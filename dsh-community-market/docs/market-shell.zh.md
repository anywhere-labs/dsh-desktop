# Community Market shell

[English](market-shell.md)

状态：已交付并内置于 DSH Desktop。

## 归属边界

`dsh-community-market` 负责目录来源设置、来源 adapter、标准化发现、Market Client 界面、npm latest preview，以及每次 Profile package 操作外围的一次性确认。它不拥有 Profile 存储、package 执行、bundle 选择、实时应用、恢复 checkpoint 或终端窗口：package 操作属于官方 `pluginManager` 服务。

## Runtime 形态

```text
目录来源 -> Host adapter -> 标准化目录 -> Market Client
                                |
                                +-> npm latest preview

官方 pluginManager.listBundles -> 已安装视图 -> package name -> setBundleEnabled / removeBundle
```

Client 只接收标准化数据、package name 和一次性确认身份，永远不会获得 package-manager 能力。

## 来源行为

标准 cursor 来源和 dshfind 会被扫描为有界本地索引，搜索、分类筛选和可见分页使用该索引。

DSH 1024Store 的发现页对所有查询都使用 provider 当前的分页 v2 API，包括无筛选目录。单分类筛选直接转发；多分类 OR 筛选会合并有界的 provider 排序前缀，并使用本地不透明 cursor。“可安装”每批请求 200 条远程 registry 记录，并只保留该 page 里的直接 npm 目标；Client 通过下一枚不透明 cursor 继续加载，而不会在 Host 或 Renderer 中物化完整目录。

Provider 命令会被丢弃。经过审查的 1024Store adapter 只会解析一种严格的惰性命令形状来取得 npm package name，绝不会转发或执行该命令。来源可以提供目录身份，但不能提供可执行 argv、凭据、adapter 代码、来源选择或安装权限。

## 安装行为

可安装目录条目只贡献一个 npm package 身份。安装 preview 解析 npm 官方 `latest` manifest，并要求：

- npm package name 一致；
- 版本精确且稳定；以及
- `dsh.bundle.patch` 合法。

Preview 把这些事实、已经观察到的目录条目和当前 Profile 绑定到短时一次性 token。执行阶段只以精确的 `name@version` 目标调用官方管理器的 `installBundle`，保存精确版本并激活；管理器选中 bundle，并在运行 HMR 时实时应用。

除了管理器自身对 manifest 和 lockfile 的恢复，Market 不再使用 receipt 或安装专用保护、恢复路径。来源版本、仓库匹配、lifecycle script、deprecated、engine 范围和 provider 验证徽章都不作为安装门槛。

## 已安装清单、开关与卸载

清单是官方管理器的 bundle 列表中只保留社区插件的部分：Profile 声明或选中的 bundle，包括本 Market、其他市场和 DSH CLI 安装的插件，但去掉管理器标记为官方的 bundle、随安装包附带的 bundle、`@deepseek-ai` 作用域下的 package 和 Desktop 内置 bundle，它们由官方“插件”页面管理。管理器的 `readOnlyReason`、`error` 和 `removable` 标志决定列出的 bundle 可以启用、停用还是移除。

Host 在卸载 preview 前和执行前都会重新检查清单。启用和停用调用 `setBundleEnabled`；卸载调用 `removeBundle`，由它在 pnpm 移除前取消选中并卸载 bundle。

## 故障边界

官方管理器不可用时仍可浏览。来源故障不会阻止 Desktop 启动。Package 操作错误不会触发 Market 侧的清理或回滚：官方管理器恢复它快照过的 Profile manifest 和 lockfile，其余状态仍由 Desktop 的三个健康启动 Profile checkpoint 覆盖，恢复仍然是恢复页面中的显式操作。

## Headless 要求

合同生成、类型检查、单元测试、package build、export 验证和 Loader smoke test 都必须保持 headless-safe。测试不得启动 Electron 或图形应用。
