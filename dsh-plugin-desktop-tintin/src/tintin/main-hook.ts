// TinTin channel main-process capabilities (channel-only addition; see
// docs/tintin-migration-plan.md Phase 4). The mirrored desktop bootstrap files
// stay byte-identical to Beta, so every TinTin-specific main-process behavior
// installs itself from here, before the mirrored bootstrap runs.

import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { embedAttach, embedClose, embedHide, embedShow, registerBrowserService } from 'dsh-tintin-browser'
import {
  OPENFILM_HOST_REFER, OPENFILM_HOST_SELECTION, OPENFILM_REFER_EVENT, OPENFILM_SELECTION_EVENT,
  OPENFILM_VIEW_CHANNEL, isOpenFilmBounds, isOpenFilmStudioUrl,
  type OpenFilmBounds, type OpenFilmSelection, type OpenFilmStudioRef, type OpenFilmViewRequest,
} from '../openfilm-view-contract.ts'
import { BROWSER_VIEW_CHANNEL, isBrowserBounds, type BrowserViewRequest } from '../browser-view-contract.ts'
import { seedTinTinDefaults } from './first-boot.ts'

let installed = false
let browserAttached = false

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
const STUDIO_PARTITION = 'persist:tintin-openfilm-studio'
const studioPreloadPath = join(dirname(fileURLToPath(import.meta.url)), 'studio-preload.cjs')

let studioView: WebContentsView | null = null
let studioWindow: BrowserWindow | null = null
let studioShown = false

/** Create (or reuse) the native Studio view in the window that hosts the chat. */
function ensureStudioView(window: BrowserWindow, url: string): WebContentsView {
  if (studioView !== null && !studioView.webContents.isDestroyed()) return studioView
  studioWindow = window
  const view = new WebContentsView({
    webPreferences: {
      preload: studioPreloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: STUDIO_PARTITION,
    },
  })
  view.setBackgroundColor('#0b0c0f')
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('did-fail-load', (_event, code, description, failedUrl) => {
    console.error(`dsh-plugin-desktop-tintin: Studio failed to load ${failedUrl} (${String(code)} ${description})`)
  })
  view.webContents.on('destroyed', () => {
    if (studioView === view) {
      studioView = null
      studioWindow = null
      studioShown = false
    }
  })
  studioView = view
  void view.webContents.loadURL(url)
  // 键盘焦点交给 Studio（2026-10-19 报障：焦点留主窗侧栏行按钮时，视图内按空格被
  // 主窗按 HTML 语义当成「再点一次行」→ 切回工作台）。仅打开时让一次，show 轮询不抢焦
  view.webContents.once('did-finish-load', () => {
    try { if (!view.webContents.isDestroyed()) view.webContents.focus() } catch { /* 销毁竞态 */ }
  })
  return view
}

function showStudio(bounds: OpenFilmBounds): void {
  if (studioView === null || studioWindow === null || studioWindow.isDestroyed()) return
  if (!studioShown) {
    studioWindow.contentView.addChildView(studioView)
    studioShown = true
  }
  studioView.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  })
}

function hideStudio(): void {
  if (studioView === null || studioWindow === null || studioWindow.isDestroyed() || !studioShown) return
  studioWindow.contentView.removeChildView(studioView)
  studioShown = false
}

function closeStudio(): void {
  const view = studioView
  if (view === null) return
  hideStudio()
  studioView = null
  studioWindow = null
  studioShown = false
  if (!view.webContents.isDestroyed()) view.webContents.close()
}

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
      // browser-page-preload（2026-10-19）：浏览器 UI 页（内嵌视图与独立窗口共用）的
      // 页面桥（dshDesktopBrowser/tintinBrowserPage）由此接通——构建产物与本文件同目录
      registerBrowserService(window, {
        pagePreloadPath: join(dirname(fileURLToPath(import.meta.url)), 'browser-page-preload.cjs'),
      })
    } catch (error) {
      console.error(
        `dsh-plugin-desktop-tintin: browser domain registration failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      browserAttached = false
    }
  })

  // Native OpenFilm Studio view (B 方案, 2026-10-18 用户裁决): the Studio page runs
  // in a WebContentsView with a preload that supplies Studio's host contract
  // (`window.openfilmHost`); its selection/playhead and "Reference in chat" refs
  // are forwarded to the chat renderer that drives this view.
  ipcMain.handle(OPENFILM_VIEW_CHANNEL, (event, request: OpenFilmViewRequest) => {
    if (request === null || typeof request !== 'object') return { ok: false, error: 'invalid request' }
    if (request.action === 'open') {
      if (!isOpenFilmStudioUrl(request.url)) return { ok: false, error: 'refused: not a local Studio address' }
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window === null) return { ok: false, error: 'window not found' }
      ensureStudioView(window, request.url)
      return { ok: true }
    }
    if (request.action === 'show') {
      if (!isOpenFilmBounds(request.bounds)) return { ok: false, error: 'invalid bounds' }
      showStudio(request.bounds)
      return { ok: true }
    }
    if (request.action === 'hide') { hideStudio(); return { ok: true } }
    if (request.action === 'close') { closeStudio(); return { ok: true } }
    return { ok: false, error: 'unknown action' }
  })
  ipcMain.on(OPENFILM_HOST_SELECTION, (event, selection: OpenFilmSelection) => {
    if (studioView !== null && event.sender === studioView.webContents) {
      studioWindow?.webContents.send(OPENFILM_SELECTION_EVENT, selection)
    }
  })
  ipcMain.on(OPENFILM_HOST_REFER, (event, ref: OpenFilmStudioRef) => {
    if (studioView !== null && event.sender === studioView.webContents) {
      studioWindow?.webContents.send(OPENFILM_REFER_EVENT, ref)
    }
  })

  // Embedded browser view (2026-10-19 方案 4, OpenFilm native-view pattern): the chrome
  // hosts a placeholder and drives the browser UI view lifecycle; platform partition
  // views compose on top inside the page-reported host rect (browser-service embed mode).
  ipcMain.handle(BROWSER_VIEW_CHANNEL, (event, request: BrowserViewRequest) => {
    if (request === null || typeof request !== 'object') return { ok: false, error: 'invalid request' }
    if (request.action === 'open') {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window === null) return { ok: false, error: 'window not found' }
      return embedAttach(window)
    }
    if (request.action === 'show') {
      if (!isBrowserBounds(request.bounds)) return { ok: false, error: 'invalid bounds' }
      return embedShow(request.bounds)
    }
    if (request.action === 'hide') { embedHide(); return { ok: true } }
    if (request.action === 'close') { embedClose(); return { ok: true } }
    return { ok: false, error: 'unknown action' }
  })
}

// Install on module load so the composition entry only needs to import this
// module before the mirrored bootstrap; ESM evaluation order then guarantees
// the listeners exist before any window is created.
installTinTinMainHook()
