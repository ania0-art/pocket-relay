---
name: project-ts-init
description: 从零初始化一个 TypeScript Node.js 项目，搭建完整的工程基础设施（构建、格式化、Lint、Git hooks、Commit 规范）。当用户说"初始化 ts 项目"、"新建 ts 项目"、"搭建工程配置"、"init ts project"或输入 /ts-init 时触发。
---

从零创建一个工程配置完整的 TypeScript Node.js 项目。

## 第一步：收集信息

向用户询问以下信息（如果已经说明则跳过）：

1. **项目名称**（package.json `name` 字段）
2. **项目类型**：
   - `cli` — 命令行工具（需要 shebang、bin 字段）
   - `lib` — 库（需要 exports/main/types 字段）
   - `service` — 后端服务
3. **是否 monorepo**：
   - `no` — 单包项目
   - `pnpm workspace` — pnpm 原生 workspace
   - `rush` / `turborepo` / `nx` — 其他 monorepo 方案
4. **构建工具**（默认 tsup）：
   - `tsup` — 推荐，esbuild 封装，零配置
   - `tsdown` — tsup 的新替代，API 兼容
   - `tsc` — 纯 TypeScript 编译，不 bundle
5. **目标 Node 版本**（默认 node20）

## 第二步：确认方案

根据收集到的信息，输出配置方案摘要，**在用户确认前不创建任何文件**：

```
将创建以下配置：
- 包管理器: pnpm
- 构建工具: tsup (CJS 输出)
- 格式化: Prettier（无分号、单引号、100 宽）
- Lint: ESLint v9 Flat Config + typescript-eslint + eslint-config-prettier
- Git hooks: husky v9 + lint-staged（pre-commit 格式化+lint）
- Commit 规范: commitlint + Conventional Commits
- Git 配置: pull.rebase=true
```

## 第三步：创建文件

用户确认后，创建以下文件：

### `package.json`

CLI 类型：
```json
{
  "name": "<project-name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "<project-name>": "./dist/index.cjs" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "eslint \"src/**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\"",
    "prepare": "husky"
  },
  "lint-staged": {
    "src/**/*.ts": ["prettier --write", "eslint --fix", "eslint"]
  }
}
```

lib 类型去掉 `bin`，加 `"main": "./dist/index.cjs"` 和 `"exports"`；service 类型去掉 `bin`。

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

### `tsup.config.ts`

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  outExtension: () => ({ js: '.cjs' }),
  clean: true,
  bundle: true,
  esbuildOptions(options) {
    options.external = ['fsevents']
    // CLI 类型才需要 shebang，lib/service 去掉这行
    options.banner = { js: '#!/usr/bin/env node' }
  }
})
```

### `.prettierrc`

```json
{
  "semi": false,
  "trailingComma": "none",
  "arrowParens": "avoid",
  "printWidth": 100,
  "singleQuote": true,
  "tabWidth": 2
}
```

### `eslint.config.js`

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
```

### `commitlint.config.js`

```js
export default { extends: ['@commitlint/config-conventional'] }
```

### `.husky/pre-commit`

```sh
pnpm exec lint-staged
```

### `.husky/commit-msg`

```sh
pnpm exec commitlint --edit "$1"
```

### `.gitignore`

```
node_modules/
dist/
*.local
.env*
!.env.example
```

### `src/index.ts`

```ts
// Entry point
```

## 第四步：安装依赖

```bash
pnpm add -D typescript @types/node tsup prettier \
  eslint @eslint/js typescript-eslint eslint-config-prettier \
  husky lint-staged \
  @commitlint/cli @commitlint/config-conventional

pnpm exec husky init
git init   # 如果还不是 git 仓库
git config pull.rebase true
```

## 第五步：Monorepo 补充

**pnpm workspace**：根目录创建 `pnpm-workspace.yaml`：
```yaml
packages:
  - packages/*
```
tsconfig.json 补充 `paths` 和 `references` 指向子包。

**Rush**：输出引导信息，Rush 接管依赖安装和构建编排，建议参考官方 `rush init` 流程，Prettier/ESLint/husky 配置同上。

**Turborepo / Nx**：建议先用官方脚手架初始化骨架（`pnpm dlx create-turbo` / `create-nx-workspace`），再按上述补充格式化和 lint 配置。

## 第六步：验证

```bash
pnpm build
pnpm lint
```

输出完成提示，说明已创建的文件列表和可用命令。
