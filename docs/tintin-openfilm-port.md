# TinTin 视频剪辑 × OpenFilm 移植说明(第三行形态)

状态:现行 · 依据:2026-10-18/23/24 用户裁决 + 官方 openfilm 0.2.5 源码(pin `cf6cd6f`)+ 实测(铁律 12/14) · 关联:[移植方案](tintin-migration-plan.md)、[验收追踪表](tintin-openfilm-alignment-acceptance.md)、[服务端兼容说明](tintin-openfilm-server-providers.md)

## 0. 本文范围

本文是**视频剪辑功能整体从 OpenFilm 移植的说明**:OpenFilm 是什么、我们采用哪种形态、页内三份桥面契约、影片视图、ACP 智能体、持久化、媒体 provider、技能、在线素材库、角色名册、**移植文件清单(锚点)**、生命周期与自愈、服务端契约、验收口径。后续任何视频剪辑相关改动以本文为唯一入口。

## 1. OpenFilm 是什么(上游资产)+ 功能全景盘点

OpenFilm 是开源 AI 视频智能体(仓库 `github.com/openfilm/openfilm`):Studio 编辑器(影片 = HTML 页面 + 时间线)+ 应用壳(聊天列驱动智能体写影片)。官方桌面端 = 编辑器与聊天**同一页编译**(`apps/desktop/shell`),经 `window.openfilmDesktop` 桥把 Studio 与聊天接起来。我们**不重写编辑器、不重写聊天**,以官方源码为资产移植。

**上游文档(功能全景的出处)**:`README.md` / `README.zh-CN.md`(产品全貌)、`apps/desktop/README.md`(桌面 = Studio + 聊天窗)、`packages/openfilm/README.md`(命令)、`packages/openfilm/MANUAL.md`(智能体手册)、`packages/openfilm/SPEC.md`(影片格式协议 0.1)、`skills/openfilm/SKILL.md`(技能)、各包 `CHANGELOG.md`。

### 1.1 功能全景 → TinTin 视频剪辑状态

| # | OpenFilm 功能(上游文档) | TinTin 集成 | 状态 |
|---|---|---|---|
| 1 | **film.html 格式**:`<section>`=轨道(第一条在最上)、片段=页面/视频/静态图/声音、`#t=12,18` 媒体选取、`at`/`speed`、样式定位、`overrides` 保留手工修改(README/Spec) | 官方 Studio 原样处理,格式不改 | ✅ 对齐(未改) |
| 2 | **页面契约**:`window.film.frame(t)` + `duration/ready/width/height`;唯一规则「同一 t 同一画面」(README/SPEC) | 官方运行时要价原样 | ✅ 对齐(未改) |
| 3 | **look 检查**(总览/单帧/区间、乱序重绘、页面错误/字体/缺失音频/截断文字) | 智能体在影片目录执行 CLI(ACP 子进程 cwd=影片) | ✅ 可用 |
| 4 | **Studio 编辑**:时间线修剪/切分、元素移动缩放旋转、文字/颜色/样式、字幕、画面内元素覆盖(README Studio 段) | 官方编辑器页内(原生视图) | ✅ 对齐(未改) |
| 5 | **带名版本 + 回退**(Studio 保存版本,git) | 官方 Studio 自带;数据在影片目录 | ✅ 对齐(未改) |
| 6 | **导出**:MP4/GIF/声音/分轨/字幕/静帧/幻灯片/透明背景(.webm/.mov)、FCP/Premiere/Resolve XML | 官方 Studio 导出面 | ✅ 对齐(未改) |
| 7 | **媒体面板(项目素材)** | Studio 左侧媒体面板(panel 不挂 assets) | ✅ 本轮修复 |
| 8 | **桌面聊天窗口**(Studio 旁的对话窗,接 Claude Code/Codex 等智能体;也可自带智能体 + 自己 key)(desktop README) | 官方聊天 UI(shell 页内)+ DSH ACP 智能体(模型走服务端) | ✅ 第三行形态 |
| 9 | **媒体生成 `openfilm get`**:配音/音乐/音效/转写字幕/图片/视频,provider 用自己的 key(README/get) | Studio 内建功能 → provider = TinTin 服务端(`openfilmCompat` 默认开,/v1 兼容);人的真 key 让位 | ✅ 服务端默认 |
| 10 | **命令**:`openfilm`(手册)/`open`/`look`/`render`(--4k/--blur/--alpha)/`get`/`doctor` | 智能体经 ACP 在影片目录执行(CLI 随包),TinTin 不改 CLI | ✅ 可用 |
| 11 | **技能**:`npx skills add openfilm/openfilm`,智能体按技能手册做片 | 随包原生技能(`resources/skills/openfilm`)+ 服务端技能合并;智能体 home 同步 | ✅ 本轮补齐 |
| 12 | **服务商设置**(Studio 设置→服务商,自己的 key) | 服务端默认注入;人的 key 自动让位 | ✅ |
| 13 | **SPEC 协议 0.1**(播放器/渲染器/编辑器实现方) | 我们只消费官方实现,不改协议 | ✅ 对齐(未改) |
| 14 | **在线素材库**(TinTin 自定义,上游无) | shell 页内抽屉 `/material/*` 代理 + 下载落项目 | ✅ 本轮重建 |
| 15 | **角色智能体**(TinTin 自定义,上游无) | ACP 预设名册(部署配置) | 🔶 实现中 |

口径:**第 1/2/4/5/6/13 项是官方原生能力,TinTin 只负责把它跑起来、不改造**;第 3/7/8/9/10/11/12/14 项是集成点(已对齐或已修复);第 15 项是唯一未完成项。任何偏离此表的视频剪辑功能,以本表的"状态"为准。

## 2. 集成形态裁决(第三行)

| 方案 | 结论 |
|---|---|
| 自绘聊天列(过渡版) | **退役**(2026-10-23) |
| 只嵌编辑器 | 不采用 |
| **第三行:Studio 官方聊天 UI + DSH ACP 智能体** | **采用** |

铁律落点:过渡版能力**一律以官方机制重建**(删过渡版 ≠ 删功能,2026-10-24 用户裁决);重建映射见 §12 与验收表。

## 3. 总体架构

```
主窗口(TinTin 客户端页)
  └─ 视频剪辑视图(client-ui mountOpenFilm)
       ├─ 原生视图(WebContentsView, 伺服 Studio 服务页 /open?key=…)
       │    └─ shell 页(官方两树编译): Studio 编辑器 + 官方聊天列
       │         ├─ window.openfilmHost   ← shell 页 bridge.ts(唯一宿主)
       │         ├─ window.openfilmDesktop ← shell 页 bridge.ts(聊天桥)
       │         └─ window.openfilmNative  ← studio-preload(系统面 IPC)
       ├─ 底部常驻日志条(接管状态 + 诊断 + 日志路径)
       └─ 加载遮罩 / 失败重试
主进程(dsh-plugin-desktop-tintin)
  ├─ FilmAgentManager(每影片一个 dsh --profile acp 子进程)
  ├─ filmChat(.film/chat.json + .film/logs/*.jsonl)
  ├─ Studio 服务生命周期(start/attach/reconcile/teardown)
  └─ 统一日志 diagnosticLog(主进程/studio-renderer/宿主)
服务端(TinTin server 192.168.111.31:8000):/llm(模型路由)、/v1(asr/tts 兼容)、/material/*、/skills
```

## 4. 页内桥面三契约

| 契约 | 归属 | 内容 |
|---|---|---|
| `window.openfilmHost`(StudioHost) | **shell 页 bridge.ts 唯一设置者**(preload 不再暴露迷你 host — 双宿主劫持选中上报的实障) | panel(不含 assets/setAssetsOpen)、agents、asks、folders、settings、developer、update、onSelection/onRefer/onHover/onCommand |
| `window.openfilmDesktop`(AppBridge) | shell 页 bridge.ts | agents/localAgents/chat/skills/asks/projectFiles/withPicture/highlightInStudio/draftRefsInStudio/assetsOpen/setAssetsOpen/onRefer/onSelection… |
| `window.openfilmNative` | studio-preload(contextBridge) | agents 注册表、localAgents(ACP 会话协议)、chat(持久化)、skills(清单/正文)、library(在线素材代理)、tintinFilmDir、capture/pickFolder/revealPath/prefs |

**关键判定(官方源码实证)**:Studio 的左侧媒体面板是否让位,由 `host.ts useHostPanel` 的 **`panel.setAssetsOpen` 是否存在**决定;我们不挂该成员 → 项目素材保留在 Studio 左侧面板,聊天列素材按钮改开在线素材抽屉。

## 5. 影片视图(client-ui)


**加载架构(2026-10-24 用户裁决)**: 舞台上的加载遮罩(note)在原生视图**隐藏**期间显示; 原生视图是独立表面(页面里的遮罩盖不住它), 因此在「页面桥就绪 + 页面已画出过一帧(主进程双 rAF 屏障)」两项都满足后才显示; 遮罩在显示视图之后才撤, 消除遮罩撤了但首帧未画的黑屏窗口期。
> 入口位置(2026-10-24 用户裁决, 终稿): **素材 / 技能 / 角色 三个入口全部在右侧聊天列的 composer 工具条内**(官方按钮同款样式, 注入式挂载); 无任何左侧/浮动入口。在线素材抽屉由素材按钮开合; 抽屉下移 40px 让开顶部栏。抽屉下移 40px: 顶部栏(上传/语言/更多等窗口 chrome 按钮)已有内容, 抽屉头部让开它, 避免 × 与 chrome 按钮重叠。


- **重绘推进(2026-10-24 报障, 二修)**: 1px 微调不足以触发合成器; 改为在页面加载完成与接管确认后**把子视图摘挂一次**(removeChildView/addChildView, 等价于用户切换视图/还原窗口) + 16px 边界往返; 三个时机: showStudio 后 / did-finish-load 后 / has-shell 命中后 200ms;

- 原生视图覆盖舞台;250ms 快轮询 `has-shell`(openfilmDesktop + #of-chat 双判定),命中即接管;
- **视图边界 = 舞台矩形, 不向上扩张**(2026-10-24 报障的机制): 曾经的 TOP_FILL=40 让原生视图侵入窗口 chrome 条, 抽屉头部压在标题栏拖拽区边界 → 双击触发窗口最大化、× 点击落到 chrome; 现在视图从舞台顶开始, 底部仍让出 40px 日志条;
- **陈旧判定只在确认旧页时触发**(2026-10-24 报障修复):探测诊断须连续 3 次「readyState=complete 且无桌面桥」才请求清理 run.json;页面加载慢时**绝不重启**(否则会起第二个服务、视图闪切到别的界面);未命中兜底恢复过渡版;
- 顶部填充 40px(原生视图上移)、底部留 22px **日志条**(接管状态 + 诊断 + 日志路径), 且**只在视频轨道宽度内**(右缘让出聊天列, 不横跨会话框下方);
- 未命中兜底:恢复过渡版聊天列 + 状态行;陈旧服务清理后由 `startStudio` 全新拉起。

## 6. 影片智能体(ACP)

- `dsh --profile acp --patch <channelHome>/tintin/film-agent.patch.yml`,每影片一个子进程;
- 补丁定义 provider(tintin-server, OpenAI 兼容)+ 模型(deepseek-v4-flash/pro),密钥占位 `sk-tintin-local`;
- 能力:steering(通知式)、cancel、setConfigOption、permission/elicitation 转发为官方审批卡/提问卡;
- 启动句柄用 **deferred**(禁止 bare `Promise.reject`:会触发 failLoud 退出主程序 — 2026-10-24 实障);
- 会话持久化:`session/resume`,失败回落新建;`FilmAgentManager.dispose()` 随 app 退出/崩溃路径执行。

## 7. 会话持久化

- `<影片>/.film/chat.json`(原子整写:{sessions,last,turns:[{turn,items}]});
- `<影片>/.film/logs/<turnId>.jsonl`(prompt/done/事件逐行);
- IPC 面 `desktop:chat:*`(load/sessions/turn/log/unsaved/ref-image/attachment/paths/snapshot/changes/reveal);
- 轮次回执缓存:重载后恢复“运行中”会话,ack 后清理。

## 8. 媒体 provider(服务端为默认)

- `server.openfilmCompat` **默认开,仅显式 `false` 关闭**(2026-10-24 用户裁决:服务端的服务商 = 视频剪辑默认服务商;门控在 channel-table `compatUrl` 与 bundle `createOpenfilmSync` 两处同口径);隔离 Studio home 种 `use.asr/tts=openai` 并注入 `OPENFILM_OPENAI_URL` + 占位 key;人的真 openai key 存在时自动让位;
- 实证(2026-10-24):影片智能体补丁 `<channelHome>/tintin/film-agent.patch.yml` = provider `tintin-server`(openai-completions, `<server>/llm`)+ 模型 deepseek-v4-flash/pro,`provider`/`model` 默认路由已实测落盘;
- 服务端 `/v1/audio/transcriptions` 对齐(asr form 字段 + verbose_json words);`/v1/audio/speech` wav 对齐;
- 模型路由:对话不消耗 DeepSeek 官方 API(ACP 补丁走 tintin-server)。

## 9. 技能(原生 + 服务端,交互需求规范)

技能要求以本节为准:**服务端技能与本地技能全部集成**,两个表面都要完整呈现。

### 9.1 数据

- 名单:`openfilm:native:skills-list` = 随包分发的原生技能(`resources/skills/openfilm`)+ 服务端 `/skills`(实测**顶层 `skills`**,字段 id/name/description/instruction;2026-10-24 实测服务端共 7 个);每项带 `source: 'native' | 'server'` 供分组;
- **Studio 官方技能目录**(/api/skills): 项目的+个人的+官方的(视频复刻等) —— 在 Studio 页内 fetch(自带鉴权), 与本地/服务端清单合并;
- 正文:`openfilm:native:skills-texts` = 本地 SKILL.md + 服务端 `instruction` 补齐 → 技能引用的上下文注入带全文;
- 原生技能随包:`scripts/prepare-skills.mjs` 复制 → extraResources `skills/`;影片智能体启动时同步进 `film-agent-home/skills/openfilm/`;
- 安装:`openfilm:skills:install`(服务端技能 → 写 `film-agent-home/skills/<name>/SKILL.md`,智能体即可用)。

### 9.2 交互表面

| 表面 | 要求 | 状态 |
|---|---|---|
| `@` 技能组(官方聊天) | 列出**全部**原生 + 服务端技能,可插入消息(正文注入带全文) | ✅(2026-10-24 在 chat 源树扩展 @ 菜单第三组;官方 `/` 菜单的技能组同源保留) |
| (旧)技能抽屉 | **已退役**(2026-10-24): 官方技能对话框 + `@` 技能组 + `/` 斜杠菜单三处已完整覆盖原生+服务端技能; 接口 `skills:install` 保留 | — |
| 官方「Skill 示例」画廊 | 官方示例(如视频复刻/长视频转短视频等),与技能列表是两个数据源,不混用 | 官方行为 |

> 口径:官方示例画廊 ≠ 技能清单。判断“技能是否齐全”以 `@` 技能组 / `/` 斜杠菜单 / 官方技能对话框为准(原生 1 + 服务端 7 = 8 个); 原技能抽屉已退役(见上表)。

## 10. 在线素材库(交互需求规范)

在线素材库是 TinTin 在官方聊天之上的自定义能力(上游无此概念),**交互要求以本节为准**。

### 10.1 入口

| 入口 | 行为 |
|---|---|
| 聊天列 composer 的素材按钮 | 经桥 `setAssetsOpen` → `registerAssetsDrawer` 打开抽屉(再点关闭) |
| shell 页左下角「⇩ 在线素材」 | 打开抽屉 |

### 10.2 抽屉交互

| 交互 | 规格 | 状态 |
|---|---|---|
| 类型切换 | 视频 / 图片 / 音频三个 tab,服务端 `media_type` 过滤,切 tab 重置分页 | ✅ |
| 搜索 | 300ms 防抖,服务端 `search`,与 tab 组合 | ✅ |
| 分页 | 24 条/页,「加载更多」,无更多时隐藏 | ✅ |
| 缩略图 | 视频/图片行显示 `/material/thumbnail`;音频无缩略图用 ♪ | ✅ |
| 空态/错误 | 空结果与加载失败显式文案(不静默) | ✅ |
| 预览 | 点击名称/缩略图 → 模态预览(视频/音频播放器、图片大图),关闭返回 | ✅ |
| 音频试听 | 行内 ▶/■ 同键切换,单实例(起播停他行),自然结束复位 | ✅ |
| 下载到项目 | 行按钮:落 `<影片>/assets/download/` → Studio 左侧媒体面板可见 → 拖时间线 / `@` 引用 | ✅ |
| 下载到电脑 | 右键菜单:落系统下载目录(`app.getPath('downloads')`) | ✅ |
| 下载进度 | 抽屉底部不定长进度条 + 「正在下载到项目…」状态;完成后显示落盘路径/失败原因 | ✅ |
| 关闭抽屉 | 四条路径: 头部 ×(28px)/底部「关闭」/点抽屉外背景遮罩/Esc;抽屉整体下移 40px 避开窗口标题栏拖拽热区(双击会触发窗口最大化);关闭同时回置聊天素材按钮状态 | ✅ |
| 拖拽出抽屉 | 不提供(以「下载」按钮替代,避免跨视图拖拽的层级问题) | 不适用 |

### 10.3 数据与 IPC

- 列表:`openfilm:library:list`(主进程代理 `GET /material/list?page&size&media_type&search`,实测返回**顶层 `items`**,无 CORS);响应附带 `serverUrl` 供缩略图/预览 URL 拼接(`/material/thumbnail|serve?material_id=`);
- 下载:`openfilm:library:download { project, materialId, filename, target: 'project'|'downloads' }`(project→影片 assets/download;downloads→系统下载目录),返回 `{ok, rel|path}`;**项目路径缺失时主进程自行从 `openfilm-studio/studio.json` 的最近项目解析**(2026-10-24 报障:页面侧 openfilm:currentProject 偶发为空导致下载无反应);每次下载的结果(成功文件路径/失败原因)写统一日志(事件 `library-download`),行按钮有「下载中…」状态;
- 素材引用闭环:下载到项目 → 左侧面板 → 时间线 / `@` 引用(官方交互);左侧面板的刷新由 Studio 自身的列表拉取决定(外部写入的文件需面板刷新或重开影片才出现)。

## 11.1 选择产品(2026-10-24 用户要求: 仿视频流程移植)

| 交互 | 规格 |
|---|---|
| 入口 | composer 底部行「📦 产品」按钮(角色选择器旁) |
| 面板 | 搜索(品类/品牌/型号)+ 产品列表(名称/品类/货号), 点选即注入 |
| 注入 | 产品资料结构化文本(品牌·型号·品类·货号 + 性能参数 + 核心卖点逐条)以粘贴事件写入官方 composer 输入框(Lexical 原生接住), 即 @ 引用形态 |
| 数据 | 主进程代理 GET /api/product-library/search?q&limit 与 /items/{id}(实测顶层 items/item) |

## 11. 角色智能体名册(2026-10-24 实现; **2026-10-25 退役**, 见下)

> **退役(2026-10-25 用户裁决)**: 角色是**服务端定义的智能体资产**, 客户端不使用服务端定义的智能体 —— 移除 composer 的角色选择器、本地预设装配与 `system-prompt` 人设补丁; 智能体以 acp bundle 默认人设运行, 专业分工由服务端能力(MCP 工具)承载。`film-agent.patch.yml` 单文件(模型路由+MCP 会话声明)。

- 角色 = TinTin 角色预设(`dsh-tintin-bundle/presets/`:tintin-assistant 总助手、tintin-director 编导、tintin-producer 制作、tintin-qc 质检、tintin-librarian 素材库),与主应用同源(每角色的 `preset.yml` 元数据 + `agent.cordis.yml` 组合,persona 前缀即角色人设);
- 影片智能体按角色生成**分角色补丁**(`<channelHome>/tintin/film-agent-<role>.patch.yml`):模型路由 + **persona 前缀替换**(读取角色预设的 persona 块,原样进补丁,与主应用文本一致);无角色时用默认补丁;
- 选择器:shell 页 composer 工具条内的「角色」下拉(官方同款样式, 注入式挂载)(`tintin-role.ts`,持久化 `tintin.role`)→ `window.__tintinRole` → studio-preload 的 `localAgents.start` 随 meta 送达 → 主进程 `begin(project, { tintinRole })`;(选择器位于聊天列 composer 正上方, 2026-10-24 用户裁决)
- 角色变化 = 人设不同 → `ensure` 重建会话(旧子进程 stop,新角色补丁拉起);
- 上游依据:`packages/acp/acp/src/index.ts` 明示 ACP 不组预设、部署方经配置加入(本实现以部署补丁承载,不改子模块);role 切换的 UI = TinTin 自有选择器(官方 composer 的 configOptions 仍为模型选择,不变)。

## 12. 移植文件清单(锚点)

### 12.1 过渡版功能 → 官方形态映射(验收口径)

| 过渡版功能 | 官方形态实现 | 移植点 |
|---|---|---|
| 自绘聊天列(会话/审批/提问/工具卡) | 官方 chat 源树编译进 shell 页(mountChat),经 `window.openfilmDesktop` 桥通信 | `openfilm-shell/main.tsx`、chat 源树(官方 pin) |
| 宿主契约桥面 | 官方 `apps/desktop/shell/bridge.ts` 逐字移植;**单宿主**(preload 不暴露迷你 host) | `openfilm-shell/bridge.ts`、`studio-preload.ts` |
| 选中/时间/引用注入 | Studio ProjectView → `host.onSelection/onRefer` → 官方聊天 @ 菜单与 pill | `bridge.ts`(官方 ProjectView) |
| 项目素材位 | Studio 左侧媒体面板(panel 不挂 assets/setAssetsOpen) | `bridge.ts` panel |
| 在线素材库 | shell 页内抽屉(主进程代理 `/material/*`);下载落 `assets/download` | `tintin-library.ts`、main-hook `openfilm:library:*` |
| 技能(原生+服务端合并) | `app.skills` 名单合并 + 正文注入(`/skills` 的 instruction) | main-hook `openfilm:native:skills-*` |
| 原生技能随包分发 | `resources/skills/openfilm` → 影片智能体 home 同步 | `scripts/prepare-skills.mjs`、`film-acp.ts` |
| 影片历史持久化 | `.film/chat.json` + `.film/logs/*.jsonl` | `film-chat.ts`、`desktop:chat:*` |
| 角色(编导/制作) | ACP 预设名册(部署配置,不改子模块) | `film-agent.patch.yml`(进行中) |

### 12.2 文件清单

| 层 | 文件 |
|---|---|
| shell 页构建 | `dsh-tintin-bundle/openfilm-shell/{main.tsx,bridge.ts,tintin-library.ts,boot.ts,index.html,shell.css,vite.config.ts,build.mjs}` + vendor 两树(`tintin-resources/openfilm-shell-src/{openfilm,chat,shared}`,官方 pin) |
| 通道主进程 | `dsh-plugin-desktop-tintin/src/tintin/{film-acp.ts,film-chat.ts,studio-preload.ts,main-hook.ts}` |
| 契约 | `dsh-plugin-desktop-tintin/src/openfilm-view-contract.ts`(三通道镜像) |
| 客户端视图 | `dsh-tintin-client-ui/client.js`(mountOpenFilm + 抽屉/日志条/接管) |
| 宿主桥插件 | `dsh-tintin-bundle/lib/openfilm/*`(studio-runtime 对账、providers-seed、skill-sync、libs-sync) |
| 官方运行时 | `dsh-plugin-desktop-tintin/tintin-resources/openfilm`(0.2.5,editor dist 由 shell 构建覆盖) |

## 13. 生命周期与自愈

- **接管**:快轮询 → 命中接管;未命中清陈旧 run.json → `startStudio` 全新拉起(附着前**指纹对账**:editor dist 摘要 + 版本);
- **净场**:`will-quit` + `process 'exit'`(failLoud 崩溃路径)同步收场;开机对账按可执行路径甄别清理 openfilm node 孤儿(不碰其它 node);
- **观测**:页面启动错误浮层(含行号)、底部日志条、统一 `diagnosticLog`(`%APPDATA%\TinTin\logs\dsh-*.log` + host 分册)。

## 14. 服务端契约(实测摘要)

| 端点 | 形状 |
|---|---|
| `/material/list?page&size&media_type&search` | `{items:[{id,filename,size,media_type,…}]}`(**顶层 items**) |
| `/material/serve?material_id=` | 二进制流 |
| `/material/thumbnail?material_id=` | 图片 |
| `/skills` | `{ok:true,skills:[{id,name,description,instruction}]}`(**顶层 skills**) |
| `/v1/audio/transcriptions` | multipart(file/model/language/response_format=verbose_json)→ words[]+duration |
| `/v1/audio/speech` | `{model,input,voice,response_format=wav}` → wav |
| `/llm/models`、`/llm/chat/completions` | OpenAI 兼容 |

## 15. 验收与门禁

- 逐条状态:[验收追踪表](tintin-openfilm-alignment-acceptance.md);
- 锚点:`check:tintin`(scripts/tintin-anchors.json)登记本文与承重代码锚点;变体门禁、typecheck、film-acp 单测同链;
- **文档同步门禁**(2026-10-24 用户裁决):视频剪辑运行时范围(openfilm-shell/、tintin/src/tintin/、client-ui/client.js)有改动而本文与验收表均未触碰 → `check:tintin` 失败(应急豁免 `TINTIN_DOC_SYNC=off`);构建产物(dist.stock/、package-lock.json、node_modules/)不计;
- 运行时行为改动:**先出包自测该项,通过才提交**;任何失败路径必须可观测(页面浮层/日志条/统一日志)。

## 16. 调用链全解(编排决策与执行的完整时序, 每阶段标注实现者)

### 16.1 参与者清单(谁实现了什么)

| 参与者 | 实现位置 | 职责 |
|---|---|---|
| 消息入口(官方聊天 UI) | `chat/src`(官方聊天, TinTin 编译树) | 收集文本/`@`引用/产品/附件, 发起轮次 |
| 智能体进程(编排执行器) | `dsh --profile acp`(film-agent-home), 由 `main-hook` 拉起 | 组装上下文、调模型、执行工具、循环直至完成 |
| 编排大模型(决策者) | TinTin 服务端 `/llm`(deepseek-v4-flash/pro) | 每轮推理: 输出"调哪个工具+参数"或最终回复; 从不直接发网络请求 |
| MCP client | harness 的 McpClient 插件(智能体进程内) | 维护与 MCP server 的连接; 上报工具清单; 执行 MCP 工具调用 |
| 本地 MCP 桥(规划 §16.4) | TinTin bundle 随包进程(stdio MCP server) | 拉 `/agent/registry` → 39 能力映射为 MCP 工具; 按注册表 api 字段执行 HTTP |
| 本地工具面 | harness 工具插件(bash/fs/web…)+ openfilm CLI + 媒体工具链 | 本地执行: 文件读写、影片渲染、媒体处理 |
| 服务端能力层 | TinTin 服务端(`/v1`、`/material`、`/tasks/*`、`/agent/registry`) | 提供媒体生成/素材/换物等能力端点(确定性代码调用) |
| 轮次留档(TurnLog) | 聊天日志面 + 会话存储(官方 ACP 会话系统) | 每轮的模型请求/响应/工具调用记录(取证入口) |

### 16.2 一轮会话的完整时序(六阶段)

**阶段 0 — 会话建立**(实现: `main-hook` film-acp + `studio-preload` localAgents + 官方聊天会话流程):
`main-hook` 写角色补丁(`film-agent-<role>.patch.yml`: `llm` 行=模型路由, `acp` 行=provider/model, `system-prompt` 行=角色人设)并拉起 `dsh --profile acp`; 会话 id 走 ACP resume 续聊。

**阶段 1 — 消息组装**(实现: 官方 PromptEditor + 我们的 library/products 桥 + 官方会话流程):
`@`引用展开为文件路径清单; 产品注入为结构化资料文本(粘贴事件进 Lexical); 附件入消息。产物 = 一条带上下文的消息。

**阶段 2 — 上下文与工具清单组装**(实现: acp bundle 的智能体循环):
系统提示词(personaPrefix=角色人设) + 技能手册 + 会话历史 + **工具清单**(本地工具 + MCP 桥映射的服务端能力[接线后])。工具清单 = 模型的能力视野 —— 不在清单里的能力模型永远无法编排。

**阶段 3 — 模型推理**(实现: `dsh-llm` 插件 → openai-completions → `POST {server}/llm/chat/completions`):
返回两种之一: `tool_calls`(决策: 调哪个工具+参数)或纯文本回复(结束)。**推理发生在服务端** —— 这就是"模型走服务端"的落点。

**阶段 4 — 工具执行**(实现: 智能体进程的执行器):
- MCP 工具: McpClient → stdio → 本地桥 → HTTP → 服务端能力端点(桥按注册表 api 字段确定性调用);
- 本地工具: harness 工具插件 + openfilm CLI + 媒体工具链直接执行(渲染/文件/换物流水线)。

**阶段 5 — 结果回填与循环**(实现: acp bundle 智能体循环):
工具结果以 `role:tool` 回填消息流 → 回到阶段 3 再推理。**N 次工具调用 = N+1 次模型推理**(编排的成本载体, flash/pro 档位差异的来源)。循环直至模型给出纯文本回复。

**阶段 6 — 轮次收尾与留档**(实现: 官方聊天轮次收尾 + TurnLog + 统一日志):
回复渲染给用户; TurnLog 记录本轮的模型请求/响应/工具调用(取证入口); 会话由官方 ACP 会话系统持久化(重进视频剪辑可续)。

### 16.3 分层职责总结(维护边界)

| 层 | 维护方 | 内容 |
|---|---|---|
| 客户端 TinTin | 本仓库 | `main-hook`(进程/补丁)、`studio-preload`(原生面)、MCP 桥、聊天编译树组合 |
| 服务端 | 服务端团队 | `/llm` 推理、`/v1` 媒体、`/material` 素材、`/tasks/*` 能力任务、`/agent/registry` 注册表 |
| 官方上游 | pinned harness | 智能体循环、工具插件、聊天 UI、ACP 协议(只组合, 不修改) |

### 16.4 本地 MCP 桥(2026-10-25 实现, 桥本体已完成并实测)

**桥本体**(`tintin-resources/mcp/registry-bridge.mjs`, stdio MCP server)——已实现并独立实测通过:

- 启动拉取 `/agent/registry`(实测 v1.1, 39 能力), 60s 刷新;
- `tools/list`: 每能力映射为 MCP 工具(name=id, description=名称+描述, inputSchema 由 input_schema 推导, 带 `?` 字段可省);
- `tools/call`: 按注册表 `method+path` 执行(POST=JSON body, GET=query), 长任务超时 300s, 结果以 text content 返回;
- 独立实测: initialize ✓ → tools/list(39 工具) ✓ → tools/call(material_list 实调 HTTP 200 返回真实数据) ✓。

**接线(待实施)——两条候选机制, 勘误后的准确结论**:

1. ~~profile 级 acp 行加 mcpServers~~: acp Config 无此字段(index.ts:75-90, 仅 provider/model/sessionListPageSize/stream), 不可行;
2. ~~profile 级 McpClient 行~~: 工具注册在挂载作用域的 ctx.tools(mcp-client index.ts:150), acp 特意挂 agent 作用域 —— 根级挂载是否可达 agent 工具面未经验证, 风险未消;
3. **官方正路: ACP `session/new` 的 `mcpServers` 参数**(acp/src/index.ts:213; stdio 需绝对路径 command, mcp.ts:45) —— 由会话发起方(runner 层)传入; 官方聊天已有每智能体 MCP 设置面(i18n `mcpHidden` 即此), 下一步: 在 dsh 影片智能体的设置中声明本地桥(node + `<resources>/openfilm/mcp/registry-bridge.mjs` + 服务端 URL 参数)。

**验证标准(与用户对齐)**: 智能体轮次的 TurnLog 出现 39 能力工具; 会话中触发一个服务端能力 → 服务端任务库出现对应任务(用户的服务端日志取证法)。

**接线完成(2026-10-25)**: 服务端 MCP server 已上线(streamable-http, `tintin-agent-server` v1.1, 40 工具, 客户端四项实测通过)——本地桥退场(单一事实源回归服务端)。客户端接线: `film-acp` 在 `session/new`/`resume` 参数声明 `mcpServers: [{name: "tintin-server", type: "http", url: "<server>/mcp"}]`(官方 ACP 语义, acp 插件翻译为 DSH MCP client)。验证标准不变: TurnLog 出现注册表工具 + 服务端任务库出现智能体触发的任务。

**可观测性(2026-10-25 补)**: 影片智能体子进程的 stderr 实时进管理器日志, 管理器日志全部落统一日志管道(source=film-acp) —— 失败轮次不再无记录。

**"Internal error/仍在处理"的最终定位(2026-10-25 原始 ACP 探针对照实验)**: 

- 同为 0.2.1-rc.2, **工作区构建的 dsh(apps/cli/lib/bin.js) 4 秒完成完整轮次**(模型经 /llm 回复 ✓), **打包副本的 dsh(resources/app/node_modules/@deepseek-ai/dsh) 在 session/prompt 后、发出任何模型请求之前挂死**(本地捕获服务器零请求; 有/无 MCP 声明、空/真实项目目录均复现) —— 缺陷在**打包副本的 dsh 构建**, 与补丁/MCP/服务端无关;
- 服务端侧已排除: /llm(流式+非流式+任意 key)✓、/mcp(握手+40 工具+健康调用)✓、补丁文件内容与落点 ✓;
- 修复方向(待实施): 影片智能体的 dsh 换用已验证可用的工作区构建(随包分发或路径解析), 或升级 dshmarket 至无此缺陷的版本;
- 附带发现: 影片智能体子进程在失败轮次后**不退出**(僵尸累积, 各占 ~130MB); `.codebuddy\logs` 是本机 CodeBuddy CLI 的日志目录(与本项目无关, 勿混读)。
- **终极根因(2026-10-25 日志实证)**: 打包版 dsh(dshmarket 构建)的模型解析栈是 **CodeBuddy 产品体系** —— AgentModelResolver 从 `https://copilot.tencent.com/v3/config` 拉云端模型目录(34 模型), **无视补丁里的 llm-pi-ai providers**; MCP 声明同样未生效(子进程内 `allServers=[]`)。其配置面 = `C:\Users\Administrator\.codebuddy\models.json`(日志明示 userConfigPath)与 home 的 `llm-pi-ai:` settings 段。
- **修复方向(待实施)**: 将 tintin-server provider 与 deepseek 模型写入 dshmarket 构建读取的配置面(models.json / llm-pi-ai settings 段), 使打包版 dsh 的模型与能力经服务端; 或升级 dshmarket 至与补丁语义一致的版本。验证标准不变: 子进程日志出现 tintin-server 路由 + 服务端 /llm 命中。

## 17. 已知缺口/非目标

- 角色名册(§11)实现中;上游 feature:custom 服务作内建 provider、子树归组(远期);
- Studio 顶栏多窗口/tabs 桩(单视图壳);应用内更新走 TinTin 自身通道;
- 转写请求明细(calls)暂空(仅 ACP 事件日志)。
