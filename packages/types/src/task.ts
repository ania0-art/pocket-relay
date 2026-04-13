export type TaskStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled'

/** 一次用户请求对应的任务，由 TaskQueue 串行执行 */
export interface Task {
  id: string
  chatId: string
  /** 对应的 PocketRelay 内部 Session ID */
  sessionId: string
  prompt: string
  createdAt: number
  status: TaskStatus
}

/** 任务执行结果（TaskQueue 内部使用） */
export interface TaskResult {
  taskId: string
  exitCode: number | null
  output: string
  error?: string
  durationMs: number
  timedOut: boolean
}
