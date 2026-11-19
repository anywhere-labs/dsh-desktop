# 0.2.2-rc.5 适配

官方 release：https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.5

基线为 master e66243ece4（rc.4）。目标源码 9c2670d3bce5275e0d1610272958121af87787bb，比 rc.4 多 5 个提交：380 个 package.json 只改版本号，其余 53 个文件集中在网页搜索（`dsh-web`、`tool-web`、`web-search-deepseek`、搜索设置页、共享基础组合）及其文档、测试和快照，另有一个 LiveShare 测试改为按真实时钟计算凭据期限。Beta／Next 均升级 rc.5；Stable 保留 0.2.1-rc.3；Desktop 产品版本沿用 2.0.24-next／2.0.24-beta.1。

| 官方 release 条目 | 处理 |
|---|---|
| DeepSeek 模型使用 DeepSeek 服务端搜索，搜索不按次收费；其他模型默认使用 DeepSeek Search API | 直接采用官方（deepseek-ai/deepseek-harness#8707）。共享基础组合不再固定 `web.searchProvider`，`dsh-web` 按发起搜索的模型请求所在路由选择：`deepseek-official`／`deepseek-account` 路由用 Messages 搜索（提供方 `deepseek-official`，按模型 token 计费，会话日志追加 `web/deepseek-search-llm-request`），其他路由和不服务于模型请求的搜索仍用 `deepseek-search-api`。「网页搜索提供方」菜单新增「自动选择」，「DeepSeek（旧版）」改名为「DeepSeek 服务端搜索」。Desktop 不覆盖 `web.searchProvider`、DeepSeek 端点和搜索设置页，也没有补丁涉及这些包；已自行选择提供方的 Profile 和 `DSH_WEB_SEARCH_PROVIDER` 不受影响。升级指南 web-search-deepseek-model-default 的提醒同样适用于 Desktop：Messages 搜索的端点不跟随模型提供方的地址，DeepSeek 模型指向网关时，搜索仍发往官方端点并失败，需按指南改选 Search API，或给服务端搜索填网关地址。 |

## 补丁与依赖

- 28 个运行时补丁改名到 `@0.2.2-rc.5`，逐个用 `git apply --check` 对照 pristine tarball。`client-seams.mjs` 从 rc.5 tarball 重新生成 10 个补丁：前端包的哈希每次构建都变，其中 8 个随之更新（inspector 的 DevTools chunk 改名为 `legacy-CyZwv7NW.js`），sandbox-windows-acl 与 sandbox-local 字节不变。OAR 补丁只更新 package.json 上下文里的版本号，其余 17 个补丁原样适用。每个补丁改写的上游行数与 rc.4 相同，没有新增改写。`dsh-host-open-in-app` 的环境变量改写继续保留：上游修复 a8ea5fcf81 仍只在 master，不在 rc.5。
- 375 个运行时包与 rc.4 同名同数；rc.5 的 package.json 只改版本号，官方 pnpm lockfile、`patchedDependencies` 与 Cordis 家族版本未变。Next 引用的 35 个上游文件在 rc.4 与 rc.5 之间没有改动，upstream-reference 只更新提交与版本。
- 社区市场 peers 为 `0.2.1-rc.3 || 0.2.2-rc.5`，构建依赖跟随 Beta；Tokens Anywhere 插件的 dsh 依赖与 peers 跟随 Next。
- Agents Anywhere 按仓库规则重建：官方 main 仍是 76f97145facf18571724205bcd5cfebecf3592ea（与 #1704 同一提交），只有 runtime peers 改为 `0.2.1-rc.3 || 0.2.2-rc.5`，产物为 `2.2.0-desktop.c76f97145facf.r2afb7d8b`，三个通道使用同一 artifact。dshmarket 仍是 npm latest 1.73.20。

## 验证

- 官方构建 10/10 门禁通过，375 个 tarball；upstream checkout 无源码改动。
- 根 `corepack yarn check` 通过：Next 151 个文件 1382 通过、10 跳过（含构建、类型检查、前端校验与 Node Host smoke）；Beta 镜像 835 通过、7 跳过；共享 Stable 393、社区市场 328、Tokens Anywhere 60、根布局与兼容性 182 项通过，variants 427 个文件一致。
- Beta／Next 的 Electron Node 模式 Host smoke、`verify:onboarding`、`verify:window-controls` 通过。
- 搜索路由：在两个变体的真实 Host（Electron Node 模式）上，用本地替身代替模型、Messages 搜索和 Search API，各跑一轮调用 `web_search` 的 DeepSeek 对话。默认配置下搜索走 Messages 搜索，工具结果来自它，会话日志有 `web/deepseek-search-llm-request`；设 `DSH_WEB_SEARCH_PROVIDER=deepseek-search-api` 后改走 Search API，日志里没有该事件。
- `install --immutable`、AA release check、market check 通过。
- 未做：真实 DeepSeek 账号与 API Key 下的服务端搜索及计费、指向网关的部署、非 DeepSeek 模型路由（由上游测试覆盖）、图形应用与各平台安装包；上述测试不代替这些验收。
