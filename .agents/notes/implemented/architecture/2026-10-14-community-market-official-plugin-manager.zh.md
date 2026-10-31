# Agent Note：Community Market 将 package 操作委托给官方插件管理器

状态：已实现

[English](2026-10-14-community-market-official-plugin-manager.md) | 中文

## 问题

`dsh-community-market` 原本自带一整套 package 操作生命周期：通过 Desktop 提供的 `desktopPnpm` 能力执行 `pnpm add` 和 `pnpm remove`，自己改写 `dsh.profile.bundles`，从 Desktop 提供的 `desktopPlugins` 能力读取“已安装”清单，并在每次修改后发放一次性重启令牌，再用弹窗要求用户重启 Desktop。此前的[安装生命周期说明](2026-08-19-desktop-plugin-install-lifecycle-ownership.zh.md)把这一生命周期放在 Desktop，是因为上游当时没有管理服务。

上游现在在每个 dsh Host 的 base bundle 中都提供了 `@deepseek-ai/dsh-plugin-manager`。它的 `pluginManager` 服务拥有 `installBundle`、`setBundleEnabled`、`removeBundle` 和 `listBundles`：校验 bundle、失败时恢复 profile manifest 和 lockfile、在 profile 锁下串行写入、选择 bundle，并通过同一 bundle 挂载的 HMR 模块实时应用改动。因此 Next 的 Profile 在插件变化后不再需要重启，而官方插件页面管理的正是 Market 列出的那些 bundle。同一生命周期的两套实现在清单形状、registry 策略、失败处理和激活方式上互相矛盾。

## 决定

Market 保留目录身份识别与校验，把所有 package 修改委托给官方管理器。

- Host 侧软注入 `pluginManager` 和 `profileContext`，不再注入 `desktopProfiles`、`desktopPnpm` 和 `desktopPlugins`。`MarketInstallService` 接受 `MarketPluginManager` 接口，上游服务在结构上满足它；测试提供内存实现。
- 安装 preview 仍解析 npm `latest` 或固定提交的 GitHub manifest，并把已校验目标绑定到一次性 intent。执行阶段调用 `installBundle(target, { enabled: true, saveExact: true })`，并回传管理器的 `application`：`applied`、`restart-required` 或 `overridden`。`failed` 或 `cancelled` 的变更转换为携带管理器有界 pnpm 输出的 Market 错误。
- “已安装”视图是 `listBundles` 中只保留社区插件的投影：profile 声明或选中的 bundle，去掉管理器标记为官方的 bundle、随安装包附带的 bundle、`@deepseek-ai` 作用域下的 package，以及 Desktop 内置 bundle（Desktop 自身的 package、两个市场和远控桥接），这些已由官方“插件”页面管理。`toggleable` 与 `removable` 由管理器的 `readOnlyReason`、`error` 和 `removable` 推导。卸载以 package name 寻址，并在 preview 前和执行前分别向管理器复核；启用和停用直接调用 `setBundleEnabled`，没有确认步骤。
- 重启令牌、重启路由、`requestRestart` Desktop 动作和完成弹窗全部移除。完成的变更以短暂横幅宣告；当管理器报告 `restart-required` 时，横幅说明该变更在下次重启后生效。
- 管理器在重载返回的瞬间判定激活结果，因此某行仍在等待所注入服务的 bundle（观察到的案例是等待 `webRuntime` 的 `dsh-better-sidebar`）即使随后就激活，也会被报告为失败。当管理器已保存选择时，无论来自安装还是开关，Market 都会在有限的宽限期内通过 `listPlugins` 重新读取这些行的实时状态，激活后即接受该变更；某行失败或宽限期结束则保留管理器的失败结果。该规则只读取管理器的结构化状态，不针对任何插件名。Market Client 只在挂载时初始化加载器，而不是随 `t` 的身份变化重新初始化，因为客户端插件注册或移除词典时，每个 slot 都会在触发它的那次开关操作进行中拿到新的 `t`。

Next 不再提供 `desktopPlugins`。它为 dshmarket 保留 `desktopProfiles` 和 `desktopPnpm`，为 Market 的手动兜底保留 `desktopActions.openTerminal`。Stable 和 Beta 仍然挂载各自的 `DesktopPluginsService`；Market 不再消费它，移除该服务是另行的清理工作。

## 影响

Market 可以在任何挂载 base bundle 的 dsh Host 中工作，包括纯 Web；没有管理器时仍可浏览。Registry 选择、回退、兼容性检查、构建脚本批准和失败恢复都遵循官方管理器的配置，而不是 Market 专属的 npm registry 固定值；精确的 `name@version` 目标保证安装身份与校验身份一致。`installations` 响应以及 preview、execute 响应的形状发生了变化；Market 的 Client 与 Host 一起发布，没有其他消费者读取它们。
