# DSH ACP Bridge technical notes

[中文说明](TECHNICAL.zh.md)

For development and integration testing. For usage, see the [README](README.md).

## Path

```text
ACP client (Zed and others)
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

## Local RPC

The plugin listens directly inside the DSH process (MeshCall direct mode, no Router) as the service `aa.dsh.acp.v1.Acp`:

| Method | Shape | Description |
| --- | --- | --- |
| `hello` | Unary | No token required. Takes `{nonce}` (16–256 characters) and returns `{proof}`: an HMAC-SHA256 (base64url) of `agents-anywhere-dsh-acp/1 endpoint <nonce>` keyed with the token. The launcher uses it to confirm that the endpoint is the process that wrote the record |
| `info` | Unary | Returns the plugin and DSH versions, the ACP protocol version, the number of connections (`connections`), the number of followed sessions (`followed`), and whether approvals and questions are connected (`interactions.approvals/questions`) |
| `connect` | Duplex | The request is `{}`; input and output items are ACP JSON-RPC messages, never rewritten; when either side ends, this ACP connection ends |

- `info` and `connect` require the call metadata `aa-acp-token` to match the token in the endpoint record, compared through fixed-length digests in constant time.
- Frames keep MeshCall's default limit of 64 MiB; the client pings every 15 seconds and the server disconnects only after 45 seconds without data.
- The RPC layer evolves with the package version and is not an external contract; the stable external interface is ACP on the launcher's stdio.

### Endpoint records and the launcher

| Path (relative to `~/.agents-anywhere/dsh-acp`) | Content |
| --- | --- |
| `endpoints/<instance ID>.json` | `{version: 1, protocol: "meshcall", service, instanceId, pid, startedAt, endpoint, token, bridgeVersion, runtimeVersion?}`, mode 0600, written by atomic replacement |
| `sockets/<first 16 ID characters>.sock` | Unix socket, directory 0700, socket 0600. When the path exceeds 100 bytes (the `sockaddr_un` limit), the plugin instead creates a fresh 0700 directory in the system temporary directory with `mkdtemp` (its name starts with `aa-dsh-acp-`) and removes it, directory included, on unload |
| `bin/dsh-acp`, `bin/dsh-acp.cmd` | The launcher, which runs this package's `lib/stdio.js` with the DSH process's `process.execPath`. When DSH runs on Electron and itself runs with `ELECTRON_RUN_AS_NODE=1` (proof that this Electron allows Node mode), the launcher sets the same variable; any other Electron host uses `node` from `PATH` instead, so the launcher never starts a second application |

- If a directory the plugin uses is a symbolic link, not a directory, or owned by another user, the plugin refuses to start; it never follows the link or changes its permissions.
- Every DSH process that loads the plugin writes one record and removes its own record and socket when the plugin unloads. A starting plugin removes records whose process has exited, and the launcher never picks such a record.
- The launcher tries the records from the newest to the oldest start time: it first calls `hello` with a random nonce and verifies the proof, skips the record when verification fails (a reused PID, or a socket or pipe name taken by another program), and only after a successful verification sends the token with `info` and `connect`. `--instance` selects an instance by ID prefix.
- The Windows named pipe is `\\.\pipe\agents-anywhere-dsh-acp-<first 16 ID characters>`; the same proof and token tell the two sides apart.

## ACP mapping

### Methods

| Method | Behavior |
| --- | --- |
| `initialize` | Protocol version 1; declares `loadSession`, `session/list`, `resume` and `close`; declares images when attachment storage is available; declares embedded context; declares no MCP transport; declares `_meta.claudeCode.promptQueueing`, which is not part of the ACP schema but is the flag clients read before they send a prompt while a turn runs (first advertised by claude-agent-acp) |
| `session/new` | Checks that `cwd` is an existing absolute directory (resolved to its real path), only allocates a session ID and returns the configuration options; DSH creates the session with the first message |
| `session/load` | Follows the session and replays its latest 1000 messages (user messages, reasoning, replies, tool cards) before responding; a step still being generated continues streaming |
| `session/resume` | Follows the session without replay |
| `session/list` | The Session Controller's session list without subagent, blank or archived sessions, filtered by the real path of `cwd`, newest update first, 100 per page |
| `session/close` | Cancels the task this connection started that is still running, and stops following |
| `session/set_config_option` | See the configuration options below; returns the complete configuration |
| `session/prompt` | A registered slash command runs directly; any other input goes to DSH as a queued message, and the request returns when the turn that took the message ends. A prompt sent while another one of the session is still running waits in the DSH queue, as Enter does in DSH Desktop during a reply, and runs in a turn of its own; the plugin hands the messages to DSH in the order they were sent |
| `session/cancel`, `$/cancel_request` | `session/cancel` stops every prompt this connection sent in the session, `$/cancel_request` stops one. While DSH is still creating the session or a command is still running, the message is not sent and the command is aborted; a message still queued is removed from the queue; a turn already running is cancelled as DSH's Stop does, which keeps other clients' queued messages. Cancelling a running turn also withdraws the messages this connection queued behind it (see "Turns and stop reasons") |

Not supported: `session/set_mode`, `fork`, `delete`, additional working directories, client-declared MCP servers, and the client's file and terminal methods (the Agent never calls them).

### Updates

| DSH | ACP |
| --- | --- |
| User messages sent from other clients, replayed history | `user_message_chunk` |
| Streamed chunks (`assistant-stream` frames) | `agent_message_chunk`, `agent_thought_chunk`, merged every 40 milliseconds |
| `assistant/message` | Only the parts not already streamed (images included), followed by `usage_update` |
| `tool/call`, `tool/result` | `tool_call`, `tool_call_update`; the content follows the tool's own presentation (diff, terminal, search, read, web), and without one the kind is inferred from the tool name |
| `session/title` | `session_info_update` |
| Changes of model, permission, Agent mode or plan mode | The configuration options are recomputed and `config_option_update` is sent only when they changed |
| The first message creates the session | `config_option_update` with the options of the created session: `agent_preset` is gone, and `plan_mode` appears when DSH has loaded plan mode |
| Changes to the command or skill catalog | `available_commands_update` |

When a step is abandoned before its output completes, text already sent cannot be taken back: a short notice follows, and the completed message is then sent in full.

When `session/load` arrives halfway through a step, the snapshot holds that step as DSH's compact records (`text-chunks`, `reasoning-chunks` and others). The plugin expands them to send what has been generated so far, and the following chunks continue live; when it meets a record it does not recognize, it skips replaying the step and sends the step in full once it completes.

### Configuration options

| ID | Category | Description |
| --- | --- | --- |
| `model` | `model` | The value is `provider/model`, grouped by routable provider; switching keeps the current reasoning effort, or uses the new model's default when the new model does not support it |
| `reasoning_effort` | `thought_level` | Present only when the current model declares reasoning efforts; a model without a default gets an extra `default` |
| `permission` | `mode` | DSH permission presets; an existing session switches through the `/permission` command, as DSH's own composer does |
| `agent_preset` | None | Present only before the first message |
| `plan_mode` | None | Present once the session exists and DSH has loaded plan mode; a boolean when the client declares support for boolean options, otherwise an `on`/`off` select |

### Turns and stop reasons

Each prompt gets a `requestId`, which DSH records on the queued message and in `user/message.source.rpcId`. When a turn starts, DSH takes the oldest queued message for it, and writes `user/message` only after the model resolves, so a turn can fail or be cancelled before the message is written. The plugin therefore follows the queue, for each prompt of this connection:

- it keeps a copy of the queue, starting from the `inbox` projection of the follow snapshot and applying `agent/inbox/spliced`;
- when this message is taken (a removal without `outcome`), it records the current turn and returns at that turn's `turn/end`;
- when this message is discarded (`outcome: "canceled"`, by this client's cancellation, by DSH Desktop or by another client), it returns `cancelled`;
- `user/message` still confirms the same turn.

`usage` is the sum over the turn's steps. The response leaves after the last update of its turn and before any update of the next one: ACP updates do not name the prompt they belong to, so clients file each update under the prompt they have no response for yet.

| `turn/end` | `stopReason` |
| --- | --- |
| `completed` | `end_turn` |
| `max-tokens` | `max_tokens` |
| `interrupted`, `aborted` (cancelled by the user or a parent) | `cancelled` |
| `aborted` (by a hook), `blocked`, `forked` | `end_turn` |
| `error` | A JSON-RPC internal error carrying DSH's error message |

Once the client has asked to cancel, the prompt returns `cancelled` however the turn ends.

After a turn that completes, DSH goes on to the next queued message. After any other ending (cancelled, failed, blocked), it takes no queued message until new input arrives, and DSH Desktop keeps them waiting in its queue. An ACP prompt cannot wait for that, so when such a turn ends and the Agent stays idle, the plugin removes the messages this connection still has in the queue and ends their prompts: with `cancelled` after a cancelled turn, otherwise with a JSON-RPC error saying that the message was not sent.

### Approvals and questions

DSH sends every approval or question to all owner clients (DSH Desktop, Web, the Agents Anywhere plugin and this plugin); the first result counts and the others receive a cancellation. The gateway waits for a reply to every delivery, so this plugin opens a single interaction stream and replies exactly once to each delivery: it replies `next` when the request is neither an approval nor a question, when no ACP connection is attached to the session, or when no client answered. When a reconnect delivers the same request again, the decision already in progress replies on the new connection. The plugin handles only the ACP connections attached to the session:

- Approvals: DSH delivers an approval on the interaction stream, which can overtake the `tool/call` event on the follow stream, while ACP clients look up the tool card a permission request points at by its ID. The plugin therefore waits, for at most 2 seconds, until it has seen the matching tool call, sends the earlier updates, and then sends `session/request_permission` with the card's ID and title (some clients show only the request) and the options "Allow once" and "Reject". A call this connection never received as a card (it attached without replay, or the call did not arrive in time) is described in full in the request instead. When the client cancels or fails, it replies `next` so other clients can answer.
- Questions: when the client declares `elicitation.form`, it sends a form. A single choice becomes `oneOf`, a multiple choice `items.anyOf`, and a question without options a required text field; an optional question gets an extra "other answer" field, which replaces the selected option of a single choice. An accepted form becomes the DSH answer; declining or cancelling counts as the user cancelling the questions. A client without forms gets single-choice questions, plan reviews included, as `session/request_permission` choices: each question opens a card of its own (the plan of a review is its content), then a request points at it with one option per answer, and the card closes with the choice. Options of an approval question keep their grant and refusal kinds, and a plan review offers "Approve plan" and "Keep planning". Dismissing a question leaves the whole request to DSH. A request with a multiple-choice or typed answer still gets a short notice, and is left to DSH.
- When the session closes, stops being followed or loses its connection, the requests still waiting are withdrawn.

## Design decisions

- **Not mounting the official `@deepseek-ai/dsh-acp` directly**: the official implementation assembles its own Agent with `agents.create`, installs only model selection and MCP, and mounts no Agent preset; the DSH Desktop and Web profiles keep every tool in presets, so sessions mounted that way have no tools. It also owns its sessions exclusively, so sessions DSH has already loaded cannot be resumed.
- **Built on the Session Controller**: the same multi-client semantics as the DSH Web client; sessions appear in DSH Desktop, and approvals and questions can be answered on either side.
- **Following dsh-acp-enhanced's features without reusing its code**: it is a separate profile that owns its Agent; streaming, tool cards, forms, commands and history replay are reimplemented here on the Session Controller.
- **Deferred creation**: editors call `session/new` for every conversation they open, so the session is created with the first message, leaving no empty sessions or idle Agents in DSH.
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
- an error when model resolution fails, without locking the session;
- approvals (each request after the card it points at, DSH falling back when the client gives no answer, and withdrawing the client's request when DSH answers first), forms, single-choice questions for clients without forms, and image input;
- configuration, sync of model switches made in DSH, and slash commands;
- token checks, endpoint proof, the temporary directory for overlong paths, and the launcher;
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

Neither the automated checks nor these manual runs covered: replies from a real model, real editors such as Zed, the Electron runtime of DSH Desktop, Windows named pipes, several DSH processes at once, or DSH versions other than 0.2.2-rc.3.
