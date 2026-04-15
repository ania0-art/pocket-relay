import type { ExecutionChunk, ExecutionResult } from '@pocket-relay/types'

export interface ExecuteOptions {
  /** 恢复指定 Agent 会话 ID，不传则新建（支持 Claude Code、Codex 等） */
  agentSessionId?: string
  /** 强制创建新会话（忽略 agentSessionId） */
  createNewSession?: boolean
}

/**
 * 执行器接口 — 所有 Agent 实现必须遵守。
 *
 * 职责边界：
 * - 只负责执行 prompt 并流式返回输出
 * - 不管理 Session（由 Daemon.SessionManager 负责）
 * - 不直接与用户交互（通过回调通知 Daemon）
 */
export interface IExecutor {
  execute(
    taskId: string,
    prompt: string,
    onChunk: (chunk: ExecutionChunk) => void,
    options?: ExecuteOptions
  ): Promise<ExecutionResult>

  cancel(taskId: string): void
}
