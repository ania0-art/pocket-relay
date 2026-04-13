# Monorepo 构建问题记录

## 问题概述

从 tsdown → esbuild → tsup，最终使用 tsup 解决。

## 问题 1: workspace 包不被 bundle

**症状**: 构建产物仍然引用 `@pocket-relay/*` 的 `.ts` 源码文件，Node.js 报 `ERR_UNKNOWN_FILE_EXTENSION`

**原因**: tsup 默认将 workspace 包视为 external。

**解决**: `noExternal: [/@pocket-relay\//]`

## 问题 2: ESM + CommonJS 混合问题

**症状**: `Dynamic require of "util" is not supported`

**原因**: `@larksuiteoapi/node-sdk` 依赖 `form-data` / `combined-stream` 是 CommonJS 包。

**解决**: 改用 CJS 格式构建，输出 `.cjs` 扩展名。

## 问题 3: TS2835 扩展名错误

**症状**: `Relative import paths need explicit file extensions in ECMAScript imports when --moduleResolution is node16 or nodenext`

**原因**: `tsconfig.base.json` 配置了 `module: Node16` + `moduleResolution: Node16`，强制要求 `.js` 扩展名。

**解决**: 改为 `module: ESNext` + `moduleResolution: Bundler`

## 问题 4: chalk ESM/CJS 导入冲突

**症状**: `chalk.default.gray is not a function`

**原因**: chalk v5 是纯 ESM，CJS 构建时有问题。

**解决**: 移除 chalk 依赖，改用简单的 ANSI 颜色码。

## 最终构建配置

```typescript
// packages/core/tsup.config.ts
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  noExternal: [/@pocket-relay\//],
  // ...
});
```
