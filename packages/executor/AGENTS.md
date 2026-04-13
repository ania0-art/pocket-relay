# @pocket-relay/executor - AGENTS.md

## 包职责

通用执行器层，支持**多种模式**（Spawn 一次性、ACP 长连接交互）调用**多种 Agent**（Claude Code、Codex 等）。

## 架构

```
IExecutor (接口)
├── SpawnExecutor (通用 spawn 包装 - 所有 CLI Agent 的基础)
├── ClaudeCodeExecutor (Claude Code - Spawn 模式，每次任务新进程)
├── ClaudeCodeAcpExecutor (Claude Code - ACP 模式，长期运行进程)
│   └── utils/stream.ts (Node.js Stream ↔ Web Stream 转换)
└── OutputBuffer (输出缓冲/分片 - 通用)
```

## 两种执行器对比

| 特性 | ClaudeCodeExecutor (Spawn) | ClaudeCodeAcpExecutor (ACP) |
|------|--------------------------|---------------------------|
| 进程生命周期 | 每次任务新进程 | 长期运行，复用 |
| 权限审批 | 不支持（跳过所有权限） | 支持（实时询问用户） |
| 工具调用可见 | 不支持 | 支持（进度通知） |
| 会话管理 | `--resume <id>` 参数 | `loadSession` / `newSession` |
| 适用场景 | 简单查询、批量任务 | 敏感操作、需要审批的任务 |

## ClaudeCodeAcpExecutor 关键细节

### 初始化
- 懒加载：首次 `execute()` 时才 spawn `@agentclientprotocol/claude-agent-acp` 进程
- 使用 `@agentclientprotocol/sdk` 的 `ClientSideConnection` + `ndJsonStream`
- 进程退出时自动重置连接状态，下次调用重新初始化

### Callbacks（由 Daemon 注入）
```typescript
executor.setCallbacks({
  onPermissionRequest: async (req) => { /* 通过 Channel 询问用户，返回 optionId */ },
  onProgressUpdate: async (update) => { /* 通过 Channel 发送进度 */ },
})
```

**重要**：Executor 本身不知道 Channel 的存在，通过回调解耦。

### 会话处理
- `options.claudeSessionId` 存在 → `loadSession()`（恢复会话）
- `options.claudeSessionId` 不存在 → `newSession()`（新建会话）
- 返回的 `sessionId` 由 Daemon 通过 `SessionManager` 管理

## 约束与规范

### 1. 接口规范
- 所有执行器必须实现 `IExecutor` 接口
- `execute()` 方法签名保持一致，不得修改

### 2. 职责边界
- Executor **不管理** Session（由 Daemon 的 SessionManager 负责）
- Executor **不直接交互**用户（通过回调通知 Daemon，由 Daemon 通过 Channel 交互）
- Executor **不知道** Channel 的存在

### 3. 扩展新 Agent
- 新建类实现 `IExecutor` 接口
- CLI 类 Agent 基于 `SpawnExecutor`，避免重复写 spawn 逻辑
- ACP 类 Agent 参考 `ClaudeCodeAcpExecutor`

## 关键工作点（接力必读）

### 1. Windows spawn 必须 shell: true
`ClaudeCodeAcpExecutor` 用 `shell: true` spawn `npx`。
Windows 上 `npx` 是 `npx.cmd`（批处理脚本），`shell: false` 会抛 ENOENT。

### 2. activeTasks.set 必须在 loadSession/newSession 之后
`loadSession` 会通过 `sessionUpdate` 重放整个历史对话（ACP 协议设计行为）。
若在 `loadSession` 之前注册 `activeTasks`，历史重放的 chunk 会被当成新输出发到飞书。

### 3. agent_message_chunk 不走 _toProgressUpdate
`agent_message_chunk` 已由 `OutputBuffer` 通过 `onChunk` 路径处理。
若同时在 `_toProgressUpdate` 里处理，会导致每个 token 单独发一条飞书消息（已修复）。

### 4. OutputBuffer 节流参数
- `INTERVAL_MS = 3000`：3 秒无新内容则 flush
- `MAX_CHARS = 800`：累积超 800 字符立即 flush
- 修改这两个参数会直接影响飞书消息频率和延迟



详见 [`docs/acp-known-issues.md`](docs/acp-known-issues.md)

| 问题 | 根源 | 状态 |
|------|------|------|
| 输出内容重复/语序混乱 | ACP 进程在每次 prompt 时重放历史上下文 chunk | 待修复 |
| System prompt 内容泄漏到输出 | ACP 进程把 system prompt 当成 `agent_message_chunk` 流出 | 待修复 |

## 依赖

- `@pocket-relay/types`
- `@agentclientprotocol/sdk` — ACP 协议 SDK（v0.18.1）
- `@agentclientprotocol/claude-agent-acp` — Claude Code ACP Agent（运行时 spawn，v^0.26.0）

