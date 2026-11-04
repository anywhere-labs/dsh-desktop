/** Alpha.2 boot, directory-picker, host-path and Platform-page contracts; no generic IPC bridge. */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from './ipc.ts'
import { PLATFORM_IPC } from './platform-ipc.ts'
import { markDocumentPlatform } from './preload-platform.ts'
import { syncNativeTheme } from './preload-theme.ts'
import { syncWindowsAppearance } from './preload-windows.ts'
import { syncWindowMaterial } from './preload-material.ts'
import { syncNativeLocale } from './preload-locale.ts'
import { permissionBridge } from './preload-permissions.ts'
import { onOpenSettings } from './preload-settings.ts'
import { createDesktopKeyboardBridge } from './preload-keyboard.ts'
import { createDesktopBrowserBridge } from './preload-browser.ts'
import { createDesktopFileActionsBridge, createDesktopFileDragBridge } from './upstream-family-preload.ts'

if (location.protocol === 'dsh-app:' && location.hostname === 'app') {
  let documentId: string | undefined
  let profile = ''
  markDocumentPlatform()
  syncNativeTheme()
  syncNativeLocale()
  syncWindowsAppearance()
  syncWindowMaterial()
  contextBridge.exposeInMainWorld('dshOnboarding', {
    setActive: (active: boolean) => { void ipcRenderer.invoke('dsh-desktop:setup-onboarding', { action: 'active', active }).catch(() => {}) },
  })
  contextBridge.exposeInMainWorld('dshDesktopSetup', {
    read: () => ipcRenderer.invoke('dsh-desktop:setup-onboarding', { action: 'read' }),
    dismissAccount: (profile: string) => ipcRenderer.invoke('dsh-desktop:setup-onboarding', { action: 'dismiss-account', profile }),
    finish: (profile: string, selection?: unknown) => ipcRenderer.invoke('dsh-desktop:setup-onboarding', { action: 'finish', profile, selection }),
  })
  contextBridge.exposeInMainWorld('desktopNext', {
    renderer: {
      profile: () => profile,
      report: (status: unknown) => ipcRenderer.invoke(IPC.rendererStatus, documentId, status),
    },
    permissions: permissionBridge(),
    onOpenSettings,
    state: () => ipcRenderer.invoke(IPC.state),
    browserLinks: () => ipcRenderer.invoke(IPC.browserLinks),
    command: (command: unknown) => ipcRenderer.invoke(IPC.command, command),
  })
  // dsh 0.1.7 implements the native Sidebar browser itself and reads its transport from this
  // carrier; without `browser` the official plugin silently falls back to the sandboxed iframe.
  contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1, browser: createDesktopBrowserBridge(), ...createDesktopKeyboardBridge(), ...createDesktopFileActionsBridge?.(), ...createDesktopFileDragBridge?.() })
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: async () => {
      const boot = await ipcRenderer.invoke(IPC.boot)
      documentId = boot.documentId
      profile = boot.profile
      return boot
    },
    failed: (message: string) => ipcRenderer.invoke(IPC.failed, message, documentId),
  })
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', { pick: () => ipcRenderer.invoke(IPC.directory) })
  // The official account plugin opens its Platform pages (top-up, usage) in a native view only when
  // this bridge exists; without it the onboarding's top-up actions stay disabled.
  contextBridge.exposeInMainWorld('dshPlatform', {
    open: (page: 'usage' | 'top-up', bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(PLATFORM_IPC.open, page, bounds),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(PLATFORM_IPC.bounds, bounds),
    close: () => ipcRenderer.invoke(PLATFORM_IPC.close),
  })
  // The official composer cites dropped, picked, and pasted files and folders that have a
  // real path as `@path` references instead of uploading them, and refuses folders outright
  // when this bridge is absent; a File without a path (pasted bytes) answers '' and uploads.
  contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', { pathFor: (file: File) => webUtils.getPathForFile(file) })
}
