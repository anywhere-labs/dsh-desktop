/** Fixed Electron security policy for Desktop-owned local HTML windows. */

import { editingContextMenuLabels, installEditingContextMenu } from './context-menu.ts'
import { observeDesktopRenderer } from './renderer-logging.ts'
import type { DesktopLocale } from './runtime.ts'
import { app, BrowserWindow, Menu, type BrowserWindowConstructorOptions } from 'electron'

export interface DesktopLocalWindowOptions extends Omit<BrowserWindowConstructorOptions, 'webPreferences'> {
  /** Dedicated in-memory session partition for this local workflow. */
  readonly partition: string
  /** Opt into Electron preferred-size events without exposing arbitrary WebPreferences. */
  readonly preferredSizeMode?: boolean
  /** Language of the window copy; Windows context-menu labels follow it, else the Electron locale. */
  readonly locale?: DesktopLocale
}

/** Construct a local-file window with no Node, preload, popup, or WebView path. */
export function createDesktopLocalWindow(options: DesktopLocalWindowOptions): BrowserWindow {
  const { partition, preferredSizeMode, locale, ...windowOptions } = options
  if (!/^dsh-[a-z0-9-]+$/u.test(partition)) {
    throw new TypeError('dsh-plugin-desktop: local window partition must be a dedicated in-memory dsh-* partition')
  }
  const window = new BrowserWindow({
    ...windowOptions,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      ...(preferredSizeMode === undefined ? {} : { enablePreferredSizeMode: preferredSizeMode }),
      partition,
    },
  })
  observeDesktopRenderer(window.webContents, partition)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', event => { event.preventDefault() })
  // Local documents hold editable fields such as profile names and API keys;
  // they get the same native editing menu as the application document.
  installEditingContextMenu(window.webContents, window, {
    platform: process.platform,
    labels: () => editingContextMenuLabels(locale ?? app.getLocale()),
    menu: () => Menu,
  })
  return window
}
