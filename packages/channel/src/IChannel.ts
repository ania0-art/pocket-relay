import type { IncomingMessage, OutgoingMessage, InteractiveMessage, ProgressUpdate } from '@pocket-relay/types';

/**
 * 通信通道接口 — 抽象消息收发，屏蔽底层平台（飞书、Slack 等）。
 *
 * 可选方法（`sendInteractiveMessage`、`sendProgressUpdate`）由支持交互的 Channel 实现；
 * Daemon 在调用前检查是否存在，不存在时降级处理。
 */
export interface IChannel {
  connect(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  send(msg: OutgoingMessage): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * 发送交互式消息（带按钮），等待用户点击后返回选择的 value。
   * 用于权限审批等场景。可选实现 — 不支持时返回 'reject'。
   */
  sendInteractiveMessage?(chatId: string, message: InteractiveMessage): Promise<string>;

  /**
   * 发送进度通知。可选实现 — 不支持时静默忽略。
   */
  sendProgressUpdate?(chatId: string, update: ProgressUpdate): Promise<void>;
}
