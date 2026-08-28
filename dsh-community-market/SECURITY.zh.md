# 安全策略

[English](SECURITY.md)

## 信任模型

目录响应是不可信远程数据。被目录收录、provider 徽章、仓库链接或显示在**可安装**中，都不代表安全审核、维护者身份验证、推荐或兼容性保证。

插件及其依赖树安装后会以用户权限作为本地代码运行。Market 不声称能够检查其中是否存在恶意行为。

## Package 操作边界

- 只有用户明确确认后才开始安装。
- 确认框展示 Host 解析出的 npm package、npm `latest` 稳定版本和当前 Profile。
- 不接受目录数据提供的命令、脚本、HTML、header、凭据或 package-manager argv。
- 自动安装要求唯一合法的 npm package 身份，并要求 npm 官方 `latest` manifest 声明合法的 `dsh.bundle.patch`。
- 来源提供的版本和验证结论不构成安装权限。
- Market package 修改只使用 `desktopPnpm.run(argv)`，同一时间只执行一个。
- Renderer 在安装时提交来源/条目身份，在卸载时提交 Desktop 返回的不透明 `bundleId`；执行时不能自行选择任意 package name。
- 已安装清单来自当前 Profile 的直接依赖，因此其他市场或 DSH CLI 安装的 package 也会显示。可移除的直接依赖只提供卸载；Market 不暴露启用或禁用操作。
- Market 不创建安装 receipt、安装专用快照、重试、清理或回滚。恢复统一由 Desktop 的三个健康启动 checkpoint 槽位负责。
- 修改成功后可以签发短时、一次性重启许可，但重启始终需要用户明确操作。
- **打开 DSH 终端**使用空 body，只负责打开 Desktop 终端，不会粘贴或执行界面中的命令。

这些规则限制操作权限和 package 身份，但不能让第三方插件变得安全。

## 目录来源

添加或选择来源是明确的本地操作。远程 manifest 不能自行启用、决定优先级、提供 adapter 代码或提供凭据。

生产环境来源请求仅允许 HTTPS 且不携带凭据，并限制重定向、超时、并发、解码后响应大小、条目数、嵌套和字符串长度。每次重定向和 DNS 目标都会检查 loopback、私有网络、link-local 和云 metadata 地址。JSON 必须先通过公开 Schema 再进入标准化。

同一时间只选择一个来源浏览。来源故障不会静默选择兜底、修改当前 Profile 或阻止 DSH Desktop 启动。

## 报告安全问题

请通过 [t4wefan@qq.com](mailto:t4wefan@qq.com) 私下报告可能的安全问题，并提供受影响版本或 commit、操作系统、复现步骤、预期影响，以及可安全分享的最小 proof of concept。

不要发送 secret 或个人数据，也不要为未修复漏洞创建公开 issue。普通 bug、目录修正和功能建议可以使用公开 issue tracker。
