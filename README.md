<p align="center"><img src="assets/fate-dev-banner.svg" alt="DSH Desktop · fate-dev 社区扩展：工作区、文件操作、Copilot 与 Logcat" width="100%"></p>

<h1 align="center">fate-dev DSH Desktop</h1>

<p align="center">基于 <a href="https://github.com/anywhere-labs/dsh-desktop">上游 DSH Desktop</a> 的社区扩展版本，面向代码工作区、文件审阅、Git 和 Android 调试场景。</p>

## 导航

- [对原项目的改动](#对原项目的改动)
- [所有效果图](#所有效果图)
- [本地 Profile 插件](#本地-profile-插件)
- [下载链接](#下载链接)
- [代码改动记录 / Release Note](#代码改动记录--release-note)
- [安全与隐私](#安全与隐私)

## 对原项目的改动

每个功能一句话总结：

| 功能 | 一句话总结 |
| --- | --- |
| 多目录工作区 | 在一个会话中管理主目录和多个附加代码目录，切换文件浏览根目录不会改变 Agent 会话上下文。 |
| 文件树快捷操作 | 从文件树直接定位系统文件管理器、用 VS Code 打开、复制路径，或把文件/目录作为结构化引用插入对话。 |
| Git Review | 按当前会话查看已提交变更，并在多个已授权工作区根之间切换审阅目录。 |
| 可编辑 Git 工作区 | 在桌面端进行 Git 工作区相关操作，并将 Git 面板与代码审阅目录保持独立。 |
| GitHub Copilot | 使用 GitHub 设备码登录，并在模型选择器中使用可用的 Copilot 模型。 |
| Android Logcat | 通过 adb 选择设备，按进程、Tag、排除 Tag 或消息正则过滤实时日志，并支持暂停、复制、导出和设备截图。 |
| 会话与文件安全 | 文件引用使用结构化路径，README 与审阅截图不包含 Session、记忆数据库、凭据或访问令牌。 |

## 本地 Profile 插件

下面是本机 `desktop` Profile 当前安装并启用的第三方插件；版本号来自本地 Profile manifest。

| 插件 | 版本 | 用途 |
| --- | ---: | --- |
| `@michengai/dsh-archive-manager` | 1.0.16 | 归档管理 |
| `@michengai/dsh-automation` | 0.1.61 | 自动化任务 |
| `@michengai/dsh-btw` | 0.1.18 | BTW 扩展 |
| `@michengai/dsh-skills-manager` | 1.1.13 | Skills 管理 |
| `@smalltailqwq/dsh-client-ui-skin-maid-atelier` | 0.1.7 | 客户端主题 |
| `@wxg-prc-cpg/browser-skill-dsh-plugin` | 0.3.2 | 浏览器自动化技能 |
| `billion-context` | 0.1.181 | 上下文增强 |
| `dsh-dream-skin` | 10.10.0 | 界面主题 |
| `dsh-ffmpeg` | 0.4.5 | 音视频处理 |
| `dsh-figma-mcp` | 0.6.0 | Figma MCP 集成 |
| `dsh-file-review` | 0.8.8 | 文件审阅 |
| `dsh-ide-git` | 0.16.3 | Git 面板 |
| `dsh-image-viewer` | 0.1.9 | 图片查看 |
| `dsh-prompt` | 0.4.9 | Prompt 工具 |
| `dsh-rewind-plugin` | 0.15.3 | 会话回退 |
| `dsh-session-recycle-bin` | 0.4.3 | 会话回收站 |
| `meow-memory` | 0.31.0 | 跨会话记忆 |

## 下载链接

当前 Release 只保留 Stable 通道：

| 版本 | Debian / Ubuntu |
| --- | --- |
| Stable 2.0.17 | [下载 `.deb`](https://github.com/FateFeng/dsh-desktop/releases/download/v2.0.17-fate-dev/DSH-Desktop-2.0.17-amd64.deb) |

本项目后续不再分发 AppImage，仅维护可验证的 Debian / Ubuntu Stable 安装包。

- Release 页面：<https://github.com/FateFeng/dsh-desktop/releases/tag/v2.0.17-fate-dev>
- Debian SHA-256：`2915f6ed9be7beddf42159c9553f1d1473f99b06982e663fa3236356f2a28479`
- 当前已验证 `.deb` 资产大小：242,430,032 bytes。

## 代码改动记录 / Release Note

### 2.0.17-fate-dev

- `5fced936e9`：将 Git Review worktree 合并到 `fate-dev`。
- `f7c3d06b81`：新增按会话隔离的 Git Review，并支持附加工作区根。
- `97291e91c9`：接入可编辑 Git 工作区工具。
- `70962df847`：修复在光标位置插入文件引用。
- `91efd87d8d`：要求 Assistant 输出绝对文件路径。
- `6458eff142`：保存 workspace sources，并整合 Desktop workspace 功能。
- `7300dd918c`：新增文件树上下文菜单快捷操作。
- `de3b76afbc`：加入 GitHub Copilot provider 支持与 Android Logcat 过滤记忆。
- `b125d0203d`：更新 Desktop 版本至 `2.0.17`。
- `9765a12e67`：补充 README、Git Review 效果图、插件清单与 Stable 下载说明。

## 安全与隐私

- README 截图中的本地路径、仓库细节和个人信息已脱敏。
- 文档只记录插件包名和版本，不记录本机目录、账号、Session 内容或插件配置。
- 发布前应继续检查新增截图和构建产物，避免把本地 Session、记忆数据库、凭据或访问令牌放入仓库或 Release。

## 所有效果图

### 多目录工作区

<p align="center"><img src="assets/readme/workspace.png" alt="在文件浏览器中切换主目录和附加目录" width="78%"></p>

### 文件树快捷操作

<p align="center"><img src="assets/readme/files-shortcuts.png" alt="文件树项目的快捷操作菜单" width="28%"></p>

### Git Review 与代码审阅

<table>
  <tr>
    <td width="43%"><img src="assets/readme/code-review.png" alt="代码审阅目录与多工作区根选择" width="100%"></td>
    <td width="57%"><img src="assets/readme/git-review.png" alt="Git Review 变更列表与提交图" width="100%"></td>
  </tr>
</table>

### GitHub Copilot

<p align="center"><img src="assets/readme/copilot.png" alt="GitHub Copilot 连接状态与可用模型" width="58%"></p>

### Android Logcat

<p align="center"><img src="assets/readme/android-logcat.png" alt="Android Logcat 设备选择与日志过滤面板" width="88%"></p>

<p align="center"><sub>原始界面截图位于 <a href="dsh-plugin-desktop/docs/screenshots/">dsh-plugin-desktop/docs/screenshots/</a>。</sub></p>
