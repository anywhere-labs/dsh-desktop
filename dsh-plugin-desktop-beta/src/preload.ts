/** Minimal context-isolated bridges for drag payloads, Desktop-owned actions, and the upstream Desktop marker. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { SETUP_ONBOARDING_CHANNEL } from './setup-onboarding-bridge.ts'
import { DESKTOP_FILE_PATH_BRIDGE } from './file-path-bridge-contract.ts'
import { DESKTOP_NATIVE_DIRECTORY_PICKER_CHANNEL } from './directory-picker-contract.ts'
import { DESKTOP_SAVE_FILE_PICKER_CHANNEL, type DesktopSaveFilePickerRequest } from './save-file-picker-contract.ts'
import { OPEN_STUDIO_WINDOW_BRIDGE, OPEN_STUDIO_WINDOW_CHANNEL } from './open-studio-window-contract.ts'
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

// The official native directory-flow plugin captures this seam at apply time.
// Install it before any client plugin runs; the Host's macOS osascript chooser
// otherwise waits for AppleEvents and may time out without showing a window.
if (process.platform === 'darwin') {
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', Object.freeze({
    pick: (): Promise<string | null> => ipcRenderer.invoke(DESKTOP_NATIVE_DIRECTORY_PICKER_CHANNEL),
  }))
}

// Native save-file dialog for client-plugin renderers that run outside the
// Electron main process (the TinTin host bundle is a plain-node Harness child
// and cannot open dialogs itself). Consumed as
// `window.dshDesktopSaveFilePicker.pick(params)` → absolute path or null.
contextBridge.exposeInMainWorld('dshDesktopSaveFilePicker', Object.freeze({
  pick: (params?: DesktopSaveFilePickerRequest): Promise<string | null> =>
    ipcRenderer.invoke(DESKTOP_SAVE_FILE_PICKER_CHANNEL, params ?? {}),
}))

// OpenFilm Studio window (TinTin channel): the renderer names the address the
// OpenFilm host channel returned; the main process validates it before opening.
contextBridge.exposeInMainWorld(OPEN_STUDIO_WINDOW_BRIDGE, Object.freeze({
  open: (url: string): Promise<void> => ipcRenderer.invoke(OPEN_STUDIO_WINDOW_CHANNEL, url),
}))

// Upstream client plugins recognize the Desktop renderer by this carrier. Version 1
// without `updates` or `browser` keeps upstream update badges and the embedded
// browser tab on their Web fallbacks, and turns on the DeepSeek account entry whose
// Platform sign-in the Host hands to the native shell (src/platform-login.ts).
contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({ protocolVersion: 1 }))

contextBridge.exposeInMainWorld('dshDesktopSetup', {
  read: () => ipcRenderer.invoke(SETUP_ONBOARDING_CHANNEL, { action: 'read' }),
  dismissAccount: (profile: string) => ipcRenderer.invoke(SETUP_ONBOARDING_CHANNEL, { action: 'dismiss-account', profile }),
  applyPending: (profile: string) => ipcRenderer.invoke(SETUP_ONBOARDING_CHANNEL, { action: 'apply-pending', profile }),
  finish: (profile: string, selection?: unknown) => ipcRenderer.invoke(SETUP_ONBOARDING_CHANNEL, { action: 'finish', profile, selection }),
})
