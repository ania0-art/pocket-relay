# 实施记录：ACP Executor + Session 管理集成

## 概述

本文档记录本次开发会话的完整工作内容，涵盖架构分析、技术决策和代码变更。

---

## 一、架构分析结论

### 现有架构数据流

```
飞书消息
  → LarkChannel (WebSocket 长连接)
  → Daemon._onIncomingMessage()
  → 命令匹配 (IFeishuCommand) 或 _enqueueTask()
  → TaskQueue (串行队列)
  → _runTask()
  → ClaudeCodeExecutor.execute()
  → SpawnExecutor (spawn claude CLI)
  → OutputBuffer → send() → 飞书回复
```

### 关键发现

1. **IChannel 接口过于简单**：只有 `send()`，无法支持权限审批（需要按钮交互）和进度通知
2. **SessionManager 是 per-chatId 设计**：`chatId → Session`，每个飞书群独立管理 claudeSessionId，这比方案 08 中"全局 currentAgentSessionId"更合理
3. **Daemon 已经依赖注入**：`new Daemon(channel, executor)` 签名干净，扩展时保持不变
4. **`@anthropic-ai/claude-agent-sdk` 已安装**：`listSessions()` 可直接调用，无需启动进程

---

## 二、技术决策

### 2.1 per-chatId Session 管理（保留现有设计）

方案 08 原设计是全局 `currentAgentSessionId`，但现有 `SessionManager` 已经是 per-chatId 的 `claudeSessionId`。

**决策**：保留 per-chatId 设计。多个飞书群可以独立使用不同的 Claude 会话，更符合实际使用场景。

### 2.2 IChannel 可选扩展（向后兼容）

新增方法设为可选（`?`），LarkChannel 实现，其他 Channel 可以不实现：
- 权限审批在没有 `sendInteractiveMessage` 时默认拒绝
- 进度通知在没有 `sendProgressUpdate` 时静默忽略

### 2.3 Executor Callbacks 注入

Daemon 构造函数签名保持 `new Daemon(channel, executor)` 不变。Daemon 内部通过 `instanceof ClaudeCodeAcpExecutor` 检测，调用 `executor.setCallbacks()` 注入回调。

### 2.4 `listSessions` 直接调用 SDK

`@anthropic-ai/claude-agent-sdk` 的 `listSessions()` 是独立函数，无需启动进程，两种执行器模式（Spawn/ACP）都可以使用。

---

## 三、文件变更清单

### packages/types

| 文件 | 变更 |
|------|------|
| `src/channel.ts` | 新增 `InteractiveMessage`、`ProgressUpdate` 类型 |
| `src/executor.ts` | 新增 `PermissionRequest`、`PermissionRequestCallback`、`ProgressUpdateCallback` |
| `src/session.ts` | 新增 `AgentSessionInfo`、`ListSessionsOptions` |

### packages/channel

| 文件 | 变更 |
|------|------|
| `src/IChannel.ts` | 新增可选方法 `sendInteractiveMessage`、`sendProgressUpdate` |
| `src/lark/LarkFormatter.ts` | 新增 `toInteractiveCard()` — 构造飞书交互式卡片 |
| `src/lark/LarkChannel.ts` | 实现 `sendInteractiveMessage`（卡片+等待回调）、`sendProgressUpdate`、`_handleCardAction` |

### packages/executor

| 文件 | 变更 |
|------|------|
| `src/claude-code/utils/stream.ts` | 新增 Node.js Stream ↔ Web Stream 转换工具 |
| `src/claude-code/ClaudeCodeAcpExecutor.ts` | 新增 ACP 执行器实现 |
| `src/index.ts` | 导出 `ClaudeCodeAcpExecutor` |

### packages/core

| 文件 | 变更 |
|------|------|
| `package.json` | 新增 `@anthropic-ai/claude-agent-sdk` 依赖 |
| `src/daemon/commands/IFeishuCommand.ts` | `IDaemonCommandContext` 新增 `listAgentSessions` |
| `src/daemon/commands/SessionListCommand.ts` | 新增 `/session-list` 命令 |
| `src/daemon/commands/index.ts` | 导出 `SessionListCommand` |
| `src/daemon/Daemon.ts` | 新增 `listAgentSessions`、权限审批/进度回调、注册 `SessionListCommand` |
| `src/cli/start.ts` | 新增 `--executor-mode acp\|spawn` 选项 |

---

## 四、新增功能说明

### 4.1 ACP 执行器（ClaudeCodeAcpExecutor）

- spawn `@agentclientprotocol/claude-agent-acp` 进程，长期运行
- 通过 ACP 协议（JSON-RPC over stdio）执行任务
- 支持 `loadSession`（恢复会话）和 `newSession`（新建会话）
- 权限审批通过 `onPermissionRequest` 回调通知 Daemon
- 进度更新通过 `onProgressUpdate` 回调通知 Daemon
- `dispose()` 方法优雅关闭进程

### 4.2 飞书交互式卡片（权限审批）

- `LarkChannel.sendInteractiveMessage()` 发送带按钮的飞书卡片
- 通过 `CardActionHandler` 接收用户点击事件
- 使用 `interactionId` 匹配等待中的 Promise
- 超时 5 分钟自动拒绝

### 4.3 /session-list 命令

- 调用 `@anthropic-ai/claude-agent-sdk` 的 `listSessions()` 获取会话列表
- 标记当前 chatId 选中的会话（`>>` 前缀）
- 支持 `/session-list [limit]` 参数
- 兼容 `/sessions` 简写

### 4.4 --executor-mode 启动参数

```bash
pcr start                        # 默认 spawn 模式
pcr start --executor-mode acp    # ACP 交互模式（支持权限审批）
pcr start --executor-mode spawn  # 显式指定 spawn 模式
```

---

## 五、相关文档

- `docs/05-claude-code-acp-executor.md` — ACP Executor 技术方案
- `docs/08-integrated-session-management.md` — Session 管理技术方案
