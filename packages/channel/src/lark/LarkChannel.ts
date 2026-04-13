import * as lark from '@larksuiteoapi/node-sdk'
import type {
  ChannelConfig,
  IncomingMessage,
  OutgoingMessage,
  InteractiveMessage,
  ProgressUpdate
} from '@pocket-relay/types'
import type { IChannel } from '../IChannel'
import { extractText, splitMessage, toTextContent, toInteractiveCard } from './LarkFormatter'

/**
 * 飞书通信通道实现。
 *
 * 使用 WebSocket 长连接（WSClient）接收消息，REST API 发送消息。
 * 支持交互式卡片消息（权限审批）和进度通知。
 *
 * 注意：卡片回调必须通过 EventDispatcher 注册 `card.action.trigger`，
 * 不能使用 CardActionHandler（仅适用于 HTTP Webhook 模式）。
 */
export class LarkChannel implements IChannel {
  private client: lark.Client
  private wsClient: lark.WSClient
  private messageHandler: ((msg: IncomingMessage) => void) | null = null

  // 幂等去重：记录最近处理过的 message_id
  private seenMessageIds = new Set<string>()
  private readonly MAX_SEEN = 1000

  // 等待交互回调：messageId -> resolve
  private pendingInteractions = new Map<string, (value: string) => void>()

  constructor(config: ChannelConfig) {
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      disableTokenCache: false
    })

    this.wsClient = new lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret
    })
  }

  async connect(): Promise<void> {
    return this.wsClient.start({
      eventDispatcher: new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async data => {
          await this._handleEvent(data)
        },
        'card.action.trigger': async (data: any) => {
          console.log('[LarkChannel] card.action.trigger 完整数据:', JSON.stringify(data, null, 2))
          await this._handleCardAction(data)
          return { toast: { type: 'success', content: '已收到' } }
        },
        // 用户进入机器人单聊时发送欢迎卡片
        'im.chat.access_event.bot_p2p_chat_entered_v1': async (data: any) => {
          console.log('[LarkChannel] bot_p2p_chat_entered 事件:', JSON.stringify(data, null, 2))
          const openId: string = data?.operator_id?.open_id ?? ''
          if (!openId) {
            console.log('[LarkChannel] bot_p2p_chat_entered: 未获取到 open_id')
            return
          }
          console.log('[LarkChannel] 发送欢迎卡片到:', openId)
          await this.client.im.v1.message.create({
            params: { receive_id_type: 'open_id' },
            data: {
              receive_id: openId,
              msg_type: 'interactive',
              content: JSON.stringify({
                type: 'template',
                data: { template_id: 'AAqeUxe2zCgCx' }
              })
            }
          })
        }
      })
    })
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler
  }

  async send(msg: OutgoingMessage): Promise<void> {
    console.log('[LarkChannel] 发送消息:', msg)
    const chunks = splitMessage(msg.text)
    for (const chunk of chunks) {
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: msg.chatId,
          msg_type: 'text',
          content: toTextContent(chunk),
          ...(msg.replyToMessageId ? { reply_in_thread: false } : {})
        }
      })
    }
  }

  async sendInteractiveMessage(chatId: string, message: InteractiveMessage): Promise<string> {
    // 每次生成唯一 ID，用于回调时匹配对应的 Promise
    const interactionId = `interaction_${Date.now()}_${Math.random().toString(36).slice(2)}`

    const cardContent = toInteractiveCard(message, interactionId)

    await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(cardContent)
      }
    })

    // 等待用户点击按钮（最多 5 分钟）
    return new Promise<string>(resolve => {
      const timer = setTimeout(
        () => {
          this.pendingInteractions.delete(interactionId)
          resolve('reject')
        },
        5 * 60 * 1000
      )

      this.pendingInteractions.set(interactionId, value => {
        clearTimeout(timer)
        this.pendingInteractions.delete(interactionId)
        resolve(value)
      })
    })
  }

  async sendProgressUpdate(chatId: string, update: ProgressUpdate): Promise<void> {
    const icon =
      update.type === 'tool_call'
        ? '🔧'
        : update.type === 'tool_update'
          ? '⏳'
          : update.type === 'thinking'
            ? '🤔'
            : '💬'
    await this.send({ chatId, text: `${icon} ${update.content}` })
  }

  async disconnect(): Promise<void> {
    // @larksuiteoapi/node-sdk WSClient 无显式 close API，进程退出时自动断开
  }

  private async _handleCardAction(data: any): Promise<void> {
    console.log('[LarkChannel] card.action.trigger 完整数据:', JSON.stringify(data, null, 2))
    const action = data?.action
    const value = action?.value ?? {}

    // 欢迎卡片"开始使用"按钮：发送绑定提示
    if (value.type === 'start_use') {
      const openId: string = data?.operator?.open_id ?? ''
      if (openId) {
        await this.client.im.v1.message.create({
          params: { receive_id_type: 'open_id' },
          data: {
            receive_id: openId,
            msg_type: 'text',
            content: JSON.stringify({
              text: '请向 PCR 进程发送 `/bind <node-id>` 完成绑定。\n\nNode ID 在启动 PCR 时会打印在终端中。'
            })
          }
        })
      }
      return
    }

    // 权限审批卡片回调：通过 interactionId 匹配等待的 Promise
    const interactionId: string = value?.interactionId ?? ''
    const selectedValue: string = value?.optionId ?? ''

    if (!interactionId || !selectedValue) return

    // 找到对应的等待 Promise 并 resolve，sendInteractiveMessage 将返回用户选择
    const resolve = this.pendingInteractions.get(interactionId)
    if (resolve) {
      resolve(selectedValue)
    }
  }

  private async _handleEvent(data: any): Promise<void> {
    console.log('[LarkChannel] 收到事件:', JSON.stringify(data, null, 2))

    const message = data?.message
    if (!message) return

    const messageId: string = message.message_id
    const chatId: string = message.chat_id
    // open_id 是飞书用户的唯一标识，用于过滤 @机器人 标记
    const senderId: string = data?.sender?.sender_id?.open_id ?? ''
    const msgType: string = message.message_type
    const content: string = message.content ?? '{}'

    console.log('[LarkChannel] 解析结果:', { messageId, chatId, senderId, msgType, content })

    // 飞书 WebSocket 长连接偶尔会重复推送同一条消息，用 messageId 去重
    if (this.seenMessageIds.has(messageId)) {
      console.log('[LarkChannel] 重复消息，跳过:', messageId)
      return
    }
    this._trackMessageId(messageId)

    // 目前只处理纯文本消息，图片/文件/表情等类型暂不支持
    if (msgType !== 'text') {
      console.log('[LarkChannel] 非文本消息，跳过:', msgType)
      if (this.messageHandler) {
        await this.send({
          chatId,
          text: '暂仅支持文字指令，图片/文件等暂不支持。'
        })
      }
      return
    }

    // extractText 会去掉 @机器人 的 mention 标记，返回纯文本指令
    const text = extractText(content, senderId)
    console.log('[LarkChannel] 提取到文本:', text)
    if (!text) return

    const incoming: IncomingMessage = {
      messageId,
      chatId,
      senderId,
      text,
      receivedAt: Date.now()
    }

    console.log('[LarkChannel] 传递给 messageHandler:', incoming)
    this.messageHandler?.(incoming)
  }

  private _trackMessageId(id: string): void {
    this.seenMessageIds.add(id)
    // 内存去重集合上限 1000 条，超出时删除最老的一半（LRU 近似）
    // 避免长期运行后内存无限增长
    if (this.seenMessageIds.size > this.MAX_SEEN) {
      const entries = [...this.seenMessageIds]
      entries.slice(0, this.MAX_SEEN / 2).forEach(e => this.seenMessageIds.delete(e))
    }
  }
}
