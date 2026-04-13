import type { InteractiveMessage } from '@pocket-relay/types';

const MAX_LENGTH = 4000;

/**
 * 将长文本切割为飞书单条消息允许的长度（4000字符）
 */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + MAX_LENGTH));
    offset += MAX_LENGTH;
  }
  return chunks;
}

/**
 * 将文本包装为飞书 text 类型消息 content（JSON 字符串）
 */
export function toTextContent(text: string): string {
  return JSON.stringify({ text });
}

/**
 * 从飞书消息 content 字段提取纯文本
 * 兼容 text 消息类型，过滤掉 @机器人 的 mention 标记
 */
export function extractText(content: string, botOpenId: string): string | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed['text'] === 'string') {
      // 去掉 @机器人 标记（格式：@_user_1 或带 open_id）
      return (parsed['text'] as string)
        .replace(/@[^\s]+/g, '')
        .trim();
    }
    return null; // 不支持的消息类型（图片、文件等）
  } catch {
    return null;
  }
}

/**
 * 构造飞书交互式卡片（用于权限审批）
 * interactionId 用于回调时匹配等待的 Promise
 */
export function toInteractiveCard(message: InteractiveMessage, interactionId: string): object {
  return {
    schema: '2.0',
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `**${message.title}**\n\n${message.content}`,
        },
        // schema 2.0 中按钮直接放 elements，不能用 action 容器（已废弃）
        ...message.buttons.map((btn) => ({
          tag: 'button',
          text: { tag: 'plain_text', content: btn.text },
          type: btn.style === 'primary' ? 'primary' : btn.style === 'danger' ? 'danger' : 'default',
          action_type: 'callback',
          value: { interactionId, optionId: btn.value },
        })),
      ],
    },
  };
}

