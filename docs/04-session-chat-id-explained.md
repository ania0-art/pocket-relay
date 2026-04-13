# chatId vs sessionId 详解

## 概览

PocketRelay 中有三种 ID，各司其职：

| ID 类型 | 来源 | 作用 | 示例 |
|---------|------|------|------|
| `chatId` | 飞书 | 标识飞书聊天（单聊/群聊） | `oc_8237d67edffc25be75e48a3e5e7e9306` |
| `sessionId` (PocketRelay) | PocketRelay 生成 | 标识 PocketRelay 内部会话 | `WQdYYyr_Fg4r9oK61Gnet` |
| `claudeSessionId` | Claude Code | 标识 Claude Code 的会话 | （Claude Code 返回的 UUID） |

---

## chatId（飞书聊天 ID）

### 来源
- 由飞书服务器生成
- 每个飞书聊天（单聊或群聊）都有唯一的 `chatId`
- 通过飞书事件的 `message.chat_id` 字段获取

### 作用
1. **消息路由**：确定消息发给哪个飞书聊天
2. **会话绑定**：每个 chatId 绑定到一个 PocketRelay 会话
3. **用户隔离**：不同飞书用户/群聊的任务完全隔离

### 特点
- 永久不变（同一个飞书聊天的 chatId 永远不变）
- 飞书侧唯一标识

---

## sessionId（PocketRelay 会话 ID）

### 来源
- PocketRelay 启动时通过 `nanoid()` 生成
- 每个 chatId 对应一个（或多个）sessionId

### 作用
1. **内部会话管理**：SessionManager 用它来索引会话
2. **任务关联**：每个 Task 关联到一个 sessionId

### 特点
- 临时：每次重启 PocketRelay 会重新生成
- 仅在 PocketRelay 内部有意义

---

## claudeSessionId（Claude Code 会话 ID）

### 来源
- 由 Claude Code CLI 生成和返回
- 用户也可以通过 `/resume <session-id>` 手动指定

### 作用
1. **Claude 会话复用**：让 Claude Code 继续之前的会话
2. **上下文保持**：保留对话历史

### 特点
- 可选：如果没有，Claude 会创建新会话
- 仅对 Claude Code 有意义

---

## 关系图

```
飞书用户 A (chatId: oc_xxx)
    ↓ 绑定
PocketRelay 会话 (sessionId: abc_123)
    ↓ 可关联
Claude Code 会话 (claudeSessionId: uuid-xxx)


飞书用户 B (chatId: oc_yyy)
    ↓ 绑定
另一个 PocketRelay 会话 (sessionId: def_456)
```

---

## 代码中的体现

### Task 接口（`types/src/task.ts`）
```typescript
export interface Task {
  id: string;           // 任务 ID
  chatId: string;       // 飞书 chatId（用于回复消息）
  sessionId: string;    // PocketRelay sessionId
  prompt: string;
  createdAt: number;
  status: TaskStatus;
}
```

### Session 接口（`types/src/session.ts`）
```typescript
export interface Session {
  id: string;                    // PocketRelay sessionId
  chatId: string;                // 对应的飞书 chatId
  claudeSessionId?: string;       // Claude Code 的会话 ID（可选）
  status: SessionStatus;
  createdAt: number;
  lastActiveAt: number;
}
```

---

## 飞书命令与会话的关系

| 飞书命令 | 作用 |
|----------|------|
| `/bind <node-id>` | 将当前 chatId 绑定到 PocketRelay |
| `/new` | 为当前 chatId 创建新的 PocketRelay 会话（claudeSessionId 清空） |
| `/resume <claude-session-id>` | 设置当前会话的 claudeSessionId |
