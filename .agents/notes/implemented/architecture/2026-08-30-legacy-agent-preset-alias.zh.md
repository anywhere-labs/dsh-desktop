# Agent Note: 为运行时重命名前持久化的会话提供旧版 agent preset 别名

Status: implemented

[English](2026-08-30-legacy-agent-preset-alias.md) | 中文

## 问题

上游在 0.1.2-alpha.1 中把 PTC agent preset 从 `code` 改名为 `ptc`,并且按照其重命名 Agent Note 记录的 pre-release 策略,不提供任何兼容别名。但会话会在自己的 header 与 `agentPreset` projection 中持久化创建时的 preset id,而桌面更新只会替换随包的 preset 名册,不会触碰会话存储。在 runtime 0.1.1-rc.2(Desktop ≤ 2.0.3)上以 `code` 预设创建的会话,升级到 Desktop 2.0.4 后全部无法恢复:提交提示词会触发会话恢复,恢复流程拿持久化的 id 去查改名后的名册,客户端随即报出 `resume failed for session "…": agent-presets: preset "code" not found (available: standard, ptc, minimal, cordis)`。会话历史本身完好,只有挂载被拒。该问题由 GitHub issue #727 报告。

## 决策

桌面启动器选择物化兼容 preset,而不是改写会话存储。`agent-preset-compat` 维护旧 id 到替代它的随包 preset 的映射(`code → ptc`),并在每次 profile 准备时把随包 preset 原样复制到 `<profileDir>/agent-preset-compat/<legacyId>/`,只改写展示元数据——名称追加 `（兼容）` 后缀,描述注明旧 id。每次准备都会从随包 preset 重新复制,别名随固定版本的运行时组合保持同步。

`agent-presets` 行配置接管 harness home 的用户 root(`includeUserRoot: false`,改为显式配置),并把名册排序为 随包 → 用户 → 别名,因此别名只提供随包名册和本地自建 preset 都无法提供的 id——在旧 id 下自建过 preset 的用户继续挂载自己的组合,别名绝不会遮蔽它。

考虑过的替代方案:

- **启动时改写持久化的会话 header 与 projection** —— 拒绝:桌面将不得不在上游 `SESSION_FORMAT_VERSION` v0→v1 迁移落地之前自行做会话日志手术,而一次部分失败或中断的改写会损坏本完好的历史。
- **持久化 id 未知时回退到默认 preset** —— 拒绝:会话一旦产生历史,其组合即被固定;悄悄挂载不同组合会改变模型看到的工具 schema 与 prompt 分节。
- **等待上游提供别名或迁移** —— 拒绝:重命名把全部会话持久化词汇推迟到被格式版本迁移阻塞的 stacked persistence PR,而用户的会话现在就无法恢复。

## 后果

改名前创建的会话可以恢复,并继续运行它一直使用的组合,界面上也继续显示其持久化的 `code` id。新会话继续选择 `ptc`;preset 选择器会多出一个以随包 preset 命名、带 `（兼容）` 后缀的条目。若运行时重新提供 `code`(或不再提供 `ptc`),则不会物化任何内容,兼容 root 也完全不会配置。别名的 trust 为 `system`,因为它由启动器依据随包名册生成,而非用户手写;用户在 harness home 中以旧 id 自建的 preset 仍然优先于它。
