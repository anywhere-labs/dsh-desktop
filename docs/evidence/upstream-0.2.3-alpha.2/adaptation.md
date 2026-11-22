# 0.2.3-alpha.2 适配（Beta 与 Next）

官方 release：
- https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.3-alpha.1
- https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.3-alpha.2

基线为 master abac62dd35，当时 Beta、Next 都是 0.2.2-rc.5。目标源码 4b399c39a6d1479cd84ca591b4d7c88e24d38a96（alpha.2）：alpha.1（d98f5d6851）比 rc.5 多 2343 个提交，alpha.2 在它之上再加 5 个提交。Beta 和 Next 一起升到 alpha.2，Stable 留在 0.2.1-rc.3。产品版本：Beta 由 2.0.24-beta.1 升为 2.0.25-beta.1，Next 由 2.0.24-next 升为 2.0.25-next（变体校验把 `x.y.z-next.N` 对应到 `x.y.z-beta.(N+1)`）。Next 和 Beta 的 Electron 由 44.7.0 升到 44.11.5。不再有通道使用 rc.5：`vendor/dsh-runtime/0.2.2-rc.5/` 删除，rc.5 的补丁移到 alpha.2。

## 决定与后果

决定记在 Effi T522（D29）：
1. 先答「等上游」。
2. 之后改为「继续适配」alpha.1：只升 Beta，Next 留在 rc.5，用一个 Yarn 插件让两个运行时各用各的 Cordis。
3. 再改为「一起升」：去掉插件，用全局 resolutions 指向源码打包的 Cordis，Next 也升到 alpha.1。
4. alpha.2 发布后改为直接适配 alpha.2。用户定下 Next 2.0.25-next；按镜像规则，Beta 对应 2.0.25-beta.1。Electron 一起升到 44.11.5。

alpha.2 起 Cordis 家族有了新版本号，两个变体在技术上又可以分别跟随不同的上游版本；这次仍按「一起升」处理。

后果：

- 上游发出 0.2.3 的 rc 之前，Next 不从 master 发版。要发 Next 紧急修复，从合入前的 master（rc.5）拉维护分支。
- 进行中的分支（anywhere-account、#1690、T420 等）合入前要变基到这次改动，并适配 alpha.2。
- Agents Anywhere 按 peers `0.2.1-rc.3 || 0.2.3-alpha.2` 重建。

## Cordis 家族

alpha.1 把官方 vendored 的 Cordis 核心换成上游 Cordis 4.0.0-rc.12，Loader 换成 1.0.0-rc.9，Include 换成 1.2.0（js-yaml 改为 yaml），三个包的版本号却没升，npm 上同号的是旧代码，所以 npm 发布的 `@deepseek-ai/dsh@0.2.3-alpha.1` 无法启动。

alpha.2 用新版本号发布了整个 vendor 家族：`@deepseek-ai/cordis` 4.2.0-alpha.1，Loader、Include、Group、HMR、Logger Console 1.2.0-alpha.1，Timer 1.3.0-alpha.1，Schemastery 3.20.0-alpha.1，Cosmokit 1.10.0-alpha.1。dsh 0.2.3-alpha.2 用 `~` 范围依赖它们。npm 上这 9 个 tarball 与从 4b399c39a6 打包的结果逐字节一致（不计 source map），所以 Desktop 照旧从 npm 安装。alpha.1 时为此做的源码打包和全局 resolutions 已经撤回，同步脚本与 master 相同。

依赖写法沿用之前 alpha 的做法：
- Beta、Next 直接写 vendor 家族的确切版本，Schemastery 写 `^3.20.0-alpha.1`。
- 社区市场的构建依赖与 Beta 相同。peers 取各通道的并集：Cordis `4.0.5 || 4.2.0-alpha.1`，Schemastery `^3.18.5 || ^3.20.0-alpha.1`。
- Tokens Anywhere 跟随 Next。
- ACP 桥的 peers 在原有范围后加上 `~4.2.0-alpha.1` 和 `~3.20.0-alpha.1`。

## 逐条对照官方 release

- **直接采用**：随官方运行时生效，Desktop 没有代码或补丁改动。
- **Desktop 改动**：Desktop 的代码、测试、依赖或打包配置随接口变化调整。Beta 和 Next 跟随同一个上游版本，两边的改动一致。
- **补丁**：Desktop 在 `patches/` 里对官方 npm 包的安装时修补，子模块不改。
- **不涉及**：官方 Desktop 应用（`apps/desktop`）或其他运行形态自身的改动，Desktop 是自己的实现。

### alpha.2：其他变更

| 官方条目 | 处理 |
|---|---|
| 调整 Node.js 版本要求为 24.22.3、26.13.1 及以上 | Desktop 改动，见下文「Node 与 Electron」。 |

### alpha.1：新增功能

| 官方条目 | 处理 |
|---|---|
| 插件市场支持添加 Git 仓库作为插件来源 | 直接采用。`dsh-plugin-manager` 补丁原样沿用。 |
| 实验性时间线插件 | Desktop 改动：`@deepseek-ai/dsh-timeline` 进入官方可选 bundle 清单，按「官方可选 bundle 都随安装包提供」的规则加入两个变体的依赖。 |
| 代码审阅页面 | 直接采用（forge bundle）。 |
| 代码审阅扩展机制，支持 GitLab | 直接采用（`dsh-forge-gitlab` 随 forge bundle）。 |
| 会话状态区域 | 直接采用。Desktop 没有往被移走的会话头部插槽注册内容。 |
| 会话已读/未读 | 直接采用。Desktop 不读会话状态；社区市场测试去掉了已不存在的 `useSessionStatus` owner prop。 |
| Web 连接模式远程登录，标准化连接鉴权 API | Desktop 改动，见下文「认证」。 |
| 插件页统一管理连接器账号，MCP OAuth | 直接采用（web-app 自带 `dsh-client-ui-connector-account`）。 |
| Linear、Notion、腾讯文档、飞书、企业微信、腾讯会议、钉钉连接器 | 直接采用，未内置：官方可选清单、按需目录和官方 Desktop/Web 应用都不包含它们，Desktop 保持一致。 |

### alpha.1：体验优化

| 官方条目 | 处理 |
|---|---|
| 智能体团队入口移到二级面板 | 直接采用。 |
| 子智能体模型选择、消息来源、授权与汇报 | 直接采用。子智能体的初始任务改为「来自父智能体的消息」，ACP 桥测试里的脚本模型随之也认这种来源（只改测试）。 |
| 子代理和分支会话的阅读与创建 | 直接采用。 |
| 会话列表与 @ 引用候选加载加速 | 直接采用。 |
| 搜索列表模糊与跨语言匹配 | 直接采用。 |
| 自动化任务推荐、删除确认、会话标记、每周回顾 | 直接采用。`dsh-client-ui-schedule` 补丁（页头可拖动窗口）由 client-seams 重新生成。 |
| DeepSeek 图片并发上传与限流重试 | 直接采用。 |
| web_fetch 网络失败提示 | 直接采用。 |
| 代码审阅与工作树体验 | 直接采用。 |
| 长会话流式输出、轮次导航、右侧栏拖动 | 直接采用。 |
| 图标、对齐、间距与列表交互 | 直接采用。「设置」导航项宽度由 164px 变为 188px；`verify-window-controls` 改为与基准项比较尺寸，不再写死上游宽度。 |
| Office 技能统一为 `/office` | Desktop 改动（只测试）：技能清单放在 `tests/upstream-family.ts` 的 `OFFICE_PACKAGE_SKILLS`；打包与 Host 的 Office 解析不变。 |
| 压缩摘要预览 | 直接采用。 |
| 桌面版从应用菜单打开「设置」 | 不涉及：官方 Desktop 应用的菜单（`apps/desktop/src/keyboard.ts`）；Desktop 自己的应用菜单已有「设置…」。 |
| 空白输入框按 ↑ 召回已发送消息 | 直接采用。`dsh-client-ui-conversation` 补丁（容错非字符串草稿）因 `setDraft` 多了 `undoable` 参数，在 client-seams 里更新锚点后重新生成。 |
| 文件右键菜单「添加到对话」 | 直接采用。 |
| 把会话拖到右侧栏 | 直接采用。 |
| 自定义内置目录模型的推理档位 | 直接采用。 |
| 共享会话的读者可参与更多操作 | 补丁去掉：插件推荐改为可选注入 `pluginNavigation`，LiveShare 读者页面不再等这个服务，只为此存在的 `dsh-client-ui-plugin-recommendations` 补丁不再需要，随 rc.5 一起删除。 |

### alpha.1：问题修复

| 官方条目 | 处理 |
|---|---|
| 切换模型后首个请求超出上下文时会话卡住 | 直接采用。 |
| DeepSeek 图片上传无响应时长时间等待、取消导致运行时退出 | 直接采用。 |
| Python wheel 等单文件运行时恢复旧会话 | 不涉及。 |
| PTC 中 gh 或 git push 的 PR 不出现在代码审阅面板 | 直接采用。 |
| macOS 输入框 Home/End 滚动对话 | 直接采用。 |
| 浏览器拒绝剪贴板写入时复制按钮无效 | 直接采用。 |
| Windows 安装器拖动卡住、卸载残留 | 不涉及：官方 Windows 安装器；Desktop 有自己的安装器。 |
| Windows「在应用中打开」启动 VS Code、Cursor 失败 | 补丁缩减：官方修复 a8ea5fcf81 已在 alpha.1，`dsh-host-open-in-app` 补丁去掉我们自己的环境变量改写（原补丁唯一改写上游行的一段），保留 Ptyxis/GNOME Console 和 `reg.exe` UTF-8 两部分。 |
| 打开用量、充值页后 Cmd+W 无法关闭窗口 | 不涉及：官方 Desktop 应用的窗口；Desktop 的平台页是自己的实现，本次未核对。 |
| 只创建或编辑过自动化任务的会话显示时钟 | 直接采用。 |
| 切换会话时草稿附件丢失 | 直接采用。 |
| 插件管理的重启指引 | 直接采用。 |
| 不存在的 @ 路径显示为文件引用 | 直接采用。 |
| 实验性个性化页面无法在后台创建 | 直接采用。 |
| read、glob 内存占用 | 直接采用。 |
| 会话切换工作目录后文件引用指向错误；`fileAddressFor` | 直接采用；Desktop 不调用 `fileAddressFor`。 |
| 团队任务领取失败提示 | 直接采用。 |
| Web 应用安装图标的圆角 | 直接采用。 |
| 桌面诊断历史遗漏操作记录 | 不涉及，待移植：修复在官方 Desktop 应用的 `operation-history.ts`（4b77d9c01e、3bdf5aa56c）；Desktop 的操作历史是早先移植的副本，还没有跟进。 |
| 手动输入 @ 路径时字符顺序和光标错乱 | 直接采用。 |
| pi 接入模型发送超限图片时缩图 | 直接采用。 |
| 同一主机多个端口登录后旧登录状态累积 | 直接采用；Desktop 自己的 #1562 处理（过期多余的 `dsh-auth-*` cookie）照常生效。 |
| 点击模型菜单分组标题时菜单关闭 | 直接采用。 |

### alpha.1：其他变更

| 官方条目 | 处理 |
|---|---|
| 同步 Cordis 4.0.0-rc.12，更新 Loader 与 Include | Desktop 改动：依赖改用 alpha.2 发布的新版本号，见上文「Cordis 家族」。Desktop 的 `cordis.patch.yml`、Host 补丁和 Profile 补丁通过了新的条目校验；Desktop、社区市场和 Agents Anywhere 都没有用 `ctx.root`、`Service.config` 等被删接口。ACP 桥用 `ctx.root` 判断插件是否单独卸载，改为先读 `Context.root` 对应的 `cordis.root` 符号键，读不到再用 `ctx.root`，仍能装进 0.2.2。 |
| Cordis 检查工具合并为 `cordis_inspect` | 直接采用。 |
| 插件配置前端可读，volatile 配置实时同步 | Desktop 改动（只测试）：账户通知的轮询间隔改由同步配置下发；Host smoke 的判断标记放在 `scripts/upstream-family.ts`。 |
| HMR 下 `--patch` 覆盖文件修改即时生效 | Desktop 改动：`ProfileContext.overlays` 改为 `overlayPaths`，Desktop 直接传 overlay 文件路径（`profileOverlays`）。 |
| 插件设置与启停入口，「内置插件」跳转到插件管理 | Desktop 改动：`settings.plugins.tab` 插槽被删。社区市场为仍有这个插槽的旧版本补了类型声明后照常构建；它只在声明了插槽的版本里注册，所以 Beta、Next 的「设置」里不再有市场标签页，从侧栏底部入口进入。 |
| Computer Use：macOS 统一系统键鼠输入授权，Windows 实验性支持 | Desktop 改动：官方 macOS provider 改名为 `@deepseek-ai/dsh-cua-macos`（入口 id `cua-macos`）。解析钩子、Computer Use（Next）页面行、打包规则（`asarUnpack`、`x64ArchFiles`）和 CI 缓存 helper 的步骤都改用新包名。Windows provider 随 bundle 作为可选依赖安装，但本地打包没有它的原生 helper，未在 Windows 验证。 |
| Computer Use 可通过 cua-mcp 提供，`cua_run_code` 默认可用 | Desktop 改动：`@deepseek-ai/dsh-cua-mcp` 进入官方可选清单，加入两个变体的依赖。官方 provider 现在用 `cua_run_code` 服务 PTC 以外的会话，按共存规则 Computer Use（Next）在这些会话里也让位：启用官方 Computer Use 后，macOS 14 及以上的所有会话都由官方提供，Computer Use（Next）只在 Windows、Linux、macOS 14 以下或未加载官方 provider 时工作。 |
| PTC 运行与结果展示，移除 Python PTC | 直接采用。`dsh-experimental-computer-use-cua-driver-native` 补丁（交给 Desktop 申请系统权限）因 `callTool` 增加错误码、提示段增加 `retirement`，在新位置重新生成，内容不变。 |
| 工具失败结果统一错误名与错误码 | 直接采用。 |
| 规范模块导出入口，移除旧子路径 | 直接采用；Desktop 没有用到被删的导出。 |
| 会话状态迁到 `dsh-client-ui-session-status` | 直接采用，同「会话已读/未读」。 |
| 客户端插件产物结构，样式改由框架挂载时安装，CSS Modules 类名格式变化 | Desktop 改动：client-seams 的 9 个前端补丁重新生成。Desktop 自己的原生页面（启动引导、恢复、启动提示）直接打包官方 primitives，alpha 版的 primitives 不再自己插入样式，原生页面的按钮、对话框因此失去样式；Desktop 在原生页面启动时按 primitives 的模块清单安装这些样式（`src/upstream-family/primitives-styles.ts`）。Desktop 的样式没有依赖生成类名的选择器。 |
| 会话 cwd，工作树 Git 写授权，移除 working_directory | 直接采用。`dsh-api-session-controller` 补丁（工作目录缺失时技能列表容错）原样沿用。 |
| 默认开启个性化推荐 | Desktop 改动：官方删除了 `@deepseek-ai/dsh-personalized-recommendations` bundle，两个变体的依赖中去掉它；推荐插件补丁的去留见上文。 |
| 恢复实验性「持久终端」入口 | 直接采用。 |
| 实验性 SQLite 会话存储 | 直接采用，默认仍是 JSONL。 |
| DeepSeek API 密钥提供方改名，统一经 `ctx.deepseekAuth` 授权 | 直接采用。引导页判断是否已配置 API Key 读的是可配置提供方列表，不受改名影响；Desktop 不调用被删的 helper。 |
| 分支会话创建需要 `parentSource` | 直接采用。 |
| 会话工具与跨会话消息 | 直接采用。 |
| SDK 恢复会话可指定 permissionMode | 直接采用。 |
| `list_agents` 返回并发占用与上限 | 直接采用。 |
| 输入框行内提示接口 | 直接采用。 |
| MCP 工具按需加载 | 直接采用。 |

### Node 与 Electron

- 上游把 `engines.node` 改为 `^24.22.3 || >=26.13.1`，这是内置 undici 首次带上 2026 年 11 月安全修复的 Node 版本。上游代码里没有运行时的版本检查，只靠 `engines` 提示。
- 打包版 Desktop 的 Host 跑在 Electron 自带的 Node 上。Electron 44.7.0 带的是 Node 24.21.0，低于新下限；Next 和 Beta 因此升到 Electron 44.11.5（Node 24.22.3），与上游官方 Desktop 相同。Stable 冻结，留在 44.7.0。
- dsh 0.2.3-alpha.2 的 app-boot 和 hmr 改为依赖 `node-addon-require-builtin@^0.1.10`。0.1.10 认得 44.7.0 和 44.11.5 两个 Electron 版本的 V8 指纹，所以不用再像早先试 44.10.2 时那样给它打补丁。
- 44.11.5 也已拒绝泄露的 eMudhra 证书链（#1466，44.9.1 起修复）。
- 44.9 起，`window.open` 打开的窗口继承打开者的 session 和 webPreferences。平台登录、LiveShare 和插件弹窗没有在真实窗口里验证。
- 随包的主运行时跟随上游锁定，改为 Node 24.22.3。Desktop 自己补的 Windows ARM64 目标同步改为 24.22.3：`scripts/primary-runtime-win-arm64.json` 里 `win-arm64.zip` 的 sha256 取自 nodejs.org 的 SHASUMS256，这份清单已与上游锁定里另外 5 个平台的哈希逐一核对。
- 本机和 CI 仍用 Node 24.14.0 构建、测试：pnpm 只提示 `engines`，构建和测试都能通过，但低于上游的支持下限。

### 认证

- 官方 Connection 不再提供带令牌的登录链接（`authenticatedUrl`）和 `requestRejection`，登录交给 `@deepseek-ai/dsh-host-authentication-token`。Desktop Host 就绪时从 `webserver/entry-url` 取 Token 提供方的链接（`hostLaunchUrl`），壳层仍用它换 cookie，流程与 rc.5 相同。
- WebServer 的路由默认要求认证，处理函数多一个已准入的 Peer 参数。Desktop 的 WebServer 子类把处理函数的全部参数透传，否则 API 网关和 open-in-app 拿不到 Peer；fallback 保留自己的 `auth`。
- 社区市场路由的凭据检查改为看 WebServer 交给处理函数的 Peer：`connection.admit()` 要求调用方注入 `connection.authentication`，WebServer 已在派发前完成准入。
- ACP 桥的测试 Host 改为先挂 `ConnectionAuthentication`，`HostConnectionService` 从它读取凭据校验。
- 官方 Desktop 改为父进程经私有 IPC 下发凭据（`@deepseek-ai/dsh-host-authentication-desktop`），并删掉了 `web-document.ts` 里用登录链接换 cookie 的 `authenticateWebHost`。Desktop 暂未采用私有 IPC，Next 的这份移植保留换 cookie 的写法。

## Next 的官方移植

`dsh-desktop-next/upstream-reference.json` 的顶层版本改为 alpha.2。alpha.1 到 alpha.2 之间，Next 移植的官方原件没有变化。官方 Desktop 在 alpha.1 改了其中 5 个原件，这次没有重新移植，单独记为 rc.5（9c2670d3bc）：

- `apps/desktop/src/keyboard.ts`：应用菜单加入「设置」及其快捷键。Desktop 有自己的「设置…」菜单项。
- `apps/desktop/src/web-document.ts` 及其测试：删掉 `authenticateWebHost`，见上文「认证」。
- `apps/desktop/scripts/macos-runtime.ts` 及其测试：签名时把 CUA helper 当作 `.app` 整体处理的规则改用新包名。Desktop 的 `scripts/sign-runtime.ts` 只移植了解释器负载的签名，没有这条规则，无需跟进。

## 补丁与依赖

- rc.5 的 28 个补丁移到 alpha.2，保留 27 个，没有新增：
  - 6 个与 rc.5 逐字节相同。
  - 20 个只因上游代码位置、产物结构或上下文里的版本号变化而重新生成，新增、删除行数与 rc.5 相同。其中 9 个前端补丁由 client-seams 生成，两个变体的脚本都能复现同样的结果。
  - `dsh-host-open-in-app` 去掉我们自己的环境变量改写，少了 5 行新增和唯一 1 行改写。
  - `dsh-client-ui-plugin-recommendations` 删除。
- 从 alpha.1 到 alpha.2，27 个补丁都能套上 alpha.2 的原始 tarball：15 个不变，12 个只改了索引行、行号或上下文里的版本号。
- 398 个运行时包（rc.5 为 375）。去掉 6 个：`dsh-tool-working-directory`、`dsh-experimental-cua-macos`、`dsh-personalized-recommendations`、`dsh-client-ui-settings-plugin-inventory`、`dsh-client-ui-settings-plugins`、`dsh-experimental-ptc-runtime-python`。新增 29 个，包括 `dsh-cua-macos`、`dsh-cua-windows`、`dsh-cua-mcp`、`dsh-timeline`、`dsh-host-authentication-token`、`dsh-host-authentication-desktop`、`dsh-client-ui-session-status`、`dsh-client-ui-session-panel`、`dsh-deepseek-auth` 和七个连接器。
- Beta、Next 的依赖去掉 `dsh-personalized-recommendations`，新增 `dsh-cua-mcp`、`dsh-timeline`，vendor 家族改到 alpha.2 发布的版本。
- 社区市场的构建依赖跟随 alpha.2，DSH peers 为 `0.2.1-rc.3 || 0.2.3-alpha.2`。
- Tokens Anywhere 的开发依赖和 peers 改到 alpha.2，并补上开发依赖 `dsh-launch-environment`（alpha 版的 `dsh-credentials` 需要它作 peer）。
- ACP 桥的开发依赖由 0.2.2-rc.4 改到 alpha.2，补上 `dsh-mcp-client` 新需要的 peer `dsh-output-retention` 和 `dsh-compaction-image-offload` 需要的 `dsh-compaction`。DSH peers 放宽为 `>=0.2.2-rc.1 <0.3.0-0 || >=0.2.3-alpha.1 <0.3.0-0`：前一段按 semver 不含 0.2.3 的预发布版。README 写明自动化检查只覆盖 0.2.3-alpha.2。这个包还没有发布到 npm。
- Agents Anywhere 按仓库规则重建：官方 main 已到 32fa2d478e，比上次的 b3ccface52 多 2 个提交，都是后端改动，dsh-bridge-next 插件代码没有变化。peers 为 `0.2.1-rc.3 || 0.2.3-alpha.2`，产物 `2.2.0-desktop.c32fa2d478e22.r1dfd55f5`，三个通道使用同一 artifact。
- 根 `check:beta` 回到镜像模式：Beta 构建、前端检查，再跑与通道相关模块有关的 Beta 测试。

## 验证

- 官方构建（Node 24.22.3）10/10 门禁通过，398 个 tarball；子模块无源码改动。
- 根 `corepack yarn check` 在 alpha.2 与 Electron 44.11.5 上通过：
  - Next：1435 项通过、12 项跳过，含构建、类型检查、前端检查、Desktop runtime、safe-cleanup 和 Node Host smoke。Host smoke 在 alpha.2 上覆盖登录、混合版本 Profile 隔离、市场与 AA、官方行开关和与官方 Computer Use 并存。
  - Beta：构建与前端检查通过，与 103 个通道相关模块有关的 853 项测试通过、7 项跳过。
  - 其余：根布局与兼容性 183 项、社区市场 328 项、Tokens Anywhere 60 项、Stable 共享模块 398 项、ACP 桥 90 项；variants 440 个文件一致。
- 根检查之外单独运行：
  - Beta 的 `verify:host`，Next 与 Beta 的 `verify:host:electron`（Host 跑在 Electron 44.11.5 的 Node 模式下）。
  - Beta 与 Next 的 `verify:window-controls`、`verify:onboarding`（无头 Chromium）。
  - 都通过。
- 可选 bundle 启动检查：在 Electron 44.11.5 的 Node 模式 Host 里逐个打开可选 bundle，读取它插入的插件行，两个变体各 13 个 bundle、29 行全部启动，包括早先在 44.10.2 上失败的 inspector。用 Electron 44.7.0 做对照，结果相同。macOS 上跳过了 Agents Anywhere、两个 CUA bundle、LiveShare、插件市场、语音输入、社区市场和 dshmarket：这些会联网或弹系统授权。
- Beta 与 Next 自带的 dsh：`--version` 输出 0.2.3-alpha.2，`--profile headless --dump-config` 正常。
- 未做：
  - 图形应用（真实窗口），包括 `window.open` 弹窗；各平台安装包与签名。
  - Linux 容器里的离线 bundle 检查，所以上面跳过的 bundle 没有在 44.11.5 上启动过。
  - Windows 上的官方 Computer Use（没有原生 helper）。
  - 真实 DeepSeek 账号与模型下的对话。
  - ACP 桥装进 0.2.2 运行时：自动化检查只用 alpha.2。

## 后续

- 上游发出 0.2.3 的 rc 后，Next 才能从 master 发版。
- 本机与 CI 的 Node 升到 24.22.3 以上，与上游支持下限一致。
- 在真实窗口里检查 Electron 44.11.5 下的平台登录、LiveShare 和插件弹窗，并在 Linux 容器里补跑离线 bundle 检查。
- 采用官方 Desktop 的私有 IPC 凭据（`dsh-host-authentication-desktop`）。
- 移植官方 Desktop 操作历史遗漏记录的修复。
