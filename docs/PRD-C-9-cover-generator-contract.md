# PRD-C-9.1：封面生成接口契约（/cover/generate）——三端对齐稿（草案）

- 日期：2026-10-20
- 上游：`PRD-C-9-cover-generator.md`（服务端，⏳需求骨架）+ `封面生成移植需求文档_OpenCreator_2026-09-07.md`（客户端，215 行详细需求）
- 引擎依据：comfygen **v4.30 已实装** t2i（含可选参考图），本稿全部引擎能力均带实测证据（附录 A）
- 状态：**草案**——待 .31 / 客户端会话确认后定稿；确认前 comfygen 侧无阻塞
- 引擎状态：`/api/media_jobs type=t2i` 已上线（v4.29 起语义文生图，v4.30 起支持参考图 ≤3）

---

## 0. 结论速览

| # | 事项 | 结论 |
|---|------|------|
| 1 | 9-07 上报的契约缺口 #1（无文生图端点） | **已闭合**：comfygen t2i 引擎上线（Klein-9B，中文原生），.31 编排对接即可，无需另建 /image/generations 代理 |
| 2 | 契约缺口 #2（YouTube 元数据/yt-dlp） | 服务端仍无 → **首版缓行 YouTube 模式**，仅"提示词+参考图"（客户端文档既有建议） |
| 3 | 中文封面文字 | **实测：模型直渲中文字形幻演不可用**（'三天涨粉十万'→'三夫挠份丁大'）→ 采用**两段式：AI 出无字底图 + 既有套版层叠字**（PRD-C-9 §6 本就排除排版模板由 Remotion 承担） |
| 4 | 多候选 | comfygen v1 单产物（既有裁决）→ .31 编排层把 candidate_count 拆成 N 个 t2i 任务聚合并容忍部分失败 |
| 5 | 参考图 | comfygen t2i 已支持 refs ≤3（ReferenceLatent 链），实测锚定有效 |

## 1. 三端分工

| 端 | 职责 |
|----|------|
| 客户端 | 三步向导 UI（移植文档 §二 逐控件）、叠字合成预览（或用服务端成品图）、下载/版本管理 |
| 服务端 .31 | `/cover/generate` 端点 + 风格库（cover_styles）+ 封面 prompt 组装（cover_prompt，风格指令+文案+反推）+ N 候选拆分聚合 + 能力注册 + 出片后自动封面钩子 |
| comfygen .26 | 引擎：`POST /api/media_jobs type=t2i`（prompt/aspect/seed/refs ≤3）→ 单 PNG；串行队列/质量资产复用 |

## 2. 对接纪律（同 PRD-文生图文生视频 §2）

客户端与智能体只对接 .31；comfygen/ComfyUI 概念不出现在 /cover 契约与错误信息；产物自包含 URL；凭据不落客户端。

## 3. 接口契约（.31 侧，本稿提案）

### 3.1 POST /cover/generate

请求（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| prompt | string | 三选一 | 画面内容与排版要求（≤4000，对齐 OpenCreator textarea） |
| reference_image | string | 否 | 参考图（素材库 URL）；传入则引擎走参考图锚定 |
| cover_style | string | 否 | `personal-growth` / `psychology` / `wealth-platinum-red` / `bilibili-red-blue-white`(默认) / `custom` |
| custom_style_prompt | string | style=custom 必填 | ≤1000，配色/字体气质/构图描述 |
| text_language | string | 否 | `zh-CN`/`zh-TW`/`en-US`/`ja-JP`/`ko-KR`，缺省 `zh-CN` |
| headline | string | 否 | ≤80；叠字层渲染 |
| subheadline | string | 否 | ≤140；叠字层渲染 |
| emphasis_terms | string[] | 否 | ≤3 个强调词 |
| ratio | string | 否 | `16:9`(默认) / `1:1` / `9:16` |
| candidate_count | int | 否 | 1..4，默认 2 |
| quality | string | 否 | `low`/`medium`(默认)/`high`（映射引擎尺寸/步数档，v1 差异=尺寸档） |

响应 `202`：`{"task_id": "c_xxxx", "poll": "/tasks/unified/c_xxxx"}`

完成态 result：

```json
{"candidates": [
   {"no": 1, "base_image_url": "/output/cover/c_xxx_1.png", "width": 1280, "height": 704,
    "seed_used": 123, "engine_job_id": "…"},
   …],
 "failures": [{"no": 3, "message": "生成超时，请重试"}],
 "text_layer": {"headline": "…", "subheadline": "…", "language": "zh-CN",
                "style": "bilibili-red-blue-white", "emphasis_terms": []}}
```

- `candidates` 为 AI 无字底图；`text_layer` 为叠字规格（headline/subheadline/语言/风格派生排版），由**既有套版层**（Remotion，PRD-C-9 §6 已排除复杂排版归它）或客户端合成成品封面。
- 部分失败：`status=done` + `failures[]`（全败才 `failed`）——聚合语义由 .31 归一，对客户端屏蔽重试细节。

### 3.2 错误码（对齐移植文档 §四）

沿用 `creator_image_config_missing` / `unsupported_source` / `image_generation_failed` 等既有映射；`creator_llm_config_missing` 仅 YouTube 模式涉及（缓行）。

## 4. 服务端组织层（.31，PRD-C-9 §4.2 原样）

- `utils/cover_styles.py`：5 档风格 instructions（对齐 OpenCreator styles.ts，**追加"画面不含文字"指令**——文字改由套版层）
- `utils/cover_prompt.py`：风格指令 + 画面要求 + 参考图指代（`<image1>`）→ 引擎 prompt；**不再含 headline 渲染指令**（实测证据见附录 A，偏离 OpenCreator 逐字模板的裁决点）
- `api/cover.py`：端点 + N 候选拆分（每候选一个 comfygen t2i 任务，seed 派生 N 档）+ 聚合
- 反推结合：`image_prompt_reverse`（registry 已有 `image_prompt_reverse`）可选接入参考图反推
- `/agent/registry` 注册 `cover_generate`；producer 智能体挂能力；一键成片/混剪出片后自动封面

## 5. comfygen 移交规格（.26 侧——**已全部实装，v4.30**）

| 项 | 状态 |
|---|---|
| `POST /api/media_jobs type=t2i`（prompt/aspect/seed → 单 PNG） | ✅ v4.29（422 根因修复） |
| 可选参考图 `refs`（≤3，ReferenceLatent 链） | ✅ v4.30 |
| prompt UTF-8 ≤2000 + GBK 乱码自愈 | ✅ v4.29 |
| 终态/进度/download_ref/seed_used | ✅ v4.29 |
| 封面档尺寸 | v1 用现有档（16:9→1280×704 等）；更高封面档（1920×1088 类）列待裁决 §7.3 |

## 6. 客户端衔接（另行任务）

`CoverGenerator.vue` 三步向导（移植文档 §二）+ `useCoverGen.ts`；Step0 参考图上传走 `server.upload`；Step2 成品合成预览；对齐文档 §2.4/§3 缺口行随之销项。

## 7. 待裁决点

| # | 决策 | 本文默认 |
|---|------|---------|
| 7.1 | 叠字层归属：服务端套版合成成品图 vs 返回底图+text_layer 由客户端合成 | **返回底图+text_layer**（服务端可后续加合成开关） |
| 7.2 | YouTube 模式 | 首版缓行（依赖缺口 #2） |
| 7.3 | 封面更高分辨率档 | v1 用现档；high 档是否升级 1080p+ 待实测 |
| 7.4 | brief 生成（/llm json_object 透传） | 待验证；不支持则客户端容错解析 |

---

## 附录 A：引擎实测证据（comfygen v4.30，2026-10-20）

| 实验 | 输入 | 结果 |
|---|---|---|
| 中文标题直渲 | OpenCreator coverGenerationPrompt 模板 + Headline"三天涨粉十万"/副标题"普通人也能做的账号方法" | 版式/风格/构图优秀（红蓝白、放射背景、标题优先、主体突出），**中文字形全部幻演**（'三天涨粉十万'→'三夫挠份丁大'）→ 两段式定案依据（16:9 与 9:16 双样本一致） |
| 参考图锚定 | G304 产品图 ref + 场景迁移 prompt（阳光窗台） | 产品外形与 G 标志跟随参考图，场景按 prompt 迁移（`temp/ref_smoke.png`） |
| 纯文生图中文 prompt | 赛博朋克鼠标特写（中文 40 字） | 逐要素命中（`temp/t2i_smoke2.png`） |

工程事实：t2i 实测出图 15-35s/张（4090D）；候选 N 张 = N 次任务串行（GEN_LOCK），2 候选端到端约 1-2 分钟。
