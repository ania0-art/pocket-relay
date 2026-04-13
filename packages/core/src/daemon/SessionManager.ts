import { nanoid } from 'nanoid'
import type { Session, SessionStatus } from '@pocket-relay/types'

/**
 * 管理飞书 chatId 到 PocketRelay Session 的映射（内存存储，进程重启后丢失）。
 *
 * 注意：这里的 Session 是 PocketRelay 内部概念，不是 Claude Code 的 Session。
 * Claude Code 的会话 ID 存储在 `session.claudeSessionId` 字段中。
 */
export class SessionManager {
  private sessions = new Map<string, Session>() // chatId -> Session

  /**
   * 获取或创建一个会话（每个 chatId 对应一个）
   */
  getOrCreate(chatId: string): Session {
    let session = this.sessions.get(chatId)
    if (!session) {
      session = {
        id: nanoid(),
        chatId,
        status: 'idle',
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      }
      this.sessions.set(chatId, session)
    }
    session.lastActiveAt = Date.now()
    return session
  }

  /**
   * 为当前 chat 创建全新会话，清除旧的 claudeSessionId。
   * 对应飞书命令 `/new`。
   */
  createNew(chatId: string): Session {
    const session: Session = {
      id: nanoid(),
      chatId,
      status: 'idle',
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    }
    this.sessions.set(chatId, session)
    return session
  }

  getByChatId(chatId: string): Session | undefined {
    return this.sessions.get(chatId)
  }

  setStatus(chatId: string, status: SessionStatus): void {
    const session = this.sessions.get(chatId)
    if (session) {
      session.status = status
    }
  }

  /** 绑定 Claude Code 会话 ID，后续任务将恢复该会话 */
  setClaudeSessionId(chatId: string, claudeSessionId: string): void {
    const session = this.sessions.get(chatId)
    if (session) {
      session.claudeSessionId = claudeSessionId
    }
  }
}
