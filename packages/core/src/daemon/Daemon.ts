import { nanoid } from 'nanoid'
import { listSessions as sdkListSessions } from '@anthropic-ai/claude-agent-sdk'
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import type {
  IncomingMessage,
  OutgoingMessage,
  Task,
  AgentSessionInfo,
  ListSessionsOptions,
  PermissionRequest,
  ProgressUpdate
} from '@pocket-relay/types'
import type { IChannel } from '@pocket-relay/channel'
import type { IExecutor, ExecuteOptions } from '@pocket-relay/executor'
import { OutputBuffer, ClaudeCodeAcpExecutor } from '@pocket-relay/executor'
import { SessionManager } from './SessionManager'
import { TaskQueue } from './TaskQueue'
import {
  IDaemonCommand,
  IDaemonCommandContext,
  BindCommand,
  NewCommand,
  ResumeCommand,
  SessionListCommand
} from './commands'

/**
 * PocketRelay 核心协调器。
 *
 * 职责：
 * - 接收飞书消息，分发给命令处理器或任务队列
 * - 通过 TaskQueue 串行执行用户任务
 * - 在 ACP 模式下，桥接 Executor 的权限审批和进度通知到 Channel
 *
 * 依赖注入：channel（消息通道）和 executor（Agent 执行器）在构造时传入，
 * 便于测试和切换不同实现。
 */
export class Daemon {
  readonly nodeId: string
  readonly cwd: string
  readonly boundChatIds = new Set<string>()
  readonly sessionManager = new SessionManager()
  readonly taskQueue = new TaskQueue()

  private readonly channel: IChannel
  private readonly executor: IExecutor
  private readonly commands: IDaemonCommand[]

  // 当前正在处理的 chatId（用于 ACP 回调定向发送消息）
  private currentChatId: string | null = null

  constructor(channel: IChannel, executor: IExecutor, cwd: string = process.cwd()) {
    this.nodeId = nanoid(6)
    this.cwd = cwd
    this.channel = channel
    this.executor = executor

    // 如果是 ACP executor，注入回调
    if (executor instanceof ClaudeCodeAcpExecutor) {
      executor.setCallbacks({
        onPermissionRequest: req => this._handlePermissionRequest(req),
        onProgressUpdate: update => this._handleProgressUpdate(update)
      })
    }

    // 注册斜线命令
    this.commands = [
      new BindCommand(),
      new NewCommand(),
      new ResumeCommand(),
      new SessionListCommand()
    ]

    this.taskQueue.setRunTaskCallback((task, executeOptions) => this._runTask(task, executeOptions))
  }

  async start(): Promise<void> {
    this.channel.onMessage(msg => this._onIncomingMessage(msg))
    await this.channel.connect()
  }

  // ========== 公开方法 ==========

  isBound(chatId: string): boolean {
    return this.boundChatIds.has(chatId)
  }

  async send(chatId: string, text: string): Promise<void> {
    const msg: OutgoingMessage = { chatId, text }
    try {
      await this.channel.send(msg)
    } catch (err) {
      console.error('[Daemon] 发送消息失败:', (err as Error).message)
    }
  }

  /** 未绑定时发送欢迎卡片，引导用户完成绑定并测试卡片交互 */
  async sendUnboundHint(chatId: string): Promise<void> {
    await this.send(
      chatId,
      `请先发送 /bind <node-id> 完成绑定。\n\nNode ID 在启动 PCR 时会打印在终端中。`
    )
  }

  /** 列出 Claude Code Agent 的历史会话，按 cwd 过滤 */
  async listAgentSessions(options?: ListSessionsOptions): Promise<AgentSessionInfo[]> {
    const sdkSessions = await sdkListSessions({
      dir: options?.dir,
      limit: options?.limit,
      offset: options?.offset,
      includeWorktrees: options?.includeWorktrees
    })

    return sdkSessions.map((s: SDKSessionInfo) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      title: s.customTitle || s.summary,
      updatedAt: new Date(s.lastModified).toISOString(),
      createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
      gitBranch: s.gitBranch,
      tag: s.tag,
      fileSize: s.fileSize
    }))
  }

  // ========== 私有方法 ==========

  /**
   * 消息入口：先尝试匹配斜线命令（/bind 等），
   * 未匹配则检查绑定状态，通过后进入任务队列。
   */
  private async _onIncomingMessage(msg: IncomingMessage): Promise<void> {
    const text = msg.text.trim()

    const ctx: IDaemonCommandContext = {
      nodeId: this.nodeId,
      cwd: this.cwd,
      boundChatIds: this.boundChatIds,
      sessionManager: {
        getOrCreate: (chatId: string) => this.sessionManager.getOrCreate(chatId),
        createNew: (chatId: string) => this.sessionManager.createNew(chatId),
        getByChatId: (chatId: string) => this.sessionManager.getByChatId(chatId),
        setClaudeSessionId: (chatId: string, sessionId: string) =>
          this.sessionManager.setClaudeSessionId(chatId, sessionId),
        setStatus: (chatId: string, status: any) => this.sessionManager.setStatus(chatId, status)
      },
      send: (chatId: string, text: string) => this.send(chatId, text),
      listAgentSessions: options => this.listAgentSessions(options)
    }

    for (const cmd of this.commands) {
      if (cmd.matches(text)) {
        await cmd.execute(ctx, msg, text)
        return
      }
    }

    if (!this.isBound(msg.chatId)) {
      await this.sendUnboundHint(msg.chatId)
      return
    }

    await this._enqueueTask(msg, text)
  }

  /** 构造 Task 并加入串行队列，根据 Session 状态决定新建还是恢复 Claude 会话 */
  private async _enqueueTask(msg: IncomingMessage, text: string): Promise<void> {
    const session = this.sessionManager.getOrCreate(msg.chatId)
    const task: Task = {
      id: nanoid(),
      chatId: msg.chatId,
      sessionId: session.id,
      prompt: text,
      createdAt: Date.now(),
      status: 'pending'
    }

    const executeOptions: ExecuteOptions = {}
    if (!session.claudeSessionId) {
      // 首次对话或 /new 之后，claudeSessionId 为空，强制新建 Claude 会话
      executeOptions.createNewSession = true
    } else {
      // 已有会话 ID，恢复上次对话上下文
      executeOptions.claudeSessionId = session.claudeSessionId
    }

    const position = this.taskQueue.enqueue(task, executeOptions)
    // position === 1 表示立即执行，无需提示排队
    if (position > 1) {
      await this.send(msg.chatId, `⏳ 任务已排队，当前排在第 ${position} 位`)
    }
  }

  private async _runTask(task: Task, executeOptions?: ExecuteOptions): Promise<void> {
    const session = this.sessionManager.getByChatId(task.chatId)
    if (!session) return

    // currentChatId 供 ACP 回调（权限审批、进度通知）定向发送消息
    this.currentChatId = task.chatId
    this.sessionManager.setStatus(session.chatId, 'busy')
    await this.send(session.chatId, '🚀 开始执行...')

    // OutputBuffer 节流：累积 800 字符或 3 秒后批量发送，避免飞书消息轰炸
    const outputBuffer = new OutputBuffer(async text => {
      await this.send(session.chatId, text)
    })

    try {
      const result = await this.executor.execute(
        task.id,
        task.prompt,
        chunk => outputBuffer.push(chunk),
        executeOptions
      )

      outputBuffer.end()

      const exitNote = result.timedOut
        ? `⏱️  任务超时已停止`
        : `✅ 执行完成（耗时 ${(result.durationMs / 1000).toFixed(1)}s，退出码：${result.exitCode ?? 'unknown'}）`
      await this.send(session.chatId, exitNote)
    } catch (err) {
      outputBuffer.end()
      await this.send(session.chatId, `❌ 执行出错：${(err as Error).message}`)
    } finally {
      this.sessionManager.setStatus(session.chatId, 'idle')
      this.currentChatId = null
    }
  }

  /**
   * ACP 权限审批回调：通过飞书卡片询问用户，返回用户选择的 optionId。
   * Channel 不支持交互时降级为自动拒绝。
   */
  private async _handlePermissionRequest(req: PermissionRequest): Promise<string> {
    if (!this.currentChatId || !this.channel.sendInteractiveMessage) {
      return req.options.find(o => o.kind === 'reject_once')?.optionId ?? 'reject'
    }

    try {
      return await this.channel.sendInteractiveMessage(this.currentChatId, {
        title: '权限审批',
        content: `Claude 想要执行: **${req.toolName}**`,
        buttons: req.options.map(opt => ({
          text: opt.name,
          value: opt.optionId,
          style: opt.kind === 'allow_always' || opt.kind === 'allow_once' ? 'primary' : 'danger'
        }))
      })
    } catch (err) {
      console.error('[Daemon] 发送权限审批卡片失败:', (err as Error).message)
      return req.options.find(o => o.kind === 'reject_once')?.optionId ?? 'reject'
    }
  }

  private async _handleProgressUpdate(update: ProgressUpdate): Promise<void> {
    if (!this.currentChatId || !this.channel.sendProgressUpdate) return
    try {
      await this.channel.sendProgressUpdate(this.currentChatId, update)
    } catch (err) {
      console.error('[Daemon] 发送进度更新失败:', (err as Error).message)
    }
  }
}
