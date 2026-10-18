---
name: "software-engineering-iron-rules"
description: "强制执行软件工程铁律（修复禁git回退、拆文件验完整性、py_compile/单测必跑、不混层、只改指出的点、任务走服务端队列、API契约唯一参考API-GUIDE.md）。任何修改代码/提交/拆分文件/修复/重构的任务，第一步必须立刻调用本 Skill。"
---

# 软件工程铁律 Software Engineering Iron Rules

> 适用范围：**任何 Python 桌面客户端 + 服务端双端协作工程**。跨项目复用。
> 触发条件：只要本次任务涉及「改代码 / 拆文件 / 修 bug / 重构 / 提交 / 恢复代码」中的任意一项，**必须在第一步调用本 Skill** 并逐条对照执行，任何铁律不得有例外。

---

## 一、修复 & 恢复类铁律（最高优先级 = 阻断性）

### IRON-01 禁止用 Git 整体回退修复 / 恢复代码

❌ 绝对禁止的做法：
```bash
git checkout HEAD -- <file>    # 整文件回退
git restore <file>             # 同上
git reset --hard HEAD^         # 整仓库回退一个 commit，再 cherry-pick
```
> 以上操作会把**同一文件内其他已经修复好的未提交改动一并抹掉**，是整个工程最高频的踩坑源头（无异议）。

✅ 正确做法：**基于当前工作区做增量 Edit**
1. 先 Read 目标文件的**最新完整内容**
2. 只在需要修复的区段做 Edit（保留其他区段已存在的任何改动）
3. 只改「用户明确指出要恢复的那一段逻辑」，不波及其他
4. 如果无法从当前内容恢复，必须用 `git show HEAD:<file>` 或 `git show <commit-hash>:<file>` **只读出目标片段**，再手工合并进当前文件——**绝对不能直接整文件覆盖**

### IRON-02 拆分大文件时必须逐项检查完整性（5 项 checklist 全过才算拆完）

任何 `a.py` 拆成 `a/__init__.py + a/workers.py + a/widgets.py + a/dialogs.py + a/page.py` 等操作时，**必须逐项核对通过，不得凭感觉说"应该差不多"**：

| # | 检查项 | 通过判据（Python 为例，其他语言等价映射） |
|---|---|---|
| 1 | **行数守恒** | 拆分后所有文件 `wc -l` 之和 = 原始文件行数 ± 2%（允许注释/空行微调，但差值超过 5% 必须人工逐类核对） |
| 2 | **类 / 函数完整** | 所有类、顶层函数、嵌套类的 `class ...:` 与 `def ...:` 开头必须成对出现配套的方法缩进完整结束；不得出现"某个方法只写了一半"的截断。用 grep 对比 `^class ` / `^def ` / `^    def ` 数量完全一致 |
| 3 | **导入完整无缺** | 每个拆分文件被 import 的符号必须在本文件或 `__init__.py re-export` 中存在；启动程序时不得出现 `NameError: name 'XXX' is not defined`、`ImportError: cannot import name 'XXX'` |
| 4 | **单测全过** | 相关模块的单元测试通过率 = 100%，且新增测试文件命名 `test_<模块名>.py` |
| 5 | **无逻辑截断** | 检查每个方法的 `if / elif / else` 分支是否闭环（例如 `if d: open(d)` 必须有 `elif path: open(path)` 或 `else: fallback`，不允许 else 丢失导致"逻辑只走一半"） |

---

## 二、代码门禁铁律（提交 = 不通过不允许走）

### IRON-03 改 .py 必跑 py_compile（Python 的"编译期"语法检查）

```powershell
# 改动了哪个就指定哪个，不允许全量 py_compile 漏掉报错
python_embeded\python.exe -m py_compile <改动的绝对路径 file1.py> <file2.py> ...
```
**必须全部返回 exit code = 0**。SyntaxError / IndentationError = 不允许往下走（包括不允许提交）。

### IRON-04 提交前必须跑通全量单元测试（无例外）

```powershell
python_embeded\python.exe -m unittest discover tests/unit
```
- 结果必须 `OK`。任何 `FAIL` / `ERROR` 都不允许提交，哪怕是"老问题"。
- 如果本次改动触及**核心链路**（数字人提交、智能混剪、一键成片、素材下载、脚本保存、成片任务、工作流编排等），而现有测试**未覆盖**该链路，必须**同步补充对应单元测试**（先写"红测试"→再改代码→测试变绿）。

### IRON-05 静态检查（渐进但提交不允许新增）

```powershell
python_embeded\python.exe -m ruff check <改动的文件>
python_embeded\python.exe -m mypy <改动的文件>   # 渐进覆盖
```
- `ruff` 出现新的 `E` / `F` 级错误 = 不允许提交（`W` 级若新增也尽量修）
- 已装 pre-commit hook 时，`git commit` 会自动跑 `ruff + py_compile`，语法错误 / 未定义变量 / 重复键 = 直接拒绝提交

---

## 三、分层 & 架构铁律

### IRON-06 不允许混层（任何改动都要检查模块归属）

以典型 `studio/gui / studio/utils / studio/core / studio/config` 四层结构为例：

| 层 | 该做什么 | 绝对禁止做 |
|---|---|---|
| `gui/` | 纯界面绘制 + 控件事件转发（薄封装）；最多做 QSS 样式和最小的表单校验 | ❌ 直接写业务计算、JSON 拼装解析、工作流节点识别、任务队列编排、服务端 URL 拼接、HTTP 响应解析 |
| `utils/` | 纯函数/工具类、外部 API 客户端封装（HTTP 客户端、文件工具、路径配置） | ❌ UI 代码、QWidget 直接引用；❌ 业务状态放在 utils 单例里全局共享 |
| `core/` | 业务领域逻辑、状态机、工作流编排、纯函数核心算法 | ❌ 出现 `import PySide6`、`QPushButton` 等 GUI 类 |
| `config/` | 常量、路径、默认配置；纯数据 | ❌ 出现任何业务逻辑 if/else |

**外部 API 调用规范**：所有 HTTP 调用必须封装成独立 `XXClient` 类（`WorkflowClient` / `MaterialClient` / `DigitalHumanClient` …），UI 层**只允许调用 client.method()**，绝对禁止在 UI 里直接 `requests.get(url + "?x=1")`。

### IRON-07 组件级验证：parser → builder → runner 三段拆 + TDD

面对"大模型 prompt / 视频工作流编排 / 任务队列"这类黑箱产出的功能，拆分原则：
1. **Parser 层**：纯函数，输入原始响应 dict / 字符串，输出结构化数据类（dataclass / pydantic model），无副作用
2. **Builder 层**：纯函数，输入结构化数据，输出可直接给执行层的参数对象（工作流 JSON / 命令行参数列表）
3. **Runner 层**：有副作用，调用 client / subprocess 真正执行

**必须先写测试（红）→ 实现（绿）→ 重构**，最后才组装到 UI。UI 改动要能在"修改最小、可回退"的前提下独立完成，不允许 UI 内嵌三段逻辑的任一段。

### IRON-12 API 契约唯一参考 = API-GUIDE.md（禁止使用旧契约 / openapi-latest.json 仅为静态快照）

> **背景**：项目根目录的 `openapi-latest.json` 是某次导出的**静态快照**，不会自动跟随服务端迭代更新，部分端点/字段可能已过时（TTS 参数映射错误即为前车之鉴）。

**铁律**：
- 所有客户端 → 服务端的 API 调用，**唯一契约参考** = `API-GUIDE.md`（`/guide` 在线页，已同步双引擎 + `sample_id`）
- ❌ **禁止**以 `openapi-latest.json` 作为新增/修改接口字段的依据
- ❌ **禁止**凭记忆或旧代码臆造接口字段名、路径、请求体结构
- ✅ 新增或修改 API 调用时，**必须**先查阅 `API-GUIDE.md` 确认端点、字段名、请求/响应结构
- ✅ 代码注释中标注契约来源时统一写 `API-GUIDE`（不再写 `openapi-latest.json 已核实`）

**执行要求**：
1. 新增接口调用 → 先读 `API-GUIDE.md` 核对端点存在性 + 字段名 + 请求体结构
2. 修改已有接口参数 → 以 `API-GUIDE.md` 为准，发现与代码不一致时**立即对齐修正**
3. `API-GUIDE.md` 与 `openapi-latest.json` 冲突时 → **以 `API-GUIDE.md` 为准**
4. 双引擎（服务端/本地）接口差异 → 以 `API-GUIDE.md` 中对应章节为准，注意 `sample_id` 等新增字段

---

## 四、提交纪律铁律（80% 线上事故来源于这里）

### IRON-08 只改被指出的地方，不顺手重构

✅ 对的：用户说"分镜脚本保存后脚本成片没同步" → 只改 `_upload_storyboard_to_server._done` 回调里加 `compile_tool._populate_scripts()` 一处

❌ 错的：顺手把相邻的 `_reload_sb_scripts()` 函数签名也改了、顺便把引用素材对话框的布局也调了、把旁边的注释也重写了一遍 = 会引入别的 bug 且极难回滚定位

> **Golden Rule：用户没提的，哪怕你再觉得"这样更好"也不要动**。除非在修改方案前单独 AskUserQuestion 征得同意。

### IRON-09 提交信息要具体（禁止含糊描述）

✅ 对的：
```
feat(ai_script_page): _go_to_storyboard 传递 product(brand/model/category) 到 set_copywriting
fix(storyboard_page): ShotMaterialDialog 联网素材 Tab 改为 stock_search 服务端接口+缩略图网格（替代 DuckDuckGo 文本）
fix(storyboard_page): _open_mg 跳转索引 switch_page(35) → 31 + switch_dreamina_tab(2) 修复空界面
```

❌ 错的：
```
修复bug              # 哪个模块？怎么修的？
优化一下             # 优化了啥？
调整代码             # 无信息
```
**commit 模板**：`<type>(<模块文件或类名>): <做了什么> / <为什么>`
- type = `feat / fix / refactor / test / docs / chore / build` 七选一

### IRON-10 跨模块行为变动 → 必须补对应测试

改动影响到跨文件/跨模块的行为时（例如：A 模块传给 B 模块的字段多了 product 参数；任务新增了类型筛选；脚本保存后通知了第三处刷新），必须：
1. 新增或更新对应模块的单元测试
2. 验证新测试是"未改动前 Fail、改动后 Pass"（真的在测这条链路，不是摆设）
3. 至少覆盖**正向一次 + 一个典型边界 case**

---

## 五、任务与队列铁律（客户端不能绕过服务端调度）

### IRON-11 任务调度必须走服务端，不允许客户端本地并行

客户端任务通过以下三条服务端 `/tasks` 体系调度：
| 前缀 | 对应接口 | 用途 |
|---|---|---|
| `c_` | `/tasks` | 通用客户端任务 |
| `m_` | `/material/tasks` | 素材下载/解析类任务 |
| `s_` | `/scheduled/tasks` | 成片/编排串行任务队列 |

✅ 正确做法：客户端**只负责领取 → 执行 → 上报**，所有并发/排队/重试策略由服务端控制

❌ 错误做法：客户端自己开 `ThreadPoolExecutor(max_workers=N)` 本地并行跑多个任务，绕过服务端队列 = 会导致服务端资源冲突、状态不一致、任务重复或丢失。

---

## 六、任何改动的标准执行顺序（Checklist，必须按顺序走）

### Step 0 调用本 Skill
任何涉及改代码的请求进入后，**第一动作 = 调用 `software-engineering-iron-rules` Skill**，把这条 Checklist 拿出来贴在执行计划里。

### Step 1 用 TodoWrite 创建任务计划
- 多步 / 多文件 / 多模块 任务 **必须** 先写 Todo 列表。
- 单文件单步纯编码小任务可以跳过，但"问题 ≥ 3 个或涉及 3 个以上文件"必须 Todo。
- Todo 必须标优先级 `high / medium / low`，同一次只有一个 in_progress，顺序执行。

### Step 2 读当前文件（不要凭记忆）
- 改任何文件前，**必须 Read 最新内容**。Edit 报错 90% 是因为用了缓存的旧内容。
- 涉及相邻函数/类时，把它们一起 Read 出来，保证 Edit 时的 `old_string` 在当前文件里唯一。

### Step 3 改代码（增量 Edit 优先）
- 改现有文件 → 用 Edit；**只有在"必须新增空文件"（如 Skill、API 客户端新类）时才用 Write**
- 改完立刻：
  1. `py_compile`（IRON-03）
  2. 跑相关模块的单测（IRON-04 部分）

### Step 4 门禁全跑
- `ruff check` + `mypy`（IRON-05）
- 全量 `unittest discover tests/unit`（IRON-04）
- **任何失败不允许 Step 5**

### Step 5 提交
- 提交信息符合 IRON-09 格式
- diff 过一遍只包含用户要求修改的部分（IRON-08）

---

## 七、违规的典型案例库（踩坑清单，持续积累）

| 时间 | 违规 | 后果 | 对应铁律 |
|---|---|---|---|
| — | 用 `git checkout HEAD -- page.py` 恢复封面制作 | 同一文件里已经改好的 6 处导入/布局修复被一起抹回旧版，程序无法启动 | IRON-01 |
| — | 拆 vector_search_page.py 不核对行数守恒 + 嵌套类漏拆分 | `_RemoteWorker` 被误当顶层类单独成文件，实际是 `_do_transcribe` 内部嵌套类，运行 AttributeError | IRON-02 |
| — | 改完 8 个 .py 不跑 py_compile 直接提交 | 5 个文件有 SyntaxError / NameError，程序启动崩溃 6 轮才定位完 | IRON-03 |
| — | 在 GUI 的 `_open_material_dialog` 里直接 `requests.get("http://...stock_search")` + 解析响应 | 新增接口字段变化时 3 处硬编码同时改漏，URL 拼接错端口无法定位 | IRON-06 |
| — | 顺手把底部查看日志按钮移到操作列时，顺便重写了列表的列宽分配逻辑 | 原"总分列"宽度被挤成 0，显示全空，用户反馈"总分拿不到" | IRON-08 |
| — | 提交信息"修复跳转问题" | 第二周再次翻提交历史完全无法定位哪次修了 MG 跳转 vs 脚本成片同步 | IRON-09 |
| — | 客户端本地 `ThreadPoolExecutor(3)` 同时跑 3 段素材下载 | 服务端限速触发 429 + 本地文件锁冲突，文件一半写入损坏 | IRON-11 |
| — | 按 `openapi-latest.json` 旧快照实现 TTS 接口，字段名与服务端实际不一致 | `voice_id` vs `speaker`、`clone_ref_file` vs `prompt_audio`，TTS 调用全部 400 | IRON-12 |

---

> **本 Skill 是跨项目复用的"零容忍"铁律清单。任何一项铁律被绕过 = 本次改动视为质量不合格，需返工重做，不得提交或发版。**
