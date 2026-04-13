import type { ExecutionChunk } from '@pocket-relay/types'

type FlushCallback = (text: string) => void

/**
 * 节流缓冲区：累积 stdout/stderr 片段，满足条件后批量触发回调。
 * 触发条件（任意一个）：
 *   1. 距上次 flush 超过 INTERVAL_MS
 *   2. 累积字符数超过 MAX_CHARS
 */
export class OutputBuffer {
  private static readonly INTERVAL_MS = 3000
  private static readonly MAX_CHARS = 800

  private buffer = ''
  private lastFlush = Date.now()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly onFlush: FlushCallback) {}

  push(chunk: ExecutionChunk): void {
    this.buffer += chunk.data

    // 超过字符上限立即 flush，避免单条飞书消息过长
    if (this.buffer.length >= OutputBuffer.MAX_CHARS) {
      this._flush()
      return
    }

    // 启动定时器（若尚未启动），保证即使内容少也能在 INTERVAL_MS 内发出
    if (this.timer === null) {
      this.timer = setTimeout(() => this._flush(), OutputBuffer.INTERVAL_MS)
    }
  }

  /** 强制 flush 剩余内容（任务结束时调用） */
  end(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length > 0) {
      this._flush()
    }
  }

  private _flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length === 0) return

    const text = this.buffer
    this.buffer = ''
    this.lastFlush = Date.now()
    this.onFlush(text)
  }
}
