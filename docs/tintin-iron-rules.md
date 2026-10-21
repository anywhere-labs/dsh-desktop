# 工程移植铁律(2026-09-30 建立)

> 本文是 TinTin 业务向本框架移植期间的**强制工程规范**。任何违反铁律的实现,评审必须打回。
> 来源:源仓库《工程规范铁律.md》10 条事故条款(`D:\Project\tintin-dsh-desktop\docs\tintin\工程规范铁律.md`,只读参考)+ 本仓库 [AGENTS.md](../AGENTS.md) 治理红线 + 5 条移植特有条款,共 16 条(2026-10-20 增补铁律 16)。
> 配套方案:[TinTin 移植方案](tintin-migration-plan.md)。规则不进门禁 = 假绿灯(铁律 6 的原始教训):本文每条都标注落实方式,未落实的由交付物 D0-1(`check:tintin` 门禁骨架)补齐。

## 事故原型(条款为什么存在)

- **声音克隆播放灰一整天**:composable 内 ref 已赋值但未 `return`,Vite/esbuild 不查类型,静默 `undefined`。→ 铁律 1/2/3/5/6。
- **剪映封面指向模板目录**:克隆他人草稿当模板、硬编码空 `coverPath`,文档无依据。→ 铁律 12。
- **混剪 3528 行文件拆分翻车**:128 个函数搬不全,168 个 typecheck 错误,整链回滚。→ 铁律 1/4。
- **tintin 侧"测试全绿但定制丢失"**:上游合并后补丁失效无察觉,靠事后 grep 核查补救。→ 铁律 13/15。
- **桥面静默失效(2026-10-20)**:壳基线升级改了 preload 桥名,消费端裸字符串摸旧名,测试全绿但媒体/运营工具文件入口全断。→ 铁律 16。

## A. 代码纪律(继承源仓库铁律,迁移期间继续有效)

### 铁律 1|只搬不写
业务代码迁移 = 纯搬迁。动工前先产出"逐符号迁移映射"(目标文件清单 + 源→目标对照);搬完 `typecheck` 0 错误 + 单测全过才算完成。禁止顺手重写函数体或改契约;确需重写的(接入层)单列工作包并在映射表标记。借迁移拆分大文件必须过五项 checklist:行数守恒、符号完整、导入完整、单测全过、分支闭环。
*落实:迁移映射清单随工作包提交;typecheck 进根 `corepack yarn typecheck`。*

### 铁律 2|契约逐字段对齐,缺失即显式报错
FastAPI 契约、`/tintin/ipc/*` 路由名、预设 schema 在 0.2.0 下的字段,逐字段核对;禁止 `|| s.url` 式猜测兜底、静默 return 或猜字段。字段缺失/漂移 → 显式错误 + 用户提示。服务端响应、宿主路由、client 类型声明多处同值。
*落实:契约测试(vitest)随 `dsh-tintin-bundle` 提交,进根 `corepack yarn test`。*

### 铁律 3|关键失败路径必须打点
每条迁移链路(路由 → ffmpeg/yt-dlp spawn → FastAPI → SSE)的每个失败分支保留日志/错误上报;诊断日志打到"断点处的实际值"(拼出的 URL、元素真实状态、绑定变量值),不只记"做了什么"。"没有报错日志 ≠ 没有 bug,可能只是没打点"。
*落实:评审清单项;SSE/spawn 链路测试覆盖失败分支。*

### 铁律 4|单文件 ≤1000 行,基线锁定只减不增
手写源码单文件 ≤1000 行(豁免:生成物、`dist/`、lock 文件、纯数据表)。迁入即登记基线,此后任何改动不得使行数增加;迁移是唯一合法的降行数机会。
*落实:D0-1 `check:tintin` 行数门禁(基线锁定式,存量锁定、新增拦截)。*

### 铁律 5|分层下沉
jianying/montage/voice-tts 等纯逻辑 + 单测下沉 `dsh-tintin-bundle/lib/`;路由注册、client 注入只是可替换的编排壳。新代码沿"纯逻辑(可测)→ 组合式(编排+响应式)→ 组件(视图)"分层。
*落实:评审清单项。*

### 铁律 6|构建不查类型 = 假绿灯
`vite build`/esbuild 只转译不查类型;Vue 子应用解构不存在的成员会静默 `undefined`。本框架根 `corepack yarn typecheck` 是门禁,但 **`dsh-tintin-media-bundle` 的 vite 构建不在此覆盖内**——必须为 media-bundle 补独立 `tsc --noEmit` 门禁。任何"build 通过"不等于"类型正确"。
*落实:D0-1 把 media-bundle typecheck 接入根 check;本仓库 `enableScripts: false`,此条不会自动生效。*

## B. 架构治理(本仓库 AGENTS.md 红线,移植必须遵守)

### 铁律 7|子模块与 vendored 产物只读
`deepseek-harness/` 与 `vendor/dsh-runtime/` 的 tgz 一个字不改。tintin 需要的上游改动只能走 `patches/` 按版本分代,经 `sync-vendored-runtime` 管线生效。
*落实:已有 CI/`corepack yarn check`;违规即回退。*

### 铁律 8|tintin 业务代码不进 `dsh-plugin-desktop(-beta)/src/`
变体镜像门禁强制 Stable/Beta 源码逐字节一致;业务只住 `dsh-tintin-*` 独立 workspace 包,经 profile 组合装载。第三通道镜像规则定稿前,Beta 内只做挂载验证。
*落实:已有 `check:desktop-variants` + `verify-layout.mjs`;新增包须登记。*

### 铁律 9|提交纪律
子模块 pin 更新与桌面行为改动分开提交;每个 Phase 收尾必须是一次完整可回滚的提交;大方向变化前先 commit。
*落实:评审 + CI。*

### 铁律 10|新鲜度门禁不可绕过
根 dev/dist 链先跑 `market:prepare` + `aa:prepare-release`,失败即停、不沿用旧物;`dist:tintin` 从第一天接入同样门禁。
*落实:已有脚本链;`dist:tintin` 建立时同步接入(Phase 4)。*

### 铁律 11|无头安全
构建、类型检查、单测、Loader 冒烟不得依赖图形应用启动;调试用临时目录或独立开发 Profile。
*落实:已有 `corepack yarn check` 全链无头。*

## C. 移植特有(新增,两边规则均未覆盖)

### 铁律 12|四类依据,缺一不动工
每个移植操作(补丁 hunk 裁决、状态机取舍、API 差异处理、产品取舍)必须有四类依据之一:**①用户裁决;②tintin 原实现一比一;③第三方权威/契约(0.2.0 上游源码、FastAPI OpenAPI、pyJianYingDraft 等);④实测证据(spike 输出)**。四者皆无 → 列入移植方案附录 E 待裁决清单上报,不得自行发明。代码注释引用依据(文档名/裁决日期/实测样本)。高风险操作(克隆外部数据当模板、硬编码占位、静默兜底回退、改写他人数据文件)必须有明确依据 + 风险说明,否则禁止。
*落实:方案附录 E + D0-2/D0-4 留档;评审核对依据标注。*

### 铁律 13|补丁逐 hunk 裁决留档
26 个源补丁每个 hunk 的去向(丢弃/已被本框架覆盖/转译)登记 `docs/tintin-patch-audit.md`,每条带铁律 12 的依据;hunk 计数等价物纳入门禁。**测试全绿 ≠ 定制还在。**
*落实:D0-2 交付物;`check:tintin` 含 hunk 计数核对。*

### 铁律 14|API 差异只认实测
0.1.7→0.2.0 每个接触面(agentPresets 注册、client 模块缝、webServer 路由、预设格式、session 持久化)以 spike 实测为准,不凭上游 changelog、文档或"应该兼容"推断。未实测的接触面视为未验证,交付说明必须区分已验证/未验证。
*落实:D0-3/D0-4 留档;评审拒绝无实测记录的接触面结论。*

### 铁律 15|锚点门禁先于打包
源仓库 `verify:customizations` 的 grep 锚点核查改造成 `check:tintin`,接入根 `check` 与 `dist:tintin`;FAIL>0 禁止打包。每合入一批能力同步更新锚点表。
*落实:D0-1 建骨架,Phase 5 全量接入。*

### 铁律 16|桥面单一事实源,升级基线必对账(2026-10-20 事故)
桌面壳 preload 暴露的每个 `window.*` 桥与 dsh-tintin-* 消费端的桥名,统一登记 `scripts/bridge-surface.json`(单一事实源)。任何新增/改名/删除桥必须先改 JSON,再改实现;`check:bridge-surface`(接入根 `check`)对账三方向:preload 暴露面 ⊆ 声明、消费端桥名 ⊆ 声明全集、废弃桥名必须与现行主桥同文件成对出现。升级壳基线(dsh 0.2.x)或合并上游 master 的提交,`check:bridge-surface` 为合并阻塞项——消费端靠裸字符串摸 window,类型检查/单测/行数基线均不设防,升级时唯一能拦住静默失效的就是这份对账。三包 preload.spec 的暴露面全量快照与打包探针(packaged-bridge-surface.spec)是同一事实源的另外两道锁。
*事故:0.2.1-rc.2 基线升级把 `__DSH_DESKTOP_FILE_PATH__` 换成上游 `__DSH_HOST_PATHS__`,4 处消费点未同步,媒体/运营工具全部文件入口、聊天框 @文件、缓存目录选择静默失效(2026-10-20 用户报障复盘)。*

## 修订规则

新增或修改条款必须附事故复盘或用户裁决依据,并在本文头部登记日期;无依据的条款不受理。
