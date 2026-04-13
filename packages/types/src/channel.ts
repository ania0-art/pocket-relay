/** 从 Channel 收到的用户消息 */
export interface IncomingMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  text: string;
  receivedAt: number;
}

/** 向 Channel 发送的消息 */
export interface OutgoingMessage {
  chatId: string;
  text: string;
  replyToMessageId?: string;
}

/** Channel 初始化配置（飞书 App 凭证） */
export interface ChannelConfig {
  appId: string;
  appSecret: string;
}

/**
 * 交互式消息（权限审批等场景）
 */
export interface InteractiveMessage {
  title: string;
  content: string;
  buttons: Array<{
    text: string;
    value: string;
    style?: 'primary' | 'danger' | 'default';
  }>;
}

/**
 * 进度通知
 */
export interface ProgressUpdate {
  type: 'tool_call' | 'tool_update' | 'thinking' | 'message';
  content: string;
  metadata?: Record<string, unknown>;
}
