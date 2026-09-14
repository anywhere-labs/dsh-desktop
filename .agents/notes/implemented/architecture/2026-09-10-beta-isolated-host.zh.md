# Beta 独立 Host 进程实验

状态：Beta 默认启用的实验；稳定版保持原样。

2026-09-10：按用户要求推广到稳定版。两版默认使用相同的独立 Host 与顶栏架构，保留各自的发布身份。下文中的原生验证限制仍然适用。
[English](2026-09-10-beta-isolated-host.md) | 中文

## 运行边界

Beta 默认在 Electron utility process 中启动 Cordis Host。主进程继续管理窗口、原生菜单、对话框、更新网络请求及系统保护的证书访问。现有 Web 服务、认证、HTTP/WebSocket 通信、客户端插件装配和 Desktop 前端视觉保留原有职责。聊天请求和模型输出不经过新增的控制通道。

启用 AA 时，AA Host 服务随 Cordis 移动；Python Connector 仍使用原有子进程。此改动隔离 Host 与 Electron 的事件循环，并不修复 Host 慢任务、AA 兼容性或插件清单的包解析错误。

私有控制通道只传递原生操作和状态快照。函数保留在所属进程，以回调 ID 调用。启动环境保留各层来源信息。Host 日志位于 Beta 用户数据目录的 `logs/host`。更新请求仍使用原来的 Electron 适配器，取消信号跨进程传递；交互对话框和下载不受普通 RPC 超时限制。

## 本地尝试

在本 worktree 安装锁定依赖并构建 Beta：

```sh
corepack yarn install --immutable
corepack yarn workspace dsh-plugin-desktop-beta build
corepack yarn workspace dsh-plugin-desktop-beta prepare:electron-native
corepack yarn workspace dsh-plugin-desktop-beta start
```

Yarn 脚本同时适用于 Windows 和 macOS。请先退出已有 Beta。设置 `DSH_DESKTOP_ISOLATED_HOST=0` 可回退到原有同进程路径进行对比。不要让两个实例同时使用同一 Profile。

## 验证与推广

Headless 测试覆盖双向原生调用、取消、环境来源、窗口与托盘回调、退出管理，以及真实 Node 子进程中的 DSH Web Profile 启动。真实进程夹具将 Node IPC 适配为 utility-process 的端口接口，不验证 Electron utility process 或系统打包行为。它验证不同 PID、认证、第三方客户端插件条目及其脚本下载，以及 Web 服务正常关闭。

推广到稳定版前，需要验证 Windows/macOS 安装包的 utility process、ASAR 路径与原生模块；各模式窗口材质和控制；设置、托盘刷新与 Profile 切换；LAN 证书；Host 崩溃/卡死和退出；AA 启动与大量历史同步；浏览器中的插件实际激活与 HMR。还要确认退出后没有残留 Connector/工具子进程。未测量前不能宣称已改善 Windows 响应。

Host 意外退出时报告错误，不自动重启或重放请求。退出先请求正常清理，再终止无响应子进程并限时等待退出；若无法确认终止，恢复操作继续受保护。当前夹具未证明强制终止时任意插件后代进程的清理。

实验阶段独立启动器暂时保留了与原启动器对应的实现。推广到稳定版前应统一两条启动实现，避免生命周期逻辑分叉。截图里的请求扩展清单错误仍需要单独的打包布局回归测试与修复。

## 原生顶栏隔离

macOS 和 Windows 的兼容模式与扩展模式都将打包的顶栏放在独立、沙箱化的 WebContentsView 中。DSH 内容从 36px 原生边界下方开始，内容文档不再额外预留高度或挂载 Portal 顶栏。前端插件的 DOM、CSS 和插槽无法访问顶栏文档。这是前端边界，不是任意高权限 Host 代码的安全沙箱。macOS 增强模式为主面板与右侧面板预留完整的 32px 拖拽条高度，保留侧栏原有间距。原生界面仍需手动验证。
