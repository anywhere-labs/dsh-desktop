# DSH ACP Bridge technical notes

[中文说明](TECHNICAL.zh.md)

For development and integration testing. For usage, see the [README](README.md).

## Path

```text
ACP client (application, script or automation tool)
  │ stdio, one JSON-RPC message per line
  ▼
lib/stdio.js (run by the launcher)
  │ MeshCall duplex call over a Unix socket or a Windows named pipe, with a token
  ▼
The plugin inside the DSH process
  ├ AcpRpcService.connect: one call per ACP connection, messages passed through unchanged
  ├ AcpConnection: the Agent side of ACP v1 (@agentclientprotocol/sdk 1.4.0)
  │   └ AcpSession: one per session; creates, prompts, cancels and switches models through sessionController, and follows its events
  └ InteractionHub: receives approvals and questions from DSH's $events interaction stream (a single one) and hands them to the clients attached to that session
```

The plugin creates no Agent of its own. Everything goes through the Session Controller that the DSH Web client uses, so DSH keeps managing the sessions: DSH Desktop, the Agents Anywhere plugin and several ACP connections can use one session at the same time.

Programs can skip the launcher: the public client in `lib/client.js` opens the same call (see [Client API](#client-api)), and the launcher itself is built on it.

## Local RPC

The plugin listens directly inside the DSH process (MeshCall direct mode, no Router). This local RPC is a public interface, contract version 1: besides the launcher, other programs of the same user can reach DSH through it, with the client API below or with any MeshCall client that follows the contract. The service is `aa.dsh.acp.v1.Acp`:

| Method | Shape | Description |
| --- | --- | --- |
| `hello` | Unary | No token required. Takes `{nonce}` (16–256 characters) and returns `{proof}`: an HMAC-SHA256 (base64url) of `agents-anywhere-dsh-acp/1 endpoint <nonce>` keyed with the token. Clients use it to confirm that the endpoint is the process that wrote the record |
| `info` | Unary | Returns `{protocol: "agents-anywhere-dsh-acp", version: 1, acpProtocolVersion, bridgeVersion, runtimeVersion?, pid, connections, followed, interactions: {approvals, questions}}`: the plugin and DSH versions, the ACP protocol version, the DSH process, the number of ACP connections, the number of followed sessions, and whether approvals and questions are connected |
| `connect` | Duplex | The request is `{}`; input and output items are ACP JSON-RPC messages, never rewritten; when either side ends, this ACP connection ends |

- `info` and `connect` require the call metadata `aa-acp-token` to match the token in the endpoint record, compared through fixed-length digests in constant time.
- Frames keep MeshCall's default limit of 64 MiB; the client pings every 15 seconds and the server disconnects only after 45 seconds without data.

### Contract and compatibility

Contract version 1 is made of the endpoint records (`version: 1`), the service `aa.dsh.acp.v1.Acp` with its three methods and their fields, the call metadata `aa-acp-token`, the endpoint proof over `agents-anywhere-dsh-acp/1 endpoint <nonce>`, and the `protocol` and `version` that `info` reports. `tests/unit/contract.test.ts` pins these values.

- Within version 1, changes only add: new optional fields in records and in `info`, and new methods. Clients ignore fields they do not know.
- A breaking change (renaming or removing a field, a method or the metadata key, or changing the proof) takes version 2: the service `aa.dsh.acp.v2.Acp`, records with `version: 2` and the proof prefix `agents-anywhere-dsh-acp/2`. Clients of version 1 skip records of another version and report that no DSH is running instead of failing in the middle of a session.
- The package version follows semantic versioning for this contract: a breaking change is a major release.
- What `connect` carries is ACP: `initialize` negotiates its version on each connection, independently of the contract version.

### Client API

`@agents-anywhere/dsh-acp-bridge/client` needs only Node.js and meshcall, not DSH. The launcher is built on it.

| Export | Description |
| --- | --- |
| `connectDsh(options?)` | Tries the running instances from the newest, has each prove that it holds its record's token before the token is sent, and returns a `DshConnection`. Options: `home` (the records' directory), `instance` (an instance ID or a prefix of it), `timeoutMs` for `hello` and `info` (5000 by default), `peerId` and `logger` |
| `DshConnection` | `record` and `info` of the instance reached; `fetchInfo()` for current figures; `openAcpStream()` opens one ACP connection as a stream for the ACP SDK's `client(...).connect()`; `openAcpCall()` opens one as the raw duplex call (`send`, `closeSend`, `cancel` and async iteration); `close()` ends every ACP connection opened through it |
| `listInstances(options?)` | The records of the running instances of contract version 1, newest first |
| `acpStream(call)` | A raw call as an ACP SDK stream |
| `DshAcpError` | `code` is `no-instance` (no running DSH, or none matching `instance`) or `unreachable` (every instance failed); `failures` lists each instance tried, as `unproven` or `error` |
| `CONTRACT_VERSION`, `PROTOCOL`, `RPC_SERVICE`, `TOKEN_METADATA`, `defaultHome()` | The contract identifiers and the default records directory |

```ts
import { client, methods } from '@agentclientprotocol/sdk'
import { connectDsh } from '@agents-anywhere/dsh-acp-bridge/client'

const dsh = await connectDsh()
const acp = client({ name: 'my-tool' }).connect(dsh.openAcpStream())
await acp.agent.request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: {} })
const { sessionId } = await acp.agent.request(methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] })
await acp.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'Hello' }] })
await dsh.close()
```

- Each ACP connection follows the same connection lifecycle rules: when it ends, the prompts it started that are still running are cancelled and its queued messages are withdrawn.
- The client never reconnects: an endpoint belongs to one DSH process, and a restarted DSH serves a new one. Call `connectDsh` again, then `initialize` and `session/load` or `session/resume` to continue a session.
- Programs in other languages can implement the contract directly: read the record, check the `hello` proof, send the token as call metadata, and exchange ACP messages over `connect`, with a MeshCall client that reaches Unix sockets or named pipes. Only the TypeScript client has been verified.

### Endpoint records and the launcher

| Path (relative to `~/.agents-anywhere/dsh-acp`) | Content |
| --- | --- |
| `endpoints/<instance ID>.json` | `{version: 1, protocol: "meshcall", service, instanceId, pid, startedAt, endpoint, token, bridgeVersion, runtimeVersion?, launcher?}`, mode 0600, written by atomic replacement. `launcher` is the `{runtime, electron, script}` this instance's launcher runs, used when another instance hands the launcher over |
| `sockets/<first 16 ID characters>.sock` | Unix socket, directory 0700, socket 0600. When the path exceeds 100 bytes (the `sockaddr_un` limit), the plugin instead creates a fresh 0700 directory in the system temporary directory with `mkdtemp` (its name starts with `aa-dsh-acp-`) and removes it, directory included, on unload |
| `bin/dsh-acp`, `bin/dsh-acp.cmd` | The launcher, which runs this package's `lib/stdio.js` with the DSH process's `process.execPath`. When DSH runs on Electron and itself runs with `ELECTRON_RUN_AS_NODE=1` (proof that this Electron allows Node mode), the launcher sets the same variable; any other Electron host uses `node` from `PATH` instead, so the launcher never starts a second application. `--version` prints one line, the plugin version, without reaching DSH, so clients can read the version as they do from ACP agents |
| `bin/dsh-acp.json` | The launch description `{version: 1, command, args, env}`: the program the launcher runs, its arguments (`lib/stdio.js`) and the environment variables to add. Programs that start processes without a shell (on Windows, for example, those that cannot run a `.cmd`) start the bridge from it directly, with their own arguments after `args`. Written, kept, handed over and removed with the launcher; within version 1 it only gains fields |

- If a directory the plugin uses is a symbolic link, not a directory, or owned by another user, the plugin refuses to start; it never follows the link or changes its permissions.
- Every DSH process that loads the plugin writes one record and removes its own record and socket when the plugin unloads. A starting plugin removes records whose process has exited, and clients never pick such a record.
- What becomes of the launcher: it stays when DSH stops, so that a client can start DSH again, and is withdrawn when the plugin unloads while DSH runs on (disabled, removed, uninstalled or reloaded). The scopes around the plugin tell the two apart: when DSH stops they unload first, so an enclosing fiber has lost its ID, and the root fiber has left its running state. Withdrawing leaves alone a launcher another instance has rewritten since; otherwise it hands the launcher to the newest other running instance whose plugin files and program still exist (rewriting it from that instance's `launcher` record field), or, without one, removes it with the empty directories the plugin made (`bin`, `endpoints`, `sockets` and the home itself).
- Clients try the records from the newest to the oldest start time: they first call `hello` with a random nonce and verify the proof, skip the record when verification fails (a reused PID, or a socket or pipe name taken by another program), and only after a successful verification send the token with `info` and `connect`. The launcher's `--instance` and the client's `instance` select an instance by ID prefix.
- meshcall 0.3.0 can report a call that failed while it was still being opened as an unhandled promise rejection, although the caller awaits the same failure (DSH Desktop patches it, see anywhere-labs/deepseek-harness-desktop#1574). The launcher writes such a rejection to standard error and keeps forwarding instead of exiting; a long-running program that uses the client should handle `unhandledRejection` the same way.
- The Windows named pipe is `\\.\pipe\agents-anywhere-dsh-acp-<first 16 ID characters>`; the same proof and token tell the two sides apart.
- Before it runs anything, the launcher checks that this package's `lib/stdio.js` and the runtime (when it is an absolute path) still exist. When the plugin was uninstalled, or DSH was uninstalled or moved, it prints why and exits with 1 instead of leaving Node.js to report a module error. An AppImage's program exists only while that AppImage runs (mounted under `/tmp/.mount_*`); the launcher then asks for DSH to be opened first. The Windows `.cmd` switches to code page 65001 before cmd reads its Chinese messages.

### Starting DSH Desktop

When `lib/stdio.js` finds no running instance (`no-instance`) and none of `--instance`, `--check` or `--no-start` was given, it starts the DSH Desktop that wrote it and waits for the plugin to be ready:

- Only a launcher that runs on Electron (written by DSH Desktop) starts the app; one that runs on Node.js (written by the DSH command line) reports the error as before.
- macOS starts the app through LaunchServices: `open -n -g <app bundle> --args --next-background`. Started as the client's child, the app would count the client as its responsible process, which breaks Local Network access (anywhere-labs/deepseek-harness-desktop#1515). `-n` hands the argument to an instance that is already running as well.
- Windows and Linux start the executable directly and detached, with the same `--next-background` argument, in an environment without `ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ATTACH_CONSOLE` and `NODE_OPTIONS`, so the app starts as itself.
- DSH Desktop (Next and Beta) started with `--next-background` starts its Host as usual but shows only its tray icon and opens no window; without a usable tray it opens the window anyway. A running instance that receives a second start with this argument leaves its windows alone. The argument is not carried into later restarts. Earlier releases ignore it and open their window.
- The launcher then connects every 0.5 seconds and keeps waiting through `DshAcpError` (no instance yet, or one it cannot reach yet), for up to `--start-timeout` seconds (90 by default; DSH Desktop's Host startup limit defaults to 60 seconds). Reaching the limit means the plugin did not load: the current DSH Profile has not enabled it, or DSH stopped at first-run setup, recovery or an update.

## ACP mapping

### Methods

| Method | Behavior |
| --- | --- |
| `initialize` | Protocol version 1; declares `loadSession`, `session/list`, `resume`, `close`, `delete` and `fork`; declares images only when DSH's attachment storage takes PNG, JPEG, WebP or GIF and the model new sessions start with (DSH's default model) declares image input, as the official dsh-acp decides it; whatever DSH cannot tell (no declaration, a failed lookup, or one slower than 5 seconds) counts as no; declares embedded context; declares HTTP MCP servers when DSH's MCP client is installed beside the plugin (stdio is always supported, as the protocol requires, and the deprecated SSE is not declared); declares `_meta.claudeCode.promptQueueing`, which is not part of the ACP schema but is the flag clients read before they send a prompt while a turn runs (first advertised by claude-agent-acp); declares `_meta.steering.supported: true` at the top level of the response for `_session/steering` below |
| `session/new` | Checks that `cwd` is an existing absolute directory (resolved to its real path) and checks the MCP servers the client declares, only allocates a session ID and returns the configuration options; DSH creates the session with the first message, and the MCP servers are mounted before that message goes to DSH |
| `session/load` | Follows the session, replays its latest 1000 messages (user messages, reasoning, replies, tool cards) and mounts the MCP servers the client declares before responding; a step still being generated continues streaming |
| `session/resume` | Follows the session without replay, again mounting the MCP servers the client declares first |
| `session/list` | The Session Controller's session list without subagent, blank or archived sessions, newest update first, 100 per page. With `cwd`, both it and each session's directory are resolved to real paths before they are compared (case-insensitively on Windows): DSH keeps a directory as it was opened, through a symbolic link for example |
| `session/close` | Cancels the task this connection started that is still running, stops following, and unmounts the MCP servers only this connection declared |
| `session/delete` | Archives the session in DSH, which leaves `session/list` and can be restored in DSH. This connection's own prompts in the session are cancelled first, and the plugin waits up to 5 seconds for that turn to end; while a turn started by DSH Desktop or another client runs, the request fails and the session stays |
| `session/fork` | Checks the MCP servers the client declares first and copies nothing when they are wrong; DSH copies the session's history up to its last finished turn into a new session, which the connection then follows like `session/resume`; the original is not changed |
| `session/set_config_option` | See the configuration options below; returns the complete configuration |
| `session/prompt` | A registered slash command runs directly; any other input goes to DSH as a queued message, and the request returns when the turn that took the message ends. A prompt sent while another one of the session is still running waits in the DSH queue, as Enter does in DSH Desktop during a reply, and runs in a turn of its own; the plugin hands the messages to DSH in the order they were sent. Embedded binary resources other than images are uploaded into the session's Agent first, as DSH Desktop uploads the files a user adds, and go with the message as file attachments. A message with images is first checked against the model it will run on (the session's current model; for a session DSH has not created, the client's choice or DSH's default): when that model declares no image input, the request fails with invalid params and DSH creates, uploads and receives nothing; a model that declares nothing is left to DSH, which accepts the images. An image or file DSH refuses when the message arrives is reported as invalid params as well |
| `_session/steering` | The steering extension, with the name and shape the Codex and Claude ACP agents use: parameters `{sessionId, prompt}` (`_meta.steering.idleBehavior` needs no reading), answer `{outcome}`. While a turn of the session runs, the content is checked and converted as for `session/prompt` and handed to DSH with `mode: "steer"`; as with steering in DSH Desktop, the model receives it at the turn's next step, and the answer is `injected`. A turn that is closing runs another step for it. Before DSH has created the session, or while nothing runs, the answer is `promptRequired` and the client sends a normal prompt instead: steering never starts a turn, which would leave no prompt to answer for it. The message DSH records for the steering is not echoed to the connection that sent it; other connections receive it as `user_message_chunk` |
| `session/cancel`, `$/cancel_request` | `session/cancel` stops every prompt this connection sent in the session, `$/cancel_request` stops one. While DSH is still creating the session or a command is still running, the message is not sent and the command is aborted; a message still queued is removed from the queue; a turn already running is cancelled as DSH's Stop does, which keeps other clients' queued messages. Cancelling a running turn also withdraws the messages this connection queued behind it (see "Turns and stop reasons") |

Not supported: `session/set_mode`, additional working directories, and the client's file and terminal methods (the Agent never calls them).

### MCP servers

As in the official dsh-acp, every MCP server the client declares in `session/new`, `session/load`, `session/resume` and `session/fork` becomes one DSH `mcp-client` in the session Agent's scope: its tools are named `mcp__<name>__<tool>`, and only the session's Agent and the subagents it starts see them. The checks follow the official ones too: only the stable stdio and HTTP transports are accepted; a stdio command must be an absolute path and starts in the session's working directory; a name outside `[A-Za-z0-9_-]{1,32}` is replaced by a fixed one (its letters and a hash); duplicate servers and invalid or repeated environment variables or headers are invalid params; and every server has to connect and list its tools (`failOnStartupError`), or the request that mounts it fails and names it.

DSH sessions are shared, so mounts are counted per client that follows the session:

- Within one Agent, declarations with the same name and configuration share one server, which is unmounted only when the last client that declared it closes the session, disconnects, or is no longer followed by DSH; a different declaration under the same name is invalid params.
- Each server mounts in a scope made by `createScope(agent.ctx, agent)`, the way DSH's CUA and built-in browser add tools to a running Agent. The plugin loads `@deepseek-ai/dsh-mcp-client` and `@deepseek-ai/dsh-scope` from where it is installed; in a DSH Desktop profile those are the plugin's own copies, and `mcp-client` cannot see the scope tag DSH puts on the Agent, so it would take servers of the same name in different sessions for a conflict. With a scope of that copy made below `agent.ctx` and keyed by the Agent, DSH still registers the tools for that Agent through the tag the scope inherits, and `mcp-client` keeps names apart per Agent. A mount is checked once more afterwards: tools that show up in the view every session shares are unmounted at once, with an error.
- Opening a session mounts the servers in its Agent of the moment; before each message goes to DSH, the plugin checks that they are still mounted in the session's current Agent and mounts them again if DSH replaced it.
- Without those two packages beside the plugin, `initialize` declares no HTTP, and client-declared servers are logged once and left out.

### Updates

| DSH | ACP |
| --- | --- |
| User messages sent from other clients, replayed history | `user_message_chunk` |
| Streamed chunks (`assistant-stream` frames) | `agent_message_chunk`, `agent_thought_chunk`, merged every 40 milliseconds |
| `assistant/message` | Only the parts not already streamed (images included), followed by `usage_update` |
| `tool/call`, `tool/result` | `tool_call`, `tool_call_update`; the content follows the tool's own presentation (diff, terminal, search, read, web), and without one the kind is inferred from the tool name |
| `session/title` | `session_info_update` |
| The todo list (`todo/write`, and the `todos` projection when a client opens the session) | `plan`, one entry per item with priority `medium`; DSH clears the list when the next turn starts, and the plan is then sent empty |
| Changes of model, permission, Agent mode or plan mode | The configuration options are recomputed and `config_option_update` is sent only when they changed |
| The first message creates the session | `config_option_update` with the options of the created session: `agent_preset` is gone, and `plan_mode` appears when DSH has loaded plan mode |
| Changes to the command or skill catalog | `available_commands_update` |
| A turn starts or ends (`turn/start`, `turn/end`) | `session_info_update` carrying only `_meta.dsh.turnEvent`, see below |

When a step is abandoned before its output completes, text already sent cannot be taken back: a short notice follows, and the completed message is then sent in full.

ACP reports the end of a turn only by answering the `session/prompt` that started it, so clients cannot tell when turns end that DSH Desktop, other clients or subagent results started. For a session it follows, the plugin therefore sends a `session_info_update` carrying only `_meta` when each turn starts and when it ends (the protocol makes every field of this update optional, for custom metadata). The shape is the `turnEvent` of the Agents Anywhere DSH bridge contract 3.0, §7, so clients reading either share the code:

- Start: `{sessionId, phase: "started", turn, seq}`, with DSH's turn number and the sequence number of the `turn/start` event. It goes out with the turn's first update rather than when `turn/start` arrives: DSH opens a turn before it takes the queued message, and the answer to this connection's earlier prompt must come first.
- End: `{sessionId, phase: "ended", turn, seq, stopReason, reason}`, after the turn's last update and before the answer to the prompt it ends. `stopReason` is ACP's stop reason (the same rules as for `session/prompt`; a failed turn reports `end_turn`), and `reason` is DSH's `{kind}`, with `message` when the turn failed.
- Sent while following live, never during replay; a client that opens a session halfway through a turn receives only that turn's end.

When `session/load` arrives halfway through a step, the snapshot holds that step as DSH's compact records (`text-chunks`, `reasoning-chunks` and others). The plugin expands them to send what has been generated so far, and the following chunks continue live; when it meets a record it does not recognize, it skips replaying the step and sends the step in full once it completes.

### Configuration options

| ID | Category | Description |
| --- | --- | --- |
| `model` | `model` | The value is `JSON.stringify([provider, model])`, as the official dsh-acp sends it, so a slash in a model ID stays unambiguous; the `provider/model` form of earlier releases is still accepted (the provider ends at the first slash). Grouped by routable provider; switching keeps the current reasoning effort, or uses the new model's default when the new model does not support it |
| `reasoning_effort` | `thought_level` | Present only when the current model declares reasoning efforts; a model without a default gets an extra `default` |
| `permission` | `mode` | DSH permission presets; an existing session switches through the `/permission` command, as DSH's own composer does |
| `agent_preset` | None | Present only before the first message |
| `plan_mode` | None | Present once the session exists and DSH has loaded plan mode; a boolean when the client declares support for boolean options, otherwise an `on`/`off` select |
| `agent_team` | None | DSH's Team mode, the 「启用智能体团队协作」 switch of its model menu (`ctx.agentTeams` of `@deepseek-ai/dsh-agent-team`); present when DSH composes agent teams, as a boolean or an `on`/`off` select like `plan_mode`. It turns the shared task board, its tools and guidance on or off for the whole subagent tree, not subagents themselves. New sessions start without it; a choice made before the first message is applied when DSH creates the session. Unlike DSH Desktop, the client asks for no confirmation before turning it off, so the option's description mentions the cache cost |

### Turns and stop reasons

Each prompt gets a `requestId`, which DSH records on the queued message and in `user/message.source.rpcId`. When a turn starts, DSH takes the oldest queued message for it, and writes `user/message` only after the model resolves, so a turn can fail or be cancelled before the message is written. The plugin therefore follows the queue, for each prompt of this connection:

- it keeps a copy of the queue, starting from the `inbox` projection of the follow snapshot and applying `agent/inbox/spliced`;
- when this message is taken (a removal without `outcome`), it records the current turn, and from that turn's `turn/end` waits for the session to go quiet (below);
- when this message is discarded (`outcome: "canceled"`, by this client's cancellation, by DSH Desktop or by another client), it returns `cancelled`;
- `user/message` still confirms the same turn.

A subagent started with the `subagent` tool works in the background after its turn ends, and its result reaches the Agent as a message (`source.kind: "subagent-settled"`) that starts another root turn. Like the official `@deepseek-ai/dsh-acp`, the plugin therefore returns a prompt only once the session is quiet: the Agent is idle (`whenIdle`), its subagent tree has no work (`ctx.subagents.waitForTreeWork`, read structurally, so compositions without subagents work unchanged), no event was written meanwhile (`session.seq`), and the follow stream has delivered every event up to that point. Every root turn until then is part of the prompt, whether a subagent's result or another client's message started it, as in the official implementation. Two cases end the wait early: this connection's next prompt being taken by a turn, which answers the waiting prompt before the next one's first update, and cancellation (below).

`usage` is the sum over the steps of every turn the prompt took part in. The response leaves after the last update of its last turn and before any update of the next one: ACP updates do not name the prompt they belong to, so clients file each update under the prompt they have no response for yet.

The last turn the prompt took part in decides how it ends:

| `turn/end` | `stopReason` |
| --- | --- |
| `completed` | `end_turn` |
| `max-tokens` | `max_tokens` |
| `interrupted`, `aborted` (cancelled by the user or a parent) | `cancelled` |
| `aborted` (by a hook), `blocked`, `forked` | `end_turn` |
| `error` | A JSON-RPC internal error carrying DSH's error message |

Once the client has asked to cancel, the prompt returns `cancelled` however the turn ends. A prompt that waits for its subagents returns `cancelled` at once, as in the official implementation: a root turn still running is cancelled, and the subagents keep working, as they do after DSH Desktop's Stop. `session/close` and a lost connection do the same and never tear the subagent tree down, since the session is DSH Desktop's too.

After a turn that completes, DSH goes on to the next queued message. After any other ending (cancelled, failed, blocked), it takes no queued message until new input arrives, and DSH Desktop keeps them waiting in its queue. An ACP prompt cannot wait for that, so when such a turn ends and the Agent stays idle, the plugin removes the messages this connection still has in the queue and ends their prompts: with `cancelled` after a cancelled turn, otherwise with a JSON-RPC error saying that the message was not sent.

### Approvals and questions

DSH sends every approval or question to all owner clients (DSH Desktop, Web, the Agents Anywhere plugin and this plugin); the first result counts and the others receive a cancellation. The gateway waits for a reply to every delivery, so this plugin opens a single interaction stream and replies exactly once to each delivery: it replies `next` when the request is neither an approval nor a question, when no ACP connection is attached to the session, or when no client answered. When a reconnect delivers the same request again, the decision already in progress replies on the new connection. The plugin handles only the ACP connections attached to the session:

- Approvals: DSH delivers an approval on the interaction stream, which can overtake the `tool/call` event on the follow stream, while ACP clients look up the tool card a permission request points at by its ID. The plugin therefore waits, for at most 2 seconds, until it has seen the matching tool call, sends the earlier updates, and then sends `session/request_permission` with the card's ID and title (some clients show only the request) and the options "Allow once" and "Reject". A call this connection never received as a card (it attached without replay, or the call did not arrive in time) is described in full in the request instead. When the client cancels or fails, it replies `next` so other clients can answer.
- Questions: when the client declares `elicitation.form`, it sends a form. A single choice becomes `oneOf`, a multiple choice `items.anyOf`, and a question without options a required text field; an optional question gets an extra "other answer" field, which replaces the selected option of a single choice. An accepted form becomes the DSH answer; declining or cancelling counts as the user cancelling the questions. A client without forms gets single-choice questions, plan reviews included, as `session/request_permission` choices: each question opens a card of its own (the plan of a review is its content), then a request points at it with one option per answer, and the card closes with the choice. Options of an approval question keep their grant and refusal kinds, and a plan review offers "Approve plan" and "Keep planning". Dismissing a question leaves the whole request to DSH. A request with a multiple-choice or typed answer still gets a short notice, and is left to DSH.
- When the session closes, stops being followed or loses its connection, the requests still waiting are withdrawn.
- Subagents never reach this channel. DSH starts an in-process subagent with the approval policy `never` (`approval/policy` with `source: "delegation"` in the child's log), so an approval it asks for is rejected on the spot (`approval/asked`, then `approval/decided` with `rejected`, delivered to no client), and `ask_user_question` fails with "human interaction is unavailable while the calling agent is owned by another live agent". DSH Desktop sees none of them either, so there is nothing to forward. A subagent inherits the parent's permission preset only when it is `auto` or `danger-full-access`.
- A request DSH sent before any ACP connection followed its session was passed on with `next`, and waits in DSH Desktop or another client. The gateway delivers every request that is still waiting to a newly opened interaction stream, so when a connection starts following a session for which the gateway reports waiting approvals or questions (`getPendingRemoteEvents`), the plugin reopens its stream and the request reaches the client too. A decision already in progress replies on the new stream; nothing is held back, so DSH behaves as before when no client answers.

## Design decisions

- **Not mounting the official `@deepseek-ai/dsh-acp` directly**: the official implementation assembles its own Agent with `agents.create`, installs only model selection and MCP, and mounts no Agent preset; the DSH Desktop and Web profiles keep every tool in presets, so sessions mounted that way have no tools. It also owns its sessions exclusively, so sessions DSH has already loaded cannot be resumed.
- **Built on the Session Controller**: the same multi-client semantics as the DSH Web client; sessions appear in DSH Desktop, and approvals and questions can be answered on either side.
- **Following dsh-acp-enhanced's features without reusing its code**: it is a separate profile that owns its Agent; streaming, tool cards, forms, commands and history replay are reimplemented here on the Session Controller.
- **Deferred creation**: a client's `session/new` request reserves an ID; DSH creates the session only with the first message, leaving no empty sessions or idle Agents behind.
- **No escaping rejections**: DSH treats an unhandled promise rejection as fatal and ends the whole process, so every asynchronous path catches its errors; messages written after a connection ends are dropped.
- **Close wins**: a session can be closed by `session/close` or a lost connection while `session/load` or the first message's session creation is in progress. The connection registers the session before following it, and every await is followed by a check for closure; a closed session stops following, sends no message and is never attached to approval routing again. Loading the same session again on one connection first closes the earlier view, including one still opening.
- **Backlog limit**: when a client stops reading, MeshCall's flow control keeps sends waiting. Once more than 20000 updates are queued for one session, the connection is closed, so the DSH process's memory cannot grow without bound.

## Development and tests

Node.js `^22.19.0 || >=24` and Corepack are required. This package is a member of the DSH Desktop repository's root Yarn workspace; install the dependencies and run its check from the repository root:

```bash
corepack yarn install --immutable
corepack yarn workspace @agents-anywhere/dsh-acp-bridge check
```

`check` runs the type check (sources and tests), the build, the unit tests and the integration tests, and needs no database, Python or model service; the repository root's `corepack yarn check` runs it too. The integration tests start real DSH services in-process (session store, Gateway, AgentLoop, Session Controller, approvals and questions, with only the model replaced by a script), load the build output, and drive it with an ACP SDK client through a real `lib/stdio.js` child process. They cover:

- creation, streamed replies, listing and replay (including a load halfway through a step), and live sync of messages from other clients;
- cancellation at each moment after sending, while DSH creates the session, while a slash command runs, and when DSH Desktop removes the queued message;
- prompts sent while another one runs: each waits in the DSH queue and gets a turn of its own; `session/cancel` with queued prompts, cancelling one queued prompt, cancelling the running one, and a turn ahead of them that fails or is stopped by another client;
- steering: inserted halfway through a turn, DSH runs another step for it and the model receives it; not echoed to the connection that sent it, received by the others; `promptRequired` before DSH creates the session and while it is idle; errors for empty content, an unknown session and missing parameters;
- turn boundaries: the start before the turn's first update, the end after its last update and before the prompt's answer; a queued prompt's turn starting only after the prompt before it is answered; a turn DSH Desktop starts reaching a connection that only follows the session with both boundaries;
- subagents (the in-process backend and the `subagent` tool, as the base bundle mounts them): a prompt returns only after its subagent and the turn its result starts; cancelling, closing and the next prompt while the prompt waits; and a DSH Desktop message during the wait;
- an error when model resolution fails, without locking the session;
- approvals (each request after the card it points at, DSH falling back when the client gives no answer, withdrawing the client's request when DSH answers first, and a request DSH was already waiting for when the client opened the session), forms, single-choice questions for clients without forms, image input (offered by DSH's default model, refused before DSH creates the session for a model without image input, left to DSH for a model that declares nothing, DSH's own refusals as invalid params) and file attachments;
- the todo list as the plan, `session/delete` (including a session DSH Desktop still runs), `session/fork`, and the `cwd` filter of `session/list` through a symbolic link;
- configuration, sync of model switches made in DSH (model values in the official form, with the earlier `provider/model` still accepted), the agent team switch in both directions (with agent teams mounted as in the base bundle), and slash commands;
- MCP servers the client declares (with a local stdio server from the tests): mounted with a new session's first message, visible to that session only, and their process ended on close; declarations with errors refused as invalid params before a session is created or copied; a server that does not start failing the prompt with its name; two clients sharing one declaration, and a different server under the same name refused; mounting on `session/load` and unmounting on disconnect;
- token checks, endpoint proof, the temporary directory for overlong paths, the launcher, `--version` without DSH, and a launcher that keeps forwarding after a late unhandled rejection;
- starting DSH Desktop: the start on each platform, the Node-mode variables left behind, a failing `open` and a missing executable, and connecting when the plugin publishes its record only after the launcher has looked once; the launcher's messages when the plugin or DSH is gone (running the generated script in a shell; the Windows script is checked as text); the launcher kept when DSH stops and removed when only the plugin unloads, and taken over by the other of two DSH sharing one home; the launch description written, kept, handed over and removed with the launcher, and reaching DSH when started as it describes;
- the public client, loaded from the built package: the ACP SDK over its stream and a raw call, refusing an endpoint that cannot prove itself before sending it the token, offering only running instances of contract version 1, failing at once when DSH exits, and needing nothing beyond Node.js and meshcall; and the pinned contract values;
- no remaining follows, and an undisturbed DSH, after a client is killed while creating a session, opening a session or running a turn, after `session/close`, and after repeated loads.

To link-install into a local DSH for manual testing:

```bash
corepack yarn workspace @agents-anywhere/dsh-acp-bridge build
cd dsh-acp-bridge
dsh plugin --profile desktop add "link:$PWD"
```

After restarting DSH, confirm that the plugin is ready with `~/.agents-anywhere/dsh-acp/bin/dsh-acp --check`.

Manual test record (2026-11-17): with the npm-published DSH 0.2.2-rc.3 CLI, a temporary `DSH_HOME` and the official `web` profile, the plugin was installed with `link:` and `dsh --profile web` was started. The plugin loaded through DSH's plugin mechanism and wrote the endpoint record, socket and launcher with private permissions; `--check` showed approvals and questions connected; an ACP client created a session, read the real model, permission and Agent mode options, the slash menu (DSH commands and skills) and the session list (with the title DSH generated), replayed the session on another connection, switched the permission and toggled plan mode; without a model key, a prompt returned an error carrying DSH's reason and DSH was unaffected; on a normal exit, DSH removed the endpoint record and socket.

After the issues found in review were fixed, the same environment was checked again: `--check` connected after the endpoint proof; without a model key, two consecutive prompts both returned errors and the session was not locked; cancelling right after sending returned `cancelled`; slash commands, listing, replay on another connection, plan mode, permission switches and `session/close` worked, and the other connection received the configuration changes; on SIGINT, DSH removed the endpoint record and socket, and the launcher then reported that no DSH was running.

MCP test record (2026-11-18): in the in-process test DSH, with Context7 configured through DSH's MCP manager (one HTTP and one stdio server), both tool calls of an ACP session and the documentation they returned reached the client in full. The plugin's own copies were verified with the separately installed `mcp-client` and `dsh-scope` of the Next workspace standing in for them while DSH used another copy: two sessions declaring a stdio server under the same name each saw only their own tools, and closing one left the other working; mounting straight into `agent.ctx`, without the scope the plugin makes, failed in the second session because the server name was taken.

Neither the automated checks nor these manual runs covered: replies from a real model, real editors such as Zed, the Electron runtime of DSH Desktop (including a plugin installed in a profile mounting client-declared MCP servers, and the launcher starting DSH Desktop on a real system with only its tray icon), Windows named pipes, several DSH processes at once, or DSH versions other than 0.2.2-rc.4 (the automated checks) and 0.2.2-rc.3 (the 2026-11-17 runs).
