# Enterprise Agent Runtime · 企业级需求基线与领域拆分 PRD

> 版本 v0.1 · 2026-09-04
> 定位：**把通用运行底座（Enterprise Agent Runtime）与业务领域（Commerce Ops 电商品牌经营）正式拆分**，并定义两者的边界合同。以「竞品情报闭环」作为第一个端到端验证域。
> 前置：《commerce-ops-engineering-prd.zh.md》描述当前 Commerce Ops 可运行骨架；本文是其向通用底座演进的需求基线。

---

## 1. 为什么拆分

`dsh-plugin-commerce-ops` 目前是一个**单一包**。里面既有平台能力，也有电商领域逻辑。这带来三个运营风险：

```text
1. 域逻辑污染平台：竞品、商品、内容相关的判断散落在 Event/Case/Agent 里，
   新增「供应链」「客服 VOC」领域时无法复用核心链路。
2. 平台能力被域绑定：审批、责任、SLA 这些通用能力写死在电商假设下。
3. 多租户抽象不完整：租户隔离只覆盖到 Event + 看板投影，未覆盖身份、策略、连接器。

结论：不先拆分，Commerce Ops 只是「一个品牌经营骨架」，不是「企业级 Agent 运行底座」。
```

**拆分原则**：平台能力一次性建设、跨域复用；领域逻辑按业务模块托管，只实现差异，不重写核心链路。

---

## 2. 两个平面

```text
通用平台层（enterprise-agent-runtime）
├── Tenancy / Identity / Permission
├── Event Ledger / Event Router
├── Workflow / Case / Task
├── Agent Runtime / Skill Runtime
├── Policy Engine / Risk Engine
├── Approval / Responsibility
├── Connector Gateway
├── Notification / SLA
├── Execution / Receipt / Compensation
├── Audit / Evaluation / Replay
└── Agent Space UI（通用容器）

业务域应用层（domain-commerce-ops）
├── competitor/      竞品情报
├── product/        商品经营
├── content/        内容增长
├── campaign/       活动与投放
├── inventory/      库存
└── customer-voc/   客服舆情
```

平台层**不知道**「竞品」「SKU」「转化率」是什么。它只理解：

```text
Event（事件）× Agent（判断单元）× Skill（动作原子）× Case（协同容器）× Human（责任主体）× Policy（规则）
```

领域层把业务含义翻译成这些原语。

---

## 3. 企业级需求基线：先回答八个运行问题

需求梳理从「企业运行问题」出发，不是从「要几个 Agent / Skill / 看板」出发。

### 3.1 服务谁（组织模型）

```text
Platform Operator       平台运营方
Enterprise              企业
Organization            事业部 / 部门
Brand                   品牌
Shop                    店铺
Project                 项目
Member                  个人
Agent                   智能体
External Vendor         外部服务商
```

领域内必须回答：

```text
谁拥有企业数据？  谁可见哪个品牌？  谁能创建事件？  谁能审批？
谁能执行动作？    谁承担最终责任？  企业之间是否完全隔离？
```

### 3.2 发生了什么（事件目录）

事件是**最小业务事实**，必须先于页面梳理。每个事件都要定义：来源、对象、发生条件、证据、影响范围、严重等级、响应时限、通知对象、责任角色、是否人工决策、可触发动作。

```text
信号类：competitor.price.changed / competitor.content.published /
         content.viral / comment.negative / inventory.low /
         ad.budget_exceeded / order.refund_rise / logistics.delay
企业类：new_product.launched / campaign.started / stock.alert
治理类：approval.* / human.decision.* / responsibility.* /
         action.* / notification.* / sla.* / outcome.*
```

### 3.3 事件如何变成协同事项

不是所有事件都建任务。由 **Event Router + Policy + Risk** 决定，不能完全交给 LLM。

```text
Event
├── 仅归档（低风险、低价值）
├── 生成提醒（中等信号，观察）
├── 创建 Case（需协同）
├── 创建分析任务（只需 Agent 判断）
├── 请求人工确认（判断需人背书）
├── 请求审批（动作需授权）
└── 触发已授权动作（低风险、策略放行）
```

示例分级：

```text
竞品降价 1%            → 归档观察
竞品降价 12%           → 创建竞品响应 Case
竞品降价 + 本品牌转化率降 → 升级高优先级经营 Case
涉及价格调整            → 必须人工审批
```

### 3.4 谁来处理（Agent + 人统一责任模型）

Agent 和人放在**同一个责任模型**里，责任不悬空。

```text
Agent 发现事实 → Agent 补证据 → Agent 提判断 → 人确认判断
→ 人批准动作 → Agent 执行 → 系统记回执 → 人+Agent 复盘
```

每个 Agent 声明：订阅哪些事件、用哪些 Skill、读哪些数据、提什么建议、**不能执行什么**、对应哪个人工责任角色、输出什么结构化对象。

### 3.5 企业允许系统做什么（Policy vs Permission）

```text
Permission：谁能做？（身份与权限）
Policy：    什么情况下可以做？（条件与策略）
```

```text
价格变化 >5% 必须审批
毛利率 <20% 禁止自动跟价
广告预算超日预算 10% 必须负责人确认
负面舆情高风险必须通知品牌负责人
低风险内容草稿可自动生成，但不可自动发布
```

### 3.6 动作是否可追踪（动作执行链）

任何外部动作必须形成可审计链：

```text
Action Proposal → Approval → Action Started → Connector Request
→ Receipt → Verification → Outcome
```

系统必须回答：谁提出？谁批准？执行到哪？平台返回什么？是否真写入？失败怎么恢复？

### 3.7 数据从哪来（连接器能力矩阵）

```text
企业内部：ERP / CRM / WMS / OMS / 客服 / 广告
电商平台：店铺 / 商品 / 订单 / 售后 / 评价
内容平台：视频 / 图文 / 直播 / 评论 / 互动指标
人工输入：Excel / 表单 / 对话 / 审批 / 备注
```

每个连接器声明：是否授权、只读/写、对象、字段、分页、调用限制、失败状态、数据新鲜度、成本、能力状态（`REGISTERED/ACTIVE/PARTIAL/NOT_AVAILABLE`）。**登记 ≠ 真实可调用**。

### 3.8 结果如何衡量

不只衡「Agent 有没有回答」，还要衡：

```text
数据质量    事件识别质量  路由准确率   Agent 分析质量
人工采纳率  审批响应时间   执行成功率   通知送达率
SLA 达成率  经营动作结果   复盘改进效果
```

---

## 4. 领域需求分层

### A. 企业组织域
```text
Tenant / Enterprise / Organization / Department / Brand / Shop
Member / Role / Permission / Policy / Workspace
```
多租户隔离、组织树、品牌归属、成员角色、数据范围权限、操作权限、代理权限、外部服务商权限。

### B. 事件域
```text
Event / EventType / EventSource / EventEvidence / EventSubscription
EventCorrelation / EventReplay / EventSchemaVersion
```
结构校验、幂等写入、版本、关联、回放、审计、租户隔离、订阅与路由。

### C. Case 与工作流域
```text
Case / Task / Stage / Transition / Owner / SLA / Escalation / Blocker / AcceptanceCriteria
```
事件建 Case、状态机、拆任务、多 Agent 协同、多人协同、责任转派、接管释放、超时升级、关闭条件、复盘任务。

### D. Agent 与 Skill 域
```text
AgentDefinition / AgentRun / AgentSubscription / AgentMemory
SkillDefinition / SkillRun / SkillVersion / ToolBinding / OutputContract
```
Agent 注册、Skill 注册、绑定、订阅、IO 合同、运行状态、失败重试、权限边界、运行日志、版本评测、人工接管。

### E. 决策与治理域
```text
Proposal / Approval / HumanDecision / Responsibility
PolicyEvaluation / RiskAssessment / AuditRecord
```
低风险自动、中风险人工确认、高风险审批、双人审批、审批超时、驳回修改、人工接管、审批与动作一致性校验、决策不可篡改。

### F. 连接器与执行域
```text
Connector / Capability / Credential / ActionGateway
ExecutionAttempt / Receipt / Compensation
```
连接器注册、能力探测、读写区分、凭证隔离、请求幂等、回执、失败重试、补偿、紧急停止、外部写入审计。

### G. 人类协同域
```text
AgentSpace / EventBoard / ResponsibilityBoard / ApprovalBoard / ReceiptBoard
Notification / Mention / Comment / ActivityFeed
```
事件看板、待我确认、待我审核、我负责、被阻塞、SLA 超时、事件详情、证据查看、Agent 建议查看、人工修改与接管、协作评论。

---

## 5. 企业级运行主链路（所有领域复用）

```text
Request/External Event
→ Ingest → Validate → Persist Event → Correlate
→ Apply Policy → Route Agent → Invoke Skill → Produce Evidence/Insight
→ Create Case → Assign Human Responsibility → Request Approval
→ Execute Approved Action → Receive Receipt → Verify Outcome
→ Notify Stakeholders → Evaluate/Retro
```

领域差异只在：事件类型、Agent、Skill 组合、Policy、连接器、人工责任角色。

---

## 6. 边界合同（Runtime ↔ Domain）⭐ 最关键的拆分契约

领域层通过**三个注册点**接入，核心链路不改。这决定了「拆分」能否成立。

```text
① 领域通过「契约对象」而不是「领域代码」向平台声明自己。

② 平台提供六个扩展点：
   DomainEventType   领域定义事件类型 + schema 版本
   DomainAgent       领域定义 Agent（订阅事件 / 用 Skill / 输出合同）
   DomainSkill       领域定义 Skill（单个动作原子）
   DomainPolicy      领域定义策略（什么条件下可以做）
   DomainConnector   领域定义连接器（能力 + 只读/写 + 状态）
   DomainResponsibility 领域定义人工责任角色

③ 平台反向提供六个通用能力：
   EventLedger       append-only + 幂等 + 租户隔离 + 回放
   EventRouter       Event → Agent（策略驱动）
   SkillRuntime      执行 Skill（IO 合同 + 幂等 + 失败分类）
   CaseStore         协同容器 + 状态机
   Approval / Responsibility / SLA / Notification  治理闭环
   Agent Space UI    四类投影 + 人看板 + 人工动作写回
```

**测试合同**：一个领域层必须能在**不改平台源码**的情况下，仅注册 `DomainEventType + DomainAgent + DomainConnector` 就打通一条完整链路。

这是「企业级」与「领域工具」的本质区别。

---

## 7. 当前代码 → 运行底座 / 领域拆分映射表

基于 `src/` 现状（已含本轮交互看板 + 持久化加固 + workbench 打包）：

### 归属「通用运行底座」（未来 `enterprise-agent-runtime/`）

```text
src/event-core/contracts.ts      → events/contracts       事件契约（schema 版本）
src/event-core/ledger.ts         → events/ledger          append-only + 幂等 + 订阅
src/event-core/persistence.ts    → events/store           JSONL + 租户分区 + schema 校验
src/event-core/router.ts         → events/router          Event → Agent（策略驱动）
src/event-core/cases.ts          → cases/projection       Case 投影
src/event-core/space.ts          → spaces/projection      四类看板 + 五人看板视图
src/governance/service.ts        → governance/*           权限 / 责任 / SLA / 通知
src/approvals/service.ts         → approvals/*            审批事件 + 回放
src/decision/service.ts          → decisions/*            人工决策事件
src/skills/registry.ts           → skills/registry        Skill 原子注册
src/skills/runtime.ts            → skills/runtime         Skill 执行（IO 合同 + 幂等）
src/agents/registry.ts           → agents/registry        Agent 原子注册
src/policies/rule-engine.ts      → policies/engine        Policy / Risk 规则引擎
src/actions/mock-executor.ts     → executions/gateway     mock 执行 + 外部写入门禁
src/replay/replay.ts             → events/replay          事件回放
src/parallel-bus/fanout.ts       → events/fanout          并行分发
src/host/routes.ts               → spaces/api             Host API + 静态 workbench 页
src/host/commerce-ops-service.ts → spaces/service         运行底座服务装配（混领域，需拆）
src/plugin.ts                    → runtime/bootstrap      Cordis 插件装配
src/client/AgentSpace.tsx        → spaces/ui              人看板（通用容器）
src/client/api.ts                → spaces/ui/api          看板 API client
src/client/main.tsx + vite.config.ts → spaces/ui/build    浏览器打包
```

### 归属「电商领域」（未来 `domain-commerce-ops/`）

```text
src/connectors/mock.ts           → competitor/connectors/mock   Mock 店铺/竞品数据
src/connectors/http.ts           → connectors/http              通用 HTTP 连接器（可上移）
src/connectors/browser-capture.ts→ connectors/browser           浏览器采集（可上移）
src/connectors/field-mapping.ts  → product/field-mapping         电商字段映射
src/connectors/platform-config.ts→ product/platform-config       平台配置
src/browser-acquisition/agent.ts → competitor/browser-agent      浏览器采集 Agent
src/browser-acquisition/contracts.ts → competitor/contracts      采集契约
src/analysis/service.ts          → competitor/analysis           分析服务
src/decision/service.ts          → 复用（通用）
```

### 领域专属示例（未来新增模块）

```text
domain-commerce-ops/competitor/   竞品匹配、价格历史、影响评估、策略建议
domain-commerce-ops/product/      商品、SKU、价格、库存、评价
domain-commerce-ops/content/      内容结构、主题钩子、内容机会、测试方案
domain-commerce-ops/campaign/     活动、投放、预算
domain-commerce-ops/customer-voc/ 客诉、舆情、负面
```

### 关键判定

```text
上移通用：EventLedger/EventRouter/SkillRuntime/AgentRegistry/Approvals/
          Responsibility/Sla/Notification/AgentSpace/Workbench 打包  → 运行底座
留在领域：Competitor/Product/Content 的具体判断、连接器映射、策略内容 → 领域
拆后需改：commerce-ops-service.ts 目前同时装配平台 + 领域，需拆成
          runtime bootstrap（装配平台）+ domain bootstrap（注册领域）
```

---

## 8. 第一个端到端验证域：竞品情报闭环

拆分后的验证不选「更多 Agent」，选一条**能证明边界合同**的闭环：

```text
竞品降价事件
→ 事件接入（DomainEventType 注册）
→ 事件校验 + 路由（Policy + Risk）
→ 竞品 Agent（DomainAgent）匹配商品
→ 产品 Agent 评估影响
→ 创建 Case（CaseStore）
→ 品牌负责人看板确认（Agent Space Responsibility）
→ 人工审批（Approval + Human Gate）
→ Mock 执行（Action Gateway，externalWrite=false）
→ Receipt 事件
→ Outcome 事件
→ Case CLOSED + Responsibility RELEASED + 复盘
```

**验证目标**：这条链路**不通向平台源码**、仅靠注册领域对象即可跑通。若需改平台，即是边界合同失败。

---

## 9. 构建顺序（六步）

```text
第一步  企业需求基线        企业类型/组织/角色权限/业务对象/经营事件/责任/高风险动作/数据来源/验收指标
第二步  通用运行底座        先建 Tenant/Event/Case/Task/Agent/Skill/Policy/Approval/Responsibility/Action/Receipt/Outcome
第三步  一个垂直闭环        竞品降价 → 价格/内容应对 → 人工审批 → mock 执行 → 复盘
第四步  多企业模拟          企业A日化 / 企业B食品 / 企业C服饰，各不同品牌/商品/角色/价格策略/审批规则/SLA/Agent/连接器
第五步  真实连接器          选一个授权只读连接器，验证权限/字段/分页/频率/数据质量/请求账本/失败恢复
第六步  受控写入            最后才开放内容发布/活动创建/改价/广告，并配 Approval+Permission+Policy+Idempotency+Receipt+Compensation+Emergency Stop
```

**重要**：不要在第一步就铺 Agent 数量。先落«需求基线»，再拆«运行底座»，再跑«一个闭环»。

---

## 10. 企业级交付物清单（22 项）+ 当前状态

| # | 交付物 | 当前状态 |
|---|--------|---------|
| 1 | 企业业务地图 | 部分（电商域已梳理） |
| 2 | 组织与角色模型 | 部分（内存成员表） |
| 3 | 业务对象字典 | 部分（Event/Case/Responsibility） |
| 4 | 事件目录 | 骨架（signal.*/approval.*/responsibility.*） |
| 5 | 事件 Schema | ✅ event.v1 |
| 6 | Case 状态机 | ✅ 已实现 |
| 7 | Task 状态机 | 骨架（未完整） |
| 8 | Agent 目录 | ✅ 已注册 |
| 9 | Skill 目录 | ✅ 已注册 |
| 10 | Policy 目录 | 骨架（rule-engine） |
| 11 | 权限矩阵 | ✅ 已实现（tenant 角色） |
| 12 | 连接器能力矩阵 | 部分（mock + browser） |
| 13 | 审批矩阵 | ✅ 已实现 |
| 14 | SLA 矩阵 | ✅ 已实现（手动 evaluate） |
| 15 | 通知升级矩阵 | 骨架（queued + 手动） |
| 16 | 数据证据规范 | ✅ 已实现（质量评分 + NOT_AVAILABLE） |
| 17 | API 合同 | ✅ 已实现 |
| 18 | 看板信息架构 | ✅ 四类投影 + 五人看板 |
| 19 | 失败与补偿方案 | 骨架（mock error） |
| 20 | 测试和验收标准 | ✅ 25 文件 / 38 用例 |
| 21 | 迁移与上线计划 | 未开始 |
| 22 | ADR 架构决策记录 | 部分（本文即 ADR-001 变体） |

---

## 11. 完成标准 & 当前差距

```text
结构正确：对象/事件/Agent/Skill/Case/责任边界清晰   ✅ 骨架达成
可落地：真实状态/持久化/权限/审批/回执/失败处理     ✅ 骨架达成
可运营：人可看懂/接管/审批/转派/追责/复盘            ✅ 骨架达成
可扩展：新企业/品牌/连接器/Agent 不重写核心流程      ⚠️ 待验证（边界合同未拆分验证）
可审计：决策和外部动作可追溯                        ✅ 骨架达成
生产就绪：真实身份/连接器/监控/告警/灾备/合规          ❌ 未完成
```

当前差距按优先级：

```text
1. 拆分边界合同：把平台能力从 commerce-ops 中抽出为 enterprise-agent-runtime（核心）
2. 真实身份与组织：OIDC + 组织树 + 数据范围权限
3. 连接器能力矩阵 + 一个授权只读连接器验证
4. 生产级持久化：SQLite/Postgres + 事务 + 迁移
5. 常驻调度：SLA 定时 + 通知通道 + 升级链
6. 受控外部写入：Action Gateway + 补偿 + 紧急停止
```

---

## 12. 建议的下一步动作

**不是扩 Agent，而是先落这三点**：

```text
A. 本 PRD 作为拆分基线（含 §6 边界合同 + §7 映射表），评审拆分方向
B. 把 §7「归属通用运行底座」的模块从 commerce-ops 抽出到 enterprise-agent-runtime/
   （先只做事件域 + 治理域，作为最小运行底座，不搬领域逻辑）
C. 以竞品情报闭环（§8）作为第一个端到端验证：仅注册领域对象，不改平台源码

验证通过后，再进入第四步多企业模拟、第五步真实连接器。
```
