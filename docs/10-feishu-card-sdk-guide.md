# 飞书卡片交互消息开发指南

本文档沉淀了 PocketRelay 开发中调研的飞书卡片交互消息（Interactive Card）完整使用方式，供 AI Agent 日后查阅。

---

## 一、核心结论（速查）

| 问题 | 结论 |
|------|------|
| 长连接下如何接收卡片回调？ | 在 `EventDispatcher` 中注册 `card.action.trigger` 事件 |
| `CardActionHandler` 用于什么？ | HTTP Webhook 模式，长连接模式**不适用** |
| 卡片消息如何发送？ | `msg_type: 'interactive'` + `content: JSON.stringify(cardJson)` |
| 需要预先设计卡片模板吗？ | **不需要**，可以动态内联 JSON（推荐），也可用模板 ID |
| 按钮回调的关键配置？ | 按钮必须设置 `action_type: 'callback'` |
| 回调数据在哪里？ | `data.action.value`（v1 格式）或 `data.event.action.value`（v2 格式） |

---

## 二、长连接模式：WSClient 用法

### 2.1 启动方式

```typescript
import * as lark from '@larksuiteoapi/node-sdk';

const wsClient = new lark.WSClient({ appId, appSecret });

await wsClient.start({
  eventDispatcher: new lark.EventDispatcher({}).register({
    // 普通消息事件
    'im.message.receive_v1': async (data) => {
      // 处理消息
    },
    // 卡片按钮点击回调 ← 长连接模式必须在这里注册
    'card.action.trigger': async (data) => {
      // data.action.value = 按钮的 value 字段
      return { toast: { type: 'success', content: '已收到' } };
    },
  }),
  // ⚠️ 不要传 cardActionHandler，WSClient.start() 的类型签名只接受 eventDispatcher
});
```

### 2.2 重要区别

| 模式 | 卡片回调注册方式 |
|------|----------------|
| **长连接（WSClient）** | `EventDispatcher` 注册 `card.action.trigger` |
| **HTTP Webhook** | `new lark.CardActionHandler({}, callback)` |

**错误示例**（长连接下不起作用）：
```typescript
// ❌ CardActionHandler 只适用于 HTTP Webhook
wsClient.start({
  cardActionHandler: new lark.CardActionHandler({}, async (data) => { ... }),
});
```

**官方示例**（`@larksuiteoapi/node-sdk` README）：
```typescript
wsClient.start({
  eventDispatcher: new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => { ... },
    'card.action.trigger': async (data) => {
      console.log(data);
      return {};
    },
  }),
});
```

---

## 三、卡片 JSON 格式

### 3.1 两种发送方式

#### 方式 A：内联 JSON（推荐，动态生成无需模板）

```typescript
await client.im.v1.message.create({
  params: { receive_id_type: 'chat_id' },
  data: {
    receive_id: chatId,
    msg_type: 'interactive',
    content: JSON.stringify(cardJson),  // 卡片 JSON 序列化为字符串
  },
});
```

#### 方式 B：使用预设模板（需在飞书开放平台预先设计）

```typescript
content: JSON.stringify({
  type: 'template',
  data: {
    template_id: 'AAqjXXXXXX',   // 在飞书卡片搭建工具中创建
    template_variable: {
      title: '动态标题',
      content: '动态内容',
    },
  },
})
```

**对于 PocketRelay**：权限审批卡片内容动态生成，使用**方式 A（内联 JSON）**。

### 3.2 v1 卡片格式（推荐）

```typescript
const cardJson = {
  // 无 schema 字段（v1 格式）
  config: { wide_screen_mode: true },
  header: {
    title: { tag: 'plain_text', content: '权限审批' },
    template: 'orange',
  },
  elements: [
    {
      tag: 'div',
      text: { tag: 'lark_md', content: '**Claude 想要执行**：Bash' },
    },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '允许一次' },
          type: 'primary',
          action_type: 'callback',   // ⚠️ 必须是 'callback' 才能触发服务端回调
          value: {                    // 透传到 data.action.value
            interactionId: 'xxx',
            optionId: 'allow_once',
          },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '拒绝' },
          type: 'danger',
          action_type: 'callback',
          value: {
            interactionId: 'xxx',
            optionId: 'reject',
          },
        },
      ],
    },
  ],
};
```

### 3.3 v2 卡片格式

```typescript
const cardJson = {
  schema: '2.0',                   // v2 标识
  config: { wide_screen_mode: true },
  header: {
    title: { tag: 'plain_text', content: '权限审批' },
    template: 'orange',
  },
  body: {
    elements: [
      {
        tag: 'markdown',
        content: '**Claude 想要执行**：Bash',
      },
      // ⚠️ schema 2.0 中按钮直接放 elements，不能用 action 容器（已废弃，会报 230099 错误）
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '允许一次' },
        type: 'primary',
        action_type: 'callback',
        value: { interactionId: 'xxx', optionId: 'allow_once' },
      },
    ],
  },
};
```

**v1 vs v2 对比**：

| 特性 | v1 | v2 |
|------|----|----|
| 标识 | 无 `schema` | `schema: '2.0'` |
| 内容位置 | `elements` 在根 | `body.elements` |
| 按钮位置 | 包在 `action` 容器里 | 直接放 `elements` |
| 回调路径 | `data.action.value` | `data.event.action.value` |
| 推荐程度 | ✅ 文档更完整 | 较新，部分文档不全 |

---

## 四、回调数据结构

### 4.1 v1 卡片回调（`card.action.trigger`）

```typescript
'card.action.trigger': async (data) => {
  // v1 格式
  const value = data.action?.value;        // = 按钮的 value 字段（完整对象）
  const interactionId = value?.interactionId;
  const optionId = value?.optionId;

  return { toast: { type: 'success', content: '已收到' } };
}
```

### 4.2 v2 卡片回调

```typescript
'card.action.trigger': async (data) => {
  // v2 格式
  const value = data.event?.action?.value;
  // ...
}
```

### 4.3 回调返回值

```typescript
// 更新 Toast 提示
return { toast: { type: 'success', content: '操作成功' } };
// type: 'success' | 'warning' | 'error' | 'info'

// 不做任何 UI 更新
return {};
```

---

## 五、完整实现示例（PocketRelay 权限审批场景）

### 5.1 LarkChannel.connect()

```typescript
async connect(): Promise<void> {
  return this.wsClient.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        await this._handleEvent(data);
      },
      'card.action.trigger': async (data) => {
        await this._handleCardAction(data);
        return { toast: { type: 'success', content: '已收到' } };
      },
    }),
  });
}
```

### 5.2 _handleCardAction()

```typescript
private async _handleCardAction(data: any): Promise<void> {
  // v1 格式：data.action.value
  const value = data?.action?.value;
  const interactionId: string = value?.interactionId ?? '';
  const selectedValue: string = value?.optionId ?? '';

  if (!interactionId || !selectedValue) return;

  const resolve = this.pendingInteractions.get(interactionId);
  if (resolve) {
    resolve(selectedValue);
  }
}
```

### 5.3 toInteractiveCard()（v1 格式）

```typescript
export function toInteractiveCard(message: InteractiveMessage, interactionId: string) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: message.title },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: message.content },
      },
      {
        tag: 'action',
        actions: message.buttons.map((btn) => ({
          tag: 'button',
          text: { tag: 'plain_text', content: btn.text },
          type: btn.style === 'danger' ? 'danger' : 'primary',
          action_type: 'callback',   // ⚠️ 必须
          value: {
            interactionId,
            optionId: btn.value,
          },
        })),
      },
    ],
  };
}
```

---

## 六、常见坑

| 坑 | 说明 |
|----|------|
| 按钮没有 `action_type: 'callback'` | 点击后不触发服务端回调，只有前端跳转 |
| 长连接下用 `CardActionHandler` | 回调永远不触发，类型签名也不兼容 |
| v1/v2 格式混用 | `schema: '2.0'` + `elements`（v1 根级位置）会导致卡片渲染失败 |
| `content` 未 JSON 序列化 | `msg_type: 'interactive'` 的 `content` 必须是字符串（`JSON.stringify`） |
| 回调路径错误 | v1 → `data.action.value`；v2 → `data.event.action.value` |

---

## 七、参考资料

- 飞书开放平台：[卡片交互机器人开发示例代码](https://open.feishu.cn/document/develop-a-card-interactive-bot/explanation-of-example-code)
- `@larksuiteoapi/node-sdk` v1.60.0 README
- 相关实现：`packages/channel/src/lark/LarkChannel.ts`、`packages/channel/src/lark/LarkFormatter.ts`
