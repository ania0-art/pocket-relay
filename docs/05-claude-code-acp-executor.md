# Claude Code ACP Executor 技术方案（修订版）

## 概述

本文档描述基于 `@agentclientprotocol/claude-agent-acp` 实现 Claude Code ACP 执行器的技术方案。

**核心定位**：提供**实时交互能力**的执行器，支持权限审批、工具调用进度监控等高级功能。

---

## 一、方案定位

### 1.1 为什么需要 ACP 模式？

| 能力 | Spawn 模式 | ACP 模式 |
|------|-----------|---------|
| 执行任务 | ✅ | ✅ |
| **实时权限审批** | ❌ 只能预设 `--dangerously-skip-permissions` | ✅ 可实时询问用户 |
| **工具调用可见** | ❌ 只能看到最终输出 | ✅ 实时看到每个工具执行 |
| **进程开销** | ❌ 每次新进程 | ✅ 长期运行 |
| **状态保持** | ❌ 需要 `--resume` 重新加载 | ✅ 会话状态在内存 |

### 1.2 典型场景

```
场景 1：敏感操作需要审批
用户: "帮我删除所有 .log 文件"
  → Claude 想执行 Bash: rm *.log
  → ACP Executor 通过 Channel 询问用户
  → 用户点击"允许"
  → 执行完成

场景 2：复杂工具调用进度可见
用户: "分析这个大文件"
  → 🔧 正在读取文件...
  → 🤔 正在分析...
  → 📝 正在写入结果...
  → ✅ 完成
```

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Daemon                                │
├─────────────────────────────────────────────────────────────┤
│  职责：                                                       │
│  • Session 管理 (currentAgentSessionId)                     │
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
                │                        │
        ┌───────┴────────┐      ┌────────┴─────────┐
        ▼                ▼      ▼                  ▼
  ClaudeCode    ClaudeCodeAcp  LarkChannel  TelegramChannel
  Executor      Executor
  (Spawn)       (ACP)
```

### 2.2 职责清晰划分

| 组件 | 职责 | 不负责 |
|------|------|--------|
| **Daemon** | • Session 管理<br>• 任务调度<br>• 协调 Executor 和 Channel | • 执行细节<br>• 协议细节 |
| **ClaudeCodeAcpExecutor** | • 启动 ACP 进程<br>• 执行任务<br>• 通过回调通知 Daemon | • Session 管理<br>• 用户交互 |
| **IChannel** | • 发送消息<br>• 权限审批交互<br>• 进度通知 | • 任务执行<br>• Session 管理 |

---

## 三、核心组件设计

### 3.1 ClaudeCodeAcpExecutor

**文件**: `packages/executor/src/claude-code/ClaudeCodeAcpExecutor.ts`

```typescript
import type {
  ExecutionChunk,
  ExecutionResult,
  ExecutorConfig,
  PermissionRequestCallback,
  ProgressUpdateCallback,
} from '@pocket-relay/types';
import type { IExecutor, ExecuteOptions } from '../IExecutor.js';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import { nodeToWebReadable, nodeToWebWritable } from './utils/stream.js';

/**
 * 活跃任务信息
 */
interface ActiveTask {
  sessionId: string;
  abortController: AbortController;
  onChunk: (chunk: ExecutionChunk) => void;
}

/**
 * Claude Code ACP 执行器
 *
 * 职责：
 * 1. 启动和管理 claude-agent-acp 进程
 * 2. 执行任务（通过 ACP 协议）
 * 3. 通过回调通知 Daemon（权限审批、进度更新）
 *
 * 不负责：
 * 1. Session 管理（由 Daemon 负责）
 * 2. 用户交互（由 Channel 负责）
 */
export class ClaudeCodeAcpExecutor implements IExecutor {
  // ============ 状态 ============
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private activeTasks = new Map<string, ActiveTask>();
  private initPromise: Promise<void> | null = null;

  // ============ 回调 ============
  private onPermissionRequest?: PermissionRequestCallback;
  private onProgressUpdate?: ProgressUpdateCallback;

  constructor(
    private config: ExecutorConfig,
    callbacks?: {
      onPermissionRequest?: PermissionRequestCallback;
      onProgressUpdate?: ProgressUpdateCallback;
    }
  ) {
    this.onPermissionRequest = callbacks?.onPermissionRequest;
    this.onProgressUpdate = callbacks?.onProgressUpdate;
  }

  // ============ IExecutor 实现 ============

  async execute(
    taskId: string,
    prompt: string,
    onChunk: (chunk: ExecutionChunk) => void,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // 1. 确保连接已建立
      await this.ensureConnection();

      // 2. 获取 sessionId（由 Daemon 传入）
      const sessionId = options?.claudeSessionId;
      if (!sessionId) {
        throw new Error('ACP 模式必须提供 claudeSessionId');
      }

      // 3. 加载会话
      await this.connection!.loadSession({
        sessionId,
        cwd: this.config.cwd,
      });

      // 4. 注册任务
      const abortController = new AbortController();
      this.activeTasks.set(taskId, { sessionId, abortController, onChunk });

      // 5. 发送 prompt
      const result = await this.connection!.prompt({
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      });

      // 6. 返回结果
      return {
        taskId,
        exitCode: result.stopReason === 'end_turn' ? 0 : 1,
        fullOutput: '',
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        taskId,
        exitCode: 1,
        fullOutput: `Error: ${errorMessage}`,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  cancel(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (task) {
      this.connection?.cancel({ sessionId: task.sessionId }).catch(() => {});
      task.abortController.abort();
    }
  }

  // ============ 内部方法 ============

  private async ensureConnection(): Promise<void> {
    if (this.connection) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initConnection();
    return this.initPromise;
  }

  private async _initConnection(): Promise<void> {
    // 1. 启动 claude-agent-acp 进程
    this.process = spawn('npx', ['@agentclientprotocol/claude-agent-acp'], {
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 2. 处理 stderr（日志）
    this.process.stderr!.setEncoding('utf-8');
    this.process.stderr!.on('data', (data) => {
      console.error('[claude-agent-acp]', data);
    });

    // 3. 创建 Web Streams
    const input = nodeToWebWritable(this.process.stdin!);
    const output = nodeToWebReadable(this.process.stdout!);

    // 4. 创建 NDJSON 流
    const stream = ndJsonStream(input, output);

    // 5. 创建 ACP 客户端连接
    this.connection = new ClientSideConnection(
      (agent) => this.createClientHandler(agent),
      stream
    );

    // 6. 初始化
    await this.connection.initialize({
      protocolVersion: '2024-11-05',
      capabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
      clientInfo: {
        name: 'pocket-relay',
        version: '0.1.0',
      },
    });
  }

  private createClientHandler(agent: Agent): Client {
    return {
      // ============ 进度通知 ============
      sessionUpdate: async (notification: SessionNotification) => {
        // 通过回调通知 Daemon
        if (this.onProgressUpdate) {
          const update = this.convertToProgressUpdate(notification);
          if (update) {
            await this.onProgressUpdate(update);
          }
        }

        // 同时分发给活跃任务的 onChunk
        for (const [, task] of this.activeTasks) {
          if (task.sessionId === notification.sessionId) {
            const chunk = this.convertToExecutionChunk(notification);
            if (chunk) {
              task.onChunk(chunk);
            }
          }
        }
      },

      // ============ 权限审批 ============
      requestPermission: async (req) => {
        // 通过回调询问 Daemon
        if (this.onPermissionRequest) {
          const decision = await this.onPermissionRequest({
            toolName: req.toolCall.toolName || 'unknown',
            toolInput: req.toolCall.rawInput,
            options: req.options.map(opt => ({
              kind: opt.kind,
              name: opt.name,
              optionId: opt.optionId,
            })),
          });
          return { outcome: { outcome: 'selected', optionId: decision } };
        }

        // 默认拒绝
        return { outcome: { outcome: 'selected', optionId: 'reject' } };
      },
    };
  }

  private convertToProgressUpdate(notification: SessionNotification): ProgressUpdate | null {
    const update = notification.update;
    
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          return {
            type: 'message',
            content: update.content.text,
          };
        }
        break;
      
      case 'tool_call':
        return {
          type: 'tool_call',
          content: `🔧 正在执行: ${update.toolName || 'unknown'}`,
          metadata: { toolCallId: update.toolCallId },
        };
      
      case 'tool_call_update':
        return {
          type: 'tool_update',
          content: `⏳ 工具状态: ${update.status}`,
          metadata: { toolCallId: update.toolCallId },
        };
      
      case 'agent_thought_chunk':
        if (update.content.type === 'text') {
          return {
            type: 'thinking',
            content: update.content.text,
          };
        }
        break;
    }
    
    return null;
  }

  private convertToExecutionChunk(notification: SessionNotification): ExecutionChunk | null {
    // TODO: 实现转换逻辑
    return null;
  }
}
```

### 3.2 类型定义扩展

**文件**: `packages/types/src/executor.ts`

```typescript
// ... 现有类型 ...

/**
 * 权限请求
 */
export interface PermissionRequest {
  toolName: string;
  toolInput: unknown;
  options: Array<{
    kind: string;
    name: string;
    optionId: string;
  }>;
}

/**
 * 权限请求回调
 * 
 * 由 Daemon 实现，通过 Channel 询问用户
 */
export type PermissionRequestCallback = (
  request: PermissionRequest
) => Promise<string>;  // 返回用户选择的 optionId

/**
 * 进度更新
 */
export interface ProgressUpdate {
  type: 'tool_call' | 'tool_update' | 'thinking' | 'message';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * 进度更新回调
 * 
 * 由 Daemon 实现，通过 Channel 通知用户
 */
export type ProgressUpdateCallback = (
  update: ProgressUpdate
) => Promise<void>;
```

---

## 四、Channel 抽象

### 4.1 IChannel 接口

**文件**: `packages/types/src/channel.ts`

```typescript
/**
 * 通用 Channel 接口
 * 
 * 支持多种消息平台：飞书、Telegram、微信等
 */
export interface IChannel {
  /**
   * 发送文本消息
   */
  sendMessage(chatId: string, text: string): Promise<void>;

  /**
   * 发送交互式消息（带按钮）
   * 
   * 用于权限审批等场景
   * 
   * @returns 用户选择的按钮 value
   */
  sendInteractiveMessage(
    chatId: string,
    message: InteractiveMessage
  ): Promise<string>;

  /**
   * 发送进度通知
   * 
   * 用于工具调用进度等场景
   */
  sendProgressUpdate(chatId: string, progress: ProgressUpdate): Promise<void>;
}

/**
 * 交互式消息（权限审批等）
 */
export interface InteractiveMessage {
  title: string;
  content: string;
  buttons: Array<{
    text: string;
    value: string;
    style?: 'primary' | 'danger' | 'default';
  }>;
}
```

### 4.2 LarkChannel 实现示例

**文件**: `packages/channel/src/LarkChannel.ts`

```typescript
import type { IChannel, InteractiveMessage, ProgressUpdate } from '@pocket-relay/types';

export class LarkChannel implements IChannel {
  async sendMessage(chatId: string, text: string): Promise<void> {
    // 实现飞书消息发送
  }

  async sendInteractiveMessage(
    chatId: string,
    message: InteractiveMessage
  ): Promise<string> {
    // 实现飞书交互式消息（卡片 + 按钮）
    // 等待用户点击按钮
    // 返回用户选择的 value
  }

  async sendProgressUpdate(chatId: string, progress: ProgressUpdate): Promise<void> {
    // 实现飞书进度通知
  }
}
```

---

## 五、与 Spawn 模式对比

| 对比项 | Spawn 模式 | ACP 模式 |
|--------|-----------|---------|
| 进程开销 | 每次 task spawn 新进程 | 一次启动，长期运行 |
| 权限审批 | ❌ 只能预设 `--dangerously-skip-permissions` | ✅ 实时询问用户 |
| 工具调用可见 | ❌ 只能看到最终输出 | ✅ 实时看到每个工具执行 |
| 状态保持 | ❌ 需要 `--resume` 重新加载 | ✅ 会话状态在内存 |
| 实现复杂度 | 简单 | 中等 |
| 适用场景 | 简单查询、批量任务 | 敏感操作、复杂工具调用 |

---

## 六、依赖

新增依赖：
- `@agentclientprotocol/sdk`: 0.18.1
- `@agentclientprotocol/claude-agent-acp`: ^0.26.0

---

## 七、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/types/src/executor.ts` | 修改 | 新增回调类型 |
| `packages/types/src/channel.ts` | 新增 | IChannel 接口 |
| `packages/executor/src/claude-code/ClaudeCodeAcpExecutor.ts` | 新增 | ACP 执行器实现 |
| `packages/executor/src/claude-code/utils/stream.ts` | 新增 | Stream 转换工具 |
| `packages/channel/src/IChannel.ts` | 新增 | Channel 接口 |
| `packages/channel/src/LarkChannel.ts` | 新增 | 飞书 Channel 实现 |

---

## 八、实施步骤

| 阶段 | 任务 |
|------|------|
| Phase 1 | 扩展类型定义（回调、Channel） |
| Phase 2 | 实现 Stream 转换工具 |
| Phase 3 | 实现 ClaudeCodeAcpExecutor 基础框架 |
| Phase 4 | 实现 IChannel 接口 + LarkChannel |
| Phase 5 | 实现权限审批回调 |
| Phase 6 | 实现进度通知回调 |
| Phase 7 | 集成到 Daemon |
| Phase 8 | 测试 |

---

## 九、总结

### 核心要点

| 要点 | 说明 |
|------|------|
| **职责清晰** | Executor 只负责执行，不管理 Session，不直接交互用户 |
| **通过回调解耦** | 权限审批、进度通知通过回调通知 Daemon |
| **Channel 抽象** | 支持多种消息平台（飞书、TG、微信等） |
| **与 08 互补** | 08 管理 Session，05 提供实时交互能力 |

### 优势

1. ✅ **实时交互** - 权限审批、工具调用进度可见
2. ✅ **职责清晰** - Executor、Daemon、Channel 各司其职
3. ✅ **易扩展** - 新增 Channel 只需实现 IChannel
4. ✅ **解耦合** - Executor 不依赖具体 Channel
