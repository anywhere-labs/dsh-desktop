# TinTin 业务移植方案

> 状态:提案(未开工)。Phase 0 启动前本文档为唯一权威方案;开工后每个交付物回填实际结果。
> 建立日期:2026-09-30。基线:本仓库 `838ba60fd7`(运行时 vendored `0.2.0-rc.2`),源仓库 `D:\Project\dsh-desktop`(建立时位于 `tintin-dsh-desktop`,后与本地目录互换;建立时基线 `bf7e7cd`,运行时 npm `0.1.7-rc.2`)。
> 源业务同步点:已吸收至源仓库 `1b9aca5`(2026-09-30 混剪体验批次:BGM 增益默认 35→30 与滑条加长微调、第四步状态行改基于虚拟剪辑方案、关键词标注高可见样式+去胶囊纯文字、剪映草稿命名改序、选择素材弹窗加宽与两行条目、产品选择持久化、智能匹配跨镜防重复);`92b66f0`(口播音频跨机同步)及更早 `9dda0a4`/`29ca952`/`01d70c8`/`6bc1c32` 随各移植提交先行进入。
> 源仓库文档(`dsh-desktop/docs/`)为只读参考,不在本仓库内修改。
> 强制门禁:[工程移植铁律](tintin-iron-rules.md)(D0-1 交付物,先立门禁再动代码)。

## 一、背景与终态

源仓库是 dataelement 血统的 DSH Desktop fork,其上叠有约 6.4 万行 TinTin 视频创作业务(宿主桥、剪映导出、montage/TTS、Vue 媒体工具、浏览器域、角色预设)。本方案把该业务整体移植到本仓库的 anywhere-labs 架构(Yarn 4 workspace + vendored 运行时 + profile 组合插件)。

```
dsh-desktop(Yarn 4 monorepo,运行时 0.2.0-rc.2 vendored)
├── dsh-plugin-desktop          Stable(不动)
├── dsh-plugin-desktop-beta     Beta = 开发验证通道(只增组合项,不改 src/)
├── dsh-plugin-desktop-tintin   ★ 新增第三通道:TinTin 产品壳(品牌/更新/打包)
├── dsh-tintin-bundle           ★ 新增:宿主 Cordis 插件(IPC 路由/剪映/montage/TTS/媒体代理/FastAPI 代理/角色预设)
├── dsh-tintin-media-bundle     ★ 新增:Vue 媒体工具 client 子应用 + 入口注入
└── 浏览器域:tintin 通道包内 Electron-main 模块 + extraResources(抽取器/扩展/媒体二进制)
```

总量判断:单人全职约 8–11 周;前两周(Phase 0)的三个 spike 决定真实成本,任何 spike 不通即停止并修订本方案。

## 二、三原则

1. **业务代码"搬",接入层"重写"**:剪映导出、montage、TTS 逻辑、媒体代理、Vue 组件等纯业务原样迁移(铁律 1:只搬不写);tintin 的接入机制(patch.yml insert、`window.tintin` polyfill、npm `file:` 依赖)全部换成本框架对应物(workspace 包 + profile 组合 + client 插件)。
2. **tintin 业务代码不进 `dsh-plugin-desktop(-beta)/src/`**:变体镜像门禁强制 Stable/Beta 源码逐字节一致,业务只住独立 workspace 包,经组合装载。
3. **先 Beta 验证,后拆产品通道**:Phase 1–3 期间所有能力以"插件挂到 Beta"方式跑通;品牌/更新器/安装包等不可逆决策推迟到 Phase 4。

## 三、资产映射

| # | TinTin 资产 | 源位置 | 去向 | 改造量 |
|---|---|---|---|---|
| 1 | 宿主桥(路由/任务表/设置探测) | `packages/tintin-bundle/index.js` | `dsh-tintin-bundle` host 插件;`/tintin/ipc/*`、`/tintin/jobs` 注册方式改 0.2.0 Cordis API | 接入重写,逻辑保留 |
| 2 | 剪映导出(轨道/花字/字体/模板) | `tintin-bundle/lib/jianying/` | 原样迁入 `dsh-tintin-bundle/lib/` | 几乎为零 |
| 3 | montage/声音 IPC/品牌读音词典 | `lib/montage/`、`voice-tts-logic.js` | 同上 | 几乎为零 |
| 4 | 媒体代理(rembg/VSR/归档)+ ytdlp | `lib/media-proxy.js` | 同上;`TINTIN_BIN_DIR` spawn 不变 | 小 |
| 5 | FastAPI 服务代理 + SSE 流 | `lib/server-proxy.js` + 契约类型 | 同上;`contract:gen` 保留,生成物提交 | 小 |
| 6 | 5 个角色预设 + 生成管线 | `tintin-bundle/presets/`、`scripts/build-tintin-presets.mjs` | 管线保留,基底换成 0.2.0-rc.2 standard 预设重新生成;agentPresets 注册按 0.2.0 API 校对 | 中 |
| 7 | context-task / legacy-config | `lib/context-task.js`、`legacy-config.js` | 原样迁 | 小 |
| 8 | Vue 媒体应用(12+ 工具卡/分镜/素材库/ops 工具) | `tintin-media-bundle/src/**` | `dsh-tintin-media-bundle`,vite 构建不变 | 组件零改动,挂载缝重做 |
| 9 | Tab/侧栏入口 + `window.tintin` polyfill | `tintin-bundle/client.js` | 重写为标准 client 插件(参照 `dsh-plugin-desktop/src/client/` 做法) | 重写 |
| 10 | 浏览器域(独立窗口/cookies/嗅探/下载/抽取器/扩展) | `src/main/tintin/browser/**`、`build/extractors/`、`build/ext-assets/` | tintin 通道的 Electron-main 模块 + host RPC 面;资源进 extraResources | 中-大 |
| 11 | 自动上架编排 | `browser/auto-listing/scripts/` | 随浏览器域 | 中 |
| 12 | 首启动种子/自愈、旧预设迁移 | `tintin-first-boot.ts`、`state/legacy-preset-migration.ts` | 对照本框架 onboarding/setup-wizard 重放到 tintin 通道 | 中 |
| 13 | `.dshpreset` 导入导出 | `packages/dsh-desktop-preset-transfer` | 先查本框架是否已有等价物;没有则独立迁入 | 小 |
| 14 | 媒体二进制(~300MB)+ 搬运脚本 | `resources/bin`、`fetch-tintin-binaries.mjs`、`fetch-tintin-ext-assets.mjs` | 脚本原样保留(源仍指 `TinTin_Client_Electron`),产物进 tintin 通道 extraResources | 小 |
| 15 | 33 个 tintin 测试 + 剪映/SSE 测试 | `test/tintin-*.test.ts` | 拆进对应 workspace 包,纳入根 `corepack yarn test` | 小 |
| 16 | FastAPI 服务端 | 外部内网服务 | 不动 | 零 |

**不迁移**(逐项裁决后确认):`src/main/state/` 30+ 个 Profile/插件/恢复状态机(与本框架 `profile-manager`/`package-overlay`/startup-recovery 重叠,按功能对照表裁决,预计大部分废弃)、`dsh-desktop-market-installer`(本框架有更完整市场)、tintin 手机 LAN 桥(Phase 4 决策:AA 桥 vs 保留)。

## 四、26 个补丁处置分类

完整逐 hunk 裁决见 D0-2 交付物 `docs/tintin-patch-audit.md`(铁律 13)。

| 处置 | 已知示例 | 说明 |
|---|---|---|
| 丢弃(机制被取代) | `@deepseek-ai+dsh`(宿主包注入) | 本框架 embedded launcher + profile 组合已做同一件事 |
| 很可能已被本框架覆盖(审计后丢弃) | `dsh-app-boot`、`dsh-plugin-manager`、`dsh-client-ui-conversation/sidebar/settings-*`、`cordis-plugin-loader` | 本框架 0.2.0 代有同名补丁;tintin 特有 hunk(如媒体卡接线)**重基底**到本框架补丁上 |
| 待验证 0.2.0 是否内置(内置则丢弃) | `dsh-api-session-controller`(SessionDelete)、`dsh-session-persistence(+jsonl)` | 0.1.7 能力缺口补丁,0.2.0 大概率已含,须实测(D0-3) |
| 转译保留(tintin 专属) | `dsh-client-ui-agent-preset`、`dsh-llm-deepseek`(若为 provider 种子则改配置实现) | patch-package → yarn `patch:` 协议,按版本分代进 `patches/`,纳入 vendored 管线 |

## 五、阶段计划与交付物

### Phase 0 — 基线 + spike + 补丁审计(1.5–2 周)★ 决定成败 — **已完成(2026-09-30),三 spike 全过,结果见 [spike 报告](tintin-spike-report.md)、[补丁审计](tintin-patch-audit.md)、[API 差异清单](tintin-api-diff.md)**

内容:
- 基线三连:`git submodule update --init --recursive` → `corepack yarn install` → `corepack yarn check` 全绿 → `yarn workspace dsh-plugin-desktop-beta dev` 应用可启动。
- Spike A(最关键):tintin-bundle 缩成 `/tintin/ping` + 1 条 IPC 路由 + 1 次 ffmpeg spawn 的最小 host 插件,挂进 Beta 组合跑通。验证 0.2.0 插件注册、webServer 路由 API、`TINTIN_BIN_DIR` 二进制注入。
- Spike B:`tintin-media-bundle` 的 `dist/client.js` 在 0.2.0 客户端模块缝(`__ModuleLoader__`/dsh-client-modules)下挂载渲染。UI 侧最大风险点;不通则写适配插件。
- Spike C:浏览器域可行性——确认本框架 Electron 窗口/session 控制能力归属面,定接入模式。

交付物:
- **D0-1** 移植铁律落档 + `check:tintin` 门禁骨架(锚点 grep + 单文件行数基线 + media-bundle tsc 接入根 check)。
- **D0-2** `docs/tintin-patch-audit.md`:26 补丁逐 hunk 裁决(丢弃/已覆盖/转译),每条带四类依据之一。
- **D0-3** 0.1.7→0.2.0 API 差异实测清单(agentPresets、模块缝、webServer 路由、预设格式、session 持久化)。
- **D0-4** Spike A/B/C 实测报告。
- **D0-5** 基线三连通过记录。

验收门禁:**三个 spike 全通才进入 Phase 1;任何一个不通,回本方案修订后再继续。**

### Phase 1 — 宿主能力层(1.5–2 周) — **已完成(2026-09-30)**:lib/ 与 presets/ 逐字节原样迁入,index.js 仅改插件名;17 个测试文件 118 用例全绿;Beta 组合接线(dep + cordis.patch.yml insert)后 `verify:profile` 无头冒烟通过(Creator/plugin manager/两次 HMR generation)。注意:宿主单例(@deepseek-ai/*)不进插件私有依赖,运行时走宿主回退,测试经 vitest alias 指向 Beta 安装;首次 verify:profile 需补下 Electron 二进制(约 50 分钟,enableScripts:false 所致)。预设运行时行为留待 Phase 2 GUI 验证。

- 建 `dsh-tintin-bundle` workspace:迁资产 #2–#7;预设按 0.2.0 基底重新生成;`contract:gen` 接通;对应测试迁入全绿。
- 验收:Beta 内可 ping,可走通一条完整链路(whisper 转写经 FastAPI 代理返回)。

### Phase 2 — 前端能力层(1.5–2 周) — **核心完成(2026-09-30)**:Vue 源码 99 文件整体迁入,vite 管线一次构建成功(180 模块→1.6MB dist,模块 id 改 dsh-tintin-media-bundle);真实 chrome(1426 行)移植,侧栏入口注入适配官方锚点 `[class*="sidebarCol"]`/`[data-pane="sidebar"]`;浏览器实测:首启向导、三入口注入(运营/媒体/浏览器)、视图切换 KeepAlive、媒体目录、素材库卡片(含真实后端调用与显式失败路径)、输入框上下文条全部工作;media src 测试 8 文件 58 用例全绿。**余量**:三补丁集群(SessionDelete 5包/FORBIDDEN 3包/附件打开 5包)转译为独立后续工作包(逐包 re-base 到 0.2.0 + resolutions patch: 接线);`conversation.input.left` 上下文条在 0.2.0 原生存在已实证。

- 建 `dsh-tintin-media-bundle`:Vue 源码整体迁入(组件不动),重写挂载缝与入口注入;dev-probe 探针页机制保留用于离线调组件。
- 验收:分镜卡、素材库、声音克隆三张代表性卡在 Beta 内正常渲染并调通后端。

### Phase 3 — 浏览器域 + 打包资源(2–3 周) — **逻辑迁移完成(2026-09-30)**:新建 `dsh-tintin-browser` workspace,浏览器域整树迁入(browser-service/cookies/嗅探/下载/扩展/自动上架 39 文件)+ 平台抽取器 6 脚本 + 二进制/扩展获取脚本;测试 9 文件 60 用例全绿(Electron 经 vitest stub 注解,纯逻辑无 Electron 依赖的设计得到保持)。**Phase 4 承接**:extraResources 接线(300MB bin + 抽取器 + 扩展)随 tintin 通道包,窗口接线与 host↔main 通信面。

- 迁 #10、#11、#14:浏览器域 Electron 模块、抽取器、扩展、自动上架;extraResources(含 300MB bin)接入 electron-builder;`afterPack` 校验扩展。
- 验收:浏览器域窗口 + B 站/抖音抽取器在**打包目录安装版**可用(非 dev 目录)。

### Phase 4 — TinTin 产品通道(1–2 周) — **引导 + 窗口接线 + 打包链完成(2026-09-30)**:
- 三方镜像通道落地(Beta 字节级镜像 + TinTin 身份),`verify-desktop-variants` 三方校验 + 通道增量允许清单(`tintin/main-hook.ts`、`tintin-main.ts`)。
- **组合入口架构**:`package.json main → lib/tintin-main.js`(通道专属入口,加载即装 TinTin 能力后引镜像 main)——镜像文件零改动。浏览器域经 `app.on('browser-window-created')` 挂到主窗口(dsh-tintin-browser 以 noExternal 打包进通道入口,无运行时 TS 导入);TINTIN_BIN_DIR 指向 `<resources>/bin`。
- **打包链**:通道 `package:dir` 与根 `package:tintin:dir`(market:prepare + aa:prepare-release 新鲜度门禁)打通;win-unpacked 产物含 tintin 包与组合入口(777MB 清单核验)。⚠️ afterPack 打包冒烟在本机失败为**仓库级 Windows 存量问题**(打包内 Node 24 BigInt 对 default_app.asar 统计,Beta 同样逐字失败;CI 的 ubuntu 绿)。**余量**:extraResources 接线(300MB bin/抽取器/扩展,fetch 脚本已就位待产物)、NSIS 安装器/签名链、更新端点裁决(附录 E)。

- 建 `dsh-plugin-desktop-tintin`:`src/` 与 Beta 镜像 + `product-identity.ts`(appId `com.tintin.desktop`、独立 DSH_HOME);`verify-desktop-variants` 扩为三方校验(tintin = 镜像 + 允许清单增量);AGENTS.md 同步改规则;Windows 签名链移植;更新器指向 TinTin 自己的版本服务;根 `dist:tintin` 链接入 `market:prepare`/`aa:prepare-release` 同样的新鲜度门禁。
- 决策点(到此再定,列入附录待裁决清单):手机桥用 AA 还是保留 LAN 桥;`.dshpreset` 传输是否保留;mac 二进制来源。

### Phase 5 — 收敛与门禁(1 周) — **门禁收敛完成(2026-09-30)**:`check:tintin`(15 锚点 + 9 行数基线 + workspace 注册 + 单测 5/5)已接入根 `check` 链;三方镜像门禁与布局门禁全绿;四个 tintin workspace 测试全部接入根 `test` 链(bundle 118 + media 58 + browser 60 = 236 用例)。**余量**:dist:tintin 打包门禁待 Phase 4 打包链落地后接入;补丁 hunk 计数核对随补丁集群转译落地。

## 八、移植执行总账(2026-09-30)

| 阶段 | 状态 | 提交 |
|---|---|---|
| Phase 0 基线+审计+三 spike | ✅ 完成 | `5ac6a08505` |
| Phase 1 宿主能力层(16.2k 行) | ✅ 完成 | `a2132658f8` |
| Phase 2 前端能力层核心(99 文件 Vue + 真实 chrome) | ✅ 核心完成 | `3946b200ad` |
| Phase 3 浏览器域逻辑(39 文件 + 抽取器) | ✅ 逻辑完成 | `50124521d8` |
| Phase 4 产品通道引导 | ✅ 引导完成 | `b15eb77b0c` |
| Phase 5 门禁收敛 | ✅ 完成 | 本提交 |

**已验证的关键结论**:0.1.7→0.2.0 的宿主路由 API、客户端模块缝、dsh.client 声明完全同构;真实生产产物(1.9MB Vue dist、1426 行 chrome、1415 行宿主桥)零重写迁移;verify:profile 无头组合冒烟通过;浏览器实测全链路(向导→入口→视图→卡片→后端调用)工作。

**遗留工作包**(按优先级):
1. ~~三补丁集群转译~~ **已完成(2026-09-30,提交 `cc983086fe` + `e59f6491ad`)**:SessionDelete 7 包、FORBIDDEN 3 包、附件打开 4 包(UI 层含与仓库现有 conversation 补丁的合并);全部经 yarn patch: 协议注册、重装存活验证、浏览器 DOM 实测生效。剩余 11 个独立审计项(非集群)见[补丁审计](tintin-patch-audit.md)转译进度节。
1b. ~~first-boot 重放(服务菜单+自动注册)~~ **已完成(2026-09-30)**:旧 `tintin-first-boot.ts` 的三大件迁移——provider/凭据/默认模型自愈移入 `client.js` 的 `installTintinProvisioning()`(每次页面加载幂等,经已验证同名的 settings/credentials 公开 RPC),默认工作区经宿主 `/tintin/workspace/ensure` 路由(lib/workspace-ensure-route.js)+ `workspace/create` RPC。**实测全链**:server.url 一处配置 → tintin-server provider 自动注册(2 模型,baseURL=<server>/llm)→ 默认模型自动接管 → 凭据占位 → 工作区登记,composer 模型选择器显示服务端模型。顺带修复 0.2.0 适配 bug:schemastery volatile 占位新形态 `{get:()=>current}`(lazy getter,JSON 序列化为 {} 但键计数非空)穿透 stripEmptyObjectLeaves 盖掉 store 真值——strip 增加全函数叶子判定 + 回归测试。
2. 浏览器域窗口接线(通道包 main + host↔main RPC)+ extraResources。
3. dist:tintin 打包链 + 更新端点/签名链(附录 E 决策)。
4. 预设运行时行为 GUI 验证、tintin:presets 生成管线 0.2.0 基底化。
5. undici 补丁验证(审计 #26,未执行)。

- `verify:customizations` grep 锚点改造成 `check:tintin` 并入根 `check` 与 `dist:tintin`;补丁 hunk 计数等价物纳入;`corepack yarn check` + 三平台打包验证 + Windows 安装包冒烟。

## 六、风险(按杀伤力排序)

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 客户端模块缝 API 变化(0.1.7→0.2.0)导致 Vue 挂载重做 | Spike B 前置,第一周暴露 |
| 2 | 补丁语义散佚("测试全绿但定制丢了") | D0-2 审计 + 铁律 13 hunk 门禁 + 锚点核查 |
| 3 | 三方镜像门禁是治理变更 | Phase 4 前定稿 AGENTS.md 规则,先门禁后代码 |
| 4 | mac 侧媒体二进制缺失(当前基本为 Windows 形态) | `TinTin_Client_Electron` 先补 mac bin,或 Phase 4 裁决仅发 Windows |
| 5 | Electron 43→44、builder 26.15.3→26.15.7、npm→Yarn 机械差异 | 逐包过,量小面广 |
| 6 | Studio 服务实例无主:detached 服务跨 app 重启/版本残留,版本漂移 + 崩溃循环导致官方聊天接管整体失败(2026-10-23 实障) | 见 [lifecycle ownership note](../.agents/notes/proposed/architecture/2026-10-23-tintin-studio-service-lifecycle-ownership.zh.md):指纹化附着 + DSH 持有实例;短期先修视图自愈三缺口 |

## 七、待裁决清单(附录 E,四类依据之"用户裁决"挂起项)

1. TinTin 产品更新通道:沿用 TinTin 自有版本服务,还是接入 `dshdesktop.cn` 渠道体系。
2. 手机桥:AA 桥 vs 保留 tintin LAN 桥(cloudflared/pinggy)。
3. `.dshpreset` 导入导出是否保留为本框架能力。
4. 迁移期间源仓库 `tintin-dsh-desktop` 是否冻结大改(建议:Phase 0–3 冻结,避免双线漂移)。
5. mac 通道发布范围(仅 Windows 首发?)。
6. Studio 服务生命周期收归 DSH(指纹化附着、实例对账、崩溃可观测)——依据与方案见 [2026-10-23 lifecycle ownership note](../.agents/notes/proposed/architecture/2026-10-23-tintin-studio-service-lifecycle-ownership.zh.md);随附流程规则:撤销降级路径的改动必须同步审计依赖该兜底的错误处理(拟入铁律)。

## 八、OpenFilm 壳/ACP 集成(第三行裁决,2026-10-23 起)

**裁决**:视频剪辑 = Studio 官方聊天 UI(openfilm 0.2.5 页内 shell:编辑器 + 官方聊天同页编译)+ DeepSeek Harness ACP 智能体(模型路由 TinTin 服务端)。**删过渡版不等于删功能** — 过渡版能力一律以**官方机制**重建(用户裁决 2026-10-24)。

### 8.1 过渡版功能 → 官方形态映射(验收口径)

| 过渡版功能 | 官方形态实现 | 移植点(锚点) |
|---|---|---|
| 自绘聊天列(会话/审批/提问/工具卡) | 官方 chat 源树编译进 shell 页(mountChat),经 `window.openfilmDesktop` 桥通信 | `openfilm-shell/main.tsx`、chat 源树(官方 pin cf6cd6f) |
| 宿主契约桥面 | 官方 `apps/desktop/shell/bridge.ts` 逐字移植;**单宿主**(页面 bridge 是唯一 `openfilmHost`,preload 不暴露迷你 host) | `openfilm-shell/bridge.ts`、`studio-preload.ts` |
| 选中/时间/引用注入 | Studio ProjectView → `host.onSelection/onRefer` → 官方聊天 @ 菜单与 pill | `bridge.ts` selection/refer(官方 ProjectView) |
| 项目素材位 | Studio 左侧媒体面板(**panel 不挂 assets/setAssetsOpen** — host.ts useHostPanel 判定) | `bridge.ts` panel |
| 在线素材库(浏览/下载落项目) | shell 页内抽屉(主进程代理 `/material/*`,无 CORS);下载落 `assets/download` → 左侧面板 | `tintin-library.ts`、main-hook `openfilm:library:*` |
| 技能(原生+服务端合并) | `app.skills` 名单合并(顶层 `skills` 形状);正文注入含服务端 `instruction` | main-hook `openfilm:native:skills-list/texts` |
| 原生技能随包分发 | `resources/skills/openfilm` → 影片智能体 home 同步 | `scripts/prepare-skills.mjs`、`film-acp.ts` |
| 影片历史持久化 | `.film/chat.json` + `.film/logs/*.jsonl` | `film-chat.ts`、`desktop:chat:*` |
| 角色(编导/制作) | 官方 ACP 会话预设名册(上游接缝:preset-registry「Composing a child agent」,经部署配置加入,不改子模块) | `film-agent.patch.yml`(进行中) |

### 8.2 生命周期与自愈(第三行形态)

- **接管**:影片视图 250ms 快轮询 `has-shell`;未命中 → 清陈旧 run.json → `startStudio` 全新拉起(附着前指纹对账)。
- **净场**:`will-quit` + `process 'exit'`(failLoud 崩溃路径)同步收场;开机对账按可执行路径甄别清理 openfilm node 孤儿。
- **日志**:统一 `diagnosticLog`(主进程 / studio-renderer / 宿主);页面启动错误浮层;影片视图底部常驻日志条。

### 8.3 验收追踪

需求→实现→验证的逐条状态见 [对齐验收追踪表](tintin-openfilm-alignment-acceptance.md);锚点门禁(`check:tintin`)登记本文与代码的承重锚点([scripts/tintin-anchors.json](../scripts/tintin-anchors.json))。
