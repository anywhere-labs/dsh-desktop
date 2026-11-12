# 恢复助手与启动报错修复

## 已定位的问题

- 主进程弹窗来自 createWindow 的 console-message 回调：恢复模式销毁窗口后，延迟到达的日志事件仍读取 window.webContents.id，触发 Object has been destroyed。改为窗口创建时保存 ID，晚到的错误仍记日志，回调不再访问已销毁的原生对象。
- 旧工作区误从 Tokens 功能分支起步，Next 仍用 0.2.1-rc.5。其前端把未激活的可选翻译插件视为致命启动错误，连续重载后进入恢复模式。最初回移 activation audit 只解除了前端阻断，未解决下述 Host 依赖链。
- 用户 next-111 Profile 安装过 rc.1 CUA bundle，其 node_modules 中另一版本的 dsh-storage-domain 优先于桌面随附包，因 storage peer 精确版本不符被官方兼容性检查停用。workspace、sessionController 和 cotTranslation 随后等待缺失依赖，表现为“暂无会话”和翻译设置错误。这是桌面组合的版本隔离缺陷，不能归结为正常内核升级必然失败，也不是会话数据丢失。

## 当前修复

- 已从 master 233b76c65d2a83a777a96419d798cb5582acb8f7 重建分支 codex/upstream-rc2-from-master。Desktop 版本保持主线 2.0.22，Beta／Next 均为官方运行时 0.2.2-rc.2，直接使用其可选／必需插件启动诊断，不迁入旧前端回移补丁。
- dsh-app-boot 补丁统一模块解析与兼容性检查的包选择。仅对安装表属于 Next／Beta 的启动，应用随附的官方 DSH／Cordis 家族包优先使用安装版本。ESM、CommonJS 和 Worker 共用安装表；普通 CLI 保留官方规则。未随应用提供的包仍执行原有解析及兼容性检查，不增加 allow-version 豁免。
- 核心版本隔离不删除 Profile 中的冲突包。保留 master 已有的过期按需 bundle 清理，以及退役 Team／Worktree bundle 的备份迁移；不清理用户会话数据。
- 启动完成前确认 storageDomain、workspaceRegistry、sessionController 可用；缺失时进入恢复流程并保留日志，避免把服务故障显示成“暂无会话”。
- 新分支没有 Tokens 功能提交、源码、workspace 或加载入口。旧工作区成果保存在 backup/upstream-adaptation-before-master（5ffe9d6469），用于恢复和对照。

## 恢复助手显示

- 顶部显示两行摘要、失败阶段和 Profile 信息。
- “完整错误与日志”默认折叠；展开显示故障时间、版本、运行 ID、原始错误及 cause 链、故障前日志、重试与插件加载警告，支持复制。
- 进入恢复模式时冻结详情，后续操作失败不覆盖原始现场；磁盘报告保存失败时仍可查看内存详情。
- 故障报告只附本次运行日志，历史记录保留在诊断导出中。console 日志包含来源文件与行号，可选插件启动警告不依赖开发者日志开关。
- 保留密钥脱敏和长度限制，详情按纯文本显示。共享恢复页面同时服务 Stable。

## 验证

复用现有真实 Host smoke，不新增独立测试文件：临时 Profile 放入不兼容 storage-domain 99.0.0；核心服务必须 active，冲突包保持原样。实际创建工作区和会话、停止 Host、重新启动并读取；启用官方翻译 bundle 后调用 cotTranslation/limits；确认没有 Tokens 插件；主动停用核心存储时必须返回明确错误。

Beta／Next 的 Node 与 Electron Node 模式均通过上述回归。两端完整 check 各 134 文件、1243 通过、10 跳过；共享 Stable 测试 35 文件、389 通过。覆盖销毁后 console 事件、摘要／折叠详情、冻结与脱敏及历史日志隔离。所有运行使用临时 home；没有启动图形应用、执行翻译请求或修改真实用户 Profile。未声称已在真实用户 Profile 上完成升级验收。
