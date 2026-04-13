import type { IncomingMessage } from '@pocket-relay/types';
import type { IDaemonCommand, IDaemonCommandContext } from './IDaemonCommand';

/** `/resume <sessionId>` — 设置下次任务恢复的 Claude 会话 ID */
export class ResumeCommand implements IDaemonCommand {
  readonly prefix = '/resume';

  matches(text: string): boolean {
    return text.startsWith('/resume ');
  }

  async execute(ctx: IDaemonCommandContext, msg: IncomingMessage, text: string): Promise<void> {
    const targetId = text.slice(this.prefix.length).trim();
    if (targetId === 'latest') {
      await ctx.send(msg.chatId, '✅ 将使用当前目录的最新会话');
    } else {
      // 设置 claudeSessionId，下次任务时使用
      ctx.sessionManager.getOrCreate(msg.chatId);
      ctx.sessionManager.setClaudeSessionId(msg.chatId, targetId);
      await ctx.send(msg.chatId, `✅ 将恢复会话: ${targetId}`);
    }
  }
}
