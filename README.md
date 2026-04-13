# PocketRelay

<div align="center">

**Control code agents from your Feishu mobile app**

[![pnpm](https://img.shields.io/badge/pnpm-latest-blue.svg)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[English](#english) | [中文](#中文)

</div>

---

## English

### What is PocketRelay?

PocketRelay is a CLI tool that lets you control code agents (like Claude Code, Codex, etc.) from your Feishu (Lark) mobile app. Send commands in Feishu chat, and PocketRelay will execute them locally using your preferred agent.

### Features

- 📱 **Mobile Control**: Send commands from Feishu mobile app
- 🤖 **Multi-Agent Support**: Extensible architecture for Claude Code, Codex, and other code agents
- 🔗 **Multiple Sessions**: Support binding multiple Feishu chats to one PCR process
- 🔄 **Session Management**: `/new` to create new sessions, `/resume` to continue existing ones
- ⚡ **Task Queue**: Queue multiple tasks and execute them sequentially
- 🛡️ **Idempotent**: Duplicate messages are automatically ignored
- 🎯 **Switchable PCR Processes**: Bind different PCR processes for different projects

### Architecture

```
PocketRelay/
├── packages/
│   ├── types/       # Shared TypeScript types
│   ├── executor/    # Executor layer (supports multiple agents: Claude Code, Codex, etc.)
│   ├── channel/     # Channel layer (Feishu WebSocket)
│   └── core/        # CLI + Daemon
```

### Quick Start

#### Prerequisites

- Node.js 20+
- Claude Code CLI installed
- Feishu app (mobile or desktop)

#### Installation

```bash
# Clone the repository
git clone <repo-url>
cd PocketRelay

# Install dependencies
pnpm install

# Build
pnpm build

# Link to global
npm link
```

#### Configuration

Set up your Feishu credentials:

```bash
# Global configuration
pcr config set lark-app-id <your-app-id>
pcr config set lark-app-secret <your-app-secret>

# Or use .env.pcr in your working directory
```

#### Usage

```bash
# Start PocketRelay
pcr start

# You'll see a Node ID
# Send "/bind <node-id>" in Feishu to bind
```

### Feishu Commands

| Command | Description |
|---------|-------------|
| `/bind <node-id>` | Bind current chat to PCR process |
| `/new` | Create new agent session |
| `/resume <session-id>` | Resume specific agent session |
| Any text | Execute as agent task |

### CLI Commands

| Command | Description |
|---------|-------------|
| `pcr` | Show help |
| `pcr start` | Start PocketRelay daemon |
| `pcr config list` | List all configs |
| `pcr config set <key> <value>` | Set config |
| `pcr config get <key>` | Get config |
| `pcr config unset <key>` | Unset config |

### Configuration Priority

1. Command line arguments
2. Local `.env.pcr` file
3. Global config (`~/.pocket-relay/config.json`)

### Development

```bash
# Watch mode
pnpm dev

# Build
pnpm build
```

---

## 中文

### 什么是 PocketRelay？

PocketRelay 是一个 CLI 工具，让你可以通过飞书手机应用控制代码 Agent（如 Claude Code、Codex 等）。在飞书聊天中发送命令，PocketRelay 会使用你选择的 Agent 在本地执行。

### 功能特性

- 📱 **手机控制**：从飞书手机应用发送命令
- 🤖 **多 Agent 支持**：可扩展架构，支持 Claude Code、Codex 等多种代码 Agent
- 🔗 **多会话支持**：支持将多个飞书聊天绑定到一个 PCR 进程
- 🔄 **会话管理**：`/new` 创建新会话，`/resume` 继续已有会话
- ⚡ **任务队列**：多个任务排队顺序执行
- 🛡️ **幂等处理**：自动忽略重复消息
- 🎯 **可切换 PCR 进程**：为不同项目绑定不同的 PCR 进程

### 架构

```
PocketRelay/
├── packages/
│   ├── types/       # 共享 TypeScript 类型
│   ├── executor/    # 执行器层（支持多种 Agent：Claude Code、Codex 等）
│   ├── channel/     # 通道层（飞书 WebSocket）
│   └── core/        # CLI + 守护进程
```

### 快速开始

#### 前置要求

- Node.js 20+
- 已安装 Claude Code CLI
- 飞书应用（手机或桌面）

#### 安装

```bash
# 克隆仓库
git clone <repo-url>
cd PocketRelay

# 安装依赖
pnpm install

# 构建
pnpm build

# 链接到全局
npm link
```

#### 配置

设置飞书凭证：

```bash
# 全局配置
pcr config set lark-app-id <your-app-id>
pcr config set lark-app-secret <your-app-secret>

# 或者在工作目录使用 .env.pcr
```

#### 使用

```bash
# 启动 PocketRelay
pcr start

# 你会看到一个 Node ID
# 在飞书中发送 "/bind <node-id>" 完成绑定
```

### 飞书命令

| 命令 | 说明 |
|------|------|
| `/bind <node-id>` | 将当前聊天绑定到 PCR 进程 |
| `/new` | 创建新的 Agent 会话 |
| `/resume <session-id>` | 恢复指定的 Agent 会话 |
| 任意文本 | 作为 Agent 任务执行 |

### CLI 命令

| 命令 | 说明 |
|------|------|
| `pcr` | 显示帮助 |
| `pcr start` | 启动 PocketRelay 守护进程 |
| `pcr config list` | 列出所有配置 |
| `pcr config set <key> <value>` | 设置配置 |
| `pcr config get <key>` | 查看配置 |
| `pcr config unset <key>` | 删除配置 |

### 配置优先级

1. 命令行参数
2. 本地 `.env.pcr` 文件
3. 全局配置（`~/.pocket-relay/config.json`）

### 开发

```bash
# 监听模式
pnpm dev

# 构建
pnpm build
```

---

## License

MIT
