# dotenv 加载机制问题与解决方案

## 问题描述

在 monorepo 项目中使用 `dotenv` 时，经常遇到 "环境变量未设置" 的错误，即使 `.env` 文件确实存在于项目根目录。

## 根因分析

### 1. dotenv 默认加载路径

`dotenv` 和 `dotenv/config` 默认从 **`process.cwd()`**（当前工作目录）查找 `.env` 文件。

当运行方式不同时，`process.cwd()` 也不同：

| 运行方式 | `process.cwd()` | 能否找到根目录 .env |
|---------|------------------|---------------------|
| `pnpm dev`（根目录） | `D:\Coding_Personal\frontend\PocketRelay` | ✅ 能 |
| `cd packages/core && node dist/cli.js` | `D:\Coding_Personal\frontend\PocketRelay\packages\core` | ❌ 不能 |
| `npm link` 后全局运行 `pocket-relay` | 取决于用户当前目录 | ❓ 不确定 |

### 2. ESM 模块中的 __dirname

在 CommonJS 中：
```javascript
const path = require('path');
console.log(__dirname); // 文件所在目录
```

在 ESM 模块（type: "module"）中：
- `__dirname` / `__filename` **默认不存在**
- 需要用 `import.meta.url` + `fileURLToPath` + `dirname` 自己构建

```javascript
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### 3. 不能用 `require`

在 ESM 模块中不能混用 `require()`，否则会报错：
```
ReferenceError: require is not defined in ES module
```

所有文件系统操作都要用 `node:fs` 模块的 ESM 版本。

---

## 解决方案

### 方案：向上查找项目根目录

实现一个 `findProjectRoot()` 函数，从当前文件所在目录开始，**逐级向上查找**，直到找到标志性文件（如 `pnpm-workspace.yaml`、`.git`、`package.json`）。

```typescript
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    // 找到这些标志性文件就认为是项目根目录
    if (
      existsSync(resolve(dir, 'pnpm-workspace.yaml')) ||
      existsSync(resolve(dir, '.git')) ||
      existsSync(resolve(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // 到达文件系统根目录还没找到
    dir = parent;
  }
  return process.cwd(); // 找不到就回退到当前目录
}

// 加载 .env.pcr
const projectRoot = findProjectRoot(__dirname);
const envPath = resolve(projectRoot, '.env.pcr');
config({ path: envPath });
```

### 优势

- 无论从哪里运行（根目录、子目录、全局 link），都能找到项目根目录的 `.env`
- 不依赖 `process.cwd()`
- 优雅降级（找不到就回退到 `process.cwd()`）

---

## 调试技巧

在开发阶段加一些调试输出，确认路径是否正确：

```typescript
console.log(`[调试] 当前目录: ${process.cwd()}`);
console.log(`[调试] 项目根目录: ${projectRoot}`);
console.log(`[调试] 尝试加载 .env: ${envPath}`);
console.log(`[调试] .env 是否存在: ${existsSync(envPath) ? '是' : '否'}`);
```

---

## PocketRelay 项目中的实现

见 `packages/core/src/cli.ts`：

1. `findProjectRoot()` 函数查找 `pnpm-workspace.yaml` 或 `.git` 作为项目根目录标志
2. 显式调用 `config({ path: envPath })` 而不是隐式的 `import 'dotenv/config'`
3. 加了 `.env` 不存在时的友好提示

---

**日期**：2026-04-10
**项目**：PocketRelay
