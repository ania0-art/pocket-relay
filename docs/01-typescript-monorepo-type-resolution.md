# TypeScript Monorepo 类型引用问题与解决方案

## 问题描述

在使用 pnpm workspace + tsdown 构建工具的 monorepo 项目中，子包之间相互引用（如 `@pocket-relay/executor` 引用 `@pocket-relay/types`）时，WebStorm/VSCode 等 IDE 报类型找不到的错误。

## 问题根因

1. **tsdown 生成的 d.ts 带 hash 文件名**
   - tsdown 打包时生成的类型声明文件格式类似：`dist/index-CMbTnjPu.d.ts`
   - `package.json` 中配置的 `types: "./dist/index.d.ts"` 找不到文件

2. **依赖打包产物做类型解析**
   - 各包 `package.json` 的 `main/module/types/exports` 都指向 `dist/` 下打包后的产物
   - 开发时 tsdown 可能还没运行，或产物文件路径不对

## 解决方案

### 1. 开发时直接指向源码，不依赖打包产物

将各子包 `package.json` 改成：

```json
{
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

**说明**：
- `tsx` 可以直接运行 TypeScript 源码
- TypeScript 可以直接从 `src/index.ts` 解析类型
- tsdown 打包产物仅用于生产/发布

### 2. 配置根目录 `tsconfig.json`

创建 `tsconfig.json` 在项目根目录：

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@pocket-relay/*": ["packages/*/src"]
    }
  },
  "references": [
    { "path": "packages/types" },
    { "path": "packages/executor" },
    { "path": "packages/channel" },
    { "path": "packages/core" }
  ]
}
```

### 3. 子包 `tsconfig.json` 配置 composite

每个子包的 `tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../types" }  // 依赖什么包就引用什么包
  ]
}
```

## 最终效果

- IDE 类型检查无报错
- 可以正常跳转到引用的源码位置
- 开发时用 `tsx src/index.ts` 直接跑源码
- 发布前用 `tsdown` 打包到 `dist/` 目录

---

**日期**：2026-04-10
**项目**：PocketRelay
