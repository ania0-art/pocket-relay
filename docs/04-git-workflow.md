# Git 工作流指南

主干开发模式（Trunk-Based Development），唯一长期分支为 `main`。

## 开始新功能 / 修复

```bash
# 1. 切回 main，rebase 同步最新代码
git checkout main
git pull --rebase

# 2. 从 main 切新分支
git checkout -b feat/cli-channel-selection
# 或 fix/acp-output-duplicate

# 3. 推送到远程并关联
git push -u origin feat/cli-channel-selection
```

## 开发过程中

```bash
# 正常提交（推荐使用 /commit skill）

# 如果 main 有新提交，同步到当前分支
git fetch origin
git rebase origin/main
```

## 完成后提 PR

```bash
# 推送最新代码
git push

# 创建 PR（推荐使用 /pr-create skill）
gh pr create --title "feat(core): add cli channel selection" --body "..."
```

## PR 合并后清理

```bash
git checkout main
git pull --rebase
git branch -d feat/cli-channel-selection
```

---

## 分支命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 新功能 | `feat/xxx` | `feat/cli-channel-selection` |
| Bug 修复 | `fix/xxx` | `fix/acp-output-duplicate` |
| 文档 | `docs/xxx` | `docs/update-readme` |
| 重构 | `refactor/xxx` | `refactor/session-manager` |

---

## 约束

- **禁止直接 push 到 main**（GitHub 已开启 Require linear history + branch protection）
- **禁止 merge commit**，只用 rebase（`git pull` 已配置 `pull.rebase=true`）
- **禁止 `git push --force`**，只允许 `--force-with-lease`（rebase 后需要强推时）
