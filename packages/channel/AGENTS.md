# @pocket-relay/channel - AGENTS.md

## 包职责

通信通道层，负责与飞书 IM 对接，抽象多平台消息收发能力。

## 架构

```
IChannel (接口)
├── registry.ts (Channel 注册表 + 工厂函数)
│   ├── SUPPORTED_CHANNELS — 已实现 channel 类型列表
│   ├── CHANNEL_REQUIRED_CONFIG — 各 channel 必填配置项
│   └── createChannel() — 工厂函数，按类型创建实例
└── LarkChannel (飞书 WebSocket 实现)
    ├── 幂等去重 (seenMessageIds)
    ├── 消息分片 (splitMessage)
    ├── 交互式卡片 (sendInteractiveMessage)
    └── LarkFormatter (飞书消息格式转换)
        ├── toTextContent()
        ├── extractText()
        └── toInteractiveCard()
```

## IChannel 接口

```typescript
interface IChannel {
  connect(): Promise<void>;
  onMessage(handler): void;
  send(msg): Promise<void>;
  disconnect(): Promise<void>;

  // 可选扩展（ACP 模式使用）
  sendInteractiveMessage?(chatId, message): Promise<string>;  // 返回用户选择的 value
  sendProgressUpdate?(chatId, update): Promise<void>;
}
```

**重要**：`sendInteractiveMessage` 和 `sendProgressUpdate` 是可选方法。新增 Channel 实现时不强制实现，但 ACP 模式的权限审批功能依赖这两个方法。

## 关键实现细节

### LarkChannel
- 使用 `@larksuiteoapi/node-sdk` WebSocket 长连接
- 幂等去重：记录最近 1000 条 `message_id`，防止重复处理
- 长消息自动分片（飞书单条消息 4000 字符限制）
- 只处理 `text` 类型消息，其他类型回复提示

### sendInteractiveMessage（权限审批）
- 发送飞书交互式卡片（带按钮）
- **卡片回调必须通过 `EventDispatcher` 注册 `card.action.trigger`**，不能用 `CardActionHandler`（仅适用于 HTTP Webhook，长连接下永远不触发）
- 用 `interactionId` 匹配等待中的 Promise
- 超时 5 分钟自动返回 `'reject'`

### toInteractiveCard（LarkFormatter）
- 构造飞书卡片 JSON（schema 2.0）
- 每个按钮的 `value` 包含 `{ interactionId, optionId }`
- `interactionId` 用于回调时定位对应的 Promise

## 扩展新 Channel

实现 `IChannel` 接口即可接入 Daemon：

```typescript
class TelegramChannel implements IChannel {
  // 必须实现
  connect, onMessage, send, disconnect

  // 可选（支持 ACP 权限审批）
  sendInteractiveMessage, sendProgressUpdate
}
```

## 关键工作点（接力必读）

### 5. Channel 元数据下沉到 channel 包（registry 模式）

PR #2 review 评论指出：`start.ts` 中存在硬编码的 channel 列表、必填配置校验、`new LarkChannel()` 构造逻辑，导致新增 channel 时必须同时改动 `core` 层。

**解决方案**：将所有 channel 元数据提取到 `src/registry.ts`：
- `SUPPORTED_CHANNELS` — 已实现类型（类型安全的 `as const` 数组）
- `CHANNEL_REQUIRED_CONFIG` — 各 channel 的必填配置键名，供 core 层统一校验
- `createChannel()` — 工厂函数，消除 `core` 层对具体实现类的直接依赖

**收益**：新增 channel 只需修改 `registry.ts` 一处，`start.ts` 零改动。

### 1. 卡片回调注册方式（已踩坑）
长连接模式下，卡片按钮回调**必须**在 `EventDispatcher` 里注册 `card.action.trigger`：
```typescript
eventDispatcher: new lark.EventDispatcher({}).register({
  'card.action.trigger': async (data) => { ... }
})
```
`CardActionHandler` 只适用于 HTTP Webhook 模式，长连接下永远不触发。详见 `docs/10-feishu-card-sdk-guide.md`。

### 2. 卡片按钮必须设置 `action_type: 'callback'`
不设置时点击按钮不会触发服务端回调，只有前端跳转行为。

### 3. v1 卡片格式回调路径
`data.action.value`（v1）vs `data.event.action.value`（v2），混用会导致取不到值。
当前实现使用 v1 格式。

### 4. WSClient.start() 不等待连接就绪（SDK bug）
`@larksuiteoapi/node-sdk` v1.60.0 的 `WSClient.start()` 内部调用 `this.reConnect(true)` 时缺少 `yield`，导致 `start()` 立即 resolve，WebSocket 连接实际在后台异步建立。
**真正就绪标志**：控制台出现 `ws client ready` 日志。
**修复方案**：`pnpm patch @larksuiteoapi/node-sdk`，将 `this.reConnect(true)` 改为 `yield this.reConnect(true)`。
详见 `docs/lark-wsclient-ready-bug.md`。

## 依赖

- `@larksuiteoapi/node-sdk`
- `@pocket-relay/types`

