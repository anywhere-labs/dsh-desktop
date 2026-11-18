# Agents Anywhere ACP Bridge for DSH

[English](README.md)

让 Zed 等支持 [Agent Client Protocol](https://agentclientprotocol.com)（ACP）的编辑器和脚本，直接使用正在运行的 DeepSeek Harness（DSH）。

这是一个 DSH 插件，以 npm 包 `@agents-anywhere/dsh-acp-bridge` 发布。它运行在 DSH 进程里，和 DSH Desktop 使用同一套会话：在编辑器里开始的对话会出现在 DSH Desktop 的侧边栏，DSH 里已有的对话也可以在编辑器里继续。它不另外启动 DSH，不需要单独的 profile，也不需要登录 Agents Anywhere。

## 可以做什么

- 新建 DSH 会话，或打开 DSH 里已有的会话并显示历史；同一个会话可以同时在 DSH Desktop、Agents Anywhere 和多个编辑器里使用，任何一边发的消息其他各边都会实时看到。
- 回复和思考过程逐字显示；工具调用显示为卡片：文件修改带差异，命令带输出和退出码，读取文件可以点开对应位置。
- 选择模型、推理强度和权限；新会话在发送第一条消息前可以选择 Agent 模式；会话开始后可以开关计划模式。DSH 提供智能体团队时，模型菜单里的「启用智能体团队协作」也可以随时开关。
- DSH 请求批准操作时，编辑器里出现「允许一次 / 拒绝」；Agent 用 `ask_user_question` 提问时，编辑器里出现表单，不支持表单的编辑器里出现选项列表。在 DSH Desktop 里也可以回答，先回答的生效。编辑器打开会话时 DSH 已经在等的审批或提问，也会出现在编辑器里。
- Agent 的待办清单显示为编辑器里的计划，并随进度更新。
- 输入 `/` 使用 DSH 注册的命令和可直接调用的技能。
- 发送文字、图片（PNG、JPEG、WebP、GIF）、文件链接、编辑器附带的选中内容和其他文件（和在 DSH Desktop 里添加的文件一样上传到 DSH）；随时取消正在执行的任务。
- 回复还没结束也可以继续发：和在 DSH Desktop 里回复期间按回车一样，后发的消息在 DSH 队列里等待，前一条结束后各自单独执行一轮。
- Agent 把工作交给子 Agent 时，编辑器里的这次请求会一直等到子 Agent 都完成、Agent 也回复了它们的结果才结束，和官方的 DSH ACP Agent 一样。
- 在编辑器的历史里删除会话：DSH 会把它归档，之后可以在 DSH 里恢复。支持复制会话（fork）的编辑器可以在会话的副本上继续，副本在 DSH 里是一个独立的会话。
- 编辑器里配置的 MCP 服务器（stdio 和 HTTP）会挂到会话上，工具只属于这个会话，和官方的 DSH ACP Agent 一样；DSH 自己配置的 MCP 服务器在编辑器的会话里同样能用。

## 安装

DSH 需要 0.2.2 版本线（`>=0.2.2-rc.1 <0.3.0-0`），自动化检查只覆盖 0.2.2-rc.4。

- **DeepSeek Harness Desktop**：在左侧边栏打开「插件」→「添加插件」，填入包名 `@agents-anywhere/dsh-acp-bridge` 并安装，启用后重启。
- **命令行安装的 DSH**：以 `desktop` profile 为例：

  ```bash
  dsh plugin --profile desktop add @agents-anywhere/dsh-acp-bridge
  ```

DSH 加载插件后，会在本机写入一个启动脚本：

| 系统 | 启动脚本 |
| --- | --- |
| macOS、Linux | `~/.agents-anywhere/dsh-acp/bin/dsh-acp` |
| Windows | `%USERPROFILE%\.agents-anywhere\dsh-acp\bin\dsh-acp.cmd` |

启动脚本使用 DSH 自带的 Node.js 运行环境（DSH Desktop 也是），电脑上不需要另外安装 Node.js。DSH 每次加载插件都会重写它，DSH 升级或移动位置后不用手动修改。

## 在 Zed 中使用

在 Zed 的 `settings.json` 里添加一个外部 Agent，`command` 写启动脚本的完整路径（Zed 不展开 `~`）：

```json
{
  "agent_servers": {
    "DSH": {
      "type": "custom",
      "command": "/Users/you/.agents-anywhere/dsh-acp/bin/dsh-acp",
      "args": []
    }
  }
}
```

然后在 Zed 的 Agent 面板里选择「DSH」开始对话。其他 ACP 客户端同样把启动脚本配置为 Agent 命令即可。

使用时 DSH 必须在运行。DSH 没有运行时，启动脚本会立即退出并提示原因；退出 DSH 或卸载插件后，编辑器里的连接会断开，重新打开对话即可。

## 排查问题

启动脚本可以直接在终端运行：

```bash
~/.agents-anywhere/dsh-acp/bin/dsh-acp --check
```

`--check` 连接正在运行的 DSH，打印 DSH 版本、插件版本，以及审批和提问是否已经接通；`--list` 列出可以连接的 DSH；同时运行多个 DSH 时，默认连接最后启动的那个，可以用 `--instance <实例 ID>` 指定。设置环境变量 `DSH_ACP_DEBUG=1` 后，连接过程的诊断信息会写到标准错误输出。

插件自身的日志在 DSH 的日志里，以 `acp-bridge` 开头。

## 使用说明与限制

- 新会话在发送第一条消息时才在 DSH 中创建，并归入工作目录对应的工作区；只打开编辑器面板不会留下空会话。
- 编辑器声明的 MCP 服务器在新会话发送第一条消息时、或打开已有会话时启动，编辑器关闭会话或断开连接后停止；有服务器没能启动时，这条消息或打开会话的操作会报错并给出服务器名。stdio 服务器的命令必须写绝对路径，在会话的工作目录里运行；不支持已经弃用的 SSE 传输。
- 会话是共享的：编辑器连着时，从 DSH Desktop 或其他客户端发给这个会话的消息也能用它声明的 MCP 工具。几个客户端声明同一个服务器（名称和配置都相同）时共用一个连接；一个会话里不能同时有两个同名但配置不同的服务器，后打开会话的客户端会收到错误。和 DSH 配置的服务器重名时，这个会话里用编辑器声明的那个。挂上或卸下服务器会改变会话的工具列表，之后的第一轮不能复用之前的缓存。
- 不支持音频输入。编辑器能否附带图片，在连接时按 DSH 的默认模型（新会话使用的模型）决定，之后不再变化：默认模型支持图片输入，才告诉编辑器可以发图片；在会话里换成别的模型不影响这一点。修改默认模型后，要重新连接编辑器。每条消息发送时，再按会话当前的模型检查：当前模型不支持图片输入时，带图片的消息直接报错，DSH 不会创建会话，也收不到这条消息；模型没有声明能接受哪些输入时交给 DSH 决定，和在 DSH Desktop 里一样会接收图片。
- 打开已有会话时只回放最近 1000 条消息，更早的历史请在 DSH 中查看。
- 编辑器关闭会话或断开连接时，会取消由它发起、还没结束的任务，并撤回它排队的消息；DSH Desktop 或其他客户端发起的任务不受影响。
- 在编辑器里删除会话时，先取消编辑器自己在这个会话里的任务；DSH Desktop 或其他客户端还在运行的会话，不能在编辑器里删除。
- 编辑器的请求在等子 Agent 时，Agent 在这个会话里做的事都算这次请求的，包括回复从 DSH Desktop 发来的消息。在编辑器里取消会立即返回，子 Agent 继续运行，和在 DSH Desktop 里点停止一样；关闭编辑器也不会停止它们。
- 子 Agent 不会向人请求审批或提问：DSH 派出子 Agent 时把审批策略固定为 `never`，它需要审批的操作会被当场拒绝，在子 Agent 里调用 `ask_user_question` 也会报错，DSH Desktop 里同样看不到。只有会话权限是 `danger-full-access`（或实验性的 `auto`）时子 Agent 才会沿用，所以要在 Agent 派出子 Agent 之前选好权限。
- 回复进行中能不能继续发消息，取决于编辑器；插件声明了编辑器用来判断这一点的 `promptQueueing` 标记。前面的回复被取消或失败时，编辑器排在后面的消息会被撤回，需要重新发送，因为这种情况下 DSH 不会接着处理队列。
- 编辑器长时间不读取插件的输出（例如卡住）时，插件会断开这个连接，重新打开对话即可。
- 不支持表单的编辑器把单选问题（包括计划评审）显示成选项列表；需要多选或填写文字的问题要到 DSH 中作答，对话里会提示。
- Windows 上的连接方式（命名管道）尚未经过实机验证。

## 数据与安全

- 所有通信只在本机进行，不经过 Agents Anywhere Server，也不需要账号。
- 插件只在当前用户可访问的位置监听：macOS、Linux 上是权限为私有的 Unix 套接字，Windows 上是命名管道。连接还要提供一个随机令牌，令牌保存在只有当前用户能读的文件里，每次 DSH 启动都会重新生成。
- 启动脚本和客户端接口在发送令牌之前，会先让对方证明自己持有这个令牌；证明不对的端点（例如 DSH 退出后被别的程序占用）会被跳过，令牌和对话内容不会交给它。
- 能运行启动脚本的本机用户，可以像在 DSH Desktop 里一样使用这台电脑上的所有 DSH 会话；这个用户通过客户端接口运行的程序也一样。
- 编辑器声明的 stdio MCP 服务器由 DSH 以当前用户的身份启动，和 DSH 自己配置的 MCP 服务器一样不在 DSH 的沙箱里运行。

## 从其他程序连接

其他程序可以不经过启动脚本，直接通过插件的本机 RPC 连接正在运行的 DSH。这层 RPC 是有兼容约定的公开接口。包的 `client` 入口只需要 Node.js：它负责找到 DSH、确认身份，并打开可以交给 ACP SDK 的 ACP 连接。

```ts
import { client } from '@agentclientprotocol/sdk'
import { connectDsh } from '@agents-anywhere/dsh-acp-bridge/client'

const dsh = await connectDsh()
const acp = client({ name: 'my-tool' }).connect(dsh.openAcpStream())
```

契约内容、兼容约定和完整的客户端接口见[技术说明](TECHNICAL.zh.md#本机-rpc)。

## 开发

源码构建、链接安装、协议说明和测试方式见[技术说明](TECHNICAL.zh.md)。
