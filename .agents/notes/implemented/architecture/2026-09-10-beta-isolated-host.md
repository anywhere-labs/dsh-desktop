# Beta isolated Host experiment

Status: default in Beta; experimental; stable is unchanged.

2026-09-10: Promoted to stable at user request. Both editions now default to the same isolated Host and chrome architecture; release identities remain separate. The validation limitations below still apply.
English | [中文](2026-09-10-beta-isolated-host.zh.md)

## Boundary

Beta starts its Cordis Host by default in an Electron utility process. The main process still owns windows, native menus, dialogs, update networking, and OS-protected certificate access. The existing Web server, authentication, HTTP/WebSocket transport, client-module composition, and Desktop client visuals remain in their existing layers. No chat requests or model streams are proxied through the new control channel.

AA Host services move with Cordis when enabled; the Python Connector remains its existing subprocess. This isolates the Electron event loop from Host CPU work. It does not fix slow Host tasks, AA compatibility, or plugin-inventory package resolution.

The private control channel transports native commands and snapshots. Functions stay in their owning process and are addressed by callback IDs. Environment layers retain their provenance. Host logs use the Beta user-data `logs/host` directory. Native update requests still use the original Electron adapter; cancellation crosses the channel. Interactive dialogs and downloads are not subject to the ordinary RPC deadline.

## Try locally

From this worktree, install locked dependencies and build the Beta package:

```sh
corepack yarn install --immutable
corepack yarn workspace dsh-plugin-desktop-beta build
corepack yarn workspace dsh-plugin-desktop-beta prepare:electron-native
corepack yarn workspace dsh-plugin-desktop-beta start
```

The Yarn script works on Windows as well as macOS. Close the running Beta first. Set `DSH_DESKTOP_ISOLATED_HOST=0` to compare with the original in-process path. Do not use the same Profile simultaneously in two instances.

## Verification and promotion

Headless tests cover bidirectional native calls, cancellation, environment provenance, shell/tray callbacks, supervisor exit handling, and a real Node subprocess booting the DSH Web profile. The real-process fixture adapts Node IPC to the utility-process port API; it does not validate Electron utility-process behavior or OS packaging. It verifies distinct PIDs, authentication, a third-party client entry and its served bundle, AA service activation with AA enabled or disabled, and orderly Web-server shutdown.

Before porting it to stable, validate Windows and macOS packaged utility processes, ASAR module paths and native addons; window materials and controls in each mode; settings, tray refresh and Profile changes; LAN certificates; Host crash/hang and application shutdown; AA startup and large-history sync; and actual client plugin activation/HMR in a browser. Verify no Connector/tool descendants survive shutdown. Do not claim a Windows responsiveness improvement without measuring it.

Unexpected Host exit is reported without automatic restart or replay. Shutdown first requests disposal, then terminates a nonresponsive child with a bounded exit wait. Recovery mutations remain unavailable if termination cannot be confirmed. Forced termination of arbitrary plugin descendants is not proven by the current headless fixture.

The isolated bootstrap currently mirrors the existing bootstrap during the Beta experiment. Consolidate the two implementations before stable adoption to avoid lifecycle drift. The image-reported request-extension inventory failure needs its own packaged-layout regression and fix.

## Native frame isolation

On macOS and Windows, both compatibility and extended modes place the packaged titlebar in a separate sandboxed WebContentsView. DSH content starts below its 36px native bounds, with no extra inset or Portal titlebar inside the content document. Frontend plugin DOM/CSS and slots cannot reach the chrome document. This is a frontend boundary, not a sandbox for arbitrary privileged Host code. Enhanced macOS mode reserves the full 32px drag strip above main/rightbar content, retaining the sidebar inset. Native GUI validation remains manual.
