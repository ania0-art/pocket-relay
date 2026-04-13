# @pocket-relay/core - AGENTS.md

## 包职责

CLI 入口 + 守护进程核心逻辑。

## 代码结构与约束（必读）

```
src/
├── index.ts              # ✅ 唯一入口（必须遵守）
├── logger.ts
├── config.ts
├── cli/                   # CLI 命令（pcr config/start）
│   ├── index.ts
│   ├── config.ts
│   ├── start.ts
│   └── run.ts            # runCli() 函数
└── daemon/                # Daemon 相关
    ├── index.ts
    ├── Daemon.ts
    ├── SessionManager.ts
    ├── TaskQueue.ts
    └── commands/          # 飞书斜线命令
        ├── index.ts
        ├── IFeishuCommand.ts  # 接口（必读）
        ├── BindCommand.ts
        ├── NewCommand.ts
        ├── ResumeCommand.ts
        └── SessionListCommand.ts
```

## 约束与规范（严格遵守）

### 1. 入口规范
- **唯一入口**: `src/index.ts`
- **必须导出**: `runCli()`, `Daemon`, `SessionManager`, `TaskQueue`
- **必须自动执行**: 底部调用 `runCli()`
- **禁止**: 其他文件作为打包入口

### 2. 目录职责规范
- **cli/** → 只放 `pcr xxx` 命令
- **daemon/** → 只放 Daemon 和飞书斜线命令（`/xxx`）
- **禁止**: 混淆两种命令

### 3. 斜线命令规范
- 必须实现 `IDaemonCommand` 接口
- 必须通过 `IDaemonCommandContext` 访问 Daemon
- **禁止**: 直接访问 Daemon 私有方法/属性
- `IDaemonCommandContext` 暴露的能力：`sessionManager`、`send()`、`listAgentSessions()`

### 4. Task 接口规范
- **必须包含 `chatId` 字段**: 用于获取 Session 和发送回复
- 详见: `docs/04-session-chat-id-explained.md`

## Daemon 职责

```
接收飞书消息
  → 命令匹配（/bind /new /resume /session-list）
  → 或 TaskQueue 排队
  → SessionManager 获取 claudeSessionId
  → 调用 Executor（Spawn 或 ACP）
  → ACP 模式：通过 Channel 处理权限审批/进度通知
  → OutputBuffer → 回复飞书
```

## 配置优先级

命令行参数 > 当前目录 `.env.pcr` > 全局配置 (`~/.pocket-relay/config.json`)

## CLI 命令

| 命令 | 说明 |
|------|------|
| `pcr config list` | 列出配置 |
| `pcr config set <key> <value>` | 设置配置 |
| `pcr start` | 启动守护进程（Spawn 模式） |
| `pcr start --executor-mode acp` | 启动守护进程（ACP 交互模式） |

## 飞书命令

| 命令 | 说明 |
|------|------|
| `/bind <node-id>` | 绑定当前飞书会话到此 Daemon |
| `/new` | 创建新 Claude 会话（清除 claudeSessionId） |
| `/resume <session-id>` | 恢复指定 Claude 会话 |
| `/session-list [limit]` | 列出 Claude Code 会话（也支持 `/sessions`） |

## 关键概念：三种 ID

| ID 类型 | 来源 | 作用 |
|---------|------|------|
| `chatId` | 飞书 | 标识飞书聊天，用于回复消息 |
| `sessionId` (PocketRelay) | nanoid 生成 | PocketRelay 内部会话标识 |
| `claudeSessionId` | Claude Code | Claude Code 会话复用，per-chatId 存储 |

详见：`docs/04-session-chat-id-explained.md`

## 关键工作点（接力必读）

### 1. cwd 传递链
`start.ts` 的 `claudeCwd` → `new Daemon(channel, executor, claudeCwd)` → `ctx.cwd` → `SessionListCommand` 的 `listAgentSessions({ dir: ctx.cwd })`。
`/session-list` 只显示当前工作目录下的会话，依赖此链路。

### 2. ACP 模式回调注入时机
`Daemon` 构造时通过 `instanceof ClaudeCodeAcpExecutor` 检测并注入回调。
若未来新增其他 ACP 类 executor，需在此处同步处理，或改为接口检测。

### 3. TaskQueue 串行保证
`TaskQueue` 保证同一时刻只有一个任务执行，`currentChatId` 依赖此保证（ACP 权限审批回调用它定向发消息）。
若未来支持并发任务，`currentChatId` 机制需重新设计。

### 4. position > 1 才提示排队
`enqueue()` 返回的 position 是加入后的队列长度，`position === 1` 表示立即执行，无需提示。

## 已知问题

| 问题 | 状态 |
|------|------|
| ACP 模式输出内容重复/语序混乱 | 待排查，详见 `@pocket-relay/executor` 的 `docs/acp-known-issues.md` |
| ACP 模式 API Error 400（tool_choice 冲突） | 待排查，疑似 `@agentclientprotocol/claude-agent-acp` 包问题 |



- Daemon 构造时检测 executor 类型，自动注入权限审批/进度回调
- 权限审批：通过 `IChannel.sendInteractiveMessage()` 发送飞书卡片，等待用户点击
- 进度通知：通过 `IChannel.sendProgressUpdate()` 发送工具执行状态

详见：`docs/05-claude-code-acp-executor.md`、`docs/08-integrated-session-management.md`

## 代码规范

- 格式化：`pnpm format`（Prettier）
- Lint：`pnpm lint`（ESLint）
- 详见根目录 `.prettierrc` 和 `eslint.config.js`

## 构建相关

- 构建配置：根目录 `tsup.config.ts`（统一管理）
- 构建输出：`dist/index.cjs`（根目录）
- 全局 bin: `pcr`, `pocket-relay`
- 依赖 `@anthropic-ai/claude-agent-sdk`（用于 `listSessions()`）

