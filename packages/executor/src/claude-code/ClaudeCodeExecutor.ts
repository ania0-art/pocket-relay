import type { ExecutionChunk, ExecutionResult, ExecutorConfig } from '@pocket-relay/types'
import type { IExecutor, ExecuteOptions } from '../IExecutor.js'
import { SpawnExecutor, type SpawnChunk } from '../spawn/SpawnExecutor.js'

/**
 * Claude Code Spawn 模式执行器。
 *
 * 每次任务 spawn 一个新的 `claude` 进程，通过 `-p` 非交互模式执行 prompt。
 * 适合简单查询；不支持权限审批（使用 `--dangerously-skip-permissions`）。
 * 需要交互审批时请使用 ClaudeCodeAcpExecutor。
 */
export class ClaudeCodeExecutor implements IExecutor {
  private readonly config: ExecutorConfig
  private readonly spawnExecutor = new SpawnExecutor()

  constructor(config: ExecutorConfig) {
    this.config = config
  }

  async execute(
    taskId: string,
    prompt: string,
    onChunk: (chunk: ExecutionChunk) => void,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    const args: string[] = ['-p', '--dangerously-skip-permissions']

    if (options?.createNewSession) {
      // 不传 --continue 或 --resume，Claude 会自动创建新会话
    } else if (options?.agentSessionId) {
      args.push('--resume', options.agentSessionId)
    } else {
      args.push('--continue') // 默认继续最新会话
    }

    args.push(prompt)

    console.log('[ClaudeCodeExecutor] 执行命令:', this.config.claudeBin, args.join(' '))

    const spawnResult = await this.spawnExecutor.execute(
      taskId,
      {
        command: this.config.claudeBin,
        args,
        cwd: this.config.cwd,
        timeoutMs: this.config.timeoutMs
      },
      (chunk: SpawnChunk) => {
        onChunk({
          taskId,
          type: chunk.type,
          data: chunk.data
        })
      }
    )

    return {
      taskId,
      exitCode: spawnResult.exitCode,
      fullOutput: spawnResult.fullOutput,
      durationMs: spawnResult.durationMs,
      timedOut: spawnResult.timedOut
    }
  }

  cancel(taskId: string): void {
    this.spawnExecutor.cancel(taskId)
  }
}
