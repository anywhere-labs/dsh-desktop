# 0.2.2-rc.4 适配

官方 release：https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.4

基线为 master 59929a6a79（rc.3）。目标源码 3f321d32bfe382212a8ed8785c1d47a5a300aa23，比 rc.3 多 8 个提交：380 个 package.json 只改版本号，其余改动集中在 15 个文件（llm、llm-deepseek、LiveShare 及其测试、文档和快照）。Beta／Next 均升级 rc.4；Stable 保留 0.2.1-rc.3；Desktop 产品版本沿用 2.0.23-next／2.0.23-beta.1。

| 官方 release 条目 | 处理 |
|---|---|
| 优化模型请求收到异常消息响应时的表现（#8584） | 直接采用官方。DeepSeek 以 `refusal` 结束流时，llm-deepseek 先报告已计费用量，再以新增的 `CONTENT_REFUSED` 失败（此前报 `MALFORMED_RESPONSE`），Web 撤回已流式显示的回复。Desktop 源码与测试没有按 LLM 错误码分类的逻辑，升级指南 deepseek-refusal-code 无需迁移。 |
| 修复 LiveShare 在桌面端无法创建分享的问题（#8634） | 改用官方修复：tunnel worker 从 Host 自身的环境继承 `ELECTRON_RUN_AS_NODE`。Desktop 的 Host 由 `desktopNodeEnvironment` 以 `ELECTRON_RUN_AS_NODE=1` 启动，所以删去 `dsh-experimental-liveshare` 补丁里作用相同的插入（#1534 起），只保留列出插件的 `listedByDefault`。`listed-bundles-compat` 改为取安装包里的 `start()` 与 `workerNodeModeEnv()`，按 Host 环境验证 worker 的 Node 模式；Next README 中英文同步删去对应说明。 |

## 补丁与依赖

- 28 个运行时补丁改名到 `@0.2.2-rc.4`，逐个用 `git apply --check` 对照 pristine tarball。`client-seams.mjs` 从 rc.4 tarball 重新生成 10 个补丁：前端包的哈希每次构建都变，其中 8 个随之更新（inspector 的 DevTools chunk 改名为 `legacy-BFq4W1RT.js`），sandbox-windows-acl 与 sandbox-local 字节不变；生成器改为按版本号读取 windows-acl 补丁。OAR 补丁只更新 package.json 上下文里的版本号，其余 16 个补丁原样适用。改写上游行的补丁与 rc.3 完全相同，没有新增。`dsh-host-open-in-app` 的环境变量改写继续保留：上游修复 a8ea5fcf81 只在 master，不在 rc.4。
- 375 个运行时包与 rc.3 同名同数；官方 pnpm `patchedDependencies` 与 Cordis 家族版本未变。Next 引用的 35 个上游文件在 rc.3 与 rc.4 之间没有改动，upstream-reference 只更新提交与版本。
- 社区市场 peers 为 `0.2.1-rc.3 || 0.2.2-rc.4`，构建依赖跟随 Beta；Tokens Anywhere 插件的 dsh 依赖与 peers 跟随 Next。
- Agents Anywhere 按仓库规则重建官方 main 856026dd5e745bae1b5199f15b077a103a1a2392，三个通道使用同一 artifact，runtime peers 为 `0.2.1-rc.3 || 0.2.2-rc.4`。dshmarket 仍是 npm latest 1.73.20。

## 验证

- 官方构建 10/10 门禁通过，375 个 tarball；upstream checkout 无源码改动。
- 根 `corepack yarn check` 通过：Next 151 个文件 1382 通过、10 跳过（含构建、类型检查、前端校验与 Node Host smoke）；Beta 镜像 835 通过、7 跳过；共享 Stable 393、社区市场 328、Tokens Anywhere 60、根布局与兼容性 180 项通过，variants 411 个文件一致。LiveShare、会话引用、草稿、inspector 等补丁兼容测试对两个变体都实际执行。
- Beta／Next 的 Electron Node 模式 Host smoke、`verify:onboarding`、`verify:window-controls` 通过。
- `install --immutable`、AA release check 通过；dshmarket 仍为 npm latest。
- 未做：真实 Relay 下的 LiveShare 分享（tunnel worker 只在创建分享时启动）、真实 DeepSeek 拒答、图形应用与各平台安装包；上述测试不代替这些验收。
