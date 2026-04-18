# PocketRelay 待办事项

## 进行中 / 待执行

### 工程化（发布前准备）

- [x] **构建系统升级** — tsup 配置提升到根目录 `tsup.config.ts`，`pnpm build`/`pnpm dev` 在根目录统一运行
- [x] **发布到 GitHub** — org: noetikalab，repo: pocket-relay，主干开发 + rebase 工作流，GitHub 已开启 Require linear history
- [x] **ESLint + Prettier** — 根目录 `eslint.config.js` + `.prettierrc`，职责分工：Prettier 管格式，ESLint 管代码质量
- [x] **Git hooks** — husky + lint-staged + commitlint，pre-commit 自动 format/lint，commit-msg 校验 Conventional Commits 格式
- [x] **Claude Code Agent Skills** — 制作 7 个项目级 skill（`project-commit`、`project-pr-create`、`project-pr-fix-comments`、`project-new-branch`、`project-sync-docs`、`project-ts-init`、`project-ts-audit`），存放于 `.claude/skills/`，统一使用 `project-` 前缀以区分用户级 skill

### 功能规划

- [x] **CLI channel 选择** — `pcr start --channel lark`，启动日志去掉硬编码"飞书"字样，改为通用提示

- [ ] **飞书卡片知识库文档整理** — 将 `docs/10-feishu-card-sdk-guide.md` 的经验进一步结构化，便于其他 agent/同事接力（低优先级）

### Bug 待排查（ACP 模式）

- [ ] **ACP 输出重复/语序混乱** — 根因：ACP 进程在每次 prompt 时重放历史上下文 chunk，详见 `packages/executor/docs/acp-known-issues.md`
- [ ] **ACP API Error 400** — tool_choice 冲突，疑似 `@agentclientprotocol/claude-agent-acp` 包问题

---

## 已完成

- [x] **pnpm patch 修复 WSClient.start()** — `@larksuiteoapi/node-sdk` v1.60.0 的 `start()` 缺少 `yield this.reConnect(true)`，已 patch，详见 `packages/channel/docs/lark-wsclient-ready-bug.md`
- [x] **ACP 模式实现** — ClaudeCodeAcpExecutor、权限审批卡片、进度通知
- [x] **飞书欢迎卡片** — 用户进入单聊时发送欢迎卡片，点击后发送绑定提示
- [x] **`/session-list` 命令** — 列出 Claude Code 历史会话
