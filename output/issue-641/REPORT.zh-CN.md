# Issue #641 复现、根因、修复与验证报告

日期：2026-08-26
Issue：[windows 端在使用 deepseek-v4-flash-vision-exp 模型发送图片后输入框无法再次发送图片及文字](https://github.com/anywhere-labs/dsh-desktop/issues/641)

## 结论

Issue #641 已精确复现并修复。故障不是图片解析或模型回复失败，而是 renderer 的 unary RPC carrier 在 Host 已返回 HTTP 200 后仍可能返回一个永不结算、也不遵循 `AbortSignal` 的 Promise。`AbstractApiClient.postJson()` 原先只把 30 秒 deadline 作为 signal 交给 carrier，自身继续等待该 Promise，因此会话 composer 永久停留在 `submitting/readOnly=true`。

修复让 unary 调用独立于 carrier 的中止实现进行结算：deadline 或调用方 signal 中止时，上层 Promise 立即使用 signal reason 拒绝；迟到的 carrier fulfillment/rejection 仍被消费；监听器在任一结算路径释放。未修改 composer 状态机、默认 30 秒 deadline、caller-signal-only 例外或 streaming 生命周期。

最终 Electron 故障注入闭环中，composer 在 `30065 ms` 后恢复为 `plain/readOnly=false`，图片与文字草稿完整保留；删除图片后在同一会话发送第二条纯文字成功，composer 清空，Mock 助手回复数从 1 增至 2。

## Issue 基线

- 操作系统：Windows 11 x64。
- 问题发布版本：DSH Desktop `2.0.2`。
- DSH runtime：`0.1.1-rc.2`。
- Issue 报告行为：使用 `deepseek-v4-flash-vision-exp` 发送图片和文字并完成识别后，同一会话输入框无法继续交互；新会话正常。
- 修复验证构建：Desktop `2.0.3` 工作树，runtime 仍基于 `0.1.1-rc.2` 发布包并应用兼容补丁。

## 复现方法与结果

### 自然 Mock 对照

在 Desktop `2.0.2` 和 `2.0.3` 中，以本地 OpenAI-compatible Vision Mock 发送图片加文字，两版均能自然完成请求并解锁 composer；普通 provider 业务错误也能正常解锁。因此当前环境没有用自然 Mock 复现 Issue 报告的真实平台 carrier 故障。

对照截图位于 [`controls`](controls/)：`v2.0.2-natural-mock-success.png` 显示图片加文字请求完成后 composer 可用，`v2.0.3-provider-error-unlocked.png` 显示普通 provider 错误不会留下只读状态。

本次没有可用的真实官方 `deepseek-v4-flash-vision-exp` API 凭据，未进行真实官方 Vision API 验证。下述精确复现使用确定性故障注入，仅证明 Host、RPC carrier 与 composer 恢复链路。

### Desktop 2.0.2 精确故障注入

故障注入仅拦截首个 `/api/session.prompt`：先调用原始 `fetch` 并等待真实 Host 响应，再让 renderer 收到一个永不结算的外层 Promise。这样保留真实 Host 处理、HTTP 响应和事件流，只模拟平台 carrier 在交付请求后忽略 abort。

观察结果：

1. 图片加文字请求到达 Host，原始响应完成。
2. 助手回复已经显示，说明模型/Mock 与事件流已完成。
3. 30 秒 deadline 到达后，renderer signal 已中止，但 carrier Promise 不结算。
4. 60 秒后 composer 与 deadline 前截图逐字节相同，仍处于只读提交状态。

基线截图、注入脚本和完整 Playwright trace 位于 [`baseline-v2.0.2`](baseline-v2.0.2/)。

### 仅修 Host 发布入口的中间失败

第一次组装验证只补丁化 `@deepseek-ai/dsh-host-apiproxy`。Host 的直接发布入口测试通过，但 Electron renderer 仍在 45 秒内无法恢复。原因是 `@deepseek-ai/dsh-client-connection@0.1.1-rc.2/lib/client.js` 内联了旧版 `AbstractApiClient`；仅修改 host-apiproxy 发布包不会改变 renderer 实际执行入口。

中间失败的截图、JSON 与 trace 使用 `intermediate-missing-renderer-patch-*` 命名保留。该证据证明桌面 rc.2 兼容层必须同时补丁化 Host 和 renderer 发布入口。

## 根因

原实现的实质流程是：

```text
AbortSignal.timeout(30000) -> 作为 init.signal 传入 doFetch()
                              -> postJson() 直接 await carrier Promise
```

`AbortSignal` 只发出中止通知，不保证任意注入或平台 carrier 的 Promise 会结算。若 carrier 已把请求交付给 Host，却忽略中止且永不结算：

- Host 可返回 HTTP 200 并完成助手回复；
- `sessions.prompt()` 仍永久 pending；
- composer 的提交 claim 无法进入成功或回滚分支；
- 当前会话保持 `submitting/readOnly=true`。

该缺陷影响共享 unary POST 实现，不只影响图片、`session.prompt` 或 conversation UI。

## 修复

上游提交：`fa9c62017ce05ec2feb19f1d5d9b8cba7c0cbf76`（`fix(apiproxy): settle unary calls on abort`）。

上游改动：

- `AbstractApiClient.postJson()` 在预先 abort 时不启动 carrier。
- 新增共享 `settleOnAbort()`，在 signal abort 时独立拒绝上层 Promise。
- 注册监听器后再次检查 `signal.aborted`，覆盖 carrier 启动期间同步 abort 的竞态。
- carrier 成功、失败或 abort 后移除监听器，并消费迟到 settlement。
- 非 `Error` carrier rejection 规范化为带 `cause` 的 `Error`。
- `InProcessApiClient` 复用同一 helper。
- README 与双语 Agent Note 记录 unary 结算契约。

Desktop rc.2 兼容层：

- `patches/dsh-host-apiproxy-model-modalities@0.1.1-rc.2.patch` 同步修复 Host 发布入口。
- `patches/dsh-client-connection-unary-settlement@0.1.1-rc.2.patch` 修复 renderer 实际执行的内联 carrier。
- `package.json` 对 exact/caret 两种 `dsh-client-connection` resolution 应用补丁，`yarn.lock` 固化结果。
- `host-apiproxy-timeout.spec.ts` 执行发布后的 host-apiproxy 补丁；`package.spec.ts` 锁定 renderer 发布入口中的 helper markers。

## 最终 Electron 验证

验证脚本：[`verify-fixed-electron.mjs`](verify-fixed-electron.mjs)。结构化结果：[`fixed-electron-evidence.json`](fixed-electron-evidence.json)。完整 trace：[`fixed-electron-trace.zip`](fixed-electron-trace.zip)。

| 阶段 | phase | readOnly | 草稿 | 图片 | HTTP | 助手回复数 |
|---|---|---:|---|---:|---:|---:|
| carrier 挂起期间 | `submitting` | `true` | 保留 | 是 | 200 | 1 |
| `30065 ms` deadline 后 | `plain` | `false` | 保留 | 是 | 200 | 1 |
| 同会话第二次发送后 | `plain` | `false` | 已清空 | 否 | 200 | 2 |

关键截图：

- [`fixed-injected-submitting.png`](fixed-injected-submitting.png)：Host 200 后 composer 正在提交。
- [`fixed-after-deadline-recovery.png`](fixed-after-deadline-recovery.png)：deadline 后解除只读，图片与文字草稿保留。
- [`fixed-second-send-success.png`](fixed-second-send-success.png)：同一会话第二次发送成功并清空 composer。

## 自动化验证

通过：

- `corepack pnpm exec vitest run packages/host/apiproxy/tests/fetch-carrier.spec.ts`：`39/39`。
- 上游扩大影响范围测试：27 个文件，`647/647`。
- `corepack pnpm run typecheck`：通过，包含 `build:lib:host` 与 client contracts typecheck。
- `corepack pnpm run lint`：通过，包含 `build:lib:host` 与 `lint:contracts-ready`。
- `corepack pnpm run build:lib:client`：通过。
- `corepack yarn install --immutable`：通过，仅有仓库既有 peer dependency 警告。
- `corepack yarn workspace dsh-plugin-desktop vitest run tests/package.spec.ts tests/host-apiproxy-timeout.spec.ts`：`44/44`。
- `corepack yarn typecheck`：通过。
- `corepack yarn build`：通过，包含 Desktop Host、renderer client bundle、native UI 与声明生成。
- 上游与 Desktop `git diff --check`：通过。

受环境限制：

- `corepack pnpm run doc-sync`：28 个 gate 中 27 个通过；唯一失败为 `documentation site checks` 中 `project-doc-site.spec.ts` 调用 `symlinkSync()` 时 Windows 返回 `EPERM`。失败发生在临时目录 fixture 创建阶段，测试未进入本次修改的文档投影逻辑。双语配对、Agent Note 格式、Markdown links、doc typecheck、doc budgets 等均通过。

## 证据完整性

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `controls/v2.0.2-natural-mock-success.png` | 76597 | `6f4f4b166993a430add633e4dabb7516666f154d3028adee0040b344685ec292` |
| `controls/v2.0.3-provider-error-unlocked.png` | 101966 | `daf7cf72d35de3a9f6ca2761eb9a011acfd025d09877fe3551490fd9d266e8ad` |
| `baseline-v2.0.2/before-submit.png` | 103051 | `fb669facb3dbded41d3966fa70180e173aedbdb0a0b83f17a4dca56d0e0f6711` |
| `baseline-v2.0.2/stuck-before-deadline.png` | 78180 | `554d5923997cf083070ebaeff28929e253c68de2c4ec80770069c2c2498feb8e` |
| `baseline-v2.0.2/stuck-after-60s.png` | 78180 | `554d5923997cf083070ebaeff28929e253c68de2c4ec80770069c2c2498feb8e` |
| `baseline-v2.0.2/playwright-trace.zip` | 11617677 | `6818c3e4cce96ea135c4731836e0be793fd0e7890c4a64a3e71fe22f85e690e4` |
| `intermediate-missing-renderer-patch-evidence.json` | 737 | `b15fa567baea01d54a08f328295fa736b6ace376bea126a08017a824755bd2b6` |
| `intermediate-missing-renderer-patch-trace.zip` | 495340 | `27451d1c7db00df3918628d8e3f1bccb6468240c1897922bbf16d5da3e856878` |
| `fixed-electron-evidence.json` | 1465 | `1f0c552cbbf444102d9b9df398685766981cde2380e9684a2fdad52dac0bfb88` |
| `fixed-electron-trace.zip` | 1487689 | `7425c1a2a2ece31df83587157da1c7aa3a8925cda298a4637db6adcd43c265bd` |
| `fixed-after-deadline-recovery.png` | 126064 | `44bb94fc0dce3221d99247893651f5ca6349862740c90ee0c74defe62bc519c5` |
| `fixed-second-send-success.png` | 128485 | `2a07061aa04397bc07419b3fa55506668f8aecfb6c2a9bd7abd76b5b5397aaf0` |

`stuck-before-deadline.png` 与 `stuck-after-60s.png` 的 SHA-256 完全相同，直接证明 60 秒等待期间 UI 未发生恢复。

## 清理

验证结束后已通过 Electron 的既有安全上下文执行：

- 删除 `llm-deepseek.baseURL` 测试覆盖，结果 `settingUnset=true`。
- 删除测试 `DEEPSEEK_API_KEY`，结果 `credentialUnset=true`；清理过程未读取或输出凭据值。
- 停止 Electron/Host 与 Vision Mock 进程树。
- 确认 `9222`、`43120`、`51711` 不再监听。

清理脚本保留为 [`cleanup-local-mock.mjs`](cleanup-local-mock.mjs)。

## 剩余风险

- 未使用真实官方 Vision API 验证，因此不能证明官方 provider 的具体上游故障已消失；本修复证明的是 carrier 已交付请求但忽略 abort 时，所有 unary 调用都能按既有 deadline 结算，composer 因而可恢复。
- 非遵循约定的 carrier 内部工作无法被客户端强制停止，可能迟到结算；修复会消费该结算，但不会用它覆盖已返回给调用方的 abort 结果。
- 发生 deadline 回滚时保留原始草稿是现有 composer 语义。由于 Host 可能实际已完成请求，用户手动重发保留草稿可能产生重复请求；这是无法从挂起 carrier 中可靠判定远端结果时的保守行为。
