# VOC 3.0 接入验证运行记录

版本：`voc.scene.v3`  · 模式：本地 Fixture / JSONL 可回放  · 外部写入：关闭

## 验证目标

验证以下链路是否能够在当前 Commerce Ops 系统中跑通：

```text
VOCRecord → Evidence → SceneInstance → SceneDictionary
→ SceneCluster → Insight → BusinessCase → Task
→ Human Decision / Approval → Mock Action → Receipt
→ Outcome → Retro
```

## 执行边界

- 不连接真实客服、评论、平台或 CRM 系统。
- 不创建或使用真实平台账号。
- 不发送外部请求。
- 不执行真实发布、改价、补偿、改库存或投放。
- Demo 结果不得解释为真实销售、GMV、ROI 或市场规模结论。

## 卡点记录

| 编号 | 阶段 | 现象 | 根因 | 当前处理 | 后续动作 |
|---|---|---|---|---|---|
| P0-001 | 接入前检查 | 当前没有 VOC 3.0 的正式后端对象、事件、查询投影和前端入口 | 现有 Commerce Ops 只有 CustomerVOC/`voc.signal.created` 雏形，未接入 Scene Dictionary/Instance/Cluster | 本轮以本地 Fixture 建立最小可回放验证链 | 真实数据连接器和生产存储另行接入 |
| P0-002 | 运行时边界 | 现有持久化默认只允许 `event.v1`，商品领域部分 Demo 使用 `commerce.event.v1` | Runtime 通用事件版本与领域事件版本未统一 | 已在 CommerceOpsService 的持久化入口允许 `event.v1` 与 `commerce.event.v1`，VOC 事件继续兼容使用 `event.v1` | 后续统一 schema registry 与迁移策略 |

## 执行结果

| 阶段 | 状态 | 证据 |
|---|---|---|
| VOCRecord/Evidence Fixture | `PASS` | 2 条本地 VOC 记录与证据引用成功载入 |
| Scene Dictionary / Instance | `PASS` | `voc.scene.v3`，2 个 Scene Instance，人工确认状态可投影 |
| Scene Cluster / Insight | `PASS` | 2 条信号聚类，生成 Insight 和两条建议 |
| Case / Task / Approval | `PASS` | Case、Task、人工 Decision、Approval 全部进入 Event Ledger |
| Mock Action / Receipt | `PASS` | mock action 成功，Receipt 明确 `externalWrite=false` |
| Outcome / Retro | `PASS` | Outcome succeeded、Retro recorded |
| 证据不足分支 | `PASS` | `VOC_EVIDENCE_INSUFFICIENT`，未进入 action.execution.started |
| CommerceOpsService 后端接入 | `PASS` | 使用 JSONL eventLogPath 执行并重启回放，事件数量不增加 |
| 外部真实数据/平台 | `NOT_RUN` | 按边界禁止真实外部请求 |

## 测试证据

- `./node_modules/.bin/vitest run tests/voc-integration-run.spec.ts`：3/3 通过。
- `./node_modules/.bin/vitest run`：28 个 spec、52 个用例通过。
- Commerce Ops TypeScript 类型检查：通过。
- enterprise-agent-runtime 类型检查与 1 个用例：通过。
- Commerce Ops TypeScript + Vite 构建：通过。
- 前端入口已增加 `VOC 场景中心`，通过 Vite 构建；尚未执行真实浏览器点击回流。

## 真实接入阻塞

- 尚无真实 VOC 数据源授权和字段映射证明。
- 尚无生产级 Scene Dictionary 审核流程和版本发布流程。
- 尚无真实客服/评论/售后系统回执。
