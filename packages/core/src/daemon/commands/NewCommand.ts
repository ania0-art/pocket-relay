import type { IncomingMessage } from '@pocket-relay/types';
import type { IDaemonCommand, IDaemonCommandContext } from './IDaemonCommand';

/** `/new` — 清除当前 claudeSessionId，下次任务时创建全新 Claude 会话 */
export class NewCommand implements IDaemonCommand {
  readonly prefix = '/new';

  matches(text: string): boolean {
    return text === '/new' || text === '/new ';
  }

  async execute(ctx: IDaemonCommandContext, msg: IncomingMessage): Promise<void> {
    ctx.sessionManager.createNew(msg.chatId);
    await ctx.send(msg.chatId, '✅ 新会话已创建');
  }
}
