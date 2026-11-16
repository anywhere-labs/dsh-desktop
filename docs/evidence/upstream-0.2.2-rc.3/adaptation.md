# 0.2.2-rc.3 适配

官方 release：https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3

基线为已提交的 rc.2 适配与下载重试修复（814ba5a704）。上游 pin 单独提交为 47b71de581，目标源码 38a6a5c965aa99ab525161efb7cc5cf1fe62fced。Beta／Next 均升级 rc.3；Stable 保留 0.2.1-rc.3，Desktop 产品版本沿用 2.0.22；不引入 Tokens。

| 官方 release 条目 | 处理 |
|---|---|
| 实验性 DeepSeek 会话导入 | 直接采用官方 dsh-deepseek-chat-import，随安装提供，保持可选、默认关闭。沿用官方上传、转换、工作区选择与继续会话实现，不另写导入器。 |
| Windows 应用内更新失败／无法重开 | 不迁移官方更新器；继续维护 Desktop 自有更新通道及安装流程。 |

源码中的配套变化：目录选择新增 workspace.picker.directoryFlow，侧栏／工作区提供导入入口，日志导出遇到缺失附件记录 attachments-missing.txt；均使用官方实现。已有 Desktop 补丁逐包重新应用到 rc.3，前端接缝由生成器重新生成；不编辑 upstream 源码。版本隔离、恢复报告、下载重试等桌面修复保留。

## 验证

- 官方构建 10/10 检查通过，375 个固定源码运行包；upstream checkout 无源码改动。
- Beta／Next 完整 check 各 134 文件、1248 通过、10 跳过；包括类型、构建、前端、运行时隔离与 Node Host。
- 复用真实 Host smoke：导入插件默认关闭、启用后配置行 active、deepseekChatImport/limits 可访问、停用成功；保留混合版本 Profile、会话持久化、翻译配置及无 Tokens 回归。
- Beta／Next Electron Node Host smoke 通过；immutable 安装、variants、AA／市场 freshness 通过。
- 市场 328 项、共享 Stable 389 项、根布局与兼容性 136 项通过。
- Agents Anywhere 官方 main 更新至 4f5dcd2c35c8908e2f2d61f3b5e2c5e08cd90e5c，运行时 peers 对齐 rc.3；dshmarket 保持当前 latest 1.73.19。
- 未启动图形应用、未导入真实用户聊天记录、未执行 Windows 安装；上述测试不代替这些验收。

PR #1634 的跨平台 CI 补充暴露了 Office 技能包的解包配置漏项：现已把 Office 技能包和官方 macOS CUA provider 加入实际 asarUnpack，与 payload 审计及 Host 物理路径解析保持一致。目录选择补齐 workspace.picker.directoryFlow，保证导入页也使用 Desktop 原生选择器。窗口检查使用官方 sidebar-opener 标记，并按有效拖动区域验证点击能力，移除对旧全局 no-drag 样式的假设。两端相关单测、类型检查和本地完整无头窗口检查通过。

合并 PR 期间同步 master 的 AppImage 修复：将 /tmp 下的运行器目录只读绑定迁移至 rc.3 的 sandbox-local 补丁及生成器，保留主线新增的安装包回归检查。根布局／兼容性 138 项通过；AA 保留本次从更新的官方 main 构建且兼容 rc.3 的 artifact。
