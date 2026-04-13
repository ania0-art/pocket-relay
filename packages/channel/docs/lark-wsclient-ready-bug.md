# Bug 排查：WSClient.start() 不等待连接就绪

## 问题现象

`pcr start` 打印"启动成功"日志时，飞书 WebSocket 连接实际上尚未建立。
此时发送消息，机器人不会响应，直到 `ws client ready` 日志出现后才真正可用。

## 根因

`@larksuiteoapi/node-sdk` 的 `WSClient.start()` 源码：

```typescript
async start(options) {
  // ...
  this.reConnect();  // ← 没有 await，fire-and-forget
}
```

`reConnect()` 是 async 函数，负责实际建立 WebSocket 连接。由于 `start()` 没有 `await` 它，`start()` 会立即 resolve，而连接建立是异步进行的。

**真正就绪的标志**：控制台出现 `ws client ready` 日志（由 `reConnect()` 完成后打印）。

## Promise 传递原理

```typescript
async function outer() {
  inner();        // ❌ 不 await：outer 立即 resolve，inner 在后台跑
  await inner();  // ✅ await：outer 等 inner 完成后才 resolve
  return inner(); // ✅ return：outer 的 Promise 链接到 inner 的 Promise
}
```

SDK 的 `start()` 属于第一种情况，导致调用方无法感知连接就绪时机。

## 解决方案（已修复）

用 `pnpm patch` 修改 SDK 源码，patch 文件位于 `patches/@larksuiteoapi__node-sdk@1.60.0.patch`，已注册到根 `package.json` 的 `pnpm.patchedDependencies`，`pnpm install` 后自动应用。

修改内容：

```diff
- this.reConnect(true);
+ yield this.reConnect(true);
```

## 注意事项

- patch 在 bundle 模式下同样有效：tsup 打包时读取的是已 patch 的 `node_modules`，bundle 进 `dist/index.cjs` 的代码已包含修复
- 用户通过 `npm install -g` 安装时，拿到的是原版 SDK，patch 对其无效——建议向 SDK 官方提 issue
