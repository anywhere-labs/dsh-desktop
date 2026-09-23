# Node 侧出口继承系统代理

状态：两个版本均已实现。
[English](2026-09-20-system-proxy-inheritance.md) | 中文

## 问题

Desktop 的网络有两半，答案不一致。Chromium 那一半——更新检查、每次渲染进程加载——本来就跟随系统代理。Node 那一半——LLM 传输、WebFetch、联网搜索、HTTP 上的 MCP、包安装——在任何机器上都是直连，因为 Node 的 `fetch` 既不读系统配置，也不读 `HTTP_PROXY`。

上游的 `@deepseek-ai/dsh-http-proxy` 早已解决了这件事，`package.json` 里也早就声明了这个依赖。但它唯一的安装点在 CLI 的 `runProfile()` 里，而 Desktop 走的是 `boot()`，所以从来没装上过。同一台机器、同一套配置：终端里敲 `dsh` 有代理，双击图标启动就没有。有四条 issue 直接提的就是这件事（#245、#431、#942、#379），另有几条是它的下游（#1052、#527、#759）。

## 为什么用上游的安装函数，而不是自己写 dispatcher

`setGlobalDispatcher()` 不够用，这不是口味问题。`deepseek-harness/packages/web/web-fetch-http/src/provider.ts:134-137` 里，WebFetch 的直连分支自己 new 了一个带 pinned `lookup` 的 per-request `Agent`——全局 dispatcher 永远够不着它。它切到代理的唯一开关是 `proxyRouteFor(url).proxied`，而那个状态只有 `installProxyFromEnvironment()` 能写。插件市场也是同样的结构。自己写的 dispatcher 会覆盖住 LLM 传输，然后悄无声息地漏掉 WebFetch。

还有一条独立成立的硬约束：vendored 包的发布产物只导出四个函数——`installProxyFromEnvironment`、`proxyRouteFor`、`proxyEnvironmentForChild`、`clearedProxyEnv`。`createPolicyDispatcher` 和策略模块的其余部分只存在于类型声明里，运行时根本拿不到。而 `deepseek-harness/` 是 pinned submodule，一行都不改。

所以形状就定了：读系统配置，翻译成上游安装函数已经认识的环境变量词汇，然后安装。

## 怎么读系统配置

用 `session.defaultSession.resolveProxy()`。Chromium 本来就在读 Windows 注册表、macOS 网络设置、Linux 桌面设置，并且在回答之前已经跑完了 PAC 和 WPAD。在这里重新推导一遍，等于把这些全部重新实现一遍，而且还会和应用自己的窗口给出不一样的答案。

探针用三个 URL 而不是一个：PAC 脚本可能对 HTTPS 和 HTTP 走不同路线，而企业环境经常给 npm registry 单独开一条规则。先调 `forceReloadProxyConfig()`：session 可能在配置落地之前就回答了第一次 resolve（electron#26166），那个假 `DIRECT` 和"这台机器真的没代理"是分不开的。整个过程失败都不致命——在一台读不出代理配置的机器上，应用必须照常启动。

`src/system-proxy.ts` 只放纯逻辑，不 import 任何 Electron 的东西，因为 `host-process-entry.ts` 要引用它，而那个文件不得触碰 Electron 主进程 API。

## 优先级

显式导出的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 压过系统配置，和 `curl` 及所有浏览器一致：用户导出了这个变量，就是专门给这个程序选了一条路。这种情况下什么都不合成，环境原样传下去，让上游解析器按它自己的优先级处理——包括 `ALL_PROXY` 的回退——和 CLI 完全一样。

否则把探针结果写成 `http_proxy` / `https_proxy`，外加一个 `no_proxy`：合并用户已有的条目、本机的局域网字面量、`.local`。loopback 由上游的 `LOOPBACK_NO_PROXY` 补上。

## 装两次，不是一次

主进程装一次，Host 再装一次。这不是冗余：全局 dispatcher、`proxyRouteFor` 背后的状态、`proxyEnvironmentForChild` 的注入，都是进程内模块私有的。Host 那次必须落在 `bootDesktopHost` 之前，因为插件在 boot 期间就会 mount，并且可能立刻发请求。

overlay 是显式跨进程传的，不是让 Host 自己重新推导。launch environment snapshot 在加载时就冻结了，主进程之后对 `process.env` 的写入进不到 Host 那份；而且 Host 自己重探可能得出和用户正看着的窗口不一样的答案。显式传能让优先级逻辑只写一份、可单测。

主进程那次安装对进程外也是有用的：`installProxyFromEnvironment` 会把解析结果以大小写两份写回 `process.env`，这正是 `host-process.ts` 的 `env: { ...process.env }` 能把这条路线带给 Host 及其全部子进程（pnpm、stdio MCP 服务、bash 工具）的机制。

## 明确接受的代价

**PAC 被压成一次启动快照。** PAC 的逐 URL 差异被拍平成"第一个找到的代理"，系统 bypass 列表里的 CIDR（`10.0.0.0/8`）也翻译不进 `no_proxy`。探针分歧会被检测并记进日志，让这个拍平动作可见而不是无声。loopback 和本机局域网字面量单独兜住。

**改了代理需要重启。** 没有加轮询。FAQ 里写明了。

**不支持 SOCKS**，因为上游包拒绝它。这条诊断由我们自己写，而不是留给上游解析器——后者会报一个 `HTTPS_PROXY` 的错，指向一个用户根本没设过的变量，把人送去找一个不存在的配置错误。我们的诊断指向用户真正够得着的开关（代理客户端的 HTTP 端口或混合端口），并且说明应用窗口和更新检查不受影响，免得有人以为整个应用断网了。

**shell 里的 `*_PROXY` 依然不继承。** `src/shell-environment.ts` 是刻意排除它的，因为代理 URL 可能带凭据，`tests/shell-environment.spec.ts` 对此有断言。这次没动它。后果——macOS 和 Linux 上只写在 `~/.zshrc` 里的代理，从 Dock 启动时看不见——作为已知限制写进文档，而不是遮掩过去。

## 可观测性

每次启动都写一行 `outbound proxy = ...`，直连时也写。"应用连不上网"这类报告，在不知道它选了哪条出口路线之前是无法回答的，而一条只在失败时出现的日志建立不起这个事实。`source` 是排障最先看的字段：`system`、`environment`、`none`。这行过 `maskSecrets`，代理 URL 里的凭据会被打码；`diagnostic-export.ts` 本来就会把 `userData/logs` 打包，所以"导出诊断"会自动把它带进 issue。

## 验证

`tests/system-proxy.spec.ts` 以纯函数覆盖 PAC 解析和优先级表。`tests/system-proxy-egress.spec.ts` 是最要紧的那个：它起一个真的 HTTP 服务器当假代理，断言请求确实到达了那里、loopback 和本机局域网地址没有到达、以及显式导出的代理压过系统代理。这个应用里同时存在三份 undici——`dsh-http-proxy` 内嵌的、顶层 hoist 的、Electron 内建的——它们能共用一个 dispatcher，只是因为 `setGlobalDispatcher` 写的是一个带版本号的 well-known symbol。没有任何地方声明了这个约定。如果哪天 undici 升级挪了这个 symbol，所有单元测试都会照常绿，只有那个 egress 测试会发现。不要删掉它。

## 后续

插件市场的 IP pinning（#759）是另一个改动，但本次是它的前置条件：正解是照 `web-fetch-http` 的做法，在 `proxyRouteFor(url).proxied` 分支上跳过 pinning，而那个状态要等本次让 Host 装上之后才在 Host 里存在。
