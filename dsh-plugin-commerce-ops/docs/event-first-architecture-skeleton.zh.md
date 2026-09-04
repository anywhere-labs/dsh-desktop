# 事件核心的多企业 Commerce Ops 骨架

状态：P1 可运行骨架，使用 mock 事件、人工批准和模拟执行；不代表真实平台数据或真实写操作已经接通。

## 1. 分层

```text
Business Event
  -> Event Ledger
  -> Event Router
  -> Agent Atom
  -> Skill Atom
  -> Case / Responsibility Projection
  -> Human Board
  -> Approved Action
  -> Receipt / Outcome Event
```

- Event 是不可变业务事实。
- Case 是一件需要协同处理的经营事项。
- Task 是 Case 的执行投影。
- Agent 只在订阅事件后判断下一步，并调用声明过的 Skill。
- Skill 是单一、可验收、可审计的动作。
- 人是高风险决策和业务责任的最终承担者。

## 2. 当前代码骨架

```text
src/event-core/contracts.ts  Event、Case、责任状态契约
src/event-core/ledger.ts     幂等追加、订阅、租户过滤
src/event-core/persistence.ts 本地 JSONL 事件持久化与恢复
src/event-core/space.ts      四类 Agent Space 投影
src/event-core/router.ts     事件到 Agent 的路由和风险声明
src/event-core/cases.ts      Case 与责任投影
src/event-core/simulation.ts 竞品降价事件端到端模拟
src/actions/mock-executor.ts  审批校验后的模拟执行与回执
src/skills/registry.ts       Skill 原子注册表
src/agents/registry.ts       Agent 原子注册表
src/client/AgentSpace.tsx    事件、责任、审批、回执四视图
src/governance/service.ts    权限、责任转派、SLA 和通知事件
```

## 3. P0 演示闭环

```text
competitor.price.changed
  -> event-coordinator
  -> competitor-intelligence
  -> product-intelligence
  -> brand-strategy
  -> coordination
  -> Case: WAITING_HUMAN
  -> human_brand_owner_001 批准
  -> mock Action Executor
  -> action.receipt.received
  -> outcome.recorded
  -> Case: CLOSED
```

此闭环会产生分析、人工审批、模拟执行和结果事件，但不会真实改价、投放或发布；执行回执显式携带 `mode: mock` 与 `externalWrite: false`。

## 4. 继续扩展顺序

1. 为每个真实连接器增加 capability 状态：`REGISTERED`、`ACTIVE`、`NOT_AVAILABLE`。
2. 将 CaseStore、审批记录和人类决策也写入持久化事件账本，保持租户、企业、品牌隔离。
3. 增加失败回执、重试上限和补偿事件，验证 Case 进入 `BLOCKED` 后的恢复。
4. 将 Agent Space 接入真实的多人身份、权限、SLA 和通知通道。
5. 将审批、人工决策、责任转派、SLA 升级和通知记录全部接入真实身份系统。
6. 用事件回放器构建多企业模拟场景，再接入经过授权的真实只读连接器。

## 5. 验收口径

- 重复 `eventId` 不产生重复事件或重复 Case。
- 事件必须通过结构校验，并带 `tenantId`、来源、时间、关联 ID 和证据引用。
- 高风险动作必须经过人工审批。
- 人的确认、驳回、接管和转派都必须成为可追溯事件。
- 数据不可用、样本不足和连接器失效必须显式标记，不能被 Agent 推断成经营事实。
- 运行命令：`corepack yarn workspace dsh-plugin-commerce-ops typecheck`、`corepack yarn workspace dsh-plugin-commerce-ops test`。
