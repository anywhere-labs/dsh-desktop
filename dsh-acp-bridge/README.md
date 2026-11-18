# Agents Anywhere ACP Bridge for DSH

[中文说明](README.zh.md)

Lets editors and scripts that speak the [Agent Client Protocol](https://agentclientprotocol.com) (ACP), such as Zed, work directly with a running DeepSeek Harness (DSH).

This is a DSH plugin, published as the npm package `@agents-anywhere/dsh-acp-bridge`. It runs inside the DSH process and shares its sessions with DSH Desktop: a conversation started in the editor appears in the DSH Desktop sidebar, and an existing DSH conversation can continue in the editor. It does not start another DSH, needs no separate profile, and needs no Agents Anywhere sign-in.

## What it does

- Start a DSH session, or open an existing one with its history. One session can be used from DSH Desktop, Agents Anywhere and several editors at once; a message sent from any of them appears live in all the others.
- Replies and reasoning stream as they are written. Tool calls appear as cards: file edits with diffs, commands with their output and exit code, and file reads that link to the location they read.
- Choose the model, the reasoning effort and the permission preset. A new session can pick its Agent mode before the first message; plan mode can be switched once the session has started. Where DSH offers agent teams, the 「启用智能体团队协作」 switch of its model menu can be turned on and off at any time too.
- When DSH asks to approve an operation, the editor offers "Allow once / Reject"; when the Agent asks a question with `ask_user_question`, the editor shows a form, or a list of choices in editors without forms. DSH Desktop can answer too, and the first answer counts. An approval or question DSH was already waiting for when the editor opened the session reaches the editor as well.
- The Agent's todo list appears as the editor's plan and follows its progress.
- Type `/` for the commands DSH registers and the skills that can be invoked directly.
- Send text, images (PNG, JPEG, WebP, GIF), file links, the selections an editor attaches and other files, which are uploaded to DSH like files added in DSH Desktop, and cancel a running task at any time.
- Keep sending while a reply is still running: as when Enter is pressed in DSH Desktop during a reply, each further message waits in the DSH queue and runs in a turn of its own once the one before it ends.
- When the Agent hands work to subagents, the editor's request stays open until the subagents finish and the Agent has replied to their results, as with the official DSH ACP agent.
- Delete a session from the editor's history: DSH archives it, and it can be restored in DSH. Editors that support forking can continue a copy of a session, which DSH lists as a session of its own.
- MCP servers configured in the editor (stdio and HTTP) are mounted for the session, and their tools belong to that session alone, as with the official DSH ACP agent. MCP servers configured in DSH itself work in the editor's sessions too.

## Installation

DSH must be on the 0.2.2 release line (`>=0.2.2-rc.1 <0.3.0-0`); automated checks cover 0.2.2-rc.4 only.

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

## Using it in Zed

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

DSH must be running. When it is not, the launcher exits at once and says why; quitting DSH or unloading the plugin disconnects the editor, and reopening the conversation reconnects it.

## Troubleshooting

The launcher can be run directly in a terminal:

```bash
~/.agents-anywhere/dsh-acp/bin/dsh-acp --check
```

`--check` connects to the running DSH and prints the DSH version, the plugin version and whether approvals and questions are connected. `--list` lists the DSH processes it can connect to; with several running, it connects to the most recently started one, and `--instance <instance ID>` picks another. With the environment variable `DSH_ACP_DEBUG=1`, connection diagnostics are written to standard error.

The plugin's own log lines are in the DSH log and start with `acp-bridge`.

## Notes and limitations

- A new session is created in DSH only when its first message is sent, under the workspace of its working directory; merely opening an editor panel leaves no empty session behind.
- MCP servers declared by the editor start when a new session's first message is sent or when an existing session is opened, and stop when the editor closes the session or disconnects. When a server does not start, that message or the opening fails and names the server. A stdio server's command must be an absolute path, and it runs in the session's working directory; the deprecated SSE transport is not supported.
- Sessions are shared: while the editor is connected, messages sent to the session from DSH Desktop or other clients can use its MCP tools too. Clients that declare the same server (same name and configuration) share one connection; one session cannot hold two different servers under the same name, so the client that opens the session later gets an error. A server named like one configured in DSH replaces that one in the session. Mounting or unmounting servers changes the session's tool list, so the next turn cannot reuse the earlier cache.
- Audio input is not supported; whether images can be used depends on the selected model.
- Opening an existing session replays its latest 1000 messages; earlier history is available in DSH.
- When the editor closes a session or disconnects, the tasks it started and that are still running are cancelled and the messages it queued are withdrawn; tasks started from DSH Desktop or other clients are unaffected.
- Deleting a session in the editor cancels the editor's own tasks in it first; a session DSH Desktop or another client is still running cannot be deleted from the editor.
- While the editor's request waits for subagents, whatever the Agent does in the session belongs to that request, including replies to messages sent from DSH Desktop. Cancelling it in the editor returns at once and leaves the subagents running, as Stop does in DSH Desktop; closing the editor does not stop them either.
- Subagents never ask a person. DSH starts them with the approval policy `never`, so an operation of theirs that would need approval is rejected on the spot, and `ask_user_question` fails inside a subagent; DSH Desktop shows nothing either. A subagent keeps the session's permission only when it is `danger-full-access` (or the experimental `auto`), so choose the permission before the Agent delegates.
- Whether a message can be sent while a reply is running depends on the editor; the plugin declares the `promptQueueing` flag that editors check for it. When the reply ahead is cancelled or fails, the messages the editor queued behind it are withdrawn and need to be sent again, because DSH does not go on with its queue after such a reply.
- When the editor stops reading the plugin's output for a long time (for example because it hangs), the plugin disconnects it; reopening the conversation reconnects.
- Editors without forms show single-choice questions, plan reviews included, as a list of choices; a question that takes several choices or a typed answer must be answered in DSH there, and the conversation says so.
- The Windows connection (a named pipe) has not been verified on a real machine.

## Data and security

- All communication stays on this computer. It does not pass through the Agents Anywhere Server and needs no account.
- The plugin listens only where the current user can reach it: a private Unix socket on macOS and Linux, a named pipe on Windows. A connection must also present a random token, stored in a file only the current user can read and regenerated every time DSH starts.
- Before sending the token, the launcher has the other side prove that it holds that token; an endpoint that cannot prove it (for example one taken over by another program after DSH exited) is skipped and never receives the token or any conversation.
- A local user who can run the launcher can use every DSH session on this computer, just as in DSH Desktop.
- Stdio MCP servers declared by the editor are started by DSH as the current user and, like the MCP servers configured in DSH itself, do not run in DSH's sandbox.

## Development

Building from source, link installation, the protocol and the tests are described in the [technical notes](TECHNICAL.md).
