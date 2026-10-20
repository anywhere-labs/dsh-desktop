# 安装与卸载

[English](install-and-uninstall.md)

本文说明 DSH Community Market 的 package 操作边界。

## 视图

| 视图 | 事实来源 | 可用操作 |
| --- | --- | --- |
| 发现 | 当前目录来源的标准化数据 | 查看详情并请求安装 preview |
| 可安装 | 提供唯一 npm package 身份的目录条目 | 请求安装 preview |
| 已安装 | 官方插件管理器为当前 Profile 提供的 bundle 列表，只保留社区插件 | 启用、停用或卸载列出的 bundle；官方插件和 Desktop 内置 bundle 不列出 |
| 来源 | 用户拥有的目录来源设置 | 添加、选择、排序和移除来源 |

已安装状态与当前目录来源无关，也与最初由哪个市场安装无关。

## 安装流程

1. 用户选择目录条目，Renderer 只发送 `sourceRecordId` 和 `itemId`。
2. Host 解析自己此前观察到的标准化 npm package 身份。
3. Host 请求 `https://registry.npmjs.org/<package>/latest`，要求返回相同 package name、精确稳定版本和合法的 `dsh.bundle.patch` 声明。
4. 确认框展示 package、精确版本、当前 Profile 和 preview 过期时间。
5. 用户确认后，Host 消费一次性 `previewId`，以精确的 `name@version` 目标调用官方插件管理器的 `installBundle`，保存精确版本并激活。
6. 管理器校验 bundle，把它写入 `dsh.profile.bundles`，并在 Host 运行 HMR 时实时应用。Host 确认管理器报告的 bundle 与已校验的 package 一致。管理器已安装并选中、但在其行激活前就做出判定的 bundle，适用[启用、停用与卸载](#启用停用与卸载)一节描述的激活宽限期。

来源列出的版本永远不会成为安装目标。仓库是否一致、deprecated metadata、lifecycle script、engine 范围、integrity metadata 和 provider 验证标记都不会阻止操作；provider 命令字符串会被丢弃。

Market 安装不会创建自己的 receipt、checkpoint、重试、清理或回滚 operation。失败或取消的安装由管理器恢复 Profile manifest 和 lockfile；其余状态由 Desktop 普通的 Profile checkpoint 统一覆盖。

## 自动安装条件

目录条目只有满足以下条件才能进入自动安装 preview：

- 条目能标准化出且只标准化出一个合法 npm package name；
- package 不是 `dsh-plugin-desktop`、`dsh-plugin-desktop-beta` 或 `dsh-community-market`；
- npm `latest` 对同一 package 返回精确稳定版本；以及
- npm manifest 声明安全的相对 DSH bundle patch 路径。

失败时条目仍可浏览，也可以显示只用于展示的手动命令。

## 启用、停用与卸载

1. Host 通过官方插件管理器的 `listBundles` 读取当前 Profile 的 bundle。
2. Profile 声明或选中的社区 bundle 会出现在“已安装”视图。管理器标记为官方的 bundle、随安装包附带的 bundle、`@deepseek-ai` 作用域下的 package，以及 Desktop 内置 bundle（`dsh-community-market`、`dshmarket`、`@agents-anywhere/dsh-bridge-next` 和 Desktop 自身的 package）在官方“插件”页面管理，不会列出。列出的 bundle 在管理器未报告 `readOnlyReason`、且能加载或当前已选中时可以启用或停用；管理器标记为 `removable` 时可以卸载。
3. 启用和停用提交 package name 和目标状态。Host 重新检查清单后调用 `setBundleEnabled`，依赖保持已安装。管理器在重载返回的瞬间判定激活结果，因此仍在等待所注入服务的行即使随后就激活，也会被报告为失败；当选择已经保存时，Host 会在最多五秒内重新读取这些行的实时状态，启用的 bundle 所有行都激活、或停用的 bundle 不再有存活行时即接受该变更。某行失败，或期限结束时仍在等待，则保留管理器的失败结果。
4. 卸载只提交 package name。Host 重新检查清单并返回一次性确认，执行时再次检查，然后调用 `removeBundle`，由它在 pnpm 移除前取消选中并卸载 bundle。

无论插件由 Community Market、其他插件市场还是 DSH CLI 安装，都使用同一流程。

## 手动兜底

自动 preview 不可用时，Host 可以根据标准化身份构造一条有界且只用于展示的 npm 命令。**打开 DSH 终端**只打开终端，不会提交 package 命令、路径或 Profile，也不会执行修改。

## 失败行为

| 故障 | 结果 |
| --- | --- |
| 无法解析 npm latest，或它不是稳定 DSH 插件 | 不启动 package 操作 |
| Preview 后 Profile 发生变化 | 拒绝一次性 preview |
| 管理器报告变更失败或被取消 | 报告错误并附带管理器保留的有界 pnpm 输出；管理器已恢复它快照过的 Profile 文件 |
| 管理器安装的 bundle 与已校验 package 不一致 | 报告错误供诊断；已安装的依赖仍显示在“已安装”视图中 |

package 运行失败时，Host 把管理器保留的有界 pnpm 输出写入 Desktop 日志，并返回给本地失败弹窗。弹窗显示已验证 package 对应的命令，也可以打开 DSH 终端，但不会粘贴、执行或静默重试该命令。
| 用户确认后 Renderer 关闭 | Host 持有的 package 操作继续，仅可能丢失响应 |

修改成功后，Host 运行 HMR 时改动会实时生效。管理器报告 `restart-required` 时，完成提示会说明改动在下次重启后生效；Market 永远不会重启 Desktop。
