# DSH Community Market

[English](README.md)

DSH Community Market 是 [DSH Desktop](../README.md) 内置的开放插件市场。它从用户选择的目录来源发现插件，并针对当前 Desktop Profile 执行简单的 npm package 操作。

> 目录收录或显示为可安装，不代表安全审核、兼容性保证或推荐。插件安装后会以用户权限作为本地代码运行。

本包声明标准 `dsh.bundle.patch`。Desktop Next 在官方插件页中提供它，并支持分别启停 dshmarket 与 Agents Anywhere；Stable/Beta 保留现有市场选择方式。

## 产品行为

Market 包含四个视图：

1. **发现**：浏览当前来源，支持搜索、分类筛选、详情和来源归属信息。
2. **可安装**：显示能够提供唯一 npm package 身份的标准化条目，不信任来源提供的版本。
3. **已安装**：按官方插件管理器的报告列出当前 Profile 中的社区插件，包括本 Market、其他市场或 DSH CLI 安装的插件，并可以启用、停用或卸载。官方插件、随安装包附带的 bundle、DeepSeek 自己的 package，以及 Desktop 内置 bundle（`dsh-community-market`、`dshmarket`、`@agents-anywhere/dsh-bridge-next`）在官方“插件”页面管理，不在这里显示。
4. **来源**：保存、排序和选择目录来源；同一时间只选择一个来源浏览。

Renderer 在安装时不会提交 package name 或 package-manager 命令，只提交被选中的来源和条目身份。Host 再解析自己此前观察到的标准化 package 身份。

## 自动安装

自动安装只保留很小的一组资格条件：

- 当前目录条目提供且只提供一个合法 npm package name；
- 该 package 不是 Desktop 自己拥有的产品 bundle；
- npm 官方 registry 的 `latest` 接口返回相同 package name 和一个精确稳定版本；以及
- npm manifest 声明合法的 `dsh.bundle.patch` 路径。

来源版本、验证徽章、仓库是否一致、deprecated metadata、lifecycle script、engine 范围、tarball integrity metadata 和 build-allowance 声明，都不决定 Market 是否允许安装。pnpm 负责解析并安装用户确认的精确 npm 版本。

用户确认后，Host 以精确的 `name@version` 目标调用官方插件管理器的 `installBundle`，保存精确版本并激活。管理器负责校验 bundle、在安装失败时恢复 Profile manifest 和 lockfile、选中 bundle，并在 Host 运行 HMR 时实时应用。Market 自己不创建安装 receipt、快照、重试、清理或回滚路径。如果管理器报告仍需重启，Market 会在完成提示中说明，而不会弹窗要求重启。

## 启用、停用、卸载与其他市场兼容

**已安装**视图来自官方插件管理器的 bundle 列表，不依赖 Market receipt 或当前目录来源。因此，其他市场和 DSH CLI 安装的插件无需额外适配也能正确显示。该视图只列出社区插件：管理器标记为官方的 bundle、随安装包附带的 bundle、`@deepseek-ai` 作用域下的 package，以及 Desktop 内置 bundle 都交给官方“插件”页面。

启用和停用直接调用管理器的 `setBundleEnabled`，并保留已安装的依赖。卸载 preview 接受该列表中的 package name；Host 在 preview 前和执行前都通过管理器确认 bundle 仍可移除，然后调用 `removeBundle`，由它在 pnpm 移除前取消选中并卸载 bundle。管理器的 `readOnlyReason`、`error` 和 `removable` 标志决定列出的每个 bundle 提供哪些操作。

## 目录来源

任何人都可以发布符合公开 [`catalog-source`](docs/schemas/catalog-source.schema.json) 与 [`catalog-provider-page`](docs/schemas/catalog-provider-page.schema.json) 合同的来源；现有 API 也可以通过经过审查的本地 adapter 接入。远端数据会在 Client 看到前完成标准化，provider 命令永远不会被展示或执行。

[DSH 1024Store](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) 是可选合作来源。Desktop 使用当前分页的 `/api/v2/plugins` 目录完成浏览、搜索、排序和分类，不再依赖冻结在 500 条的 v1 兼容 feed。v2 命令绝不会被执行：只有严格匹配纯文本 `dsh plugin --profile … add <npm-package>` 的形状才会贡献 npm package 身份，安装 preview 仍以 npm `latest` 为版本权威。仅有 GitHub 目标的条目保持可浏览，但不会被标成可自动安装。

[dshfind](https://dshfind.com) 是另一个可选合作来源。它的 adapter 会遍历带版本的 REST 页面，并从结构化字段标准化 npm 身份，不执行 provider 命令。Provider 版本只作信息展示；自动安装仍然解析 npm `latest`。

来源请求仅允许 HTTPS，不携带凭据，具备边界限制，并防止不安全重定向和私有网络目标。来源故障不会改变用户选择，也不会阻止 DSH Desktop 启动。

## 手动安装

自动安装不可用时，详情弹窗可以显示 Host 根据标准化身份重建的、有界且只用于展示的 npm 命令。**打开 DSH 终端**只打开 Desktop 终端，不会粘贴或执行该命令。

如果自动安装已经开始但官方管理器报告失败，Market 会把管理器保留的有界 pnpm 输出写入 Desktop 日志，并在失败弹窗中显示同一份诊断输出。弹窗提供 Host 推导的精确命令和**打开 DSH 终端**，供用户手动继续；已经消费的确认不会被自动重试。

## 文档

- [安装与卸载](docs/install-and-uninstall.zh.md)
- [Market shell](docs/market-shell.zh.md)
- [目录提供方合同](docs/catalog-provider-contract.zh.md)
- [目录适配器指南](docs/catalog-adapter-guide.zh.md)
- [安全策略](SECURITY.zh.md)
- [Desktop 插件服务](../dsh-plugin-desktop/docs/plugin-services.zh.md)

## 许可证与归属

Package 代码和文档使用 [MIT License](LICENSE)。本 package 不内置任何第三方目录快照、provider 命令或 artwork；目录提供方是独立项目，并自行负责其 metadata 与服务策略。
