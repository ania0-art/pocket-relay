---
name: project-ts-audit
description: 检查当前 TypeScript Node.js 项目的工程配置完整性，识别缺失或不规范的配置项，给出完善方案并询问用户是否应用。当用户说"检查项目配置"、"审计工程配置"、"配置有什么缺失"、"完善 ts 配置"、"audit project"或输入 /ts-audit 时触发。
---

扫描当前项目的工程基础设施配置，识别缺失或不规范的配置项，给出完善方案并询问用户是否应用。

## 第一步：扫描现有配置

并行检查以下内容：

```bash
# 包管理器检测
ls package.json pnpm-lock.yaml yarn.lock package-lock.json 2>/dev/null

# 构建工具
ls tsup.config.ts tsup.config.js tsdown.config.ts vite.config.ts rollup.config.* 2>/dev/null

# 格式化
ls .prettierrc .prettierrc.json .prettierrc.js prettier.config.js prettier.config.mjs 2>/dev/null

# Lint
ls eslint.config.js eslint.config.mjs .eslintrc.js .eslintrc.json .eslintrc.yml 2>/dev/null

# Git hooks
ls .husky/ 2>/dev/null

# Commit 规范
ls commitlint.config.js commitlint.config.mjs .commitlintrc.js .commitlintrc.json 2>/dev/null

# Git 配置
git config pull.rebase 2>/dev/null

# Monorepo 检测
ls pnpm-workspace.yaml rush.json turbo.json nx.json 2>/dev/null

# 环境变量
ls .env .env.example 2>/dev/null

# .gitignore
cat .gitignore 2>/dev/null
```

同时读取 `package.json`，检查：
- `scripts` 中是否有 `build`、`lint`、`format`、`prepare`
- `devDependencies` 中各工具链包是否安装
- 是否有 `lint-staged` 配置

读取各配置文件内容，检查关键选项是否合理（见下方检查点）。

## 第二步：逐项评估

对每个配置项判断状态：`✅ 完整` / `⚠️ 需改进` / `❌ 缺失`

| 配置项 | 检查内容 |
|--------|---------|
| **TypeScript** | tsconfig.json 存在；`strict: true`；`moduleResolution` 为 `Bundler` 或其他合理值（非旧版 `node`） |
| **构建工具** | tsup/tsdown/vite/tsc 任一存在；scripts.build 已配置 |
| **Prettier** | .prettierrc 存在；scripts.format 已配置 |
| **ESLint** | eslint.config.js 存在（推荐 Flat Config）；包含 typescript-eslint；包含 eslint-config-prettier；scripts.lint 已配置 |
| **husky** | .husky/ 目录存在；scripts.prepare = "husky" |
| **lint-staged** | package.json 中有 lint-staged 配置；pre-commit hook 调用了 lint-staged |
| **commitlint** | commitlint.config.js 存在；commit-msg hook 调用了 commitlint |
| **.gitignore** | 存在；包含 node_modules、dist、.env* |
| **pull.rebase** | git config pull.rebase = true |
| **.env.example** | 如果有 .env 文件，对应 .env.example 是否存在；.env 是否在 .gitignore 中 |

**ESLint 版本检测**：如果是旧版 `.eslintrc.*` 格式，标注 ⚠️ 并建议迁移到 Flat Config（ESLint v9+）。

**Monorepo 检测**：如果发现 pnpm-workspace.yaml / rush.json / turbo.json / nx.json，额外检查子包 tsconfig 是否 extends 根配置，lint-staged 路径是否覆盖所有子包源码。

## 第三步：输出审计报告

按以下格式输出：

```
## TypeScript 工程配置审计报告

### ✅ 已完整配置
- TypeScript（tsconfig.json，strict 模式）
- 构建工具（tsup）
- Prettier

### ⚠️ 需改进
- ESLint：缺少 eslint-config-prettier，Prettier 与 ESLint 规则可能冲突
  → 修复：pnpm add -D eslint-config-prettier，并在 eslint.config.js 中引入

### ❌ 缺失
- Git hooks（husky + lint-staged）
  → 修复：
    pnpm add -D husky lint-staged
    pnpm exec husky init
    # 在 package.json 补充 lint-staged 配置
    # 在 .husky/pre-commit 写入 pnpm exec lint-staged

- Commit 规范（commitlint）
  → 修复：
    pnpm add -D @commitlint/cli @commitlint/config-conventional
    创建 commitlint.config.js
    创建 .husky/commit-msg

- pull.rebase 配置
  → 修复：git config pull.rebase true
```

## 第四步：询问用户

展示报告后询问：

> 发现 N 处缺失/待改进配置。是否全部按上述方案应用？还是只处理某几项？

- **全部应用** → 依次执行每项修复，每完成一项报告进度
- **指定某项** → 只处理该项
- **不处理** → 结束输出报告，不修改任何文件

**所有修复操作在用户确认前不执行。**

## 第五步：应用修复

按确认方案执行。安装依赖时合并成一条 `pnpm add -D` 命令避免重复安装。

修复完成后验证：
```bash
pnpm build 2>/dev/null || true
pnpm lint  2>/dev/null || true
```

输出完成提示，说明已应用的修复项，以及需要用户手动处理的事项（如 GitHub 仓库开启 Require linear history）。
