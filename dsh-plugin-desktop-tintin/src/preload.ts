/** Minimal context-isolated bridges for drag payloads, Desktop-owned actions, and the upstream Desktop marker. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { SETUP_ONBOARDING_CHANNEL } from './setup-onboarding-bridge.ts'
import { DESKTOP_HOST_PATHS_BRIDGE } from './file-path-bridge-contract.ts'
import { DESKTOP_NATIVE_DIRECTORY_PICKER_CHANNEL } from './directory-picker-contract.ts'
import { DESKTOP_SAVE_FILE_PICKER_CHANNEL, type DesktopSaveFilePickerRequest } from './save-file-picker-contract.ts'
import type { DesktopOpenFilmBridge, OpenFilmBounds, OpenFilmSelection, OpenFilmStudioRef } from './openfilm-view-contract.ts'
import type { BrowserViewBounds, DesktopBrowserViewBridge } from './browser-view-contract.ts'
import {
  DESKTOP_RENDERER_ACTION_CHANNEL,
  DESKTOP_RENDERER_ACTIONS_BRIDGE,
  type DesktopRendererAction,
  type DesktopRendererActionsBridge,
} from './renderer-actions-contract.ts'
// A sandboxed preload can only require('electron')/builtins — a relative-chunk
// import ("module not found") kills the whole preload. Keep these literals in
// sync with ./openfilm-view-contract.ts, which the main process imports.
const OPENFILM_VIEW_CHANNEL = 'dsh-desktop:openfilm-view'
const OPENFILM_SELECTION_EVENT = 'dsh-desktop:openfilm-selection'
const OPENFILM_REFER_EVENT = 'dsh-desktop:openfilm-refer'

// The official composer cites dropped, picked, and pasted files and folders that have a
// real path as `@path` references instead of uploading them, and refuses folders outright
// when this bridge is absent; a File without a path (pasted bytes) answers '' and uploads.
contextBridge.exposeInMainWorld(DESKTOP_HOST_PATHS_BRIDGE, {
  pathFor(file: File): string {
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
// Native OpenFilm Studio view (TinTin channel, B 方案): a WebContentsView over the
// stage area; the renderer drives its lifecycle and receives Studio's selection/refs.
const openFilmView: DesktopOpenFilmBridge = {
  open: (url: string) => ipcRenderer.invoke(OPENFILM_VIEW_CHANNEL, { action: 'open', url }),
  show: (bounds: OpenFilmBounds) => ipcRenderer.invoke(OPENFILM_VIEW_CHANNEL, { action: 'show', bounds }),
  hide: () => ipcRenderer.invoke(OPENFILM_VIEW_CHANNEL, { action: 'hide' }),
  close: () => ipcRenderer.invoke(OPENFILM_VIEW_CHANNEL, { action: 'close' }),
  onSelection: (listener: (selection: OpenFilmSelection) => void) => {
    const handler = (_event: unknown, selection: OpenFilmSelection): void => { listener(selection) }
    ipcRenderer.on(OPENFILM_SELECTION_EVENT, handler)
    return () => { ipcRenderer.removeListener(OPENFILM_SELECTION_EVENT, handler) }
  },
  onRefer: (listener: (ref: OpenFilmStudioRef) => void) => {
    const handler = (_event: unknown, ref: OpenFilmStudioRef): void => { listener(ref) }
    ipcRenderer.on(OPENFILM_REFER_EVENT, handler)
    return () => { ipcRenderer.removeListener(OPENFILM_REFER_EVENT, handler) }
  },
}
contextBridge.exposeInMainWorld('dshDesktopOpenFilm', Object.freeze(openFilmView))

// Embedded browser view (TinTin channel, 2026-10-19 方案 4 same native-view pattern):
// the renderer hosts a placeholder and drives the browser UI view lifecycle.
// Literals kept in sync with ./browser-view-contract.ts (main process imports it).
const BROWSER_VIEW_CHANNEL = 'dsh-desktop:browser-view'
const browserView: DesktopBrowserViewBridge = {
  open: () => ipcRenderer.invoke(BROWSER_VIEW_CHANNEL, { action: 'open' }),
  show: (bounds: BrowserViewBounds) => ipcRenderer.invoke(BROWSER_VIEW_CHANNEL, { action: 'show', bounds }),
  hide: () => ipcRenderer.invoke(BROWSER_VIEW_CHANNEL, { action: 'hide' }),
  close: () => ipcRenderer.invoke(BROWSER_VIEW_CHANNEL, { action: 'close' }),
}
contextBridge.exposeInMainWorld('dshDesktopBrowserView', Object.freeze(browserView))


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
