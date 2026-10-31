# Agent 自我回复与无进展循环止血方案

## 背景

在“检查当前修改”类任务中，Agent 可能从用户指定的 diff 和符号逐步扩大范围，反复搜索、读取和验证，并根据自己的中间结果继续生成下一轮工具调用。工具本身都能成功返回，但任务没有产生新证据，最终形成“AI 自己回复自己”的无进展循环。

截图中的 `已完成，用时 18 分 24 秒` 只是整轮 Turn 的墙钟时间；真正的故障是 Agent 没有在目标范围已经验证完成后收敛。

## 已实现的插件止血

插件位置：`deepseek-harness/packages/guard/repeat-tool-reminder/`

包名：`@deepseek-ai/dsh-repeat-tool-reminder`

插件新增两个可选硬边界：

```yaml
- name: '@deepseek-ai/dsh-repeat-tool-reminder'
  config:
    thresholds: [3, 5, 8]
    blockAt: 8
    maxTrackedCallsPerTurn: 24
```

- `blockAt`：同一个 Agent 在相同工具和相同参数上达到阈值时，在工具执行前拒绝下一次完全重复调用。
- `maxTrackedCallsPerTurn`：一个用户 Turn 内达到跟踪工具调用预算后，拒绝后续跟踪调用，要求 Agent 总结现有证据。
- 两项配置在可复用包中默认均为 `0`，保持下游兼容；基础 profile 启用 `blockAt: 8` 和 `maxTrackedCallsPerTurn: 24`。
- 新用户消息会清除当前 Agent 的重复链和 Turn 预算。

## 为什么先做这两个边界

它们是低侵入的止血方案：复用已有 `tools/pre-execute` 和 `tools/post-execute` 插件接口，不修改 Agent Loop 主循环，不要求模型提供额外结构化输出，也能在工具真正执行前阻断最危险的精确重复调用。

它们不能识别所有语义相同的搜索，例如把 `actionCard` 改成 `appendCard`。因此 `maxTrackedCallsPerTurn` 是当前对“换关键词继续扩大检查”的粗粒度保险丝，而不是最终的任务理解方案。

## 后续演进

1. 为检查任务建立不可自动扩大的 scope 和完成条件。
2. 记录“新命中、新修改、新错误、新验证证据”等进展事件。
3. 按目标主题聚合近似工具调用，而不是只按工具名和完整参数判断重复。
4. 连续无进展时进入收尾状态，禁止继续调用检查类工具。
5. 在 UI 中显示总耗时、模型耗时、工具耗时和被止血规则阻断的调用。

## 风险与调参

硬边界可能阻断合法的长任务。对需要大量工具调用的自动化任务，应提高 `maxTrackedCallsPerTurn` 或显式关闭该项；不应全局无限提高预算来掩盖任务范围漂移。默认配置的目标是优先防止用户只要求一次检查却等待十几分钟。

## 验证

插件测试覆盖：

- `blockAt` 和 `maxTrackedCallsPerTurn` 的非法配置拒绝；
- 达到精确重复阈值时的执行前拒绝；
- 达到单 Turn 跟踪调用预算后的拒绝。

定向测试命令：

```bash
cd deepseek-harness
pnpm exec vitest run packages/guard/repeat-tool-reminder/tests/repeat-tool-reminder.spec.ts
```

该插件位于 DeepSeek Harness 的公开包结构中，配置、README、测试和基础 profile 均保持可独立开源维护。
