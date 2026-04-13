import type { IncomingMessage } from '@pocket-relay/types'
import type { IDaemonCommand, IDaemonCommandContext } from './IDaemonCommand'

/**
 * `/bind <nodeId>` — 将当前聊天绑定到本 Daemon 节点。
 * ID 不匹配时解除绑定，支持用户切换到其他 PCR 实例。
 */
export class BindCommand implements IDaemonCommand {
  readonly prefix = '/bind'

  matches(text: string): boolean {
    return text.startsWith('/bind ')
  }

  async execute(ctx: IDaemonCommandContext, msg: IncomingMessage, text: string): Promise<void> {
    const id = text.slice(this.prefix.length).trim()
    if (id === ctx.nodeId) {
      ctx.boundChatIds.add(msg.chatId)
      await ctx.send(msg.chatId, `✅ 绑定成功！Node ID: ${ctx.nodeId}`)
    } else {
      // 不管是否匹配，都确保解除绑定（支持切换到其他 PCR）
      ctx.boundChatIds.delete(msg.chatId)
      await ctx.send(msg.chatId, `❌ 已解除绑定。我的 Node ID 是：${ctx.nodeId}`)
    }
  }
}
