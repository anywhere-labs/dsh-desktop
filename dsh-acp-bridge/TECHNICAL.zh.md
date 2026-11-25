# DSH ACP Bridge 技术说明

[English](TECHNICAL.md)

面向开发和联调。使用方法见 [README](README.zh.md)。

## 链路

```text
ACP 客户端（应用、脚本、自动化工具）
  │ stdio，每行一条 JSON-RPC
  ▼
lib/stdio.js（启动脚本运行它）
  │ MeshCall 双向流调用，Unix 套接字或 Windows 命名管道，带令牌
  ▼
DSH 进程里的插件
  ├ AcpRpcService.connect：一次调用对应一个 ACP 连接，消息原样转交
  ├ AcpConnection：ACP v1 的 Agent 一侧（@agentclientprotocol/sdk 1.4.0）
  │   └ AcpSession：每个会话一份，经 sessionController 创建、发送、取消、切换模型，并用 follow 跟随事件
  └ InteractionHub：从 DSH 的 $events 交互流（只开一条）接收审批和提问，转给连着该会话的客户端
```

插件不创建自己的 Agent，所有操作都走 DSH Web 客户端使用的 Session Controller，因此会话由 DSH 统一管理：DSH Desktop、Agents Anywhere 插件和多个 ACP 连接可以同时使用同一个会话。

其他程序可以不经过启动脚本：`lib/client.js` 里的公开客户端打开的是同一种调用（见[客户端接口](#客户端接口)），启动脚本本身也建立在它上面。

## 本机 RPC

插件在 DSH 进程里直接监听（MeshCall 直连模式，不需要 Router）。这层本机 RPC 是公开接口，契约版本 1：除了启动脚本，同一用户的其他程序也可以通过它连接 DSH，用下面的客户端接口，或者用任何遵守这份契约的 MeshCall 客户端。服务名 `aa.dsh.acp.v1.Acp`：

| 方法 | 形状 | 说明 |
| --- | --- | --- |
| `hello` | 一元 | 不需要令牌。请求 `{nonce}`（16–256 个字符），返回 `{proof}`：以令牌为密钥、对 `agents-anywhere-dsh-acp/1 endpoint <nonce>` 计算的 HMAC-SHA256（base64url）。客户端用它确认端点确实是写下这条记录的进程 |
| `info` | 一元 | 返回 `{protocol: "agents-anywhere-dsh-acp", version: 1, acpProtocolVersion, bridgeVersion, runtimeVersion?, pid, connections, followed, interactions: {approvals, questions}}`：插件和 DSH 版本、ACP 协议版本、DSH 进程、ACP 连接数、正在跟随的会话数，以及审批和提问是否已接通 |
| `connect` | 双向流 | 请求为 `{}`；输入、输出条目都是 ACP JSON-RPC 消息，不做任何改写；任一方结束即断开这个 ACP 连接 |

- `info` 和 `connect` 要求调用 metadata `aa-acp-token` 与端点记录中的令牌一致，比较使用定长摘要和常量时间比较。
- 帧上限沿用 MeshCall 默认的 64 MiB；客户端每 15 秒 ping 一次，服务端 45 秒无数据才断开。

### 契约与兼容

契约版本 1 包括：端点记录（`version: 1`）、服务 `aa.dsh.acp.v1.Acp` 及其三个方法和字段、调用 metadata `aa-acp-token`、基于 `agents-anywhere-dsh-acp/1 endpoint <nonce>` 的端点证明，以及 `info` 返回的 `protocol` 和 `version`。`tests/unit/contract.test.ts` 把这些值固定下来。

- 版本 1 之内只做增加：记录和 `info` 里增加可选字段、增加方法。客户端忽略不认识的字段。
- 不兼容的改动（改名或删除字段、方法、metadata 名，或者改端点证明）进入版本 2：服务名 `aa.dsh.acp.v2.Acp`、`version: 2` 的记录、证明前缀 `agents-anywhere-dsh-acp/2`。版本 1 的客户端会跳过其他版本的记录，报告没有正在运行的 DSH，而不是在会话中途出错。
- 包的版本号对这份契约遵循语义化版本：不兼容的改动发布为主版本。
- `connect` 里传的是 ACP：它的版本由每个连接的 `initialize` 协商，和契约版本无关。

### 客户端接口

`@agents-anywhere/dsh-acp-bridge/client` 只需要 Node.js 和 meshcall，不需要 DSH。启动脚本就建立在它上面。

| 导出 | 说明 |
| --- | --- |
| `connectDsh(options?)` | 从最新启动的实例开始逐个尝试，先让对方证明持有记录里的令牌，再发出令牌，返回 `DshConnection`。选项：`home`（记录所在目录）、`instance`（实例 ID 或其前缀）、`hello` 和 `info` 的 `timeoutMs`（默认 5000）、`peerId`、`logger` |
| `DshConnection` | 连上的实例的 `record` 和 `info`；`fetchInfo()` 读取最新状态；`openAcpStream()` 打开一个 ACP 连接，作为交给 ACP SDK `client(...).connect()` 的流；`openAcpCall()` 打开一个原始双向流调用（`send`、`closeSend`、`cancel` 和异步迭代）；`close()` 结束经它打开的所有 ACP 连接 |
| `listInstances(options?)` | 正在运行的契约版本 1 实例的记录，从新到旧 |
| `acpStream(call)` | 把原始调用包装成 ACP SDK 的流 |
| `DshAcpError` | `code` 为 `no-instance`（没有正在运行的 DSH，或者没有匹配 `instance` 的）或 `unreachable`（每个实例都失败了）；`failures` 列出尝试过的每个实例，原因为 `unproven` 或 `error` |
| `CONTRACT_VERSION`、`PROTOCOL`、`RPC_SERVICE`、`TOKEN_METADATA`、`defaultHome()` | 契约标识和默认的记录目录 |

```ts
import { client, methods } from '@agentclientprotocol/sdk'
import { connectDsh } from '@agents-anywhere/dsh-acp-bridge/client'

const dsh = await connectDsh()
const acp = client({ name: 'my-tool' }).connect(dsh.openAcpStream())
await acp.agent.request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: {} })
const { sessionId } = await acp.agent.request(methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] })
await acp.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '你好' }] })
await dsh.close()
```

- 每个 ACP 连接遵循相同的连接生命周期规则：连接结束时，它发起、还在执行的任务会被取消，它排队的消息会被撤回。
- 客户端不会自动重连：一个端点只属于一个 DSH 进程，DSH 重启后换成新的端点。重新调用 `connectDsh`，再 `initialize`，然后用 `session/load` 或 `session/resume` 接着使用会话。
- 其他语言的程序可以直接实现这份契约：读记录、核对 `hello` 的证明、把令牌放进调用 metadata、在 `connect` 上收发 ACP 消息，需要能连 Unix 套接字或命名管道的 MeshCall 客户端。目前只验证过 TypeScript 客户端。

### 端点记录与启动脚本

| 路径（相对 `~/.agents-anywhere/dsh-acp`） | 内容 |
| --- | --- |
| `endpoints/<实例 ID>.json` | `{version: 1, protocol: "meshcall", service, instanceId, pid, startedAt, endpoint, token, bridgeVersion, runtimeVersion?, launcher?}`，权限 0600，原子替换写入。`launcher` 是这个实例的启动脚本运行的 `{runtime, electron, script}`，供接手启动脚本时使用 |
| `sockets/<ID 前 16 位>.sock` | Unix 套接字，目录 0700、套接字 0600。路径超过 100 字节（`sockaddr_un` 的上限）时，改为在系统临时目录下用 `mkdtemp` 新建一个 0700 目录（名字以 `aa-dsh-acp-` 开头），卸载时连同目录删除 |
| `bin/dsh-acp`、`bin/dsh-acp.cmd` | 启动脚本，用 DSH 进程的 `process.execPath` 运行本包的 `lib/stdio.js`。DSH 运行在 Electron 上、且自身以 `ELECTRON_RUN_AS_NODE=1` 运行时（说明这个 Electron 允许 Node 模式），脚本同样设置这个变量；其他 Electron 宿主改用 `PATH` 里的 `node`，避免拉起第二个应用。`--version` 只输出一行插件版本，不连接 DSH，客户端可以照 ACP Agent 的惯例用它读版本 |
| `bin/dsh-acp.json` | 启动描述 `{version: 1, command, args, env}`：启动脚本运行的程序、参数（`lib/stdio.js`，以及带 ACP 目录的 `--home`）和要加的环境变量（包括 `DSH_HOME`）。不经 shell 启动进程的程序（例如在 Windows 上运行不了 `.cmd` 的程序）按它直接启动，自己的参数接在 `args` 后面。和启动脚本一起写入、保留、交接和删除；版本 1 之内只增加字段 |

- 插件使用的目录如果是符号链接、不是目录或属于其他用户，插件拒绝启动，不会跟随链接或修改其权限。
- 每个加载了插件的 DSH 进程各写一条记录；卸载插件时删除自己的记录和套接字。插件启动时删除进程已退出的记录，客户端也从不选择这样的记录。
- 启动脚本的去留：DSH 退出时保留，留给客户端下次自动启动 DSH；插件在 DSH 运行期间卸载（停用、移除、卸载或重新加载）时撤下。两者按插件外层的作用域区分：DSH 退出时外层先卸载，外层的 fiber 已经没有 ID，根 fiber 也已离开运行状态。撤下时，如果启动脚本已被别的实例重写，就保持不动；否则交给最新的、插件文件和程序都还在的另一个正在运行的实例（按它记录里的 `launcher` 重写），没有这样的实例就删除，并删掉插件建的空目录（`bin`、`endpoints`、`sockets` 和主目录本身）。
- 客户端按启动时间从新到旧尝试各条记录：先用随机 nonce 调用 `hello` 并校验证明，校验不通过（PID 被复用、套接字或管道名被别的程序占用）就跳过，校验通过后才在 `info` 和 `connect` 中发送令牌。启动脚本的 `--instance` 和客户端的 `instance` 按 ID 前缀指定实例。
- meshcall 0.3.0 可能把一个还在建立时就失败的调用报告为未处理的 Promise 拒绝，尽管调用方会等待并处理同一个失败（DSH Desktop 打了补丁，见 anywhere-labs/deepseek-harness-desktop#1574）。启动脚本遇到这种情况只把它写到标准错误，继续转发，不会退出；使用客户端接口、需要长时间运行的程序也应该这样处理 `unhandledRejection`。
- Windows 命名管道为 `\\.\pipe\agents-anywhere-dsh-acp-<ID 前 16 位>`，同样依靠上面的证明和令牌区分双方。
- 启动脚本运行前先检查本包的 `lib/stdio.js` 和运行环境（是绝对路径时）还在不在：插件已卸载、DSH 已卸载或移动时，打印原因并以 1 退出，不交给 Node.js 报模块错误。AppImage 版的程序只在它运行时存在（挂载在 `/tmp/.mount_*` 下），这时提示先打开 DSH。Windows 的 `.cmd` 先切换到代码页 65001，再读出中文提示。

### 自动启动 DSH Desktop

`lib/stdio.js` 找不到任何正在运行的实例（`no-instance`），且没有使用 `--instance`、`--check` 或 `--no-start` 时，选择已登记的默认应用，在启动锁内检查应用进程；只有没有 DSH 运行时才启动，再等插件就绪：

- 已登记应用提供自己的程序路径和数据目录，不依赖执行启动脚本的运行时。没有应用登记时保留旧版 Electron 启动脚本的行为。
- macOS 经 LaunchServices 启动 Next/Beta：`open -n -g <应用包> --env DSH_HOME=<数据目录> --args --next-background`。官方应用不加 `-n` 和 `--args --next-background`。作为客户端的子进程启动时，应用会把客户端当作 responsible process，本地网络访问会失效（anywhere-labs/deepseek-harness-desktop#1515）。`-n` 让已经运行的实例也收到这个参数。
- Windows 和 Linux 以分离方式直接启动可执行文件，仅 Next/Beta 使用 `--next-background` 参数；环境变量去掉 `ELECTRON_RUN_AS_NODE`、`ELECTRON_NO_ATTACH_CONSOLE` 和 `NODE_OPTIONS`，应用按自己的方式启动。窗口按应用自己的方式显示：隐藏第一个窗口（`windowsHide`）会吞掉 Next/Beta 第一次点托盘时打开的窗口。
- Windows 上没有后台启动的应用（官方桌面端）改由资源管理器启动。Windows PowerShell 请桌面的文件夹视图以显示方式 `SW_HIDE` 执行 `ShellExecute`：应用的第一个窗口保持隐藏；应用是资源管理器而不是编辑器的子进程，拿不走编辑器的前台。之后从托盘或再次启动显示窗口都照常。应用拿到的是资源管理器的环境变量，所以只有这份环境给出的数据目录（用户的 `DSH_HOME`，否则系统的，否则 `~\.dsh`）与登记的一致时才这样启动；以管理员身份运行的编辑器启动的应用不带管理员权限。不一致，或 PowerShell、资源管理器不可用时，直接启动应用，可能显示窗口，启动脚本会说明原因。
- DSH Desktop（Next 和 Beta）带 `--next-background` 启动时照常启动 Host，但只显示托盘图标、不打开窗口；托盘不可用时仍然打开窗口。已经运行的实例收到带这个参数的第二次启动时，不聚焦窗口。这个参数不会带进之后的重启。较早的版本会忽略它并打开窗口。
- 随后每 0.5 秒连接一次，遇到 `DshAcpError`（还没有实例或暂时连不上）就继续等，最多等 `--start-timeout` 秒（默认 90；DSH Desktop 的 Host 启动上限默认 60 秒）。等到超时说明插件没有加载：DSH 当前的 Profile 没有启用插件，或者 DSH 停在首次设置、恢复或升级。

## ACP 映射

### 方法

| 方法 | 行为 |
| --- | --- |
| `initialize` | 协议版本 1；声明 `loadSession`、`session/list`、`resume`、`close`、`delete`、`fork`；DSH 的附件存储接收 PNG、JPEG、WebP 或 GIF，且新会话使用的模型（DSH 的默认模型）声明支持图片输入时才声明图片，和官方 dsh-acp 的判断一样；DSH 判断不了的情况（模型没有声明、查询失败或超过 5 秒）都按不支持处理；声明嵌入上下文；插件旁边装有 DSH 的 MCP 客户端时声明 HTTP MCP 服务器（stdio 按规范总是支持，已弃用的 SSE 不声明）；声明 `_meta.claudeCode.promptQueueing`，它不属于 ACP 规范，但客户端靠这个标记判断能否在一轮进行中继续发消息（最早由 claude-agent-acp 声明）；在响应顶层声明 `_meta.steering.supported: true`，表示支持下面的 `_session/steering` |
| `session/new` | 校验 `cwd` 为存在的绝对目录（转为真实路径）和客户端声明的 MCP 服务器，只分配会话 ID 并返回配置项；第一条消息时才在 DSH 中创建，MCP 服务器在这条消息交给 DSH 之前挂上 |
| `session/load` | 跟随会话，先回放最近 1000 条消息（用户消息、思考、回复、工具卡片），挂上客户端声明的 MCP 服务器后再响应；正在生成的一步会接着逐字发送 |
| `session/resume` | 跟随会话但不回放；同样先挂上客户端声明的 MCP 服务器 |
| `session/list` | Session Controller 的会话列表，去掉子 Agent、空白和已归档的会话，按更新时间倒序，每页 100 条。带 `cwd` 时，它和每个会话的目录都先解析成真实路径再比较（Windows 上不区分大小写）：DSH 按打开时的写法保存目录，例如经过符号链接的路径 |
| `session/set_title`（ACP 草案） | 仅在 DSH 加载官方标题服务时声明 `sessionCapabilities.title`。调用 Session Controller 的 `rename`，等待标题事件落盘后返回规范化的 `{ title }`；用户指定的标题不会再被自动生成覆盖。支持这条连接中新建、尚未发首条消息的会话，也支持 `session/list` 可见但未在当前连接加载的会话。非法标题返回 `-32602`，不存在或列表不可见的 ID 返回 `-32002`。已有 `session_info_update` 同步已关联客户端和管理面板。SDK 生成类型尚未包含该草案方法，暂用其公开的带解析器注册接口，不加入编辑器专用别名。 |
| `session/close` | 取消本连接发起、仍在进行的任务，停止跟随，卸下只有本连接声明的 MCP 服务器 |
| `session/delete` | 在 DSH 里归档这个会话：它从 `session/list` 消失，之后可以在 DSH 里恢复。先取消本连接在这个会话里的消息，并最多等 5 秒让那一轮结束；DSH Desktop 或其他客户端发起的一轮还在运行时，请求失败，会话保留 |
| `session/fork` | 先校验客户端声明的 MCP 服务器，有误时不复制；DSH 把会话到最后一轮结束为止的历史复制成一个新会话，本连接随后像 `session/resume` 一样跟随它；原会话不变 |
| `session/set_config_option` | 见下文配置项，返回完整配置 |
| `session/prompt` | 已注册的斜杠命令直接执行；其他输入作为排队消息发给 DSH，等这条消息所在的轮次结束后返回。同一会话还有消息在执行时再发的消息，会和在 DSH Desktop 里回复期间按回车一样在 DSH 队列里等待，轮到时单独占一轮；插件按发送顺序把消息交给 DSH。图片以外的嵌入二进制资源，会先像 DSH Desktop 上传用户添加的文件一样上传到会话的 Agent，再作为文件附件随消息发出。带图片的消息先按它要用的模型检查（会话当前的模型；DSH 还没创建的会话用客户端选的模型或 DSH 的默认模型）：这个模型声明不支持图片输入时，请求以参数错误结束，DSH 不创建会话、不上传文件，也收不到消息；模型没有声明时交给 DSH，DSH 会接收图片。DSH 收消息时拒绝的图片或文件，同样报参数错误 |
| `_session/steering` | 插话扩展，和 Codex、Claude 的 ACP Agent 同名同形：参数 `{sessionId, prompt}`（`_meta.steering.idleBehavior` 不用读），返回 `{outcome}`。会话有一轮正在执行时，内容按 `session/prompt` 的规则检查和转换后，以 `mode: "steer"` 交给 DSH，和 DSH Desktop 的插话一样在这一轮的下一步交给模型，返回 `injected`；这一轮已到收尾时 DSH 会为它再执行一步。DSH 还没创建会话或没有在执行时返回 `promptRequired`，由客户端改发普通消息：插话从不开启新的一轮，否则这一轮没有消息可以回应。插话写进 DSH 的消息不再回显给发出它的连接，其他连接照常收到 `user_message_chunk` |
| `session/cancel`、`$/cancel_request` | `session/cancel` 停止这条连接在该会话里发出的全部消息，`$/cancel_request` 只停止一条。DSH 还在创建会话或命令还在执行时，不再发送这条消息、中止命令；消息还在排队时把它移出队列；已开始执行时像 DSH 的停止按钮一样取消这一轮，其他客户端排队的消息保留。取消正在执行的一轮时，这条连接排在它后面的消息也会撤回（见「轮次与停止原因」） |

不支持：`session/set_mode`、额外工作目录、客户端的文件读写和终端（Agent 从不调用这些方法）。

### MCP 服务器

和官方 dsh-acp 一样，客户端在 `session/new`、`session/load`、`session/resume` 和 `session/fork` 里声明的每个 MCP 服务器，都成为会话 Agent 作用域里的一个 DSH `mcp-client`：工具名是 `mcp__<名称>__<工具>`，只有这个会话的 Agent 和它派出的子 Agent 看得到。检查规则也照官方：只接受稳定的 stdio 和 HTTP 传输；stdio 的命令必须是绝对路径，在会话的工作目录里启动；不符合 `[A-Za-z0-9_-]{1,32}` 的名称换成固定的新名称（名称的字母部分加散列）；重名的服务器和无效、重复的环境变量或请求头返回参数错误；每个服务器都必须连上并列出工具（`failOnStartupError`），否则挂载它的请求失败并给出服务器名。

DSH 的会话是共享的，所以挂载按跟随这个会话的客户端计算：

- 同一个 Agent 里，名称和配置都相同的声明共用一个服务器，最后一个声明它的客户端关闭会话、断开连接或被 DSH 结束跟随时才卸下；同名但配置不同的声明返回参数错误。
- 每个服务器挂在 `createScope(agent.ctx, agent)` 建出的作用域里，和 DSH 的 CUA、内置浏览器给运行中的 Agent 添加工具的方式相同。插件从自己的安装位置加载 `@deepseek-ai/dsh-mcp-client` 和 `@deepseek-ai/dsh-scope`；装在 DSH Desktop 的 Profile 里时它们是插件自带的副本，`mcp-client` 认不出 DSH 给 Agent 打的作用域标记，会把不同会话里的同名服务器当成冲突。用这份副本在 `agent.ctx` 下按 Agent 再建一层作用域后，DSH 仍按继承来的标记把工具登记给这个 Agent，`mcp-client` 也按 Agent 区分名称。挂上后再检查一次：工具出现在所有会话共用的视图里时，立即卸下并报错。
- 打开会话时挂到当时的 Agent；每条消息交给 DSH 之前，确认挂载的仍是会话当前的 Agent，DSH 换了 Agent 就重新挂。
- 插件旁边没有这两个包时，`initialize` 不声明 HTTP，客户端声明的服务器在日志里记一行后忽略。

### 更新

| DSH | ACP |
| --- | --- |
| 别的客户端发送的用户消息、回放的历史 | `user_message_chunk` |
| 流式片段（`assistant-stream` 帧） | `agent_message_chunk`、`agent_thought_chunk`，40 毫秒合并一次 |
| `assistant/message` | 只补发没有流式发出过的部分（含图片）；之后发 `usage_update` |
| `tool/call`、`tool/result` | `tool_call`、`tool_call_update`，内容来自工具自己的展示声明（差异、终端、搜索、读取、网页），没有声明时按工具名推断类别 |
| `session/title` | `session_info_update` |
| 待办清单（`todo/write`，以及客户端打开会话时的 `todos` 投影） | `plan`，每项一条，优先级为 `medium`；下一轮开始时 DSH 会清空清单，这时发送空的计划 |
| 模型、权限、Agent 模式、计划模式的变化 | 重新计算配置项，有变化才发 `config_option_update` |
| 第一条消息创建了会话 | 发 `config_option_update`，内容是创建后的配置项：去掉 `agent_preset`，DSH 加载了计划模式时加上 `plan_mode` |
| 命令或技能目录变化 | `available_commands_update` |
| 一轮开始、结束（`turn/start`、`turn/end`） | `session_info_update`，只带 `_meta.dsh.turnEvent`，见下文 |

一步输出没有完成就被放弃时，已经发出的文字无法撤回，会补一句提示，完成的消息随后完整发出。

ACP 只用 `session/prompt` 的返回表示一轮结束，DSH Desktop、其他客户端发的消息和子 Agent 的结果开启的轮次，客户端都不知道何时结束。所以插件对跟随中的会话，在每一轮开始和结束时各发一条只带 `_meta` 的 `session_info_update`（规范说明这个更新的字段都可省略，用于自定义元数据）。格式取自 Agents Anywhere DSH bridge 契约 3.0 第 7 节的 `turnEvent`，读它的客户端可以共用同一段代码：

- 开始：`{sessionId, phase: "started", turn, seq}`，`turn` 是 DSH 的轮次号，`seq` 是 `turn/start` 事件的序号。它不在 `turn/start` 到达时就发，而是和这一轮的第一条更新一起发：DSH 先开新的一轮、再从队列取消息，这条连接上一条消息的返回结果要排在新一轮之前。
- 结束：`{sessionId, phase: "ended", turn, seq, stopReason, reason}`，排在这一轮最后一条更新之后、由它结束的消息返回之前。`stopReason` 用 ACP 的停止原因（和 `session/prompt` 的规则相同；失败的一轮为 `end_turn`），`reason` 是 DSH 的 `{kind}`，失败时另带 `message`。
- 只在实时跟随时发送，回放不发；在一轮进行中打开会话的客户端只会收到这一轮的结束。

在一步输出到一半时 `session/load`，快照里这一步是 DSH 的压缩记录（`text-chunks`、`reasoning-chunks` 等），插件展开后先发出已生成的部分，后续片段接着实时发送；遇到无法识别的记录就不回放这一步，等它完成后完整发出。

### 配置项

| ID | 类别 | 说明 |
| --- | --- | --- |
| `model` | `model` | 值为 `JSON.stringify([provider, model])`，和官方 dsh-acp 相同，模型 ID 里有斜杠也不会混淆；也接受早期版本的 `provider/model`（第一个斜杠前为 provider）。按可路由的 provider 分组；切换时保留当前推理强度，新模型不支持则用其默认值 |
| `reasoning_effort` | `thought_level` | 当前模型声明了推理强度才出现；模型没有默认值时多一个 `default` |
| `permission` | `mode` | DSH 权限预设；已有会话通过 `/permission` 命令切换，和 DSH 自己的输入框一致 |
| `agent_preset` | 无 | 只在第一条消息前出现 |
| `plan_mode` | 无 | 会话已存在且 DSH 加载了计划模式时出现；客户端声明支持布尔配置项时为布尔值，否则为 `on`/`off` 选择 |
| `agent_team` | 无 | DSH 的 Team 模式，即模型菜单里的「启用智能体团队协作」开关（`@deepseek-ai/dsh-agent-team` 的 `ctx.agentTeams`）；DSH 组合了智能体团队时出现，和 `plan_mode` 一样是布尔值或 `on`/`off` 选择。它为整棵子 Agent 树开关共享任务板及其工具和提示词，并不开关子 Agent 本身。新会话默认关闭；在第一条消息前做的选择，会在 DSH 创建会话时应用。和 DSH Desktop 不同，客户端关闭它时不会先确认，所以配置项的说明里写了对缓存的影响 |

### 轮次与停止原因

发送时生成 `requestId`，DSH 把它记在排队消息和 `user/message.source.rpcId` 上。每一轮开始时，DSH 从队列取走最早的一条消息，模型解析完成后才写 `user/message`，一轮可能在写消息之前就失败或被取消，所以插件对这条连接的每条消息都以队列为准：

- 从 follow 快照的 `inbox` 投影开始，按 `agent/inbox/spliced` 维护队列的副本；
- 这条消息被取走（没有 `outcome` 的删除）时，记下当前轮次，从该轮的 `turn/end` 起等会话安静下来（见下文）；
- 这条消息被丢弃（`outcome: "canceled"`，可能是本客户端取消、DSH Desktop 删除或其他客户端操作）时，以 `cancelled` 返回；
- `user/message` 仍然作为同一轮次的确认。

用 `subagent` 工具派出的子 Agent，在派它的那一轮结束后仍在后台工作；它的结果以一条消息（`source.kind: "subagent-settled"`）回到 Agent，开启新的一轮。所以插件和官方 `@deepseek-ai/dsh-acp` 一样，要等会话安静下来才返回：Agent 空闲（`whenIdle`）、子 Agent 树没有工作（`ctx.subagents.waitForTreeWork`，按结构读取，没有组合子 Agent 时照常工作）、期间没有写入新事件（`session.seq`），并且 follow 流已经送达到这一点为止的全部事件。在此之前根 Agent 的每一轮都算这条消息的，不论是子 Agent 的结果还是其他客户端的消息开启的，这一点和官方实现相同。有两种情况会提前结束等待：这条连接的下一条消息被某一轮取走，这时先给正在等待的消息返回结果，再发下一条的第一条更新；以及取消（见下文）。

`usage` 为这条消息参与的所有轮次各步之和。返回结果排在最后一轮的最后一条更新之后、下一轮第一条更新之前：ACP 的更新不注明属于哪条消息，客户端会把每条更新算到还没收到结果的那条消息下面。

结果由这条消息参与的最后一轮决定：

| `turn/end` | `stopReason` |
| --- | --- |
| `completed` | `end_turn` |
| `max-tokens` | `max_tokens` |
| `interrupted`、`aborted`（用户或上级取消） | `cancelled` |
| `aborted`（钩子）、`blocked`、`forked` | `end_turn` |
| `error` | 返回 JSON-RPC 内部错误，附 DSH 的错误信息 |

客户端请求取消后，无论这一轮怎样结束都返回 `cancelled`。正在等子 Agent 的消息被取消时立即返回 `cancelled`，和官方实现一样：还在运行的根 Agent 轮次会被取消，子 Agent 继续工作，和在 DSH Desktop 里点停止一样。`session/close` 和连接断开也是这样处理，并且不会结束子 Agent 树，因为这个会话 DSH Desktop 也在用。

一轮正常完成后，DSH 接着处理下一条排队的消息。以其他方式结束（取消、失败、被拦下）后，DSH 在收到新的输入之前不会再取排队的消息，DSH Desktop 会把它们留在队列里。ACP 的请求不能这样一直等，所以这样的一轮结束、Agent 保持空闲时，插件把这条连接还在队列里的消息移出队列并结束对应的请求：上一轮是被取消的，返回 `cancelled`；否则返回 JSON-RPC 错误，说明这条消息没有发送。

### 审批和提问

DSH 把每个审批或提问发给所有 owner 客户端（DSH Desktop、Web、Agents Anywhere 插件和本插件），第一个结果生效，其余收到取消。网关会等每次投递的回复，所以本插件只开一条交互流，每次投递恰好回复一次：不是审批或提问、没有连着该会话的 ACP 连接、或客户端都没有作答时回复 `next`。连接重连后同一请求再次投递时，由进行中的处理在新连接上回复。本插件只处理连着该会话的 ACP 连接：

- 审批：DSH 经交互流投递审批，它可能跑在跟随流的 `tool/call` 事件前面，而 ACP 客户端按 ID 查找权限请求指向的工具卡片。所以插件先等到看见对应的工具调用（最多 2 秒），发完之前的更新，再发 `session/request_permission`，带上卡片的 ID 和标题（有的客户端只显示请求本身），选项为「允许一次」「拒绝」。这条连接从没收到过卡片的调用（没有回放就接入了，或调用没有及时到达），改为在请求里完整描述这次调用。客户端取消或出错时回复 `next`，交给其他客户端。
- 提问：客户端声明 `elicitation.form` 时发表单。单选为 `oneOf`，多选为 `items.anyOf`，没有选项的问题为必填文本；可选的问题附一个「其他回答」字段，单选时它代替所选项。接受后转换为 DSH 的答案，拒绝或取消视为用户取消问答。不支持表单的客户端，单选问题（包括计划评审）改用 `session/request_permission` 的选项：每个问题先开一张自己的卡片（计划评审的计划是卡片内容），再发指向它的请求，每个答案一个选项，选定后关闭卡片并写上所选。审批类问题的选项保留允许、拒绝的类型，计划评审提供「批准计划」「继续规划」。放弃任一个问题，整个请求留给 DSH。需要多选或填写文字的请求仍然只收到一句提示，留给 DSH 作答。
- 会话关闭、停止跟随或连接断开时，撤回还在等待的请求。
- 子 Agent 不会走到这条通道。DSH 派出进程内子 Agent 时把审批策略固定为 `never`（子 Agent 日志里 `source: "delegation"` 的 `approval/policy`），所以它请求的审批会被当场拒绝（先 `approval/asked`，紧接着 `approval/decided` 为 `rejected`，不投递给任何客户端）；`ask_user_question` 会报错「human interaction is unavailable while the calling agent is owned by another live agent」。DSH Desktop 也看不到这些请求，所以没有可转发的内容。只有父会话的权限预设是 `auto` 或 `danger-full-access` 时，子 Agent 才会继承。
- DSH 在还没有 ACP 连接跟随某个会话时发出的请求，插件已经回复 `next` 交了出去，它在 DSH Desktop 或其他客户端那里等着。网关会把所有还在等待的请求重新投递给新打开的交互流，所以有连接开始跟随某个会话、而网关报告这个会话有在等待的审批或提问（`getPendingRemoteEvents`）时，插件会重开交互流，这个请求也会出现在客户端里。正在处理中的请求改在新的交互流上回复；插件不会压着请求不回复，所以没有客户端回答时，DSH 的行为和以前一样。

## 设计取舍

- **不直接挂官方 `@deepseek-ai/dsh-acp`**：官方实现用 `agents.create` 自己组装 Agent，只安装模型选择和 MCP，不挂 Agent 预设；DSH Desktop 和 Web 的 profile 把所有工具放在预设里，挂进去的会话没有工具。它还独占会话，DSH 已加载的会话无法恢复。
- **建在 Session Controller 上**：与 DSH Web 客户端相同的多客户端语义，会话出现在 DSH Desktop，审批和提问可以在任一端回答。
- **参考 dsh-acp-enhanced 的功能，不复用代码**：它是独立 profile，自己拥有 Agent；逐字输出、工具卡片、表单、命令和历史回放在这里基于 Session Controller 重新实现。
- **延迟创建**：客户端的 `session/new` 请求只预留 ID，第一条消息时才在 DSH 中创建会话，避免留下空会话和常驻 Agent。
- **拒绝不外泄**：DSH 把未处理的 Promise 拒绝当作致命错误、会结束整个进程，所以所有异步路径都捕获错误；连接结束后写出的消息直接丢弃。
- **关闭优先**：会话在 `session/load` 或首条消息创建会话期间都可能被 `session/close` 或断开连接关闭。连接在开始跟随之前就登记会话，每个 await 之后检查是否已关闭；已关闭就停止跟随，不再发送消息，也不会被重新挂回审批路由。同一连接再次 load 同一会话时，先关闭之前的视图（包括还在打开的）。
- **积压上限**：客户端不读取输出时，MeshCall 的流控会让发送一直等待。单个会话排队的更新超过 20000 条时断开这个连接，避免 DSH 进程内存无限增长。

## 开发与测试

需要 Node.js `^22.19.0 || >=24` 和 Corepack。本包是 DSH Desktop 仓库根 Yarn 工作区的成员，在仓库根目录安装依赖并运行检查：

```bash
corepack yarn install --immutable
corepack yarn workspace @agents-anywhere/dsh-acp-bridge check
```

`check` 依次做类型检查（源码和测试）、构建、单元测试和集成测试，不需要数据库、Python 或模型服务；仓库根目录的 `corepack yarn check` 也会运行它。集成测试在进程内启动真实的 DSH 服务（会话存储、Gateway、AgentLoop、Session Controller、审批、提问，只把模型换成脚本），加载构建产物，再用 ACP SDK 客户端通过真实的 `lib/stdio.js` 子进程驱动，覆盖：

- 新建、流式回复、列表与回放（包括一步输出到一半时 load）、其他客户端消息的实时同步；
- 取消：发送后的各个时机、DSH 创建会话期间、斜杠命令执行期间，以及 DSH Desktop 把排队消息删除；
- 一轮进行中继续发的消息：各自在 DSH 队列里等待、单独占一轮；有排队消息时的 `session/cancel`、取消其中一条排队的消息、取消正在执行的那一条，以及排在前面的一轮失败或被其他客户端停止；
- 插话：一轮执行到一半时插入，DSH 为它再执行一步、模型收到插话内容；不回显给发出它的连接，其他连接收到；会话还没创建或空闲时返回 `promptRequired`；空内容、未知会话和缺参数报错；
- 轮次边界：开始排在这一轮第一条更新之前，结束排在最后一条更新之后、消息返回之前；排队的下一条消息的一轮在上一条返回之后才开始；DSH Desktop 开启的一轮，只跟随会话的连接同样收到开始和结束；
- 子 Agent（按基础 bundle 的方式挂载进程内后端和 `subagent` 工具）：消息要等它派出的子 Agent 以及子 Agent 结果开启的那一轮都结束才返回；等待期间的取消、关闭和下一条消息；以及等待期间 DSH Desktop 发来的消息；
- 模型解析失败时返回错误、会话不被锁住；
- 审批（请求排在它指向的卡片之后、客户端放弃作答时由 DSH 回落处理、DSH 先作答时撤回客户端上的请求、客户端打开会话前 DSH 就在等的请求）、表单、不支持表单的客户端回答单选问题、图片输入（按 DSH 的默认模型声明、模型不支持图片输入时在 DSH 创建会话前拒绝、模型没有声明时交给 DSH、DSH 自己的拒绝报参数错误）和文件附件；
- 待办清单作为计划、`session/delete`（包括 DSH Desktop 还在运行的会话）、`session/fork`，以及 `session/list` 经过符号链接的 `cwd` 过滤；
- 配置与 DSH 端切换模型的同步（模型值用官方格式，也接受早期的 `provider/model`）、智能体团队协作开关的双向同步（按基础 bundle 的方式挂载智能体团队）、斜杠命令；
- 客户端声明的 MCP 服务器（用测试里的本地 stdio 服务器）：新会话第一条消息时挂上、只属于这个会话、关闭后进程结束；声明有误时在创建或复制会话之前返回参数错误；服务器起不来时消息报错并给出名称；两个客户端共用同一个声明、同名不同配置被拒绝；`session/load` 时挂上、断开连接后卸下；
- 令牌校验、端点身份证明、超长路径改用临时目录、启动脚本、不连接 DSH 的 `--version`，以及启动脚本遇到迟到的未处理拒绝后继续转发；
- 自动启动 DSH Desktop：各平台的启动方式、Windows 上经资源管理器隐藏窗口启动以及它无法启动时改为直接启动、Next/Beta 的窗口从不隐藏、Windows 进程列表中的非 ASCII 路径、去掉 Node 模式的环境变量、`open` 失败和可执行文件不存在、插件在启动脚本找过一次之后才发布记录时照样连上；插件或 DSH 不在时启动脚本给出的提示（在 shell 里实际运行生成的脚本；Windows 脚本只检查文本）；启动脚本在 DSH 退出时保留、只卸载插件时删除，以及两个 DSH 共用主目录时由另一个接手；启动描述随启动脚本写入、保留、交接和删除，按它直接启动能连上 DSH；
- 公开客户端（从构建产物加载）：经它的流使用 ACP SDK、原始调用、对无法证明身份的端点在发出令牌前就拒绝、只提供正在运行的契约版本 1 实例、DSH 退出后立即失败、除 Node.js 和 meshcall 外没有其他依赖；以及固定下来的契约值；
- 客户端在创建会话、打开会话或执行中途被杀死、`session/close`、重复 load 之后不残留跟随，DSH 不受影响。

链接安装到本机 DSH 做手动联调：

```bash
corepack yarn workspace @agents-anywhere/dsh-acp-bridge build
cd dsh-acp-bridge
dsh plugin --profile desktop add "link:$PWD"
```

重启 DSH 后，用 `~/.agents-anywhere/dsh-acp/bin/dsh-acp --check` 确认插件已就绪。

手动联调记录（2026-11-17）：用 npm 发布的 DSH 0.2.2-rc.3 CLI、临时 `DSH_HOME` 和官方 `web` profile，以 `link:` 安装本插件并启动 `dsh --profile web`。插件经 DSH 插件机制加载，写出私有权限的端点记录、套接字和启动脚本；`--check` 显示审批和提问已接通；ACP 客户端完成了新建会话、读取真实的模型/权限/Agent 模式选项、斜杠菜单（DSH 命令和技能）、会话列表（含 DSH 生成的标题）、另一连接回放、切换权限和开关计划模式；没有模型密钥时，发送消息返回带 DSH 原因的错误，DSH 不受影响；DSH 正常退出时删除端点记录和套接字。

修复审查发现的问题后，用同一环境复验：`--check` 经过端点身份证明后连接成功；没有模型密钥时连续两条消息都返回错误，会话没有被锁住；发送后立即取消返回 `cancelled`；斜杠命令、列表、另一连接回放、开关计划模式、切换权限和 `session/close` 正常，另一连接收到配置变化；DSH 收到 SIGINT 后删除端点记录和套接字，启动脚本随即提示没有正在运行的 DSH。

MCP 联调记录（2026-11-18）：在进程内的测试 DSH 里用 DSH 的 MCP 管理器配置 Context7（HTTP 和 stdio 各一个），ACP 会话里的两次工具调用和返回的文档都完整到达客户端。插件自带副本的情况，用 Next 工作区里单独安装的 `mcp-client` 和 `dsh-scope` 代替插件的副本（DSH 用另一份）来验证：两个会话声明同名的 stdio 服务器，各自只看到自己的工具，关闭一个不影响另一个；不经过插件建的作用域、直接挂进 `agent.ctx` 时，第二个会话报服务器名已被占用。

自动化检查和这些联调都没有覆盖：真实模型的回复、真实的 Zed 等编辑器、DSH Desktop 的 Electron 运行环境（包括装进 Profile 的插件挂载客户端声明的 MCP 服务器，以及启动脚本在真实系统上启动 DSH Desktop、它只显示托盘图标）、Windows 命名管道、同时运行多个 DSH，以及自动化检查所用的 0.2.2-rc.4、2026-11-17 联调所用的 0.2.2-rc.3 以外的 DSH 版本。

## 管理面板与启动设置

Web 客户端通过 `plugins.bundle.config` 注册插件详情页的控制面板，键为包名 `@agents-anywhere/dsh-acp-bridge`。不再注册独立设置分类。面板提供全机默认应用、固定应用参数、自动启动开关和等待超时；保留的 CLI 设置按应用绑定。面板没有自己的样式：小节标题、事实列表和状态文字沿用插件详情页（与「来源信息」「版本」相同），表单和控件是官方共享组件。构建时从已安装的官方包编译 `PluginManagerPage.module.css` 和设置表单的 `fields.module.css`，详情页样式只保留用到的类；新版本删掉其中某个类时构建会失败。`./client` 导出的 `node` 条件保留已有 Node API，`default` 指向 DSH 客户端模块加载器需要的浏览器工厂 `lib/panel.js`。面板使用 Connection 的仅 owner 可访问路由 `/api/agents-anywhere/acp`：GET 读取快照，POST 保存或修复。卸载插件会撤销路由和客户端贡献。快照不包含端点令牌或对话正文。

连接状态通过仅 owner 可访问的 `/api/agents-anywhere/acp/connections` 读取；`?watch=1` 返回 NDJSON 实时流。建立、初始化、断开连接，以及添加、关闭会话、会话跟随终止或标题变化时推送新快照；会话总数按 ID 去重，包含尚未发送首条消息的 ACP 会话。面板只显示总数；快照和复制的诊断信息里还有各个客户端和它们的会话。客户端名称和版本来自 ACP initialize 上报，缺失时不猜测。流每 20 秒发空行心跳，不轮询状态；客户端 45 秒未收到数据会中断并重连，断线后 2 秒重试并标记旧快照。慢读取方只保留一个排队快照及最新待发状态。关闭面板或卸载插件会释放读取器、订阅和计时器。手动刷新单独读取连接快照，不修改设置草稿，也不会覆盖请求期间收到的新推送。

ACP 目录中的 `startup.json` 以 0600 权限原子替换，DSH 关闭后启动器仍可读取，同目录的启动器共享设置。损坏的设置会让启动器停止自动启动；面板显示错误并允许覆盖修复。命令行参数优先于保存设置。`startup.lock` 协调多个编辑器的启动请求，`applications.lock` 协调各应用同时登记。持有者已退出的锁会被回收；两秒后仍没有写明持有者的锁（进程在创建之后、写入之前被杀掉会留下这样的锁）也会被回收。登记失败只记日志，不影响端点发布。`last-start.json` 记录最近一次启动就绪结果。启动脚本携带自己的 ACP 目录和 DSH 目录，自定义目录不再依赖编辑器额外传参。

端点版本 1 新增可选的 `profileDirectory`，launcher 元数据新增可选 `home` 和 `dshHome`，旧读取方忽略它们。新启动的 CLI 按规范化 Profile 目录匹配，避免误连启动期间出现的其他实例。CLI 入口从官方 Desktop 安装布局推导，面板不接受任意命令。初步校验只接受已声明 Web 和 ACP bundle 的已有 Web Profile，最终以实际端点就绪为准。不自动创建或迁移 Profile，也不接管桌面会话。后台 CLI 进程当前持续运行，生命周期监管与真实安装包冷启动验收仍为独立工作。

### 应用路由

端点契约 v1 新增可选 `application` 信息。`apps/<id>.json` 持久保存每个安装位置、数据目录、Profile 的身份；ID 由规范化的程序路径、数据目录和 Profile 路径计算。`applications.lock` 独立于 `startup.lock`，避免编辑器等待启动时阻塞插件登记。`startup.json.defaultApp` 保存全机默认应用，可选的 `applications[id]` 绑定 CLI 模式、Profile 和数据目录。不可用的登记被排除；停用插件且没有同身份实例时移除登记，退出 DSH 时保留。卸载时启动脚本也可交给已登记但未运行的应用。

stdio 按默认应用、相同 Profile 目录、稳定身份排序；`--app` 严格限定目标。公开 `connectDsh` 为兼容保留原来的最新实例优先默认行为，新增可选 `application` 和 `strictApplication`。启动锁内再次检查端点并按已登记的程序路径检查系统进程；Windows 上经 Windows PowerShell 从 CIM 读取进程列表，以 UTF-8 JSON 的 Base64 传回，因为 PowerShell 重定向输出使用控制台代码页，会弄乱非 ASCII 路径。应用已运行但插件未就绪时只等待。macOS 官方应用不使用 `-n` 或 Next 参数，数据目录通过 `open --env` 显式传递。不扫描未登记的安装。真实安装包的焦点行为仍须图形验收。
