export type SessionStatus = 'idle' | 'busy';

export interface Session {
  id: string;                    // PocketRelay 内部会话 ID
  chatId: string;                // 飞书 chat_id
  claudeSessionId?: string;       // Claude Code 的会话 ID（如果有）
  status: SessionStatus;
  createdAt: number;
  lastActiveAt: number;
}

export type SessionAction =
  | { type: 'new' }                              // 全新会话
  | { type: 'continue' }                         // 继续当前会话
  | { type: 'resume'; sessionId: string };       // 恢复指定会话

/**
 * Claude Code Agent 会话信息（从 SDK 获取）
 */
export interface AgentSessionInfo {
  sessionId: string;
  cwd?: string;
  title: string;
  updatedAt: string;   // ISO 8601
  createdAt?: string;
  gitBranch?: string;
  tag?: string;
  fileSize?: number;
}

/**
 * 列出 Agent 会话的选项
 */
export interface ListSessionsOptions {
  dir?: string;
  limit?: number;
  offset?: number;
  includeWorktrees?: boolean;
}
