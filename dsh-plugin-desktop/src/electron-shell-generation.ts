import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  Tray,
} from 'electron'
import { formatDesktopExitCode } from './desktop-logger.ts'
import { showDesktopMessageBox } from './desktop-dialog-window.ts'
import { applicationNeedsReveal, revealApplication } from './electron-reveal.ts'
import type { ElectronPlatformStrategy } from './electron-platform.ts'
import type { DesktopNotification, DesktopShellSpec } from './runtime.ts'
import { prepareTrayIcon } from './tray-icons.ts'
import { desktopWindowOptions } from './window-options.ts'
import {
  windowsSupportsSystemBackdrop,
  windowsUsesLegacyAcrylic,
} from './window-material.ts'
import { setWindowsAcrylic } from './windows-acrylic.ts'
import type { DesktopRendererAccessHeader } from './desktop-browser-access.ts'
import {
  fitMainWindowBounds,
  sameMainWindowBounds,
  type MainWindowBounds,
  type MainWindowStateStore,
} from './main-window-state.ts'

const MIN_ZOOM_LEVEL = -4
const MAX_ZOOM_LEVEL = 4
const WINDOW_STATE_WRITE_DELAY_MS = 250

function pairedWebSocketOrigin(origin: string): string {
  const url = new URL(origin)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  else if (url.protocol === 'https:') url.protocol = 'wss:'
  else throw new Error(`dsh-plugin-desktop: unsupported renderer origin protocol ${url.protocol}`)
  return url.origin
}

function sameRendererCarrierOrigin(requestUrl: string, httpOrigin: string, webSocketOrigin: string): boolean {
  try {
    const origin = new URL(requestUrl).origin
    return origin === httpOrigin || origin === webSocketOrigin
  } catch {
    return false
  }
}

function withoutRendererAccessHeader(
  requestHeaders: Record<string, string>,
  headerName: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(requestHeaders)
      .filter(([name]) => name.toLowerCase() !== headerName),
  )
}

function requestBelongsToRenderer(
  details: Electron.OnBeforeSendHeadersListenerDetails,
  webContentsId: number,
): boolean {
  const providedIds = [details.webContentsId, details.webContents?.id]
    .filter((value): value is number => value !== undefined)
  return providedIds.length > 0 && providedIds.every(value => value === webContentsId)
}

function requestComesFromRendererOrigin(
  details: Electron.OnBeforeSendHeadersListenerDetails,
  origin: string,
): boolean {
  if (details.resourceType === 'mainFrame') return true
  const frame = details.frame
  if (frame === undefined || frame === null || frame.detached || frame.origin !== origin) return false
  const top = frame.top ?? (frame.parent === null ? frame : undefined)
  return top !== undefined && !top.detached && top.origin === origin
}

/**
 * Attach one generation-only capability to the renderer's HTTP and WebSocket
 * traffic. Query markers are intentionally insufficient because subresources,
 * API requests, and upgrades do not retain the main-frame query string.
 */
function installRendererAccessHeader(
  window: BrowserWindow,
  origin: string,
  header: DesktopRendererAccessHeader,
): () => void {
  const webSocketOrigin = pairedWebSocketOrigin(origin)
  const webRequest = window.webContents.session.webRequest
  const webContentsId = window.webContents.id
  const listener = (
    details: Electron.OnBeforeSendHeadersListenerDetails,
    callback: (response: Electron.BeforeSendResponse) => void,
  ): void => {
    // This listener owns a dedicated renderer session and sees every target so
    // a redirect can never carry the capability away from the local carrier.
    const requestHeaders = withoutRendererAccessHeader(details.requestHeaders, header.name)
    if (!requestBelongsToRenderer(details, webContentsId)
      || !sameRendererCarrierOrigin(details.url, origin, webSocketOrigin)
      || !requestComesFromRendererOrigin(details, origin)) {
      callback({ requestHeaders })
      return
    }
    requestHeaders[header.name] = header.value
    callback({ requestHeaders })
  }
  webRequest.onBeforeSendHeaders({
    urls: ['<all_urls>'],
  }, listener)
  let active = true
  return () => {
    if (!active) return
    active = false
    webRequest.onBeforeSendHeaders(null)
  }
}

function clampedZoomLevel(level: number): number {
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level))
}

function isZoomShortcut(input: Electron.Input): 'in' | 'out' | 'reset' | undefined {
  if (input.type !== 'keyDown' || input.alt || (!input.control && !input.meta)) return undefined
  if (input.key === '+' || input.key === '=') return 'in'
  if (input.key === '-' || input.key === '_') return 'out'
  if (input.key === '0') return 'reset'
  return undefined
}

export interface ElectronShellGenerationOptions {
  readonly platform: ElectronPlatformStrategy
  readonly spec: DesktopShellSpec
  readonly preloadPath: string
  readonly buildApplicationMenuItems: () => readonly Electron.MenuItemConstructorOptions[]
  readonly isQuitting: () => boolean
  readonly buildTrayTemplate: () => Electron.MenuItemConstructorOptions[]
  readonly stopRendererBootMonitoring: () => void
  readonly abortRendererBootMonitoring: (cause: unknown) => void
  readonly failRendererBoot: (error: string) => void
  readonly logError: (message: string) => void
  readonly mainWindowState: MainWindowStateStore
}

/** Own one BrowserWindow and Tray generation, including every native listener. */
export class ElectronShellGeneration {
  private window: BrowserWindow | undefined
  private tray: Tray | undefined
  private mounted = false
  private released = false
  private attentionCount = 0
  private prepareFullscreenReveal: (() => void) | undefined
  private refreshNativeMaterial: (() => void) | undefined
  private flushWindowState: (() => void) | undefined
  private cleanupListeners: (() => void) | undefined

  constructor(private readonly options: ElectronShellGenerationOptions) {}

  async mount(beforeInteractive?: () => void): Promise<void> {
    if (this.mounted || this.window !== undefined) {
      throw new Error('dsh-plugin-desktop: native shell generation is already mounted')
    }

    const { platform, spec } = this.options
    const icon = nativeImage.createFromPath(spec.iconPath)
    if (icon.isEmpty()) {
      throw new Error(`dsh-plugin-desktop: failed to load application icon ${spec.iconPath}`)
    }
    platform.configureApplication(icon, spec.productName, this.options.buildApplicationMenuItems())
    const origin = new URL(spec.url).origin
    if (platform.platform !== 'linux') nativeTheme.themeSource = spec.readThemeSource()
    let persistedBounds: MainWindowBounds | undefined
    let restoredBounds: MainWindowBounds | undefined
    try {
      persistedBounds = this.options.mainWindowState.read()
      if (persistedBounds !== undefined) {
        const display = screen.getDisplayMatching(persistedBounds)
        restoredBounds = fitMainWindowBounds(persistedBounds, display.workArea, {
          width: spec.minWidth,
          height: spec.minHeight,
        })
      }
    } catch (cause) {
      this.options.logError(`dsh-plugin-desktop: failed to restore main-window state: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    const window = new BrowserWindow({
      ...desktopWindowOptions(spec, icon, platform.platform, this.options.preloadPath),
      ...(restoredBounds ?? {}),
    })
    window.accessibleTitle = spec.windowTitle
    platform.configureWindow(window)
    const refreshNativeMaterial = (): void => {
      if (platform.platform === 'win32'
        && (spec.material === 'acrylic' || spec.material === 'mica')
        && !windowsSupportsSystemBackdrop(spec.windowsBuild)) {
        if (spec.material === 'acrylic' && windowsUsesLegacyAcrylic(spec.windowsBuild)) {
          try {
            if (!setWindowsAcrylic(window, true, nativeTheme.shouldUseDarkColors)) {
              this.options.logError('dsh-plugin-desktop: Windows rejected the acrylic backdrop request')
            }
          } catch (cause) {
            this.options.logError(`dsh-plugin-desktop: failed to apply Windows acrylic backdrop: ${cause instanceof Error ? cause.message : String(cause)}`)
          }
        }
        return
      }
      platform.refreshThemeMaterial(window, spec.material)
    }
    this.refreshNativeMaterial = refreshNativeMaterial
    refreshNativeMaterial()
    this.window = window

    let stateWriteTimer: ReturnType<typeof setTimeout> | undefined
    const persistWindowState = (): void => {
      if (stateWriteTimer !== undefined) {
        clearTimeout(stateWriteTimer)
        stateWriteTimer = undefined
      }
      if (window.isDestroyed()) return
      const bounds = window.getNormalBounds()
      if (persistedBounds !== undefined && sameMainWindowBounds(bounds, persistedBounds)) return
      try {
        this.options.mainWindowState.write(bounds)
        persistedBounds = { ...bounds }
      } catch (cause) {
        this.options.logError(`dsh-plugin-desktop: failed to save main-window state: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    const scheduleWindowStateWrite = (): void => {
      if (stateWriteTimer !== undefined) clearTimeout(stateWriteTimer)
      stateWriteTimer = setTimeout(persistWindowState, WINDOW_STATE_WRITE_DELAY_MS)
      stateWriteTimer.unref()
    }
    this.flushWindowState = persistWindowState

    const show = (): void => { this.show() }
    let startupSurfaceRevealed = false
    const revealStartupSurface = (): void => {
      if (window.isDestroyed()) return
      if (startupSurfaceRevealed && !applicationNeedsReveal(window, platform.platform)) return
      startupSurfaceRevealed = true
      this.show()
    }
    const activate = (): void => {
      if (applicationNeedsReveal(window, platform.platform)) this.show()
    }
    const clearAttention = (): void => { this.clearAttention() }
    let fullscreenExitPending = false
    let hideAfterFullscreenExit = false
    let restoreAfterFullscreenExit = false
    let restoreFullscreenOnShow = false
    const finishFullscreenExit = (): void => {
      if (!fullscreenExitPending) return
      fullscreenExitPending = false
      const shouldHide = hideAfterFullscreenExit
      const shouldRestore = restoreAfterFullscreenExit
      hideAfterFullscreenExit = false
      restoreAfterFullscreenExit = false
      if (window.isDestroyed()) return
      if (shouldHide) {
        window.hide()
        return
      }
      if (shouldRestore) {
        restoreFullscreenOnShow = false
        window.setFullScreen(true)
      }
    }
    const prepareFullscreenReveal = (): void => {
      if (!restoreFullscreenOnShow || window.isDestroyed()) return
      if (fullscreenExitPending) {
        hideAfterFullscreenExit = false
        restoreAfterFullscreenExit = true
        return
      }
      if (window.isFullScreen()) {
        restoreFullscreenOnShow = false
        return
      }
      restoreFullscreenOnShow = false
      window.setFullScreen(true)
    }
    const cleanupFullscreenTransition = (): void => {
      if (fullscreenExitPending) window.off('leave-full-screen', finishFullscreenExit)
      fullscreenExitPending = false
      hideAfterFullscreenExit = false
      restoreAfterFullscreenExit = false
      restoreFullscreenOnShow = false
    }
    this.prepareFullscreenReveal = prepareFullscreenReveal
    const close = (event: Electron.Event): void => {
      persistWindowState()
      if (this.options.isQuitting()) return
      event.preventDefault()
      if (platform.platform === 'darwin' && fullscreenExitPending) {
        hideAfterFullscreenExit = true
        restoreAfterFullscreenExit = false
        return
      }
      if (platform.platform === 'darwin' && window.isFullScreen()) {
        fullscreenExitPending = true
        hideAfterFullscreenExit = true
        restoreFullscreenOnShow = true
        window.once('leave-full-screen', finishFullscreenExit)
        window.setFullScreen(false)
        return
      }
      window.hide()
    }
    const preserveBlankTitle = (event: Electron.Event): void => { event.preventDefault() }
    const handleZoomShortcut = (event: Electron.Event, input: Electron.Input): void => {
      const action = isZoomShortcut(input)
      if (action === undefined) return
      event.preventDefault()
      if (action === 'reset') {
        window.webContents.setZoomLevel(0)
        return
      }
      const step = action === 'in' ? 1 : -1
      window.webContents.setZoomLevel(clampedZoomLevel(window.webContents.getZoomLevel() + step))
    }
    const navigate = (event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>): void => {
      if (!event.isMainFrame) return
      let targetOrigin: string | undefined
      try {
        targetOrigin = new URL(event.url).origin
      } catch {
        targetOrigin = undefined
      }
      if (targetOrigin !== origin) event.preventDefault()
    }
    const redirect = (
      event: Electron.Event,
      url: string,
      _isInPlace: boolean,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame) return
      let targetOrigin: string | undefined
      try {
        targetOrigin = new URL(url).origin
      } catch {
        targetOrigin = undefined
      }
      if (targetOrigin !== origin) event.preventDefault()
    }
    const rendererGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails): void => {
      const detail = `renderer process gone (reason: ${details.reason}, exitCode: ${formatDesktopExitCode(details.exitCode)})`
      this.options.logError(`dsh-plugin-desktop: ${detail}`)
      this.options.failRendererBoot(detail)
    }
    const loadFailed = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
    ): void => {
      this.options.logError(`dsh-plugin-desktop: renderer failed to load (${errorCode}: ${errorDescription})`)
      if (isMainFrame === true && errorCode !== -3) {
        this.options.failRendererBoot(
          `renderer main frame failed to load (${String(errorCode)}: ${errorDescription})`,
        )
      }
    }

    app.on('activate', activate)
    if (platform.platform === 'darwin') app.on('did-become-active', activate)
    window.on('close', close)
    window.on('focus', clearAttention)
    window.on('move', scheduleWindowStateWrite)
    window.on('resize', scheduleWindowStateWrite)
    window.on('page-title-updated', preserveBlankTitle)
    window.webContents.on('before-input-event', handleZoomShortcut)
    window.webContents.on('will-frame-navigate', navigate)
    window.webContents.on('will-redirect', redirect)
    window.webContents.on('render-process-gone', rendererGone)
    window.webContents.on('did-fail-load', loadFailed)
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url)
        if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
          void shell.openExternal(target.href).catch((cause: unknown) => {
            this.options.logError(`dsh-plugin-desktop: failed to open external link: ${cause instanceof Error ? cause.message : String(cause)}`)
          })
        }
      } catch {
        // A malformed target is rejected with the same deny result.
      }
      return { action: 'deny' }
    })
    window.once('ready-to-show', revealStartupSurface)
    let tray: Tray | undefined
    let removeRendererAccessHeader: (() => void) | undefined
    this.cleanupListeners = () => {
      app.off('activate', activate)
      if (platform.platform === 'darwin') app.off('did-become-active', activate)
      window.off('close', close)
      window.off('focus', clearAttention)
      window.off('move', scheduleWindowStateWrite)
      window.off('resize', scheduleWindowStateWrite)
      window.off('page-title-updated', preserveBlankTitle)
      window.off('ready-to-show', revealStartupSurface)
      cleanupFullscreenTransition()
      window.webContents.off('before-input-event', handleZoomShortcut)
      window.webContents.off('will-frame-navigate', navigate)
      window.webContents.off('will-redirect', redirect)
      window.webContents.off('render-process-gone', rendererGone)
      window.webContents.off('did-fail-load', loadFailed)
      removeRendererAccessHeader?.()
      removeRendererAccessHeader = undefined
      tray?.off('click', show)
      if (stateWriteTimer !== undefined) {
        clearTimeout(stateWriteTimer)
        stateWriteTimer = undefined
      }
    }

    try {
      removeRendererAccessHeader = installRendererAccessHeader(
        window,
        origin,
        spec.rendererAccessHeader,
      )
      revealStartupSurface()
      await window.loadURL(spec.url)
      tray = new Tray(prepareTrayIcon(spec.trayIcons, platform.platform))
      this.tray = tray
      tray.setToolTip(spec.productName)
      this.refreshTrayMenu()
      tray.on('click', show)
      beforeInteractive?.()
      this.mounted = true
    } catch (cause) {
      this.options.abortRendererBootMonitoring(cause)
      await this.release()
      throw cause
    }
  }

  show(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    this.clearAttention()
    revealApplication(window, this.options.platform.platform)
    this.prepareFullscreenReveal?.()
  }

  /** Reload the active renderer without permitting arbitrary renderer commands. */
  reloadRenderer(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) {
      throw new Error('dsh-plugin-desktop: renderer reload requires a mounted window')
    }
    window.webContents.reloadIgnoringCache()
  }

  /** Toggle Developer Tools for the active renderer. */
  toggleDeveloperTools(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) {
      throw new Error('dsh-plugin-desktop: Developer Tools require a mounted window')
    }
    if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools()
    else window.webContents.openDevTools({ mode: 'detach', activate: true })
  }

  notifyAttention(notification: DesktopNotification): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || window.isFocused()) return

    this.attentionCount += 1
    if (this.options.platform.platform === 'win32') window.flashFrame(true)
    else app.setBadgeCount(this.attentionCount)

    if (!Notification.isSupported()) return
    const nativeNotification = new Notification(notification)
    nativeNotification.once('click', () => { this.show() })
    nativeNotification.show()
  }

  async showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
    const window = this.window
    return window === undefined || window.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options)
  }

  async showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    const window = this.window
    return window === undefined || window.isDestroyed()
      ? await showDesktopMessageBox(options)
      : await showDesktopMessageBox(options, window)
  }

  async showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
    const window = this.window
    return window === undefined || window.isDestroyed()
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(window, options)
  }

  refreshTrayMenu(): void {
    if (this.tray === undefined) return
    this.tray.setContextMenu(Menu.buildFromTemplate(this.options.buildTrayTemplate()))
  }

  refreshThemeMaterial(): void {
    if (this.window !== undefined && !this.window.isDestroyed()) this.refreshNativeMaterial?.()
  }

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    this.options.stopRendererBootMonitoring()

    const window = this.window
    const tray = this.tray
    this.clearAttention()
    this.flushWindowState?.()
    this.window = undefined
    this.tray = undefined
    this.prepareFullscreenReveal = undefined
    this.refreshNativeMaterial = undefined
    this.flushWindowState = undefined
    if (window === undefined) return

    this.cleanupListeners?.()
    this.cleanupListeners = undefined
    tray?.destroy()
    if (!window.isDestroyed()) window.destroy()
  }

  private clearAttention(): void {
    if (this.attentionCount === 0) return
    this.attentionCount = 0
    if (this.options.platform.platform === 'win32') {
      const window = this.window
      if (window !== undefined && !window.isDestroyed()) window.flashFrame(false)
    } else {
      app.setBadgeCount(0)
    }
  }
}
