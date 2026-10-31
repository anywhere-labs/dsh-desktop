# 稳定版向 Next 过渡

稳定版会提示：计划在下个版本发布后，用 Next 取代当前稳定版。用户点击**不再提醒**后停止提示；点击**知道了**、关闭弹窗或按 Escape 时，下次启动应用仍提示一次。不再提醒是独立按钮而非勾选框：macOS 上弹窗的勾选框无法勾选，导致提示每次都出现（#1418）。选择保存在 Electron 用户数据目录的 `notices/next-transition-v1`，不依赖 Profile 或安装版本。稳定版开发环境（`corepack yarn dev`）也显示此提示；Beta 和 Next 不显示。

## 发布接替版本

稳定版继续请求 `X-DSH-Desktop-Channel: stable`。准备好向稳定版用户发布接替版本时，通过该更新流发布版本，例如：

```json
{ "version": "2.0.20-next", "channel": "stable" }
```

继续兼容不带渠道标记的稳定版响应。稳定版仍拒绝明确标为 `next` 的响应，不将用户切到实验性 Next 更新源。同时支持 `-next` 和 `-next.N` 版本。普通稳定版本继续有效，稳定更新流仍拒绝 Beta、RC 等版本。

接替版本必须按 SemVer 比已安装版本更新。例如，`2.0.20-next` 不能升级 `2.0.20`，应使用更高的主版本、次版本或修订号。不启用自动降级。

对应的 macOS、Windows 下载接口必须针对 `channel=stable` 和精确的 `X-DSH-Desktop-Target-Version` 返回已发布的接替安装包。版本信息与安装包发布应保持一致；提供 SHA-256 时继续强制校验。用户确认下载后，客户端再次检查 stable 更新流，目标变化时停止下载。下载和启动安装包仍须用户确认。

Next 安装包使用 `DSH-NEXT` 文件名，下载确认说明 DSH NEXT 将作为独立应用安装；macOS 提示用户添加并打开 DSH NEXT。此次修改不重命名应用、不更改应用身份，也不实现数据迁移。Next 自身仍使用 `next` 更新渠道。
