# 视频剪辑（OpenFilm）智能体标准开发对齐文档

- 日期：2026-10-19
- 适用：TinTin 桌面客户端「视频剪辑」视图（原 OpenFilm 客户端的 DSH 移植）
- 原版源码依据：`D:\Project\dsh-openfilm`（openfilm/openfilm fork，界面与智能体层）
- 移植版源码依据：本仓 `dsh-tintin-client-ui/client.js`（聊天壳）、`dsh-tintin-bundle/`（宿主通道与工具）、`dsh-plugin-desktop-tintin/`（原生视图）
- 状态：随实现演进更新；本文所引行号为撰写时快照

---

## 0. 结论速览

| # | 问题 | 一句话结论 |
|---|------|-----------|
| 1 | 视频剪辑里的会话控制和 DSH 会话控制是否一样？ | **是同一套**。都走 DSH `sessions` 服务（server 会话）：创建/保留/订阅/取消完全同源，只是按影片目录（cwd）过滤并落了本地映射 |
| 2 | 视频剪辑里的智能体编排由什么实现？和 DSH 一样吗？ | **一样**。编排 = DSH Harness 的服务端智能体回路（单一主智能体 + 工具回路），模型走 TinTin 服务端 `/llm`；没有独立编排层 |
| 3 | 视频剪辑的智能体/子智能体用的是服务端吗？ | **是**。主智能体在服务端 Harness 内跑，模型与媒体能力全部来自 TinTin 服务端；DSH 子智能体如果产生也属服务端会话（UI 侧按 `origin==='subagent'` 过滤不显示）。客户端只做展示与输入 |
| 4 | 原版 OpenFilm 用的 Codex 是什么用法？是多智能体编排吗？ | **不是编排**。原版把用户本机装的 CLI 智能体（Codex/Claude Code 等）当**外部进程**经 ACP 协议驱动：会话管理（session/new、resume、prompt）+ 权限问答 + 事件流绘制，一对话一智能体；"子智能体"只是 CLI 内部自起的线程，应用侧仅记录。用自己的账号，应用不经手令牌 |

---

## 1. 原版 OpenFilm 客户端全链路

### 1.1 界面层

- 同一窗口两块：**Studio 编辑器**（React）+ 右侧聊天列（`apps/desktop/chat`）。素材列表面板由 **Studio 自己绘制**，盖在聊天列上方；聊天只保留输入器（`apps/desktop/chat/src/App.tsx:107` 注释原文 "Studio draws them; the chat keeps only its composer"）。
- 聊天列元素：会话条（按今天/昨天/近 7 天分组）、消息流、@ 菜单（时刻组=当前时间/范围/选中；素材组=媒体文件+分镜页面）、权限/提问卡片、底部智能体选择芯片（默认展示 Codex 与 Claude Code，`agent-roster.mjs:54`）。

### 1.2 会话层

- **对话记录在影片项目内**：`<项目>/.film/chat/`——`sessions.json`（会话列表与最后会话）、`turns/<turn>.json`（每轮问答与结束方式）、`agent/`（自有 byok 智能体的续话状态）。随项目走，换窗口/换机都在（`apps/desktop/src/chat-store.mjs` 头注）。
- **外部 CLI 会话在 CLI 自己的存储里**：Claude Code 在 `~/.claude/projects/...`、Codex 在自己的记录中（`agent-records.mjs:7`）；应用经 ACP `session/resume` 续接。
- 调试全量日志在 `.film/logs/`（每轮 jsonl + 模型请求 jsonl）。

### 1.3 智能体层（核心差异所在）

- **应用 = ACP 客户端**，智能体 = **用户本机已安装、已登录的 CLI 程序**，以子进程运行，JSON-RPC（stdin/stdout）驱动（`apps/desktop/src/agents.mjs:1-30`）：
  - 初始化 → `session/new`（旧对话 `session/resume`）→ `session/prompt`；`session/update` 事件流画出聊天；`session/request_permission` 在聊天里问权限。
  - Claude Code / Codex 经官方适配器 `@agentclientprotocol/claude-agent-acp`、`@agentclientprotocol/codex-acp`；Gemini/OpenCode 等自带 `--acp` 模式。
  - 不捆绑任何 CLI（每家 200–330MB 且条款要求用用户自己的订阅/登录），应用永不接触令牌。
- 名册：codex/claude/gemini/copilot/cursor/opencode/codebuddy/qwen/kimi + **byok**（应用自带 Pi 智能体接用户自有模型，需图像多模态——`agent-roster.mjs:38-42,169`）。
- 默认展示 Codex 与 Claude Code（`DEFAULT_SHOWN`，`agent-roster.mjs:54`）。
- 智能体工作方式 = "在终端里该怎样就怎样"：工作目录=影片项目文件夹，PATH 上挂应用自带的 `openfilm` 命令（指向窗口内同一个 Studio），外加几行位置说明（INSTRUCTIONS，`agents.mjs:21-25,102`）。
- **没有应用侧多智能体编排**：一对话一智能体；"子智能体"仅指 CLI 自己再起的会话线程，应用侧只在日志里标注（`agent-logs.mjs:555`）。

### 1.4 剪辑/能力层

- 智能体通过 **`openfilm` CLI** 操作影片：`open/look/render/get/skills`；Studio 是本地网页服务。
- 媒体能力（配音/音乐/音效/搜图等）在原版来自**用户自己配置的供应商**（ElevenLabs/OpenAI 等，经 providers.json），或 byok 模型直接生成。

---

## 2. DSH 移植版全链路与对齐

### 2.1 界面层

| 项 | 原版 | 移植版 | 对齐 |
|----|------|--------|------|
| Studio 编辑器 | React，同窗口 | 独立页面跑在原生 `WebContentsView`，覆盖工作台区，顶栏避开系统字幕带 | 等价（形态不同：原生视图 vs 同页组件） |
| 素材面板 | Studio 绘制 | Studio 绘制（同左），**一致，不改** | 一致 |
| 聊天列 | 官方 chat 组件 | 自绘壳：会话下拉、消息流、@ 菜单（时刻/素材两组+键盘导航）、审批条、**提问卡**、素材抽屉（在线素材库/项目两 tab） | 语义对齐；视觉为自有实现 |
| 底部芯片 | 智能体（Codex/Claude…） | 「服务端」+ 角色预设（总助手默认/编导/制作/质检/素材库）+ 模型 | 语义替换：智能体选择 → 角色/模型（服务端） |

### 2.2 会话层

| 项 | 原版 | 移植版 | 对齐 |
|----|------|--------|------|
| 会话存储 | `.film/chat/sessions.json` + CLI 自身存储 | **DSH 服务端会话**（与工作台会话同源），映射存 localStorage（`tintin.openfilm.session:<项目>`） | 语义等价（换了存储宿主；项目文件夹不再承载会话） |
| 每影片多会话 | 是（会话条列表） | 是（会话下拉按 cwd 过滤该影片目录） | 一致 |
| 续话 | ACP `session/resume` / byok 状态文件 | DSH 会话天然持久（服务端会话记录），retain 即续 | 语义等价 |
| 切换/新建/停止 | 会话条 + 停止按钮 | 会话下拉 + 新会话 + 停止按钮（`session.cancel`） | 一致 |

### 2.3 智能体层

| 项 | 原版 | 移植版 | 对齐 |
|----|------|--------|------|
| 智能体本体 | 用户本机 CLI（Codex/Claude…）子进程，ACP 驱动 | **DSH 服务端 Harness 智能体**（与工作台同一套） | **根本差异（用户裁决）**：不接外部 CLI，改用服务端 DeepSeek |
| 模型 | CLI 自带/用户订阅；byok 自备 key | TinTin 服务端 `/llm`（DeepSeek-V4 Flash/Pro），客户端不经手凭据 | 语义对齐（凭据都不落客户端，但供给方不同） |
| 编排 | 无应用侧编排；一对话一智能体 | 无独立编排；同一 Harness 回路（主智能体+工具循环） | 一致（都没有多智能体编排层） |
| 子智能体 | CLI 内部线程，应用仅记录 | DSH 子会话若产生亦在服务端；UI 过滤不显示 | 等价 |
| 权限/审批 | ACP `session/request_permission` → 聊天内卡片 | DSH `pendingInteraction(kind=approval)` → 审批条 | 语义等价 |
| 提问 | ask_user_question → 官方 user-questions 卡片（waterfall/远程事件应答） | DSH `pendingInteraction(kind=question)` → 提问卡（`pending.answer({answers:[{id,selected,custom?}]})`） | 语义等价（载荷字段一致：id/selected/custom） |
| 引用（@） | StudioSelection → 结构化 pill（`[[t:..]]/[[file:..]]`） | StudioSelection（经 openfilmHost 桥）→ `@相对路径`/`[时间..]` 文本 token | 语义等价；token 语法不同（各自 agent 各认其约） |

### 2.4 能力/工具层

| 项 | 原版 | 移植版 | 对齐 |
|----|------|--------|------|
| 剪辑操作 | `openfilm` CLI（open/look/render/get/skills） | 同一 CLI（随包运行时，PATH 注入），Studio 同源 | **一致（1:1）** |
| 影片能力（TTS/BGM/SFX/搜图） | 用户自己的供应商 key | **TinTin 服务端**（`tintin_voices/tts/asr/beatmap/bgm/sfx/stock_images/...` 11 个工具，产物直落影片目录） | 语义对齐（供给方改服务端，用户裁决） |
| 文生图/视频 | 用户模型 | 服务端接口（对接面只有 TinTin 服务端 API；服务端内部由 comfygen 编排 ComfyUI 实现——comfygen 不出现在任何客户端对接面上） | 缺口（等服务端上线该接口） |
| 离线渲染 | three.js 走 CDN | three.js 0.184 随包离线（`$DSH_HOME/openfilm-libs/three`） | 增强 |

### 2.5 服务端 vs 客户端职责（移植版）

- **服务端**：智能体回路、LLM、全部媒体能力、素材库、任务队列（vsr/beatmap 等异步任务）。
- **客户端**：Studio 展示与交互、聊天壳（会话选择/引用/审批/提问/素材抽屉 UI）、文件落盘与预览通道。
- 原则：客户端不做归一化/不做服务端业务；"编导正在工作"= 服务端会话 running 状态的真实反映。
- **对接面纪律（2026-10-19 用户纠偏）**：客户端与编导智能体只对接 **TinTin 服务端 API**；comfygen 是服务端内部的编排组件（负责版式编排与控制 ComfyUI 出图/出视频），永远不在客户端或智能体的对接面上——客户端永远不知道也不需要知道 comfygen 的存在。

---

## 3. 差异总量评估

- **剪辑与影片格式层：零差异**（同一 OpenFilm CLI/Studio，1:1）。
- **会话层：语义等价，实现不同**（DSH 服务端会话 替代 `.film/chat`+CLI 会话；能力对齐：多会话/续话/切换/停止）。
- **智能体层：有意为之的根本替换**（外部 CLI+ACP → 服务端 Harness+TinTin LLM）。上层协议形态（会话/事件/权限/提问/工具循环）与官方客户端的 ACP 语义一一对应，因此"编排"层面无差异——两边都是**单主智能体回路**，不存在多智能体编排。
- **能力供给层：按裁决改服务端**；客户端与编导智能体的对接面只有 TinTin 服务端 API（comfygen/ComfyUI 属服务端内部编排与渲染层，客户端不直连）；当前缺口=服务端尚未提供文生图/文生视频接口。
- **遗留缺口清单**：图片作为聊天附件的多模态输入（受文本模型限制，走 vision_analyze 兜底）；服务端的文生图/文生视频接口（服务端内部经 comfygen 编排 ComfyUI）；ask_user_question 会话重挂后是否重放待实测。

---

## 4. 源码依据索引

| 结论 | 依据 |
|------|------|
| 原版 ACP 客户端语义（initialize/session/new/resume/prompt/update/request_permission） | `dsh-openfilm/apps/desktop/src/agents.mjs:1-30` |
| 名册与 byok（Pi） | `agent-roster.mjs:38-42,54,169` |
| 会话持久化布局 | `chat-store.mjs:1-25` |
| CLI 子智能体仅记录 | `agent-logs.mjs:555` |
| 官方素材面板由 Studio 绘制 | `apps/desktop/chat/src/App.tsx:107` |
| 官方 @ 菜单素材组=媒体+pages | `apps/desktop/chat/src/App.tsx:303,411-470` |
| ask_user_question 契约（kind/answer 载荷） | 2139 包 `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js:1292-1320,396,529` |
| 移植版会话/审批/提问/素材/@ 实现 | 本仓 `dsh-tintin-client-ui/client.js`（uiSessionSvc/asset 抽屉/questionBar） |
| 移植版工具层 | 本仓 `dsh-tintin-bundle/lib/openfilm-tools.js`、`lib/openfilm/plugin.js`、`lib/channel-table.js` |
| 原生视图 | 本仓 `dsh-plugin-desktop-tintin/src/tintin/main-hook.ts`、`src/tintin/studio-preload.ts` |
