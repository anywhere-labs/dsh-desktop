// TinTin channel main-process capabilities (channel-only addition; see
// docs/tintin-migration-plan.md Phase 4). The mirrored desktop bootstrap files
// stay byte-identical to Beta, so every TinTin-specific main-process behavior
// installs itself from here, before the mirrored bootstrap runs.

import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerBrowserService } from 'dsh-tintin-browser'
import { OPEN_STUDIO_WINDOW_CHANNEL, isStudioWindowUrl } from '../open-studio-window-contract.ts'
import { seedTinTinDefaults } from './first-boot.ts'

let installed = false
let browserAttached = false
let studioWindow: BrowserWindow | null = null

/**
 * Open (or refocus) the OpenFilm Studio window on a validated local address.
 *
 * Studio is a plain local web app (the OpenFilm CLI serves it with a per-run
 * key in the URL), so the window needs nothing from Electron: sandboxed, no
 * node, its own session partition. A second click on the sidebar entry reloads
 * the address the host just returned (Studio may have restarted on a new port).
 */
function openStudioWindow(url: string): void {
  if (studioWindow !== null && !studioWindow.isDestroyed()) {
    void studioWindow.loadURL(url)
    if (studioWindow.isMinimized()) studioWindow.restore()
    studioWindow.focus()
    return
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenFilm Studio',
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:tintin-openfilm',
    },
  })
  window.once('ready-to-show', () => window.show())
  // Never leave an invisible window behind when the page cannot paint.
  setTimeout(() => { if (!window.isDestroyed() && !window.isVisible()) window.show() }, 4000).unref?.()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.on('closed', () => {
    if (studioWindow === window) studioWindow = null
  })
  studioWindow = window
  void window.loadURL(url)
}

/**
 * Install TinTin main-process capabilities. Safe to call more than once.
 *
 * - First-boot provisioning: seed the tintin-server model provider, default
 *   model, placeholder credential and the bridge's own config store into the
 *   channel home before the Host boots (ported from the source first-boot;
 *   without it a fresh install defaults to the official DeepSeek provider).
 * - Media binaries: point the host bridge at `<resources>/bin`
 *   (ffmpeg/ffprobe/yt-dlp delivered by the fetch scripts) when packaged.
 * - Browser domain: attach to the first top-level window the desktop
 *   bootstrap creates — the harness main window. Later windows (native-ui
 *   modals, dialogs, recovery chrome) are ignored, matching the source
 *   wiring where registerBrowserService received the main window only.
 */
export function installTinTinMainHook(): void {
  if (installed) return
  installed = true

  seedTinTinDefaults(app.getPath('appData'))

  if (process.env.TINTIN_BIN_DIR === undefined && app.isPackaged) {
    const binDir = join(process.resourcesPath, 'bin')
    if (existsSync(binDir)) {
      process.env.TINTIN_BIN_DIR = binDir
      // OpenFilm runtime (2026-10-17): the vendored node.exe/openfilm.cmd sit
      // beside ffmpeg in bin/ — append (never prepend: system tools keep
      // precedence, the vendored set fills machines without them) so the
      // agent's shell and every child process resolve `openfilm` bare.
      if (process.platform === 'win32' && process.env.PATH !== undefined) {
        process.env.PATH = `${process.env.PATH};${binDir}`
      }
      const browsersDir = join(process.resourcesPath, 'playwright-browsers')
      if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined && existsSync(browsersDir)) {
        process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir
      }
    }
  }

  app.on('browser-window-created', (_event, window) => {
    if (browserAttached) return
    if (window.getParentWindow() !== null) return
    browserAttached = true
    try {
      registerBrowserService(window)
    } catch (error) {
      console.error(
        `dsh-plugin-desktop-tintin: browser domain registration failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      browserAttached = false
    }
  })

  // OpenFilm Studio window (sidebar entry → host channel → this bridge). The
  // renderer only ever supplies the local Studio address the host returned;
  // the contract refuses anything else.
  ipcMain.handle(OPEN_STUDIO_WINDOW_CHANNEL, (_event, url: unknown) => {
    if (!isStudioWindowUrl(url)) throw new Error('refused: not a local OpenFilm Studio address')
    openStudioWindow(url)
  })
}

// Install on module load so the composition entry only needs to import this
// module before the mirrored bootstrap; ESM evaluation order then guarantees
// the listeners exist before any window is created.
installTinTinMainHook()
