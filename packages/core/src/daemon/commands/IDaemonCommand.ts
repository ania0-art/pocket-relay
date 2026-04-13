import type { IncomingMessage, AgentSessionInfo, ListSessionsOptions } from '@pocket-relay/types';

/**
 * Daemon 暴露给斜线命令的上下文接口。
 *
 * 命令通过此接口访问 Daemon 能力，禁止直接访问 Daemon 私有方法。
 * 这样命令可以独立测试，也不会因 Daemon 内部重构而受影响。
 */
export interface IDaemonCommandContext {
  readonly nodeId: string;
  /** Claude Code 的工作目录，用于过滤会话列表 */
  readonly cwd: string;
  readonly boundChatIds: Set<string>;
  readonly sessionManager: {
    getOrCreate(chatId: string): any;
    createNew(chatId: string): any;
    getByChatId(chatId: string): any | undefined;
    setClaudeSessionId(chatId: string, sessionId: string): void;
    setStatus(chatId: string, status: any): void;
  };
  send(chatId: string, text: string): Promise<void>;
  listAgentSessions(options?: ListSessionsOptions): Promise<AgentSessionInfo[]>;
}

/**
 * Daemon 斜线命令接口。
 *
 * 所有 `/xxx` 命令必须实现此接口，并在 Daemon 构造时注册。
 */
export interface IDaemonCommand {
  /** 命令前缀，如 '/bind' */
  readonly prefix: string;

  /**
   * 检查是否匹配该命令
   */
  matches(text: string): boolean;

  /**
   * 执行命令
   */
  execute(ctx: IDaemonCommandContext, msg: IncomingMessage, text: string): Promise<void>;
}
