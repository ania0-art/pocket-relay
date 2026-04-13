# ACP Executor 已知问题

## 问题1：输出内容重复 / 语序混乱

### 现象

飞书收到的消息中，内容出现重复片段，例如：
> 根据系统上下文，当根据系统上下文，当前 harness 环境信息...

### 分析状态

**待确认**：需要在 `_createClientHandler.sessionUpdate` 加日志，观察 `notification.update.sessionUpdate` 和 `notification.sessionId` 的触发情况。

**已排除**：
- OutputBuffer 逻辑正确（有 `buffer.length > 0` 保护，`end()` 不会重复 flush）
- `loadSession` 历史重放：ACP 协议设计上 `loadSession` 会 stream 历史，但 `activeTasks.set` 在 `loadSession` resolve 之后，历史重放已结束，不会被接收

**待验证方向**：
- `sessionUpdate` 是否对同一 chunk 触发了两次（SDK 层面的重复通知）
- `newSession` 是否也会触发某些初始化 notifications

### 调试方法

在 `ClaudeCodeAcpExecutor._createClientHandler` 里临时加日志：
```typescript
sessionUpdate: async (notification: SessionNotification) => {
  console.log('[ACP]', notification.update.sessionUpdate, notification.sessionId);
  ...
}
```

---

## 问题2：System Prompt 内容泄漏到输出

### 现象

飞书收到的消息中包含 `<thinking_mode>interleaved</thinking_mode>`、`<max_thinking_length>31999</max_thinking_length>` 等 Claude system prompt 标签。

### 分析状态

**待确认**：与问题1同源，需要先通过日志确认 `sessionUpdate` 的触发情况。

---

## 版本信息

- `@agentclientprotocol/sdk`: 0.18.1
- `@agentclientprotocol/claude-agent-acp`: ^0.26.0

