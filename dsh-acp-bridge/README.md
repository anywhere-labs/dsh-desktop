# Agents Anywhere ACP Bridge for DSH

[中文说明](README.zh.md)

Connect applications, scripts and automation tools to DeepSeek Harness (DSH) sessions, models and tools through the [Agent Client Protocol](https://agentclientprotocol.com) (ACP).

This is a DSH plugin, published as the npm package `@agents-anywhere/dsh-acp-bridge`. It runs inside the DSH process and shares its sessions with DSH Desktop: a conversation started in an external client appears in the DSH Desktop sidebar, and an existing DSH conversation can continue from a client. It reuses DSH's runtime and configuration, needs no separate profile, and needs no Agents Anywhere sign-in. When DSH Desktop is not running, the launcher can start it automatically.

There are two ways to connect:

- **ACP over stdio**: an ACP application or script runs the generated launcher and exchanges messages over standard input and output. Zed is one such client; a configuration example follows below.
- **Local RPC client API**: programs use `@agents-anywhere/dsh-acp-bridge/client` to connect to a running DSH and open ACP connections. See [Connecting from other programs](#connecting-from-other-programs).

## What it does

These capabilities are exposed through ACP. How tool cards, forms, plans and menus are displayed and used depends on the client implementation.

- Start a DSH session, or open an existing one with its history. One session can be used from DSH Desktop, Agents Anywhere and several clients at once; a message sent from any of them appears live in all the others.
- Receive streaming replies and reasoning, and tool call updates with file diffs, command output and exit codes, and file locations. Clients can use these to display tool cards.
- Choose the model, the reasoning effort and the permission preset. A new session can pick its Agent mode before the first message; plan mode can be switched once the session has started. Where DSH offers agent teams, the 「启用智能体团队协作」 switch of its model menu can be turned on and off at any time too.
- When DSH asks to approve an operation, the client offers "Allow once / Reject"; when the Agent asks a question with `ask_user_question`, the client shows a form, or a list of choices in clients without forms. DSH Desktop can answer too, and the first answer counts. An approval or question DSH was already waiting for when the client opened the session reaches the client as well.
- Receive the Agent's todo list and progress updates for display as a plan or for use in a script.
- Type `/` for the commands DSH registers and the skills that can be invoked directly.
- Send text, images (PNG, JPEG, WebP, GIF), file links, the selections a client attaches and other files, which are uploaded to DSH like files added in DSH Desktop, and cancel a running task at any time.
- Keep sending while a reply is still running: as when Enter is pressed in DSH Desktop during a reply, each further message waits in the DSH queue and runs in a turn of its own once the one before it ends.
- Clients that support the steering extension (`_session/steering`, which the Codex and Claude ACP agents use too) can steer a running turn: as with steering in DSH Desktop, the model receives the input at the turn's next step. When no turn is running, the client sends it as a normal prompt instead.
- The client is told when each turn starts and ends, including turns that DSH Desktop, other clients or subagent results start, so it knows when they end.
- When the Agent hands work to subagents, the client's request stays open until the subagents finish and the Agent has replied to their results, as with the official DSH ACP agent.
- Delete a session from the client's history: DSH archives it, and it can be restored in DSH. Clients that support forking can continue a copy of a session, which DSH lists as a session of its own.
- MCP servers configured in the client (stdio and HTTP) are mounted for the session, and their tools belong to that session alone, as with the official DSH ACP agent. MCP servers configured in DSH itself work in the client's sessions too.

## Installation

DSH must be on the 0.2.2 or 0.2.3 release line (`>=0.2.2-rc.1 <0.3.0-0 || >=0.2.3-alpha.1 <0.3.0-0`); automated checks cover 0.2.3-alpha.2 only.

- **DeepSeek Harness Desktop**: open "Plugins" → "Add plugin" in the left sidebar, enter the package name `@agents-anywhere/dsh-acp-bridge`, install it, enable it and restart.
- **DSH installed from the command line**: for example, for the `desktop` profile:

  ```bash
  dsh plugin --profile desktop add @agents-anywhere/dsh-acp-bridge
  ```

Once DSH loads the plugin, it writes a launcher on this computer:

| System | Launcher |
| --- | --- |
| macOS, Linux | `~/.agents-anywhere/dsh-acp/bin/dsh-acp` |
| Windows | `%USERPROFILE%\.agents-anywhere\dsh-acp\bin\dsh-acp.cmd` |

The launcher uses the Node.js runtime that DSH itself runs on (DSH Desktop included), so no separate Node.js installation is needed. DSH rewrites it every time it loads the plugin, so nothing needs editing after DSH is upgraded or moved.

## Connecting an ACP client

Set the full launcher path from the table above as the client's Agent command, using its settings for arguments and environment variables. Scripts can also run that command and exchange ACP messages over stdio.

### Example: Zed

Add an external Agent to Zed's `settings.json`, with `command` set to the full path of the launcher (Zed does not expand `~`):

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

Then choose "DSH" in Zed's Agent panel to start a conversation. Other ACP clients likewise take the launcher as their Agent command.

## Connection and automatic startup

The client connects to the plugin inside DSH. When DSH Desktop is not running, the launcher starts the DSH Desktop that wrote it in the background: it shows only its tray icon and opens no window (earlier DSH Desktop releases open their window as usual), and the launcher connects once the plugin is ready. It waits up to 90 seconds; `--start-timeout <seconds>` changes that, and `--no-start` turns the start off. Put these arguments in the client's launch arguments (for example, Zed's `args`).

The launcher follows the plugin: it stays when DSH quits, for the next automatic start, and is removed when the plugin is disabled or uninstalled in DSH; the client then reports that the command does not exist. When another running DSH has also loaded the plugin, that DSH takes the launcher over instead.

In these cases the launcher says why and exits:

- The plugin is still not ready when the wait ends: usually the current DSH Profile has not enabled the plugin, or DSH is in first-run setup, recovery or an update.
- The plugin was removed while DSH was not running, so the launcher could not be removed with it: install the plugin again, and DSH writes a new launcher.
- DSH was uninstalled or moved: open DSH, and it writes a new launcher.

The DSH command line installed from npm and the AppImage build of DSH are not started automatically; open DSH first. Quitting DSH or unloading the plugin disconnects the client, and reopening the conversation reconnects it.

## Troubleshooting

The launcher can be run directly in a terminal:

```bash
~/.agents-anywhere/dsh-acp/bin/dsh-acp --check
```

`--check` connects to the running DSH (it never starts one) and prints the DSH version, the plugin version and whether approvals and questions are connected. `--list` lists the DSH processes it can connect to; with several running, it connects to the most recently started one, and `--instance <instance ID>` picks another. `--version` prints only the plugin version. With the environment variable `DSH_ACP_DEBUG=1`, connection diagnostics are written to standard error.

The plugin's own log lines are in the DSH log and start with `acp-bridge`.

## Notes and limitations

- A new session is created in DSH only when its first message is sent, under the workspace of its working directory; merely connecting over ACP or requesting a new session leaves no empty session behind.
- MCP servers declared by the client start when a new session's first message is sent or when an existing session is opened, and stop when the client closes the session or disconnects. When a server does not start, that message or the opening fails and names the server. A stdio server's command must be an absolute path, and it runs in the session's working directory; the deprecated SSE transport is not supported.
- Sessions are shared: while the client is connected, messages sent to the session from DSH Desktop or other clients can use its MCP tools too. Clients that declare the same server (same name and configuration) share one connection; one session cannot hold two different servers under the same name, so the client that opens the session later gets an error. A server named like one configured in DSH replaces that one in the session. Mounting or unmounting servers changes the session's tool list, so the next turn cannot reuse the earlier cache.
- Audio input is not supported. Whether the client may attach images is decided once, when it connects, by DSH's default model (the model new sessions start with): clients are offered images only when that model takes image input, and switching a session to another model does not change this. After changing the default model, reconnect the client. Each message is checked again against the session's current model: a message with images for a model that does not take image input fails at once, before DSH creates the session or receives the message; a model that does not declare its input types is left to DSH, which accepts the images, as in DSH Desktop.
- Opening an existing session replays its latest 1000 messages; earlier history is available in DSH.
- When the client closes a session or disconnects, the tasks it started and that are still running are cancelled and the messages it queued are withdrawn; tasks started from DSH Desktop or other clients are unaffected.
- Deleting a session in the client cancels the client's own tasks in it first; a session DSH Desktop or another client is still running cannot be deleted from the client.
- While the client's request waits for subagents, whatever the Agent does in the session belongs to that request, including replies to messages sent from DSH Desktop. Cancelling it in the client returns at once and leaves the subagents running, as Stop does in DSH Desktop; closing the client does not stop them either.
- Subagents never ask a person. DSH starts them with the approval policy `never`, so an operation of theirs that would need approval is rejected on the spot, and `ask_user_question` fails inside a subagent; DSH Desktop shows nothing either. A subagent keeps the session's permission only when it is `danger-full-access` (or the experimental `auto`), so choose the permission before the Agent delegates.
- Whether a message can be sent while a reply is running depends on the client; the plugin declares the `promptQueueing` flag that clients check for it. When the reply ahead is cancelled or fails, the messages the client queued behind it are withdrawn and need to be sent again, because DSH does not go on with its queue after such a reply.
- When the client stops reading the plugin's output for a long time (for example because it hangs), the plugin disconnects it; reopening the conversation reconnects.
- Clients without forms show single-choice questions, plan reviews included, as a list of choices; a question that takes several choices or a typed answer must be answered in DSH there, and the conversation says so.
- The Windows connection (a named pipe) has not been verified on a real machine.

## Data and security

- All communication stays on this computer. It does not pass through the Agents Anywhere Server and needs no account.
- The plugin listens only where the current user can reach it: a private Unix socket on macOS and Linux, a named pipe on Windows. A connection must also present a random token, stored in a file only the current user can read and regenerated every time DSH starts.
- Before sending the token, the launcher and the client API have the other side prove that it holds that token; an endpoint that cannot prove it (for example one taken over by another program after DSH exited) is skipped and never receives the token or any conversation.
- A local user who can run the launcher can use every DSH session on this computer, just as in DSH Desktop; so can the programs that user runs through the client API.
- Stdio MCP servers declared by the client are started by DSH as the current user and, like the MCP servers configured in DSH itself, do not run in DSH's sandbox.

## Connecting from other programs

Programs can skip the launcher and connect to the running DSH through the plugin's local RPC, a public interface with compatibility rules. The package's `client` entry point needs only Node.js: it finds DSH, checks it, and opens ACP connections for the ACP SDK.

```ts
import { client } from '@agentclientprotocol/sdk'
import { connectDsh } from '@agents-anywhere/dsh-acp-bridge/client'

const dsh = await connectDsh()
const acp = client({ name: 'my-tool' }).connect(dsh.openAcpStream())
```

This API connects to a running DSH; it does not start Desktop automatically. The contract, its compatibility rules and the whole client API are in the [technical notes](TECHNICAL.md#local-rpc).

Programs that want the automatic start but cannot run the launcher (on Windows, for example, those that start processes without a shell and so cannot run a `.cmd`) can read `dsh-acp.json` beside the launcher: it names the program the launcher runs, its arguments and its environment variables, and starting it that way works as running the launcher does. The format is in the [technical notes](TECHNICAL.md#endpoint-records-and-the-launcher).

## Development

Building from source, link installation, the protocol and the tests are described in the [technical notes](TECHNICAL.md).
