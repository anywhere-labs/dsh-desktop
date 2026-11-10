# dsh-byte-guard-recovery

请求体字节超限时**在当前会话原地恢复**，不再被迫开新会话。

## 解决什么问题

pi-ai 通道的 `maxRequestBytes` 本地保险丝（或端点 HTTP 413）触发时，官方恢复链存在缺口：

| 官方机制 | 触发条件 | 缺口 |
|---|---|---|
| dsh-compaction-image-offload | 有图可卸时卸载图片重试 | 纯文本超限（"even without images"）不接管 |
| dsh-compaction-basic 溢出恢复 | 仅认 `CONTEXT_WINDOW_EXCEEDED` 错误码 | 本地字节保险丝是 `INVALID_REQUEST`，码不对 |
| 自动压力压缩 | token ≥ 模型窗口 × 阈值 | 大窗口模型（如 100 万 token）下字节先爆，整天不触发 |
| `compactNow()` | 要求 agent 处于 idle | 请求报错回调发生在活动轮内，必抛 `busy`（日志已捕获） |

本插件补上缺口：**字节超限 → 修剪 → 就地摘要 → 抛弃 → 透明重试**。

## 恢复阶梯

一次 `agent/request-error` 事件只走一级，成功后立刻 `{ kind: 'retry' }` 重试原请求；连续封顶 `maxAttempts`（默认 3），agent 回到 idle 清零。

1. **修剪**：`toolResultPruner.pruneSession()` 把 >8KB 的工具输出截成头 4KB + 尾 1KB。不调模型，毫秒级。
2. **就地摘要**：`compaction.compactRegion(start, end, agent, signal)` —— 活动轮可用的公开入口，把最旧一段交给 LLM 压成摘要节点。**不能**用 `compactNow()`，它走 `agent.runMaintenance()`，在活动轮必抛 busy。
3. **抛弃**（不调模型）：按 shadow-price 协议写 `compaction/prune` + `user/message` 覆盖，整段丢掉最旧的平衡区间，替换成一条 `source.kind: 'byte-guard-discard'` 的占位消息。第 2 级被确定性拒绝（摘要不比原文小 / 摘要调用自身撞字节闸）时，本次故障内不再重复烧模型，直接走这一级。压缩锁被占用时只放行原错误，不抛弃——否则会让进行中的压缩失败。
   占位消息**不用** `compact-checkpoint`：`@deepseek-ai/dsh-compaction` 的 invariant 会拒绝没有配对 `compaction/start` 的 checkpoint 替换，而伪造一档 `compaction/summary` 等于谎报一次模型调用。`user` 消息的 `source.kind` 是可扩展词汇，消费方对未知 kind 走 fall-through。

窗口口径：每轮丢最旧的 `discardRatio`（默认 25%），两端都吸附到 tool-call/result 配对平衡的切点；受保护头部（首条 system/developer 之前）与最近 `keepRecentNodes`（默认 20）条永不参与。

另挂 `compaction/summary-error`：摘要请求自身撞字节上限时修剪一次并让后端重试摘要（只有真剪掉内容才重试，防循环）。

## 装与改

- 生效副本：`~/.dsh/profiles/desktop/plugins/dsh-byte-guard-recovery/`，作为 `file:` 依赖挂在 profile `package.json`，由本目录 `cordis.patch.yml` 的 bundle 补丁插入 profile。
- 版本库副本：`config/desktop-profile/plugins/dsh-byte-guard-recovery/`（仓库里的模板留档，**不参与打包**，装机包里不含它）。
- 已安装的桌面端不会在启动时热更新可执行插件：改完 `index.js` 要重启应用，profile 里的插件才会重新加载。

## 自证

`tests/` 下三个用例直接打 profile 里的生效副本（路径写死），用仓库子模块的真实源码做校验面：

```bash
cd deepseek-harness   # 子模块，供测试 import 真实 session/token-meter/compaction 源码
~/Tools/bun/bin/bun run ../config/desktop-profile/plugins/dsh-byte-guard-recovery/tests/recovery-ladder.test.mjs
~/Tools/bun/bin/bun run ../config/desktop-profile/plugins/dsh-byte-guard-recovery/tests/real-surface-fold.test.mjs
~/Tools/bun/bin/bun run ../config/desktop-profile/plugins/dsh-byte-guard-recovery/tests/compaction-invariant.test.mjs
```

分别覆盖：阶梯与预算（修剪/摘要/抛弃/封顶/busy 不抛弃）、真实 `foldSurface` + 压力折叠接受抛弃对并保持表头与尾部、以及 `@deepseek-ai/dsh-compaction` 的 invariant 在提交前后与冷启动重放三种路径都不拒绝抛弃写入。

## 配置

全部可选，在用户 profile 的 `cordis.patch.yml` 覆盖整行 config：

```yaml
- id: byte-guard-recovery
  name: 'dsh-byte-guard-recovery'
  config:
    maxAttempts: 3        # 单次故障连续恢复尝试上限（1-10，默认 3）
    keepRecentNodes: 20   # 保护的最近表层节点数（4-200，默认 20）
    discardRatio: 0.25    # 每轮抛弃占可用区间的比例（0.05-0.9，默认 0.25）
    compact:
      enabled: true       # 关闭后跳过 LLM 摘要，只做修剪与抛弃（默认 true）
```

非法值回落默认值，不报错。

## 边界

- 单条不可分消息自身超 2MiB，或 system 提示词 + 工具 schema 本身就超限时，表层缩小无法修复（压缩引擎契约同样写明），只记日志并放行原错误。
- 可用区间为空（内容全在受保护头部或最近尾部）时记 `no discardable region` 并放行。
- 修剪与抛弃改的是模型可见的表层；完整原文保留在会话日志，回放、导出与审计不受影响。
- 抛弃是有损的：占位消息只告诉模型"这段被移除且不可得"，不承载内容。要保语义请优先用第 2 级摘要（`compact.enabled: true`）。
- 客户端不识别 `byte-guard-discard`，占位消息按普通用户气泡显示——被丢的内容在界面上看得见一条明确交代，不会被伪装成摘要。
- 与 image-offload 互补：有图场景它先卸图（base bundle 先注册），本插件接管纯文本场景。
