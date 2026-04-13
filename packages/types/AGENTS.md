# @pocket-relay/types - AGENTS.md

## 包职责

定义项目共享的 TypeScript 类型接口，无运行时代码。

## 注意事项

- 只包含类型定义，无运行时代码
- 被其他所有包依赖
- 修改类型时需同步更新使用方

## 文件列表

| 文件 | 内容 |
|------|------|
| `task.ts` | `Task`、`TaskStatus` |
| `session.ts` | `Session`、`SessionStatus`、`SessionAction`、`AgentSessionInfo`、`ListSessionsOptions` |
| `channel.ts` | `IncomingMessage`、`OutgoingMessage`、`ChannelConfig`、`InteractiveMessage`、`ProgressUpdate` |
| `executor.ts` | `ExecutorConfig`、`ExecutionChunk`、`ExecutionResult`、`PermissionRequest`、`PermissionRequestCallback`、`ProgressUpdateCallback` |

## 关键类型说明

### Session vs AgentSessionInfo

| 类型 | 来源 | 用途 |
|------|------|------|
| `Session` | PocketRelay 内部 | chatId → claudeSessionId 映射，内存存储 |
| `AgentSessionInfo` | `@anthropic-ai/claude-agent-sdk` | Claude Code 会话元数据，用于 `/session-list` 展示 |

### PermissionRequestCallback / ProgressUpdateCallback

ACP 模式专用回调类型，由 Daemon 实现，注入给 `ClaudeCodeAcpExecutor`：
- `PermissionRequestCallback`：工具调用需要用户审批时触发，返回用户选择的 `optionId`
- `ProgressUpdateCallback`：工具执行进度通知，通过 Channel 发送给用户

### InteractiveMessage

用于权限审批场景，包含标题、内容和按钮列表。由 `IChannel.sendInteractiveMessage()` 消费。

