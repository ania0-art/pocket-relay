# 集成 Session 管理完整方案（修订版）

## 概述

本文档描述 PocketRelay 的 Session 管理完整技术方案，利用 `@anthropic-ai/claude-agent-sdk` 独立函数实现双模式统一的会话管理功能。

**核心定位**：在 **Daemon 层** 统一管理 Claude Code 会话，支持会话列表、切换、持久化等功能。

---

## 一、方案定位

### 1.1 职责清晰划分

```
┌─────────────────────────────────────────────────────────────┐
│                        Daemon                                │
├─────────────────────────────────────────────────────────────┤
│  职责：                                                       │
│  • Session 管理 (currentAgentSessionId)                     │
│  • 调用 SDK 获取会话列表 (listSessions)                      │
│  • 任务调度                                                   │
│  • Channel 协调（权限审批、进度通知）                         │
└─────────────────────────────────────────────────────────────┘
                    │                    │
                    ▼                    ▼
        ┌───────────────────┐   ┌──────────────────┐
        │  IExecutor        │   │  IChannel        │
        ├───────────────────┤   ├──────────────────┤
        │ 职责：执行任务     │   │ 职责：用户交互    │
        │ • execute()       │   │ • sendMessage()  │
        │ • cancel()        │   │ • sendInteractive│
        └───────────────────┘   └──────────────────┘
```

### 1.2 与 05 方案的关系

| 方案 | 职责 | 层级 |
|------|------|------|
| **08 方案（本文档）** | Session 管理 | Daemon 层 |
| **05 方案** | ACP Executor 实现（实时交互） | Executor 层 |

**关系**：互补，不重复
- 08 负责管理会话列表、当前会话选择
- 05 负责执行任务、实时交互

---

## 二、重大发现

### 2.1 核心突破

`@anthropic-ai/claude-agent-sdk` 直接导出了**独立的工具函数**，**不需要启动 Claude Code 进程**即可使用：

```typescript
import {
  listSessions,
  getSessionMessages,
  getSessionInfo,
} from '@anthropic-ai/claude-agent-sdk';

// ✅ 直接调用，无需 spawn 进程
const sessions = await listSessions({ dir: '/path/to/project' });
```

### 2.2 可用的 SDK 函数

| 函数 | 说明 |
|------|------|
| `listSessions(options?)` | 列出会话 |
| `getSessionInfo(sessionId, options?)` | 获取单个会话信息 |
| `getSessionMessages(sessionId, options?)` | 获取会话消息 |

---

## 三、详细设计

### 3.1 类型定义

**文件**: `packages/types/src/session.ts`

```typescript
/**
 * Claude Code 会话信息（从 SDK 获取）
 */
export interface AgentSessionInfo {
  sessionId: string;
  cwd?: string;
  title: string;
  updatedAt: string;  // ISO 8601
  createdAt?: string;
  gitBranch?: string;
  tag?: string;
  fileSize?: number;
}

/**
 * 列出会话的选项
 */
export interface ListSessionsOptions {
  dir?: string;
  limit?: number;
  offset?: number;
  includeWorktrees?: boolean;
}

/**
 * 会话操作类型
 */
export type SessionAction =
  | { type: 'new' }
  | { type: 'continue' }
  | { type: 'resume'; sessionId: string };
```

### 3.2 依赖更新

**文件**: `packages/core/package.json`

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.96"
  }
}
```

### 3.3 Daemon 层实现

**文件**: `packages/core/src/daemon/Daemon.ts`

```typescript
import { listSessions as listSessionsFromSdk } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentSessionInfo,
  ListSessionsOptions,
  IChannel,
  PermissionRequest,
  ProgressUpdate,
} from '@pocket-relay/types';

export class Daemon {
  // ============ 现有状态 ============
  private taskQueue: TaskQueue;
  private executor: IExecutor;
  private channel: IChannel;  // ✅ 通用 Channel 接口

  // ============ Session 管理状态 ============
  /**
   * 用户当前选择的 Claude Code 会话 ID
   * null 表示未选择，每次执行创建新会话
   */
  private currentAgentSessionId: string | null = null;

  /**
   * 持久化配置文件路径
   */
  private readonly pocketRelayConfigPath: string;

  /**
   * 当前处理的 chatId（用于回调）
   */
  private currentChatId: string | null = null;

  constructor(config: DaemonConfig) {
    // ... 现有初始化 ...

    this.pocketRelayConfigPath = path.join(
      os.homedir(),
      '.claude',
      'pocket-relay.json'
    );

    // 创建 Channel（根据配置选择）
    this.channel = this.createChannel(config.channelType);

    // 创建 Executor（根据配置选择）
    this.executor = this.createExecutor(config.executorMode);

    // 启动时加载上次选择的会话
    this.loadPersistedSession();
  }

  // ============ Session 管理方法 ============

  /**
   * 列出 Claude Code 会话
   *
   * 直接调用 SDK 函数，两种模式都支持！
   */
  async listAgentSessions(options?: ListSessionsOptions): Promise<AgentSessionInfo[]> {
    const sdkSessions = await listSessionsFromSdk({
      dir: options?.dir ?? this.config.cwd,
      limit: options?.limit,
      offset: options?.offset,
      includeWorktrees: options?.includeWorktrees,
    });

    return sdkSessions.map((sdkSession) => ({
      sessionId: sdkSession.sessionId,
      cwd: sdkSession.cwd,
      title: sdkSession.customTitle || sdkSession.summary,
      updatedAt: new Date(sdkSession.lastModified).toISOString(),
      createdAt: sdkSession.createdAt
        ? new Date(sdkSession.createdAt).toISOString()
        : undefined,
      gitBranch: sdkSession.gitBranch,
      tag: sdkSession.tag,
      fileSize: sdkSession.fileSize,
    }));
  }

  /**
   * 获取当前选择的会话
   */
  getCurrentAgentSession(): string | null {
    return this.currentAgentSessionId;
  }

  /**
   * 设置当前选择的会话
   */
  setCurrentAgentSession(sessionId: string | null): void {
    this.currentAgentSessionId = sessionId;
    this.savePersistedSession();
  }

  // ============ 持久化方法 ============

  /**
   * 从持久化文件加载上次选择的会话
   */
  private loadPersistedSession(): void {
    try {
      if (fs.existsSync(this.pocketRelayConfigPath)) {
        const content = fs.readFileSync(this.pocketRelayConfigPath, 'utf-8');
        const config = JSON.parse(content);
        if (config.currentAgentSessionId) {
          this.currentAgentSessionId = config.currentAgentSessionId;
        }
      }
    } catch {
      // 忽略错误，不影响启动
    }
  }

  /**
   * 持久化当前选择的会话
   */
  private savePersistedSession(): void {
    try {
      const dir = path.dirname(this.pocketRelayConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const config = {
        currentAgentSessionId: this.currentAgentSessionId,
      };
      fs.writeFileSync(
        this.pocketRelayConfigPath,
        JSON.stringify(config, null, 2)
      );
    } catch {
      // 忽略错误
    }
  }

  // ============ Executor 工厂 ============

  private createExecutor(mode: string): IExecutor {
    if (mode === 'acp') {
      // ACP 模式：传入回调
      return new ClaudeCodeAcpExecutor(this.config.executorConfig, {
        onPermissionRequest: async (req) => {
          return await this.handlePermissionRequest(req);
        },
        onProgressUpdate: async (update) => {
          await this.handleProgressUpdate(update);
        },
      });
    } else {
      // Spawn 模式
      return new ClaudeCodeExecutor(this.config.executorConfig);
    }
  }

  // ============ Channel 工厂 ============

  private createChannel(type: string): IChannel {
    switch (type) {
      case 'lark':
        return new LarkChannel(this.config.larkConfig);
      case 'telegram':
        return new TelegramChannel(this.config.telegramConfig);
      case 'wechat':
        return new WechatChannel(this.config.wechatConfig);
      default:
        throw new Error(`Unknown channel type: ${type}`);
    }
  }

  // ============ 权限审批处理（ACP 模式回调）============

  private async handlePermissionRequest(req: PermissionRequest): Promise<string> {
    if (!this.currentChatId) {
      // 没有 chatId，默认拒绝
      return 'reject';
    }

    // ✅ 通过 Channel 询问用户（不管是飞书、TG 还是微信）
    const decision = await this.channel.sendInteractiveMessage(
      this.currentChatId,
      {
        title: '权限审批',
        content: `Claude 想要执行: ${req.toolName}`,
        buttons: req.options.map((opt) => ({
          text: opt.name,
          value: opt.optionId,
          style: opt.kind === 'allow_always' ? 'primary' : 'default',
        })),
      }
    );
    return decision;
  }

  // ============ 进度通知处理（ACP 模式回调）============

  private async handleProgressUpdate(update: ProgressUpdate): Promise<void> {
    if (!this.currentChatId) {
      return;
    }

    // ✅ 通过 Channel 发送进度（不管是飞书、TG 还是微信）
    await this.channel.sendProgressUpdate(this.currentChatId, update);
  }

  // ============ 执行任务 ============

  private async executeTask(
    taskId: string,
    chatId: string,
    prompt: string
  ): Promise<void> {
    // 设置当前 chatId（用于回调）
    this.currentChatId = chatId;

    try {
      // ✅ 使用 Daemon 管理的 sessionId
      const options: ExecuteOptions = {
        claudeSessionId: this.currentAgentSessionId || undefined,
        createNewSession: !this.currentAgentSessionId,
      };

      const result = await this.executor.execute(
        taskId,
        prompt,
        (chunk) => {
          /* ... */
        },
        options
      );

      // ... 处理结果 ...
    } finally {
      this.currentChatId = null;
    }
  }
}
```

---

## 四、飞书命令实现

### 4.1 `/session-list` 命令

**文件**: `packages/core/src/daemon/commands/SessionListCommand.ts`

```typescript
import type { IFeishuCommand, IDaemonCommandContext } from '../types';

/**
 * /session-list 命令
 *
 * 列出 Claude Code 的所有会话
 * （两种模式都支持！）
 */
export class SessionListCommand implements IFeishuCommand {
  readonly name = '/session-list';
  readonly aliases = ['/sessions']; // 兼容简写
  readonly description = '列出 Claude Code 会话: /session-list [limit]';

  async execute(context: IDaemonCommandContext, args: string): Promise<void> {
    const { daemon, chatId, reply } = context;

    // 解析可选参数：limit
    const limitArg = args.trim();
    const limit = limitArg ? parseInt(limitArg, 10) : undefined;
    if (limitArg && isNaN(limit!)) {
      await reply(
        '参数错误：limit 必须是数字\n用法: `/session-list` 或 `/session-list 20`'
      );
      return;
    }

    try {
      const sessions = await daemon.listAgentSessions({ limit });

      if (sessions.length === 0) {
        await reply('📭 暂无会话');
        return;
      }

      const currentSessionId = daemon.getCurrentAgentSession();

      // 格式化输出
      let message = '📋 Claude Code 会话列表\n\n';

      sessions.forEach((session, index) => {
        const isCurrent = session.sessionId === currentSessionId;
        const marker = isCurrent ? '👉 ' : '   ';
        const date = new Date(session.updatedAt).toLocaleString('zh-CN');

        message += `${marker}${index + 1}. ${session.title}\n`;
        message += `   ID: \`${session.sessionId}\`\n`;
        if (session.cwd) {
          message += `   目录: ${session.cwd}\n`;
        }
        if (session.gitBranch) {
          message += `   分支: ${session.gitBranch}\n`;
        }
        message += `   更新: ${date}\n`;
        if (isCurrent) {
          message += `   ✅ 当前选中\n`;
        }
        message += '\n';
      });

      // 提示信息
      message += '💡 快捷操作：\n';
      message += '   • `/resume <ID>` - 切换到指定会话\n';
      message += '   • `/new` - 创建新会话\n';
      message += '   • `/session-list 50` - 只显示最近 50 个会话';

      await reply(message);
    } catch (err) {
      await reply(`❌ 获取会话列表失败: ${err}`);
    }
  }
}
```

### 4.2 `/resume` 命令

**文件**: `packages/core/src/daemon/commands/ResumeCommand.ts`

```typescript
import type { IFeishuCommand, IDaemonCommandContext } from '../types';

/**
 * /resume 命令
 *
 * 恢复/切换到指定会话
 * （两种模式都支持！）
 */
export class ResumeCommand implements IFeishuCommand {
  readonly name = '/resume';
  readonly description = '恢复/切换到指定会话: /resume <会话ID>';

  async execute(context: IDaemonCommandContext, args: string): Promise<void> {
    const { daemon, chatId, reply } = context;

    const sessionId = args.trim();
    if (!sessionId) {
      await reply(
        '请指定会话 ID，例如: `/resume abc123`\n' +
          '使用 `/session-list` 查看所有会话'
      );
      return;
    }

    // 设置当前会话
    // Spawn 模式：下次 execute 时使用 --resume 参数
    // ACP 模式：下次 execute 时使用 loadSession
    daemon.setCurrentAgentSession(sessionId);
    await reply(`✅ 已切换到会话: \`${sessionId}\``);
  }
}
```

### 4.3 `/new` 命令

**文件**: `packages/core/src/daemon/commands/NewCommand.ts`

```typescript
import type { IFeishuCommand, IDaemonCommandContext } from '../types';

/**
 * /new 命令
 *
 * 创建新会话
 * （两种模式都支持！）
 */
export class NewCommand implements IFeishuCommand {
  readonly name = '/new';
  readonly description = '创建新会话';

  async execute(context: IDaemonCommandContext, args: string): Promise<void> {
    const { daemon, chatId, reply } = context;

    // 清除当前会话选择
    // Spawn 模式：下次 execute 时创建新会话
    // ACP 模式：下次 execute 时创建新会话
    daemon.setCurrentAgentSession(null);
    await reply('✅ 下次对话将创建新会话');
  }
}
```

---

## 五、持久化设计

### 5.1 配置文件位置

```
~/.claude/pocket-relay.json
```

### 5.2 配置文件格式

```json
{
  "currentAgentSessionId": "abc123-def456"
}
```

### 5.3 加载时机

- Daemon 启动时读取配置文件
- 如果 `currentAgentSessionId` 存在，则恢复选择

### 5.4 保存时机

- 用户执行 `/new` 时
- 用户执行 `/resume` 时

---

## 六、双模式兼容性

| 功能 | Spawn 模式 | ACP 模式 | 实现方式 |
|------|-----------|---------|---------|
| 普通消息执行 | ✅ 支持 | ✅ 支持 | ExecuteOptions 传 `claudeSessionId` |
| `/session-list` | ✅ 支持 | ✅ 支持 | Daemon 直接调用 SDK `listSessions()` |
| `/resume` | ✅ 支持 | ✅ 支持 | 设置 `currentAgentSessionId` |
| `/new` | ✅ 支持 | ✅ 支持 | 清除 `currentAgentSessionId` |
| 当前会话持久化 | ✅ 支持 | ✅ 支持 | `~/.claude/pocket-relay.json` |

---

## 七、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/types/src/session.ts` | 修改 | 新增 `AgentSessionInfo`, `ListSessionsOptions` |
| `packages/types/src/channel.ts` | 新增 | IChannel 接口 |
| `packages/core/package.json` | 修改 | 新增 `@anthropic-ai/claude-agent-sdk` 依赖 |
| `packages/core/src/daemon/Daemon.ts` | 修改 | 新增 Session 管理 + Channel 集成 |
| `packages/core/src/daemon/commands/SessionListCommand.ts` | 新增 | `/session-list` 命令 |
| `packages/core/src/daemon/commands/ResumeCommand.ts` | 新增 | `/resume` 命令 |
| `packages/core/src/daemon/commands/NewCommand.ts` | 新增 | `/new` 命令 |
| `packages/core/src/daemon/commands/index.ts` | 修改 | 导出新命令 |
| `packages/channel/src/LarkChannel.ts` | 新增 | 飞书 Channel 实现 |

---

## 八、实施步骤

| 阶段 | 任务 |
|------|------|
| Phase 1 | 扩展类型定义 |
| Phase 2 | 新增 `@anthropic-ai/claude-agent-sdk` 依赖 |
| Phase 3 | 实现 IChannel 接口 + LarkChannel |
| Phase 4 | 实现 Daemon 的 Session 管理 + 持久化 |
| Phase 5 | 实现 Daemon 的 `listAgentSessions()` 方法 |
| Phase 6 | 实现权限审批和进度通知回调 |
| Phase 7 | 实现三个飞书命令 |
| Phase 8 | 集成测试 |

---

## 九、总结

### 9.1 核心要点

| 要点 | 说明 |
|------|------|
| **职责清晰** | Session 管理只在 Daemon 层，Executor 不管理 Session |
| **SDK 独立函数** | `listSessions()` 可直接调用，无需启动进程 |
| **双模式统一** | Spawn 模式和 ACP 模式都支持 |
| **Channel 抽象** | 支持多种消息平台（飞书、TG、微信等） |
| **与 05 互补** | 05 提供实时交互，08 提供 Session 管理 |

### 9.2 优势

1. ✅ **两种模式都支持** 所有会话命令
2. ✅ **实现简单** - 直接用 SDK 函数
3. ✅ **性能好** - 不需要启动进程
4. ✅ **兼容现有** - 不改变现有架构
5. ✅ **用户体验好** - 可以查看、切换会话
6. ✅ **易扩展** - 新增 Channel 只需实现 IChannel
