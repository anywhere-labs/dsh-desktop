/** Minimal context-isolated bridges for drag payloads, Desktop-owned actions, and the upstream Desktop marker. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { SESSION_WINDOW_BRIDGE, SESSION_WINDOW_CHANNEL, SESSION_WINDOW_TARGET, validSessionWindowId, type SessionWindowBridge } from './session-window-contract.ts'
import { DESKTOP_FILE_PATH_BRIDGE } from './file-path-bridge-contract.ts'
import {
  DESKTOP_RENDERER_ACTION_CHANNEL,
  DESKTOP_RENDERER_ACTIONS_BRIDGE,
  type DesktopRendererAction,
  type DesktopRendererActionsBridge,
} from './renderer-actions-contract.ts'

contextBridge.exposeInMainWorld(DESKTOP_FILE_PATH_BRIDGE, {
  /** Resolve only genuine disk-backed Web File objects selected by the operator. */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
})

const actions: DesktopRendererActionsBridge = {
  /** Reach the main process directly, independent of the Host generation. */
  invoke: (action: DesktopRendererAction) => ipcRenderer.invoke(DESKTOP_RENDERER_ACTION_CHANNEL, action),
}
contextBridge.exposeInMainWorld(DESKTOP_RENDERER_ACTIONS_BRIDGE, actions)

// Upstream client plugins recognize the Desktop renderer by this carrier. Version 1
// without `updates` or `browser` keeps upstream update badges and the embedded
// browser tab on their Web fallbacks, and turns on the DeepSeek account entry whose
// Platform sign-in the Host hands to the native shell (src/platform-login.ts).
contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({ protocolVersion: 1 }))

const sessionTarget = new URLSearchParams(window.location.search).get('dsh-desktop-session')
contextBridge.exposeInMainWorld(SESSION_WINDOW_TARGET, validSessionWindowId(sessionTarget) ? sessionTarget : null)
const sessionWindows: SessionWindowBridge = {
  open: request => ipcRenderer.invoke(SESSION_WINDOW_CHANNEL, request),
  ready: title => { ipcRenderer.send(`${SESSION_WINDOW_CHANNEL}:ready`, title) },
}
contextBridge.exposeInMainWorld(SESSION_WINDOW_BRIDGE, sessionWindows)
