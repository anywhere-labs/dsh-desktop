# dsh-plugin-commerce-ops 架构评审与重构方案

- 评审日期：2026-09-04
- 对照标准：`docs/agent-atom-skill-data-layer.md`（Agent 原子 = 数据输入 + Skill 动作 + 数据输出 + 人工责任边界）
- 现状基线：typecheck ✅ / vitest 17 文件 21 用例全绿 ✅
- 本文件只做诊断与方案，不修改代码。

---

## 一、现状快照

| 层 | 目录 | 现状 |
|---|---|---|
| 宿主 | `src/plugin.ts` | cordis 插件，注入 webServer，注册路由 |
| HTTP 层 | `src/host/routes.ts` | 手写 node:http 路由 + 同源校验 + JSON body 限 512KB + nosniff |
| 编排 | `src/host/commerce-ops-service.ts` | 组装 mock 连接器 + SkillRuntime + 审批 + 规则引擎 + 浏览器采集 |
| 契约 | `src/contracts/index.ts` | zod：metricSnapshot + actionProposal（含 L2-L5 必须带 approvalId 的 refine）|
| Skill | `src/skills/runtime.ts` | SkillRuntime：步骤串行执行 + transitions |
| 采集连接器 | `src/connectors/` | mock / http(只读) / browser-capture(需授权) / platform-config / field-mapping |
| 策略 | `src/policies/rule-engine.ts` | ForbiddenTermRule 命中检测 |
| 审批 | `src/approvals/service.ts` | 内存 Map：create/approve/reject/assertExecutable（动作须匹配审批单）|
| 浏览器采集 | `src/browser-acquisition/` | BrowserAcquisitionAgent + AcquisitionBundle |
| 分析 | `src/analysis/service.ts` | AnalysisService：bundle → dashboard + insight（ready_for_human_review）|
| 总线 | `src/parallel-bus/fanout.ts` | ParallelBus 发布订阅 |
| 决策 | `src/decision/service.ts` | HumanDecisionService.record（返回 recorded，无持久化）|
| 回放 | `src/replay/replay.ts` | fixture → 标准指标，标记 redacted |
| UI | `src/client/` | React（App 壳 / AgentStudio / ApprovalCenter / api.ts / styles.css）|

真实度判断：这是一个**验证架构正确性的骨架工程**，核心价值在"契约 + 审批边界 + 分层演示"，不是可用的生产采集系统。这一点是健康的——文档也自述浏览器链路只证明可见 DOM 读取可行。

---

## 二、架构诊断（对照 agent-atom-skill-data-layer 方法论）

方法论要求五层职责分明：

> 数据层负责事实 / Skill 层负责加工 / Agent 原子负责解释 / 汇总原子负责组合 / 人负责判断决策

### ✅ 做得对的部分（重构必须保留）

1. **人工边界清晰**：ActionProposal 用 zod superRefine 强制 L2+ 必须带 approvalId；ApprovalService.assertExecutable 核对审批单与动作一致——「审批前不可执行高风险动作」落地完整。
2. **采集只读且需授权**：BrowserCapture 未授权直接抛错；capabilities 恒为 read:true/write:false——符合文档承诺。
3. **平台字段不猜测**：field-mapping 白名单 + 未映射字段抛错进不了库（对应文档"进入人工确认和字段映射队列"）。
4. **证据优先**：MetricSnapshot.source 内含 evidenceId；分析输出显式 evidenceIds + ready_for_human_review。
5. **回放诚实**：replay 输出强制 replayed:true + source:'redacted-fixture'，不冒充线上证据。
6. **干跑不执行**：dry-run 永远 executed:false。
7. HTTP 层安全细节到位：同源校验 / nosniff / body 上限 / approval 冲突返回 409。

### ⚠️ 需要重构的问题（按严重度排序）

#### P0-1 业务 Agent 原子层缺位（方法论的核心没落地）
方法论定义了 29 个 Agent 原子（A01–A29），项目现状是**服务方法直接编排 Skill**，没有独立的"Agent 原子"抽象。`CommerceOpsService` 同时承担：连接器管理、技能编排、审批、策略、干跑——职责过载，将来每加一个原子就要改这个类。

**证据**：`commerce-ops-service.ts` 88 行内组合 6 个依赖；没有 Axx 对应的类或路由。

#### P0-2 审批没有"动作执行"消费端，闭环未闭合
`ApprovalService` 实现了完整的审批状态机，但**没有任何代码在审批通过后真正执行动作**（assertExecutable 只有测试在调）。也就是说"人批准 → 动作执行 → 结果回写"这一环缺失，方法论里 `Decision 人工决策记录 → follow_up_task` 没有数据支撑。

**证据**：`grep assertExecutable` 只在 `commerce-ops-service.ts`（透传）和测试出现；没有 executor/decision 落库层。

#### P1-3 分析层深度不足，Insight 无数据持久化
`AnalysisService.analyze` 只是把指标搬成卡片 + 一句模板化 conclusion（`已从…采集 N 项指标`），没有跨期对比、无问题诊断。而方法论要求 Insight 有 `problem/conclusion/evidence_ids/metric_ids/confidence/assumptions/data_gaps` 完整字段。且 decision/insight 结果都**不落库**（内存或直接返回），无历史、无 ID 关联，A29 汇总原子无米下锅。

**证据**：`analysis/service.ts` 12 行；`decision/service.ts` 12 行，record 直接 return 不存储。

#### P1-4 Skill 是通用执行器，没有 Skill 目录/元数据
`SkillRuntime` 能跑任意 steps 序列，但项目没有"Skill 定义表"（哪些 Skill 存在、输入输出契约、风险等级、归属 Agent），方法论 S01–S11 的 Skill 目录没有落地为代码。step 回调全部在 service 里 inline，无法复用/无法被 UI 列出。

**证据**：runDailyReport 的 steps 写在 service 方法内；UI 里 AgentStudio 的"技能"是硬编码字符串。

#### P2-5 契约模型覆盖面窄，缺核心领域对象
contracts 只有 metric + actionProposal。方法论数据层 D01–D07 的 **Raw / Master / Event / VOC / Evidence 快照**都没有 zod 模型。evidence 目前只是 id 字符串，没有 `evidence_id/source_type/platform/source_url/observed_at/content_hash/confidence` 的结构化对象——与 UI"查看证据"按钮无数据可点。

**证据**：`contracts/index.ts` 39 行只有 2 个 schema。

#### P2-6 RuleEngine 只支持"违禁词命中"一种规则
方法论 S04 数据质量要求 passed/warning/blocked 三态、多类检查（必填、时间范围、重复、单位、映射完整性、ID 完整性）。现状只有 ForbiddenTermRule 的 boolean 匹配，无 warning 态。

#### P2-7 浏览器采集与 HTTP 采集指标口径可能漂移
`BrowserAcquisitionAgent.capture` 与 `CommerceOpsService.captureBrowserPage` 逻辑重复（都在 normalizeShopMetric 前拼 evidenceId），两份代码易漂移；文档强调"两条路径必须共用同一套 MetricSnapshot/Evidence/Rule/Approval/Trace 合同"。

#### P2-8 测试为"单测拼图"而非"链路验证"
17 个 spec 各测一个类，但**没有一条端到端用例**（采集 → 分析 → 审批 → 决策落库）。test 名 workflow.spec 实际只测 runDailyReport 单链。

**证据**：workflow.spec.ts 只断言日报 5 条指标 + evidenceIds 长度。

#### P3-9 遗留小项
- `App.tsx` 底部 import（`import { useState }` 在文件最末，风格问题）。
- `parallel-bus/fanout.ts` 命名与用途不符（fanout vs publish/subscribe），且无订阅者，疑似预留未接线。
- `Decision` 状态类型分散（decision/service 内联 'accept'|'modify'|'reject'，contracts 未收录）。
- UI 数据多为硬编码，与后端 API 只有审批中心打通。

---

## 三、重构目标架构

```text
src/
  contracts/                 # zod 契约（D 层）
    index.ts                 # 汇总导出
    metric.ts                # D04 指标
    evidence.ts              # Evidence 证据快照（含 hash/confidence）
    action.ts                # 动作提案 + 风险分级
    insight.ts               # D06 分析结果（problem/conclusion/evidence_ids/confidence/data_gaps）
    decision.ts              # D07 人工决策记录（含 follow_up_task）
  agents/                    # Agent 原子层（A 层）——每个原子一个文件
    types.ts                 # AgentAtom 接口：input/run/output/humanOwner/notResponsible
    brand.ts / product.ts / channel.ts ...  # A01–A29 按域拆分（先落骨架）
    summary.ts               # A29 汇总原子
  skills/                    # Skill 目录（S 层）
    registry.ts              # skillId → 定义（输入输出 schema、风险级、归属域）
    runtime.ts               # 通用串行执行器（保留）
  policies/                  # 策略层（保留并扩展三态）
  approvals/                 # 审批层（保留）+ executor 执行端
  acquisition/               # 采集统一入口（合并 browser/http 两路归一化）
  host/                      # 路由 + 服务编排（只做组装，不写业务）
  client/                    # UI
```

分层铁律：`agents 可调 skills/policies`；`skills 不调 agents`；`approvals/executor 只认契约`；`host 只组装`；**人做决策的产物必须落 decision 记录并生成 follow_up_task**。

---

## 四、分阶段重构计划

### Phase 1 — 补齐契约与决策闭环（P0，最重要）
1. 新增 `contracts/evidence.ts`：Evidence 快照（evidence_id/source_type/platform/source_url/observed_at/content_hash/confidence）；把现有散落的 evidenceId 字符串升级为 evidence 引用（向后兼容：保留字符串 id 字段，新增结构化）。
2. 新增 `contracts/insight.ts` 与 `contracts/decision.ts`（含 follow_up_task）；DecisionService 增加**内存存储 + 按 insightId 查询**，返回真值而非固定 recorded。
3. 新增 `approvals/executor.ts`：审批通过后消费 ActionProposal → 执行（mock 执行器，写 Trace）→ 结果回写；给审批补上真正的消费端，闭环闭合。
4. **验收**：新增 1 条端到端测试：创建高风险动作 → 拒绝不可执行 → 批准 → 执行成功 → 决策记录可查。

### Phase 2 — 引入 Agent 原子抽象（P0）
1. 定义 `agents/types.ts`：`AgentAtom { id; domain; read: (ctx)=>…; run: (ctx)=>Insight; humanOwner; notResponsible[] }`，把方法论"Axx 读取/调用/输出/交给人/不负责"落成接口。
2. 以现有 runDailyReport 为第一个样板原子（A10 渠道经营-日报），把 service 里的 inline steps 迁移进原子，service 退化为组装器。
3. 后续 A01–A29 先落**骨架文件 + 各自契约**（读什么/输出什么/不负责什么），不一次全实现。
4. **验收**：service 不再内联 skill steps；至少 1 个原子经路由可被触发；typecheck + 全量测试绿。

### Phase 3 — 分析深化 + 数据质量三态（P1）
1. AnalysisService 升级：接受 Evidence + 跨期 MetricSnapshot，输出带 confidence/data_gaps 的 Insight；insight 落库。
2. RuleEngine 增加 warning 态与检查类型（必填/时间范围/单位），Evaluation.status 支持 passed/warning/blocked。
3. **验收**：分析用例带 evidence 断言；规则引擎新增三态用例。

### Phase 4 — 采集口径收敛 + 清理（P2/P3）
1. 抽取 `acquisition/normalize.ts` 统一浏览器/HTTP 两路归一化（消灭 P2-7 重复）。
2. 按需接线 ParallelBus 或删除；修正 App.tsx import 顺序；决策状态类型并入 contracts。
3. **验收**：单条采集路径覆盖两路来源的测试；无重复归一化代码。

---

## 五、明确不做（人工/系统责任边界）

- 不接任何真实平台 Token；不实现真实写操作（上下架/改价/发券）；系统维持 read-only 采集 + mock 执行。
- 不引入新依赖；zod 已够用，路由手写 HTTP 保持零框架。
- 每个 Phase 都以 `npm run typecheck` + `npm run test` 全绿收口，再进下一 Phase。

## 六、评审结论

**架构方向正确、安全边界扎实，但方法论的核心卖点（Agent 原子 + 证据闭环 + 决策落库）尚停在演示层。** 当前最值得投入的是 Phase 1+2：把"审批没有消费端"和"没有 Agent 原子层"补上，工程就会从"分层演示"变成"可扩展的分层框架"。P1–P4 为增强项，可按业务节奏推进。
