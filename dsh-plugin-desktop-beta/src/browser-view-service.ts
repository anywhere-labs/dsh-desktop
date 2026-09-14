/** Main-process owner of native guest browser views parented to the Desktop window. */

import { WebContentsView, type BrowserWindow, type Session, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import {
  browserViewVisible,
  clampBrowserViewBounds,
  type BrowserViewRect,
} from './browser-view-bounds.ts'
import {
  BROWSER_VIEW_CDP_PROTOCOL_VERSION,
  isAllowedBrowserViewCdpMethod,
  isAllowedBrowserViewCdpParams,
} from './browser-view-cdp.ts'

/** Stable failure code returned when no native window can host a guest view. */
export const BROWSER_VIEW_UNAVAILABLE = 'BROWSER_VIEW_UNAVAILABLE'

/** Stable failure code returned for an unknown or already closed view id. */
export const BROWSER_VIEW_UNKNOWN = 'BROWSER_VIEW_UNKNOWN'

/** Stable failure code returned for a CDP command outside the allowlist. */
export const BROWSER_VIEW_CDP_DENIED = 'BROWSER_VIEW_CDP_DENIED'

/** Stable failure code returned for invalid arguments. */
export const BROWSER_VIEW_INVALID = 'BROWSER_VIEW_INVALID'

/** Stable failure code returned when a top-level navigation leaves the policy. */
export const BROWSER_VIEW_NAVIGATION_DENIED = 'BROWSER_VIEW_NAVIGATION_DENIED'

/** Error whose message starts with a stable code the Host half can branch on. */
export function browserViewError(code: string, detail: string): Error {
  return new Error(`${code}: ${detail}`)
}

/** Options accepted by `createView`. */
export interface DesktopNativeBrowserViewOptions {
  /** Caller-owned view identity; creating an existing id replaces it. */
  id: string
  /** Group used by `closeOwner` to release every view of one owner. */
  owner: string
  /** Initial page loaded once the view exists. */
  url?: string
  /** Top-level navigation allowlist; omitted or empty means "any http(s)". */
  allowOrigins?: string[]
}

/** Every event a guest view can report to its subscribers. */
export type DesktopNativeBrowserEvent =
  | { type: 'navigated'; id: string; url: string }
  | { type: 'title'; id: string; title: string }
  | { type: 'loading'; id: string; loading: boolean }
  | { type: 'window-open'; id: string; url: string }
  | { type: 'closed'; id: string; reason: 'closed' | 'crashed' }
  | { type: 'failed'; id: string; url: string; error: string }
  | { type: 'cdp'; id: string; method: string; params: unknown }

/** Cordis service consumed by Host plugins; the Host half proxies the same shape. */
export interface DesktopNativeBrowser {
  readonly version: 1
  /** Create (or replace) one guest view. `owner` groups views for teardown. */
  createView(options: DesktopNativeBrowserViewOptions): Promise<{ id: string }>
  /** CSS-pixel rectangle measured by the renderer, relative to the renderer viewport. */
  setBounds(id: string, bounds: BrowserViewRect): Promise<void>
  /** Page zoom as a factor of 1; the CSS viewport becomes bounds/zoom. */
  setZoom(id: string, factor: number): Promise<void>
  setVisible(id: string, visible: boolean): Promise<void>
  focus(id: string): Promise<void>
  navigate(id: string, url: string): Promise<void>
  close(id: string): Promise<void>
  closeOwner(owner: string): Promise<void>
  /** One CDP command against this view's webContents, allowlisted. */
  command(id: string, method: string, params?: unknown): Promise<unknown>
  /** Events for every view; returns an unsubscribe function. */
  subscribe(listener: (event: DesktopNativeBrowserEvent) => void): () => void
}

/** Native surface the service resolves lazily for the current shell generation. */
export interface BrowserViewServiceOptions {
  /** Resolve the main window that owns every guest view. */
  window(): BrowserWindow | undefined
  /** Resolve the renderer viewport origin inside the window content area. */
  rendererOrigin(): { x: number; y: number }
  /** Optional sink for non-fatal native failures. */
  log?(message: string): void
}

interface BrowserViewEntry {
  readonly id: string
  readonly owner: string
  readonly view: WebContentsView
  readonly webContents: WebContents
  readonly allowOrigins: readonly string[] | undefined
  /** Renderer rectangle retained for re-clamping on resize and window changes. */
  requested: BrowserViewRect
  bounds: BrowserViewRect | null
  visibleRequested: boolean
  /** Last applied visibility, so a re-show can re-append the view above the renderer. */
  shown: boolean
}

/** Stable per-owner partition suffix keeps one Session's storage out of every other. */
function ownerPartition(owner: string): string {
  const digest = createHash('sha256').update(owner, 'utf8').digest('hex').slice(0, 16)
  return `persist:dsh-desktop-browser-${digest}`
}

/** Own every guest view of the current main window inside the Electron main process. */
export class BrowserViewService implements DesktopNativeBrowser {
  readonly version = 1 as const
  private readonly views = new Map<string, BrowserViewEntry>()
  private readonly listeners = new Set<(event: DesktopNativeBrowserEvent) => void>()
  private readonly hardened = new WeakSet<Session>()
  private window: BrowserWindow | undefined

  constructor(private readonly options: BrowserViewServiceOptions) {}

  /** @inheritdoc */
  async createView(options: DesktopNativeBrowserViewOptions): Promise<{ id: string }> {
    const { id, owner } = options
    if (id === '' || owner === '') {
      throw browserViewError(BROWSER_VIEW_INVALID, 'a guest view requires a non-empty id and owner')
    }
    const window = this.adoptWindow()
    if (window === undefined) {
      throw browserViewError(BROWSER_VIEW_UNAVAILABLE, 'no desktop window can host a guest view')
    }
    const existing = this.views.get(id)
    // Replacement is a caller-owned refresh: it reports no close of its own.
    if (existing !== undefined) this.forget(existing)
    const view = new WebContentsView({ webPreferences: {
      partition: ownerPartition(owner),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    } })
    this.hardenSession(view.webContents.session)
    const entry: BrowserViewEntry = {
      id,
      owner,
      view,
      webContents: view.webContents,
      allowOrigins: options.allowOrigins,
      requested: { x: 0, y: 0, width: 0, height: 0 },
      bounds: null,
      visibleRequested: false,
      shown: false,
    }
    this.views.set(id, entry)
    this.observe(entry)
    window.contentView.addChildView(view)
    view.setVisible(false)
    if (options.url !== undefined) this.load(entry, options.url)
    return { id }
  }

  /** @inheritdoc */
  async setBounds(id: string, bounds: BrowserViewRect): Promise<void> {
    const entry = this.views.get(id)
    if (entry === undefined) return
    entry.requested = { ...bounds }
    this.apply(entry)
  }

  /** @inheritdoc */
  async setZoom(id: string, factor: number): Promise<void> {
    const entry = this.views.get(id)
    if (entry === undefined) return
    if (!Number.isFinite(factor) || factor <= 0) {
      throw browserViewError(BROWSER_VIEW_INVALID, `invalid zoom factor ${String(factor)}`)
    }
    try {
      entry.webContents.setZoomFactor(factor)
    } catch {
      entry.webContents.setZoomLevel(Math.log2(factor))
    }
  }

  /** @inheritdoc */
  async setVisible(id: string, visible: boolean): Promise<void> {
    const entry = this.views.get(id)
    if (entry === undefined) return
    entry.visibleRequested = visible
    this.apply(entry)
  }

  /** @inheritdoc */
  async focus(id: string): Promise<void> {
    const entry = this.views.get(id)
    if (entry === undefined) return
    entry.webContents.focus()
  }

  /** @inheritdoc */
  async navigate(id: string, url: string): Promise<void> {
    const entry = this.views.get(id)
    if (entry === undefined) return
    this.load(entry, url)
  }

  /** @inheritdoc */
  async close(id: string): Promise<void> {
    const entry = this.views.get(id)
    if (entry !== undefined) this.release(entry, 'closed')
  }

  /** @inheritdoc */
  async closeOwner(owner: string): Promise<void> {
    for (const entry of [...this.views.values()]) {
      if (entry.owner === owner) this.release(entry, 'closed')
    }
  }

  /** @inheritdoc */
  async command(id: string, method: string, params?: unknown): Promise<unknown> {
    const entry = this.views.get(id)
    if (entry === undefined) {
      throw browserViewError(BROWSER_VIEW_UNKNOWN, `unknown guest view ${id}`)
    }
    if (!isAllowedBrowserViewCdpMethod(method) || !isAllowedBrowserViewCdpParams(method, params)) {
      throw browserViewError(BROWSER_VIEW_CDP_DENIED, `CDP method ${method} is not allowed`)
    }
    const debuggerSession = entry.webContents.debugger
    if (!debuggerSession.isAttached()) {
      debuggerSession.attach(BROWSER_VIEW_CDP_PROTOCOL_VERSION)
      debuggerSession.on('message', (_event, messageMethod, messageParams) => {
        this.emit({ type: 'cdp', id: entry.id, method: messageMethod, params: messageParams })
      })
    }
    return params === undefined
      ? await debuggerSession.sendCommand(method)
      : await debuggerSession.sendCommand(method, params)
  }

  /** @inheritdoc */
  subscribe(listener: (event: DesktopNativeBrowserEvent) => void): () => void {
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  /** Release every guest view, for example when its shell generation goes away. */
  closeAll(): void {
    for (const entry of [...this.views.values()]) this.release(entry, 'closed')
    this.detachWindow()
  }

  /** Adopt the window of the active shell generation before creating a view. */
  private adoptWindow(): BrowserWindow | undefined {
    const window = this.options.window()
    if (window === undefined || window.isDestroyed()) {
      // Guests never outlive their window: releasing them here tells the Host
      // half that its native pages are gone instead of leaving dead entries.
      if (this.window !== undefined) this.closeAll()
      return undefined
    }
    if (window !== this.window) {
      if (this.window !== undefined) this.closeAll()
      this.window = window
      window.on('hide', this.updateViews)
      window.on('minimize', this.updateViews)
      window.on('close', this.hideViews)
      window.on('show', this.updateViews)
      window.on('restore', this.updateViews)
      window.on('resize', this.updateViews)
      window.on('closed', this.closeWindow)
    }
    return window
  }

  private detachWindow(): void {
    const window = this.window
    this.window = undefined
    if (window === undefined) return
    window.off('hide', this.updateViews)
    window.off('minimize', this.updateViews)
    window.off('close', this.hideViews)
    window.off('show', this.updateViews)
    window.off('restore', this.updateViews)
    window.off('resize', this.updateViews)
    window.off('closed', this.closeWindow)
  }

  private readonly closeWindow = (): void => { this.closeAll() }

  private readonly updateViews = (): void => {
    for (const entry of [...this.views.values()]) this.apply(entry)
  }

  private readonly hideViews = (): void => {
    for (const entry of [...this.views.values()]) {
      entry.shown = false
      entry.view.setVisible(false)
    }
  }

  /** Recompute one view's rectangle and visibility from the live window state. */
  private apply(entry: BrowserViewEntry): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const [width = 0, height = 0] = window.getContentSize()
    const origin = this.options.rendererOrigin()
    // Clamp inside the renderer area first so a guest can never cover the
    // shell's own caption row, then translate into window-content coordinates.
    const renderer = clampBrowserViewBounds(entry.requested, {
      width: width - origin.x,
      height: height - origin.y,
    })
    entry.bounds = renderer === null ? null : clampBrowserViewBounds({
      x: renderer.x + origin.x,
      y: renderer.y + origin.y,
      width: renderer.width,
      height: renderer.height,
    }, { width, height })
    const visible = browserViewVisible({
      requested: entry.visibleRequested,
      windowVisible: window.isVisible(),
      minimized: window.isMinimized(),
      bounds: entry.bounds,
    })
    if (visible === entry.shown) {
      if (visible && entry.bounds !== null) entry.view.setBounds(entry.bounds)
      return
    }
    entry.shown = visible
    if (visible && entry.bounds !== null) {
      // Re-appending keeps the guest above the renderer document and its chrome.
      window.contentView.addChildView(entry.view)
      entry.view.setBounds(entry.bounds)
    }
    entry.view.setVisible(visible)
  }

  /** Deny every permission, cancel every download, and never expose the renderer session. */
  private hardenSession(session: Session): void {
    if (this.hardened.has(session)) return
    this.hardened.add(session)
    session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
    session.setPermissionCheckHandler(() => false)
    session.on('will-download', event => { event.preventDefault() })
  }

  /** Attach the navigation policy and the event forwarding of one guest view. */
  private observe(entry: BrowserViewEntry): void {
    const { webContents } = entry
    webContents.setWindowOpenHandler(({ url }) => {
      this.emit({ type: 'window-open', id: entry.id, url })
      return { action: 'deny' }
    })
    webContents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame || this.allowedTarget(entry, event.url) !== undefined) return
      event.preventDefault()
      this.refuse(entry, event.url)
    })
    webContents.on('will-redirect', (event) => {
      if (!event.isMainFrame || this.allowedTarget(entry, event.url) !== undefined) return
      event.preventDefault()
      this.refuse(entry, event.url)
    })
    webContents.on('did-navigate', (_event, url) => { this.emit({ type: 'navigated', id: entry.id, url }) })
    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.emit({ type: 'navigated', id: entry.id, url })
    })
    webContents.on('page-title-updated', (_event, title) => { this.emit({ type: 'title', id: entry.id, title }) })
    webContents.on('did-start-loading', () => { this.emit({ type: 'loading', id: entry.id, loading: true }) })
    webContents.on('did-stop-loading', () => { this.emit({ type: 'loading', id: entry.id, loading: false }) })
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED, which a superseded navigation produces by design.
      if (!isMainFrame || errorCode === -3) return
      this.emit({ type: 'failed', id: entry.id, url: validatedURL, error: `${String(errorCode)}: ${errorDescription}` })
    })
    webContents.on('render-process-gone', (_event, details) => {
      this.log(`dsh-plugin-desktop: guest view ${entry.id} renderer gone (${details.reason})`)
      this.finish(entry, 'crashed')
    })
    webContents.on('destroyed', () => { this.finish(entry, 'closed') })
  }

  /**
   * Decide whether one URL may become the guest's top-level document.
   * @param entry - view whose origin allowlist applies.
   * @param url - requested target.
   * @returns the URL to load, or `undefined` when the policy refuses it.
   */
  private allowedTarget(entry: BrowserViewEntry, url: string): string | undefined {
    if (url === 'about:blank') return url
    let target: URL
    try {
      target = new URL(url)
    } catch {
      return undefined
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return undefined
    const allowOrigins = entry.allowOrigins
    if (allowOrigins !== undefined && allowOrigins.length > 0 && !allowOrigins.includes(target.origin)) {
      return undefined
    }
    return target.href
  }

  private load(entry: BrowserViewEntry, url: string): void {
    const target = this.allowedTarget(entry, url)
    if (target === undefined) {
      this.refuse(entry, url)
      return
    }
    this.loadTarget(entry, target)
  }

  /** Report one refused navigation and leave the guest on a blank document. */
  private refuse(entry: BrowserViewEntry, url: string): void {
    this.emit({
      type: 'failed',
      id: entry.id,
      url,
      error: `${BROWSER_VIEW_NAVIGATION_DENIED}: ${url} is outside the guest navigation policy`,
    })
    if (!entry.webContents.isDestroyed()) this.loadTarget(entry, 'about:blank')
  }

  private loadTarget(entry: BrowserViewEntry, url: string): void {
    // did-fail-load reports load failures to subscribers; a rejected promise
    // here only repeats them for the native log.
    void entry.webContents.loadURL(url).catch((cause: unknown) => {
      this.log(`dsh-plugin-desktop: guest view ${entry.id} failed to load ${url}: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
  }

  /** Release a view only while it is still the registered entry of its id. */
  private finish(entry: BrowserViewEntry, reason: 'closed' | 'crashed'): void {
    if (this.views.get(entry.id) !== entry) return
    this.release(entry, reason)
  }

  private release(entry: BrowserViewEntry, reason: 'closed' | 'crashed'): void {
    this.forget(entry)
    this.emit({ type: 'closed', id: entry.id, reason })
  }

  /** Drop one view without reporting it, for example when its id is replaced. */
  private forget(entry: BrowserViewEntry): void {
    this.views.delete(entry.id)
    this.dispose(entry)
  }

  /** Detach and destroy one view without reporting it to subscribers. */
  private dispose(entry: BrowserViewEntry): void {
    const window = this.window
    if (window !== undefined && !window.isDestroyed()) window.contentView.removeChildView(entry.view)
    entry.shown = false
    const { webContents } = entry
    if (webContents.isDestroyed()) return
    if (webContents.debugger.isAttached()) webContents.debugger.detach()
    webContents.close({ waitForBeforeUnload: false })
  }

  private emit(event: DesktopNativeBrowserEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (cause) {
        this.log(`dsh-plugin-desktop: guest view subscriber failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
  }

  private log(message: string): void {
    this.options.log?.(message)
  }
}
