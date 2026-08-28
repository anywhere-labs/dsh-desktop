# Community Market shell

[English](market-shell.md)

状态：已交付并内置于 DSH Desktop。

## 归属边界

`dsh-community-market` 负责目录来源设置、来源 adapter、标准化发现、Market Client 界面、npm latest preview 和 Profile package 操作编排。它不拥有 Profile 存储、pnpm 执行、恢复 checkpoint、终端窗口或重启实现。

## Runtime 形态

```text
目录来源 -> Host adapter -> 标准化目录 -> Market Client
                                |
                                +-> npm latest preview

Desktop Profile 清单 -> 已安装视图 -> 不透明 bundleId -> pnpm remove
```

Client 只接收标准化数据和不透明 operation 身份，永远不会获得 package-manager 能力。

## 来源行为

标准 cursor 来源和 dshfind 会被扫描为有界本地索引，搜索、分类筛选和可见分页使用该索引。

DSH 1024Store 的发现页对所有查询都使用 provider 当前的分页 v2 API，包括无筛选目录。单分类筛选直接转发；多分类 OR 筛选会合并有界的 provider 排序前缀，并使用本地不透明 cursor。“可安装”每批请求 200 条远程 registry 记录，并只保留该 page 里的直接 npm 目标；Client 通过下一枚不透明 cursor 继续加载，而不会在 Host 或 Renderer 中物化完整目录。

Provider 命令会被丢弃。经过审查的 1024Store adapter 只会解析一种严格的惰性命令形状来取得 npm package name，绝不会转发或执行该命令。来源可以提供目录身份，但不能提供可执行 argv、凭据、adapter 代码、来源选择或安装权限。

## 安装行为

可安装目录条目只贡献一个 npm package 身份。安装 preview 解析 npm 官方 `latest` manifest，并要求：

- npm package name 一致；
- 版本精确且稳定；以及
- `dsh.bundle.patch` 合法。

Preview 把这些事实、已经观察到的目录条目和当前 Profile 绑定到短时一次性 token。执行阶段只调用 `desktopPnpm.run(argv)`，保存精确版本并 reconcile `dsh.profile.bundles`。

Market 不再使用 receipt 或安装专用保护、恢复路径。来源版本、仓库匹配、lifecycle script、deprecated、engine 范围和 provider 验证徽章都不作为安装门槛。

## 已安装清单与卸载

Desktop 清单读取 Profile 的直接依赖和 bundle，因此会包含本 Market、其他市场和 DSH CLI 安装的插件。产品自有 bundle 只读；其他直接插件依赖获得当前 generation 有效的不透明 `bundleId`，并且只提供卸载。

Host 在 preview 前解析 `bundleId`，在执行前重新检查直接依赖。卸载使用 `desktopPnpm.run(['remove', packageName])` 并移除 bundle 引用。Market 不暴露启用或禁用。

## 故障边界

Desktop package 能力不可用时仍可浏览。来源故障不会阻止 Desktop 启动。Package 操作错误不会触发自动清理或回滚。Desktop 的三个健康启动 Profile checkpoint 是唯一恢复机制，恢复仍然是恢复页面中的显式操作。

## Headless 要求

合同生成、类型检查、单元测试、package build、export 验证和 Loader smoke test 都必须保持 headless-safe。测试不得启动 Electron 或图形应用。
