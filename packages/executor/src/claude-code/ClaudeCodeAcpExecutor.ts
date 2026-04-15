import type {
  ExecutionChunk,
  ExecutionResult,
  ExecutorConfig,
  PermissionRequestCallback,
  ProgressUpdateCallback
} from '@pocket-relay/types'
import type { IExecutor, ExecuteOptions } from '../IExecutor.js'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
  type SessionNotification,
  type SessionUpdate
} from '@agentclientprotocol/sdk'
import { nodeToWebReadable, nodeToWebWritable } from './utils/stream.js'

interface ActiveTask {
  sessionId: string
  abortController: AbortController
  onChunk: (chunk: ExecutionChunk) => void
}

/**
 * Claude Code ACP 执行器
 *
 * 职责：启动 claude-agent-acp 进程，通过 ACP 协议执行任务，
 * 通过回调通知 Daemon 处理权限审批和进度更新。
 *
 * 不负责：Session 管理（由 Daemon 负责）、用户交互（由 Channel 负责）
 */
export class ClaudeCodeAcpExecutor implements IExecutor {
  private process: ChildProcess | null = null
  private connection: ClientSideConnection | null = null
  private activeTasks = new Map<string, ActiveTask>()
  private initPromise: Promise<void> | null = null

  private onPermissionRequest?: PermissionRequestCallback
  private onProgressUpdate?: ProgressUpdateCallback

  constructor(
    private config: ExecutorConfig,
    callbacks?: {
      onPermissionRequest?: PermissionRequestCallback
      onProgressUpdate?: ProgressUpdateCallback
    }
  ) {
    this.onPermissionRequest = callbacks?.onPermissionRequest
    this.onProgressUpdate = callbacks?.onProgressUpdate
  }

  setCallbacks(callbacks: {
    onPermissionRequest?: PermissionRequestCallback
    onProgressUpdate?: ProgressUpdateCallback
  }): void {
    this.onPermissionRequest = callbacks.onPermissionRequest
    this.onProgressUpdate = callbacks.onProgressUpdate
  }

  async execute(
    taskId: string,
    prompt: string,
    onChunk: (chunk: ExecutionChunk) => void,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now()

    try {
      await this.ensureConnection()

      const conn = this.connection!

      // 根据 options 决定新建还是恢复会话
      // 注意：loadSession 会通过 sessionUpdate 重放历史对话，activeTasks 需在之后注册
      let sessionId: string
      if (options?.agentSessionId) {
        await conn.loadSession({
          sessionId: options.agentSessionId,
          cwd: this.config.cwd,
          mcpServers: []
        })
        sessionId = options.agentSessionId
      } else {
        const resp = await conn.newSession({ cwd: this.config.cwd, mcpServers: [] })
        sessionId = resp.sessionId
      }

      // loadSession/newSession 完成后再注册，避免接收到历史重放的 chunk
      const abortController = new AbortController()
      this.activeTasks.set(taskId, { sessionId, abortController, onChunk })

      const result = await conn.prompt({
        sessionId,
        prompt: [{ type: 'text', text: prompt }]
      })

      return {
        taskId,
        exitCode: result.stopReason === 'end_turn' ? 0 : 1,
        fullOutput: '',
        durationMs: Date.now() - startTime,
        timedOut: result.stopReason === 'cancelled'
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        taskId,
        exitCode: 1,
        fullOutput: `Error: ${msg}`,
        durationMs: Date.now() - startTime,
        timedOut: false
      }
    } finally {
      this.activeTasks.delete(taskId)
    }
  }

  cancel(taskId: string): void {
    const task = this.activeTasks.get(taskId)
    if (task && this.connection) {
      this.connection.cancel({ sessionId: task.sessionId }).catch(() => {})
      task.abortController.abort()
    }
  }

  async dispose(): Promise<void> {
    this.process?.kill('SIGTERM')
    this.process = null
    this.connection = null
    this.initPromise = null
  }

  private async ensureConnection(): Promise<void> {
    // 已有连接直接复用，ACP 进程是长期运行的
    if (this.connection) return
    // 防止并发调用时重复初始化：第一次调用创建 Promise，后续调用等待同一个 Promise
    if (this.initPromise) return this.initPromise
    this.initPromise = this._initConnection()
    return this.initPromise
  }

  private async _initConnection(): Promise<void> {
    // shell: true 是 Windows 兼容性必须项：npx 在 Windows 上是 npx.cmd（批处理脚本），
    // shell: false 时 Node.js 找不到该可执行文件，会抛出 ENOENT
    this.process = spawn('npx', ['@agentclientprotocol/claude-agent-acp'], {
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    })

    this.process.stderr!.setEncoding('utf-8')
    this.process.stderr!.on('data', (data: string) => {
      console.error('[ClaudeCodeAcpExecutor]', data.trim())
    })

    // 进程意外退出时重置连接状态，下次 execute() 调用时会重新初始化
    this.process.on('exit', code => {
      console.error(`[ClaudeCodeAcpExecutor] 进程退出，code=${code}`)
      this.connection = null
      this.initPromise = null
    })

    // 将 Node.js Stream 转换为 Web Stream，供 ACP SDK 使用
    const input = nodeToWebWritable(this.process.stdin!)
    const output = nodeToWebReadable(this.process.stdout!)
    // ndJsonStream 将 stdin/stdout 封装为双向 NDJSON 消息流（ACP 协议的传输层）
    const stream = ndJsonStream(input, output)

    // ClientSideConnection 是 ACP 客户端，负责序列化/反序列化 JSON-RPC 消息
    // _createClientHandler 返回的 Client 对象处理来自 Agent 的请求（权限审批、进度通知）
    this.connection = new ClientSideConnection(agent => this._createClientHandler(agent), stream)

    // 握手：协商协议版本和能力，必须在发送任何请求前完成
    await this.connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'pocket-relay', version: '0.1.0' }
    })
  }

  private _createClientHandler(_agent: Agent): Client {
    return {
      sessionUpdate: async (notification: SessionNotification) => {
        // ACP Agent 通过此回调推送流式输出和工具调用状态
        // 按 sessionId 匹配活跃任务，将文本 chunk 路由到对应的 onChunk 回调
        for (const [taskId, task] of this.activeTasks) {
          if (task.sessionId === notification.sessionId) {
            const chunk = this._toExecutionChunk(taskId, notification)
            // 只有 agent_message_chunk（文本类型）才转为 ExecutionChunk，其余忽略
            if (chunk) task.onChunk(chunk)
          }
        }

        // 工具调用状态（tool_call / tool_call_update）通过 onProgressUpdate 发到飞书
        // agent_message_chunk 已由 OutputBuffer 处理，不在此推送（避免重复）
        if (this.onProgressUpdate) {
          const update = this._toProgressUpdate(notification)
          if (update) await this.onProgressUpdate(update)
        }
      },

      requestPermission: async req => {
        if (this.onPermissionRequest) {
          // 将 ACP 权限请求转发给 Daemon，Daemon 再通过 Channel 发飞书卡片询问用户
          const optionId = await this.onPermissionRequest({
            toolName: req.toolCall.title ?? 'unknown',
            toolInput: req.toolCall.rawInput,
            options: req.options.map(opt => ({
              kind: opt.kind,
              name: opt.name,
              optionId: opt.optionId
            }))
          })
          return { outcome: { outcome: 'selected', optionId } }
        }
        // 没有注册回调（非 ACP 模式或初始化未完成）时默认拒绝，优先选 reject_once
        const rejectOption = req.options.find(o => o.kind === 'reject_once')
        return {
          outcome: {
            outcome: 'selected',
            optionId: rejectOption?.optionId ?? req.options[0]?.optionId ?? 'reject'
          }
        }
      }
    }
  }

  private _toProgressUpdate(notification: SessionNotification) {
    const update: SessionUpdate = notification.update
    switch (update.sessionUpdate) {
      case 'tool_call':
        return {
          type: 'tool_call' as const,
          content: `正在执行: ${update.title ?? 'unknown'}`,
          metadata: { toolCallId: update.toolCallId }
        }
      case 'tool_call_update':
        return {
          type: 'tool_update' as const,
          content: `工具状态: ${update.status ?? ''}`,
          metadata: { toolCallId: update.toolCallId }
        }
      // agent_message_chunk 由 OutputBuffer 处理，thinking chunk 为内部信息，均不实时推送
    }
    return null
  }

  private _toExecutionChunk(
    taskId: string,
    notification: SessionNotification
  ): ExecutionChunk | null {
    const update: SessionUpdate = notification.update
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      return { taskId, type: 'stdout', data: update.content.text }
    }
    return null
  }
}
