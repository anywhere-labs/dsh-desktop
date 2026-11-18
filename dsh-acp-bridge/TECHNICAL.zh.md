# DSH ACP Bridge 技术说明

[English](TECHNICAL.md)

面向开发和联调。使用方法见 [README](README.zh.md)。

## 链路

```text
ACP 客户端（Zed 等）
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

- 每个 ACP 连接遵循和编辑器连接一样的规则：连接结束时，它发起、还在执行的任务会被取消，它排队的消息会被撤回。
- 客户端不会自动重连：一个端点只属于一个 DSH 进程，DSH 重启后换成新的端点。重新调用 `connectDsh`，再 `initialize`，然后用 `session/load` 或 `session/resume` 接着使用会话。
- 其他语言的程序可以直接实现这份契约：读记录、核对 `hello` 的证明、把令牌放进调用 metadata、在 `connect` 上收发 ACP 消息，需要能连 Unix 套接字或命名管道的 MeshCall 客户端。目前只验证过 TypeScript 客户端。

### 端点记录与启动脚本

| 路径（相对 `~/.agents-anywhere/dsh-acp`） | 内容 |
| --- | --- |
| `endpoints/<实例 ID>.json` | `{version: 1, protocol: "meshcall", service, instanceId, pid, startedAt, endpoint, token, bridgeVersion, runtimeVersion?}`，权限 0600，原子替换写入 |
| `sockets/<ID 前 16 位>.sock` | Unix 套接字，目录 0700、套接字 0600。路径超过 100 字节（`sockaddr_un` 的上限）时，改为在系统临时目录下用 `mkdtemp` 新建一个 0700 目录（名字以 `aa-dsh-acp-` 开头），卸载时连同目录删除 |
| `bin/dsh-acp`、`bin/dsh-acp.cmd` | 启动脚本，用 DSH 进程的 `process.execPath` 运行本包的 `lib/stdio.js`。DSH 运行在 Electron 上、且自身以 `ELECTRON_RUN_AS_NODE=1` 运行时（说明这个 Electron 允许 Node 模式），脚本同样设置这个变量；其他 Electron 宿主改用 `PATH` 里的 `node`，避免拉起第二个应用 |

- 插件使用的目录如果是符号链接、不是目录或属于其他用户，插件拒绝启动，不会跟随链接或修改其权限。
- 每个加载了插件的 DSH 进程各写一条记录；卸载插件时删除自己的记录和套接字。插件启动时删除进程已退出的记录，客户端也从不选择这样的记录。
- 客户端按启动时间从新到旧尝试各条记录：先用随机 nonce 调用 `hello` 并校验证明，校验不通过（PID 被复用、套接字或管道名被别的程序占用）就跳过，校验通过后才在 `info` 和 `connect` 中发送令牌。启动脚本的 `--instance` 和客户端的 `instance` 按 ID 前缀指定实例。
- meshcall 0.3.0 可能把一个还在建立时就失败的调用报告为未处理的 Promise 拒绝，尽管调用方会等待并处理同一个失败（DSH Desktop 打了补丁，见 anywhere-labs/deepseek-harness-desktop#1574）。启动脚本遇到这种情况只把它写到标准错误，继续转发，不会退出；使用客户端接口、需要长时间运行的程序也应该这样处理 `unhandledRejection`。
- Windows 命名管道为 `\\.\pipe\agents-anywhere-dsh-acp-<ID 前 16 位>`，同样依靠上面的证明和令牌区分双方。

## ACP 映射

### 方法

| 方法 | 行为 |
| --- | --- |
| `initialize` | 协议版本 1；声明 `loadSession`、`session/list`、`resume`、`close`、`delete`、`fork`；DSH 的附件存储接收 PNG、JPEG、WebP 或 GIF，且新会话使用的模型（DSH 的默认模型）声明支持图片输入时才声明图片，和官方 dsh-acp 的判断一样；DSH 判断不了的情况（模型没有声明、查询失败或超过 5 秒）都按不支持处理；声明嵌入上下文；插件旁边装有 DSH 的 MCP 客户端时声明 HTTP MCP 服务器（stdio 按规范总是支持，已弃用的 SSE 不声明）；声明 `_meta.claudeCode.promptQueueing`，它不属于 ACP 规范，但客户端靠这个标记判断能否在一轮进行中继续发消息（最早由 claude-agent-acp 声明） |
| `session/new` | 校验 `cwd` 为存在的绝对目录（转为真实路径）和客户端声明的 MCP 服务器，只分配会话 ID 并返回配置项；第一条消息时才在 DSH 中创建，MCP 服务器在这条消息交给 DSH 之前挂上 |
| `session/load` | 跟随会话，先回放最近 1000 条消息（用户消息、思考、回复、工具卡片），挂上客户端声明的 MCP 服务器后再响应；正在生成的一步会接着逐字发送 |
| `session/resume` | 跟随会话但不回放；同样先挂上客户端声明的 MCP 服务器 |
| `session/list` | Session Controller 的会话列表，去掉子 Agent、空白和已归档的会话，按更新时间倒序，每页 100 条。带 `cwd` 时，它和每个会话的目录都先解析成真实路径再比较（Windows 上不区分大小写）：DSH 按打开时的写法保存目录，例如经过符号链接的路径 |
| `session/close` | 取消本连接发起、仍在进行的任务，停止跟随，卸下只有本连接声明的 MCP 服务器 |
| `session/delete` | 在 DSH 里归档这个会话：它从 `session/list` 消失，之后可以在 DSH 里恢复。先取消本连接在这个会话里的消息，并最多等 5 秒让那一轮结束；DSH Desktop 或其他客户端发起的一轮还在运行时，请求失败，会话保留 |
| `session/fork` | 先校验客户端声明的 MCP 服务器，有误时不复制；DSH 把会话到最后一轮结束为止的历史复制成一个新会话，本连接随后像 `session/resume` 一样跟随它；原会话不变 |
| `session/set_config_option` | 见下文配置项，返回完整配置 |
| `session/prompt` | 已注册的斜杠命令直接执行；其他输入作为排队消息发给 DSH，等这条消息所在的轮次结束后返回。同一会话还有消息在执行时再发的消息，会和在 DSH Desktop 里回复期间按回车一样在 DSH 队列里等待，轮到时单独占一轮；插件按发送顺序把消息交给 DSH。图片以外的嵌入二进制资源，会先像 DSH Desktop 上传用户添加的文件一样上传到会话的 Agent，再作为文件附件随消息发出。带图片的消息先按它要用的模型检查（会话当前的模型；DSH 还没创建的会话用客户端选的模型或 DSH 的默认模型）：这个模型声明不支持图片输入时，请求以参数错误结束，DSH 不创建会话、不上传文件，也收不到消息；模型没有声明时交给 DSH，DSH 会接收图片。DSH 收消息时拒绝的图片或文件，同样报参数错误 |
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

一步输出没有完成就被放弃时，已经发出的文字无法撤回，会补一句提示，完成的消息随后完整发出。

在一步输出到一半时 `session/load`，快照里这一步是 DSH 的压缩记录（`text-chunks`、`reasoning-chunks` 等），插件展开后先发出已生成的部分，后续片段接着实时发送；遇到无法识别的记录就不回放这一步，等它完成后完整发出。

### 配置项

| ID | 类别 | 说明 |
| --- | --- | --- |
| `model` | `model` | 值为 `provider/model`，按可路由的 provider 分组；切换时保留当前推理强度，新模型不支持则用其默认值 |
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
- **延迟创建**：编辑器每开一个对话都会调用 `session/new`，第一条消息时才创建，避免在 DSH 里留下空会话和常驻 Agent。
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
- 子 Agent（按基础 bundle 的方式挂载进程内后端和 `subagent` 工具）：消息要等它派出的子 Agent 以及子 Agent 结果开启的那一轮都结束才返回；等待期间的取消、关闭和下一条消息；以及等待期间 DSH Desktop 发来的消息；
- 模型解析失败时返回错误、会话不被锁住；
- 审批（请求排在它指向的卡片之后、客户端放弃作答时由 DSH 回落处理、DSH 先作答时撤回客户端上的请求、客户端打开会话前 DSH 就在等的请求）、表单、不支持表单的客户端回答单选问题、图片输入（按 DSH 的默认模型声明、模型不支持图片输入时在 DSH 创建会话前拒绝、模型没有声明时交给 DSH、DSH 自己的拒绝报参数错误）和文件附件；
- 待办清单作为计划、`session/delete`（包括 DSH Desktop 还在运行的会话）、`session/fork`，以及 `session/list` 经过符号链接的 `cwd` 过滤；
- 配置与 DSH 端切换模型的同步、智能体团队协作开关的双向同步（按基础 bundle 的方式挂载智能体团队）、斜杠命令；
- 客户端声明的 MCP 服务器（用测试里的本地 stdio 服务器）：新会话第一条消息时挂上、只属于这个会话、关闭后进程结束；声明有误时在创建或复制会话之前返回参数错误；服务器起不来时消息报错并给出名称；两个客户端共用同一个声明、同名不同配置被拒绝；`session/load` 时挂上、断开连接后卸下；
- 令牌校验、端点身份证明、超长路径改用临时目录、启动脚本，以及启动脚本遇到迟到的未处理拒绝后继续转发；
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

自动化检查和这些联调都没有覆盖：真实模型的回复、真实的 Zed 等编辑器、DSH Desktop 的 Electron 运行环境（包括装进 Profile 的插件挂载编辑器声明的 MCP 服务器）、Windows 命名管道、同时运行多个 DSH，以及自动化检查所用的 0.2.2-rc.4、2026-11-17 联调所用的 0.2.2-rc.3 以外的 DSH 版本。
