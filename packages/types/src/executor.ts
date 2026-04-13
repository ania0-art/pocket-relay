/** 执行器配置，由 start.ts 构造后注入 */
export interface ExecutorConfig {
  claudeBin: string
  cwd: string
  timeoutMs: number
}

/** 执行过程中的流式输出片段 */
export interface ExecutionChunk {
  taskId: string
  type: 'stdout' | 'stderr'
  data: string
}

/** 任务执行完成后的汇总结果 */
export interface ExecutionResult {
  taskId: string
  exitCode: number | null
  fullOutput: string
  durationMs: number
  timedOut: boolean
}

/**
 * 权限请求（ACP 模式下工具调用需要用户审批）
 */
export interface PermissionRequest {
  toolName: string
  toolInput: unknown
  options: Array<{
    kind: string
    name: string
    optionId: string
  }>
}

/**
 * 权限请求回调 — 由 Daemon 实现，通过 Channel 询问用户
 * 返回用户选择的 optionId
 */
export type PermissionRequestCallback = (request: PermissionRequest) => Promise<string>

/**
 * 进度更新回调 — 由 Daemon 实现，通过 Channel 通知用户
 */
export type ProgressUpdateCallback = (update: import('./channel').ProgressUpdate) => Promise<void>
