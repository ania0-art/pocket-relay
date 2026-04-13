import type { Task } from '@pocket-relay/types';
import type { ExecuteOptions } from '@pocket-relay/executor';

type QueueItem = {
  task: Task;
  executeOptions?: ExecuteOptions;
};

type RunTaskCallback = (task: Task, executeOptions?: ExecuteOptions) => Promise<void>;

/**
 * 串行任务队列 — 保证同一时刻只有一个任务在执行。
 *
 * 设计原因：Claude Code 进程是有状态的，并发执行会导致会话混乱。
 * 用户发送多条消息时，后续消息排队等待前一个任务完成。
 */
export class TaskQueue {
  private queue: QueueItem[] = [];
  private running = false;
  private runTaskCallback: RunTaskCallback | null = null;

  constructor() {}

  /** 注入实际执行逻辑（由 Daemon 在构造时设置，避免循环依赖） */
  setRunTaskCallback(callback: RunTaskCallback): void {
    this.runTaskCallback = callback;
  }

  /**
   * 将任务加入队列，若当前空闲则立即开始执行。
   * @returns 任务在队列中的位置（1 = 立即执行，>1 = 排队中）
   */
  enqueue(task: Task, executeOptions?: ExecuteOptions): number {
    this.queue.push({ task, executeOptions });
    const position = this.queue.length;
    if (!this.running) {
      this._processNext();
    }
    return position;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private async _processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.running = false;
      return;
    }

    this.running = true;
    const item = this.queue.shift()!;
    item.task.status = 'running';

    try {
      await this.runTaskCallback?.(item.task, item.executeOptions);
      item.task.status = 'done';
    } catch (err) {
      item.task.status = 'error';
    } finally {
      // 无论成功失败都继续处理下一个任务
      this._processNext();
    }
  }
}
