# PenguinHarness 对齐契约（DSH Desktop）

> 状态：设计契约 v0.1；本文件不改变上游 `deepseek-harness/`，也不声明当前运行时已经实现下列全部能力。

## 1. 目标

借鉴 PenguinHarness 的细粒度对象模型，把 DSH Desktop 从“插件与页面集合”对齐为可追踪的 Agent 工作平台：

```text
Project → Agent → Session → Task → Run → ToolCall → Approval
                                      ↓
                                TraceEvent
                                      ↓
                              Artifact → Outcome
```

原则：

- 上游 Agent Loop 保持不变；桌面行为只进入 `dsh-plugin-desktop/` 或业务插件。
- Trace 证明执行事实；Artifact 证明产物存在；Outcome 证明业务验收，不互相替代。
- 所有外部写入、发布、付费生成和破坏性操作默认 `DRY_RUN`，直到存在明确授权、审批、幂等键和回执。
- 兼容模式使用上游默认 Client；增强呈现通过 Desktop-owned Client plugin/profile composition 实现。

## 2. 对象与责任

| 对象 | 身份边界 | 必要字段 | 不负责什么 |
|---|---|---|---|
| Project | 业务归属、权限、默认配置 | `projectId`, `ownerId`, `workspaceRoot`, `defaultAgentId`, `policyVersion` | 不直接执行工具 |
| Agent | 可配置、可版本化的执行主体 | `agentId`, `projectId`, `version`, `model`, `skills`, `hooks` | 不代表一次运行 |
| Session | Agent 与 Workspace 的长期上下文 | `sessionId`, `agentId`, `workspace`, `approvalMode`, `state` | 不代表业务验收 |
| Task | 一次用户目标或调度目标 | `taskId`, `sessionId`, `objective`, `source`, `status` | 不等于最终交付 |
| Run | Task 的一次实际执行尝试 | `runId`, `taskId`, `startedAt`, `endedAt`, `terminalState` | 不凭模型文本判定成功 |
| ToolCall | 单次外部能力调用 | `toolCallId`, `runId`, `tool`, `argsHash`, `risk` | 不绕过审批 |
| Approval | 对特定 ToolCall 的人类决策 | `approvalId`, `toolCallId`, `decision`, `actor`, `reason` | 不批准后续未知调用 |
| TraceEvent | 不可变执行证据 | `traceId`, `runId`, `seq`, `type`, `timestamp`, `payload` | 不证明业务质量 |
| Artifact | 可定位、可校验的输出物 | `artifactId`, `runId`, `path`, `sha256`, `mediaType`, `bytes` | 不自动代表可交付 |
| Outcome | 人或规则对结果的验收结论 | `outcomeId`, `runId`, `gate`, `status`, `evidenceRefs`, `reviewer` | 不修改原始 Trace |

## 3. 状态机

### Task / Run

```text
QUEUED → RUNNING → WAITING_APPROVAL → RUNNING
                  ├→ COMPACTING → RUNNING
                  ├→ INTERRUPTED → RESUMABLE
                  ├→ FAILED
                  └→ COMPLETED
```

`COMPLETED` 只表示执行循环结束；只有存在满足验收门的 `Outcome=ACCEPTED` 才能向用户显示“已交付”。

### Artifact

```text
EXPECTED → DISCOVERED → HASHED → VERIFIED → ACCEPTED
                         └──────→ REJECTED
```

远程任务完成但本地没有产物时，状态必须是 `PENDING_EXTERNAL_DOWNLOAD`，不能是 QA PASS。

### Approval

```text
NOT_REQUIRED | PENDING → APPROVED → EXECUTED → RECEIPTED
                    └──→ DENIED
                    └──→ EXPIRED
```

审批只对 `toolCallId + argsHash + policyVersion` 有效；参数变化必须重新审批。

## 4. 事件最小集合

事件采用追加写入，禁止用 UI 状态覆盖事实：

```text
project.created
agent.versioned
session.created
task.queued
run.started
model.requested
model.completed
tool.call.requested
approval.requested
approval.decided
tool.call.started
tool.call.completed
artifact.discovered
artifact.verified
outcome.recorded
run.completed | run.failed | run.interrupted
```

每个事件至少包含：`eventId`, `occurredAt`, `actor`, `projectId`, `sessionId`, `taskId`, `runId`, `seq`, `schemaVersion`。

## 5. DSH Desktop 映射

| Penguin 概念 | DSH Desktop 落点 |
|---|---|
| Core / Agent Loop | 继续由 pinned upstream 提供 |
| Project / Agent 配置 | Desktop profile 与业务插件配置层 |
| Session / Task | 上游 Session/Task 之上增加 Desktop correlation metadata |
| Skills / Hooks | DSH Skill package、Cordis host/client plugin |
| Tool / Approval | 上游 tool 与 approval UI；外部副作用由业务插件再加策略门 |
| Trace | 上游 trajectory/session evidence，加 Desktop `runId` 关联 |
| Artifact | 各工作台统一登记，包含路径、hash、大小、来源和下载状态 |
| Outcome | 业务插件的 QA/review gate，不放入上游子模块 |

Community Fabric 与 Community Market 在契约和参考适配器评审完成前仍保持文档脚手架，不声明可加载 DSH/package entry point。

## 6. 第一批验收门

1. **身份门**：每个运行都有稳定 `projectId/agentId/sessionId/taskId/runId`。
2. **顺序门**：Trace 的 `seq` 单调递增，断线重连不重复产生事实事件。
3. **审批门**：高风险 ToolCall 没有有效 Approval 时不可执行。
4. **产物门**：产物存在、路径在允许 Workspace 内、hash 可重算、大小与类型可验证。
5. **结果门**：`Run COMPLETED` 不得自动转换为 `Outcome ACCEPTED`。
6. **回归门**：兼容模式仍启动上游默认 Client；Desktop 增强仅在显式 profile 下出现。
7. **上游门**：所有变更均位于 Desktop-owned package；上游子模块 pin 不发生非目标变化。

## 7. 实施顺序

### P0：只读关联层

- 为现有 Session/Task/Trace 增加 correlation metadata。
- 建立统一 Artifact 发现与 hash 校验服务。
- 把业务插件现有的 mock/真实/阻塞状态映射到 Outcome，不改变执行器。

### P1：审批与回执层

- 为外部写入、发布、远程生成和包操作增加 ToolCall policy gate。
- 记录 Approval、执行结果和 receipt，失败时 fail-closed。

### P2：评测层

- 建立 Benchmark/Case/Run/Score/FailureReason 对象。
- 用 Trace + Artifact + Outcome 驱动回归，而不是用截图或 HTTP 200 驱动。

### P3：工作台层

- 在 Desktop-owned Client 中呈现 Session、Task、Trace、Artifact、Review 五类页面。
- 兼容模式保持上游界面；增强模式提供工作流视图。

