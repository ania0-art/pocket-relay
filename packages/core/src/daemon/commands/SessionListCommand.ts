import type { IncomingMessage } from '@pocket-relay/types'
import type { IDaemonCommand, IDaemonCommandContext } from './IDaemonCommand'

export class SessionListCommand implements IDaemonCommand {
  readonly prefix = '/session-list'

  matches(text: string): boolean {
    return text === '/session-list' || text.startsWith('/session-list ') || text === '/sessions'
  }

  async execute(ctx: IDaemonCommandContext, msg: IncomingMessage, text: string): Promise<void> {
    const args = text.replace(/^\/sessions?(?:-list)?/, '').trim()
    const limit = args ? parseInt(args, 10) : undefined
    if (args && isNaN(limit!)) {
      await ctx.send(
        msg.chatId,
        '参数错误：limit 必须是数字\n用法: `/session-list` 或 `/session-list 20`'
      )
      return
    }

    try {
      const sessions = await ctx.listAgentSessions({ limit, dir: ctx.cwd })

      if (sessions.length === 0) {
        await ctx.send(msg.chatId, '暂无会话')
        return
      }

      const currentSession = ctx.sessionManager.getByChatId(msg.chatId)
      const currentClaudeSessionId = currentSession?.claudeSessionId

      let message = 'Claude Code 会话列表\n\n'
      sessions.forEach((session, index) => {
        const isCurrent = session.sessionId === currentClaudeSessionId
        const marker = isCurrent ? '>> ' : '   '
        const date = new Date(session.updatedAt).toLocaleString('zh-CN')

        message += `${marker}${index + 1}. ${session.title}\n`
        message += `   ID: ${session.sessionId}\n`
        if (session.cwd) message += `   目录: ${session.cwd}\n`
        if (session.gitBranch) message += `   分支: ${session.gitBranch}\n`
        message += `   更新: ${date}\n`
        if (isCurrent) message += `   [当前选中]\n`
        message += '\n'
      })

      message += '快捷操作：\n'
      message += '  /resume <ID> - 切换到指定会话\n'
      message += '  /new - 创建新会话'

      await ctx.send(msg.chatId, message)
    } catch (err) {
      await ctx.send(msg.chatId, `获取会话列表失败: ${err}`)
    }
  }
}
