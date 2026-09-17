/** Main-process owner of native guest browser views parented to the Desktop window. */

import { app, session, WebContentsView, type BrowserWindow, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
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
import {
  BROWSER_CHROME_CANCELLED,
  BROWSER_CHROME_NOT_FOUND,
  defaultChromeExecutable,
  delay,
  freeLoopbackPort,
  googleSignedIn,
  GOOGLE_LOGIN_GESTURE_MS,
  needsGoogleAccount,
  openChromeCdpSocket,
  runChromeGoogleLogin,
  spawnChrome,
  toElectronCookies,
  type ChromeCdpCookie,
} from './chrome-login.ts'
import type { GoogleLoginStatus } from './google-login-status.ts'

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
  /** Group used by `closeOwner` to release every view of one owner; it does not scope storage. */
  owner: string
  /** Initial page loaded once the view exists. */
  url?: string
  /** Top-level navigation allowlist; omitted or empty means "any http(s)". */
  allowOrigins?: string[]
}

/** Page-side function a guest calls when the user acts on the page itself. */
const GUEST_GESTURE_BINDING = 'dshDesktopBrowserGesture'

/** Installed in every guest document so the shell hears the user's own input. */
const GUEST_GESTURE_SCRIPT = `(() => {
  if (window.__dshDesktopBrowserGestureBound === true) return
  window.__dshDesktopBrowserGestureBound = true
  const report = () => {
    try {
      window.${GUEST_GESTURE_BINDING}?.()
    } catch (error) {
      void error
    }
  }
  addEventListener('pointerdown', report, true)
  addEventListener('keydown', report, true)
})()`

/** Every event a guest view can report to its subscribers. */
export type DesktopNativeBrowserEvent =
  | { type: 'navigated'; id: string; url: string }
  | { type: 'title'; id: string; title: string }
  | { type: 'loading'; id: string; loading: boolean }
  | { type: 'window-open'; id: string; url: string }
  | { type: 'closed'; id: string; reason: 'closed' | 'crashed' }
  | { type: 'failed'; id: string; url: string; error: string }
  | { type: 'cdp'; id: string; method: string; params: unknown }
  | { type: 'google-login'; status: GoogleLoginStatus }

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
  /** Current Chrome Google-login snapshot for the shared guest profile. */
  googleLoginStatus(): Promise<GoogleLoginStatus>
  /**
   * Open stock Chrome so the user can sign in to Google, then copy the cookies
   * into the guest profile. Returns as soon as the window is asked to open.
   */
  startGoogleLogin(): Promise<GoogleLoginStatus>
  /** Close the Chrome login window if it is still waiting. */
  cancelGoogleLogin(): Promise<void>
  /**
   * Open the given addresses as tabs in the user's own Chrome window, so pages
   * that only work in a real browser can be handed over. Returns how many
   * addresses were opened.
   */
  openInChrome(urls: readonly string[]): Promise<number>
}

/** Native surface the service resolves lazily for the current shell generation. */
export interface BrowserViewServiceOptions {
  /** Resolve the main window that owns every guest view. */
  window(): BrowserWindow | undefined
  /** Resolve the renderer viewport origin inside the window content area. */
  rendererOrigin(): { x: number; y: number }
  /** Optional sink for non-fatal native failures. */
  log?(message: string): void
  /**
   * Chrome login runner. Production opens a stock Chrome window; tests replace
   * the process, the debugging protocol, and the clock.
   */
  chromeLogin?: ChromeGoogleLoginHost
}

/** Process and cookie-store seams the Chrome Google login uses. */
export interface ChromeGoogleLoginHost {
  /** Absolute path of Google Chrome, or `undefined` when it is not installed. */
  resolveExecutable(): string | undefined
  /** Dedicated Chrome user-data directory for this login. */
  profileDir(): string
  /** Launch Chrome and return its cookies once a Google session exists. */
  run(options: {
    executable: string
    profileDir: string
    signal: AbortSignal
    onPhase: (phase: Extract<GoogleLoginStatus['phase'], 'launching' | 'waiting'>) => void
  }): Promise<readonly ChromeCdpCookie[]>
  /** Open addresses as tabs in the user's own Chrome profile. */
  open(urls: readonly string[]): Promise<void>
  /** Clock used to stamp a successful import. */
  now(): number
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
  /** Last time the user acted on this page, which is what entitles it to Chrome. */
  gestureAt: number | undefined
}

/**
 * The one Chromium profile every guest view shares.
 *
 * A profile is the unit people already know: signing in to a site once keeps
 * that sign-in for every conversation, and the cookies, storage and cache on
 * disk survive restarts exactly like a normal browser. Guest views stay owned
 * per Session, so the tabs, history and panel column of one conversation never
 * appear in another; only the profile behind them is common.
 */
const BROWSER_PROFILE_PARTITION = 'persist:dsh-desktop-browser-profile'

/**
 * Host platform in the three shapes a user agent and its client hints use.
 * @returns the user-agent fragment, the client-hint platform and its version.
 */
function browserPlatform(): { userAgent: string; platform: string; platformVersion: string; architecture: string } {
  if (process.platform === 'darwin') {
    // Apple froze the macOS token at 10_15_7 for every release after Big Sur.
    const version = typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : ''
    return { userAgent: 'Macintosh; Intel Mac OS X 10_15_7', platform: 'macOS', platformVersion: version === '' ? '0.0.0' : version, architecture: process.arch === 'arm64' ? 'arm' : 'x86' }
  }
  if (process.platform === 'win32') {
    return { userAgent: 'Windows NT 10.0; Win64; x64', platform: 'Windows', platformVersion: '10.0.0', architecture: 'x86' }
  }
  return { userAgent: 'X11; Linux x86_64', platform: 'Linux', platformVersion: '0.0.0', architecture: 'x86' }
}

/** Languages the guest asks pages for, in the order a browser sends them. */
const BROWSER_LANGUAGES = 'zh-CN,zh,en'

/** Chromium version the guest actually runs. */
function browserChromeVersion(): { major: string; full: string } {
  const full = String(process.versions.chrome ?? '0.0.0.0')
  return { major: full.split('.')[0] ?? '0', full }
}

/**
 * The user agent a stock Chrome of this Chromium version sends.
 *
 * A site that reads the stock Electron token learns which desktop application
 * is asking, which is both a fingerprint and a reason to treat the visitor
 * differently, so the guest describes the browser it really is.
 * @returns the user-agent header of a stock Chrome build.
 */
function browserUserAgent(): string {
  const { major } = browserChromeVersion()
  return `Mozilla/5.0 (${browserPlatform().userAgent}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

/** Client-hint metadata that matches {@link browserUserAgent}. */
function browserUserAgentMetadata(): Record<string, unknown> {
  const { major, full } = browserChromeVersion()
  const { platform, platformVersion, architecture } = browserPlatform()
  const grease = { brand: 'Not)A;Brand', version: '8' }
  return {
    brands: [grease, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }],
    fullVersionList: [{ ...grease, version: '8.0.0.0' }, { brand: 'Chromium', version: full }, { brand: 'Google Chrome', version: full }],
    fullVersion: full,
    platform,
    platformVersion,
    architecture,
    model: '',
    mobile: false,
    bitness: '64',
    wow64: false,
  }
}

/** Own every guest view of the current main window inside the Electron main process. */
export class BrowserViewService implements DesktopNativeBrowser {
  readonly version = 1 as const
  private readonly views = new Map<string, BrowserViewEntry>()
  private readonly listeners = new Set<(event: DesktopNativeBrowserEvent) => void>()
  private readonly hardened = new WeakSet<Session>()
  private window: BrowserWindow | undefined
  private googleLogin: GoogleLoginStatus = { phase: 'idle' }
  private googleLoginTask: Promise<void> | undefined
  private googleLoginAbort: AbortController | undefined
  /** Sign-in page that already asked for Chrome, so one page asks only once. */
  private autoLoginUrl: string | undefined
  /** Cookie set Chrome offered that the guest could not use, so it is not retried every second. */
  /** Last answer to whether the guest holds a live Google session, and when it was given. */
  /** Set once the user cancels a Chrome login, until they ask for one again. */
  private autoLoginSuppressed = false

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
      partition: BROWSER_PROFILE_PARTITION,
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
      gestureAt: undefined,
    }
    this.views.set(id, entry)
    this.observe(entry)
    this.adoptIdentity(entry)
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
    this.attachDebugger(entry)
    // The Agent works a page through this relay, so its own clicks and keys are
    // the input that lets the page ask for Chrome.
    if (method.startsWith('Input.')) {
      if (entry.gestureAt === undefined) this.log(`dsh-plugin-desktop: guest view ${entry.id} saw the Agent's own input`)
      entry.gestureAt = Date.now()
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

  /** @inheritdoc */
  async googleLoginStatus(): Promise<GoogleLoginStatus> {
    if (this.googleLogin.phase === 'idle' || this.googleLogin.phase === 'failed' || this.googleLogin.phase === 'cancelled') {
      if (googleSignedIn(await this.guestCookies())) {
        this.googleLogin = {
          phase: 'signed-in',
          imported: this.googleLogin.imported ?? 0,
          ...(this.googleLogin.importedAt === undefined ? {} : { importedAt: this.googleLogin.importedAt }),
        }
      }
    }
    return this.googleLogin
  }

  /** @inheritdoc */
  async startGoogleLogin(): Promise<GoogleLoginStatus> {
    // An explicit request re-arms the automatic login a cancel switched off.
    this.autoLoginSuppressed = false
    return await this.launchGoogleLogin()
  }

  /** @inheritdoc */
  async cancelGoogleLogin(): Promise<void> {
    // Cancelling is a decision about the automatic path too: the same sign-in
    // page must not open Chrome again on its own.
    this.autoLoginSuppressed = true
    this.googleLoginAbort?.abort()
    if (this.googleLogin.phase === 'launching' || this.googleLogin.phase === 'waiting' || this.googleLogin.phase === 'importing') {
      this.setGoogleLogin({ phase: 'cancelled' })
    }
  }

  /** @inheritdoc */
  async openInChrome(urls: readonly string[]): Promise<number> {
    const targets = urls.filter(url => /^https?:\/\//i.test(url))
    if (targets.length === 0) return 0
    await this.chromeLogin().open(targets)
    return targets.length
  }

  /** Launch Chrome unless one is already on its way. */
  private async launchGoogleLogin(): Promise<GoogleLoginStatus> {
    if (this.googleLoginTask !== undefined) return this.googleLogin
    const host = this.chromeLogin()
    const executable = host.resolveExecutable()
    if (executable === undefined) {
      this.setGoogleLogin({ phase: 'failed', error: `${BROWSER_CHROME_NOT_FOUND}: Google Chrome is not installed` })
      return this.googleLogin
    }
    const abort = new AbortController()
    this.googleLoginAbort = abort
    this.setGoogleLogin({ phase: 'launching' })
    this.googleLoginTask = this.importGoogleLogin(host, executable, abort.signal).finally(() => {
      this.googleLoginTask = undefined
      this.googleLoginAbort = undefined
    })
    return this.googleLogin
  }

  /**
   * Ask for Chrome the moment a guest page needs a Google account.
   *
   * The embedded window cannot sign in to Google, so the page that needs the
   * account is what starts the real login; the user never has to look for a
   * button. One page asks once, and a cancel stops the asking.
   * @param url - address the guest committed.
   */
  private async maybeAutoLogin(entry: BrowserViewEntry, url: string): Promise<void> {
    if (this.autoLoginSuppressed || !needsGoogleAccount(url)) return
    // Only the user's own action on a page opens Chrome: a page that lands on a
    // sign-in address by itself keeps the embedded window it has.
    const gestureAt = entry.gestureAt
    if (gestureAt === undefined || Date.now() - gestureAt > GOOGLE_LOGIN_GESTURE_MS) return
    if (this.autoLoginUrl === url || this.googleLoginTask !== undefined) return
    this.autoLoginUrl = url
    const status = await this.googleLoginStatus()
    if (status.phase === 'signed-in' || this.googleLoginTask !== undefined) return
    if (this.autoLoginSuppressed) return
    await this.launchGoogleLogin()
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
    session.setUserAgent(browserUserAgent(), BROWSER_LANGUAGES)
    session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
    session.setPermissionCheckHandler(() => false)
    session.on('will-download', event => { event.preventDefault() })
  }

  /**
   * Describe the guest as the browser it is rather than as this application.
   *
   * The session's user agent covers requests; the client hints a page reads from
   * `navigator.userAgentData` come from the browser's own brand list, so they are
   * overridden per view. A failure here is never fatal: the guest still browses,
   * with the application token in its client hints.
   * @param entry - guest view to describe.
   */
  private adoptIdentity(entry: BrowserViewEntry): void {
    try {
      this.attachDebugger(entry)
      void entry.webContents.debugger.sendCommand('Emulation.setUserAgentOverride', {
        userAgent: browserUserAgent(),
        platform: browserPlatform().platform,
        // The session already owns `Accept-Language`; overriding it here as well
        // would append a second set of quality values to that header.
        userAgentMetadata: browserUserAgentMetadata(),
      }).catch((cause: unknown) => {
        this.log(`dsh-plugin-desktop: guest view ${entry.id} kept its default client hints: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
    } catch (cause) {
      this.log(`dsh-plugin-desktop: guest view ${entry.id} could not attach its debugger: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  /** Attach the protocol session of one view exactly once, forwarding its events. */
  private attachDebugger(entry: BrowserViewEntry): void {
    const debuggerSession = entry.webContents.debugger
    if (debuggerSession.isAttached()) return
    debuggerSession.attach(BROWSER_VIEW_CDP_PROTOCOL_VERSION)
    debuggerSession.on('message', (_event, messageMethod, messageParams) => {
      if (messageMethod === 'Runtime.bindingCalled' && (messageParams as { name?: string } | undefined)?.name === GUEST_GESTURE_BINDING) {
        if (entry.gestureAt === undefined) this.log(`dsh-plugin-desktop: guest view ${entry.id} saw the user's own input`)
        entry.gestureAt = Date.now()
        return
      }
      this.emit({ type: 'cdp', id: entry.id, method: messageMethod, params: messageParams })
    })
    void debuggerSession.sendCommand('Runtime.addBinding', { name: GUEST_GESTURE_BINDING }).catch((cause: unknown) => {
      this.log(`dsh-plugin-desktop: guest view ${entry.id} cannot report user input: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
    // A page's own sign-in control can live in a frame, and `dom-ready` only
    // reaches the top-level document, so the reporter is installed for every
    // document the view loads from here on.
    void debuggerSession.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: GUEST_GESTURE_SCRIPT }).catch((cause: unknown) => {
      this.log(`dsh-plugin-desktop: guest view ${entry.id} cannot report input from every frame: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
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
    webContents.on('did-navigate', (_event, url) => {
      this.emit({ type: 'navigated', id: entry.id, url })
      void this.maybeAutoLogin(entry, url).catch((cause: unknown) => {
        this.log(`dsh-plugin-desktop: automatic Chrome login did not start: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
    })
    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.emit({ type: 'navigated', id: entry.id, url })
    })
    webContents.on('dom-ready', () => {
      void webContents.executeJavaScript(GUEST_GESTURE_SCRIPT).catch((cause: unknown) => {
        this.log(`dsh-plugin-desktop: guest view ${entry.id} did not accept user input reporting: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
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
  /**
   * Report a refused navigation without touching the document on screen.
   *
   * The address stays in the panel and the panel itself explains the refusal,
   * so a blocked link never turns into a blank tab or a silent fallback to the
   * page the user was leaving.
   * @param entry - guest view whose navigation was refused.
   * @param url - address outside the policy.
   */
  private refuse(entry: BrowserViewEntry, url: string): void {
    this.emit({
      type: 'failed',
      id: entry.id,
      url,
      error: `${BROWSER_VIEW_NAVIGATION_DENIED}: ${url} is outside the guest navigation policy`,
    })
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

  private chromeLogin(): ChromeGoogleLoginHost {
    return this.options.chromeLogin ?? productionChromeLogin()
  }

  private guestSession(): Session {
    return session.fromPartition(BROWSER_PROFILE_PARTITION)
  }

  private async guestCookies(): Promise<Array<{ name: string; domain: string }>> {
    try {
      return (await this.guestSession().cookies.get({ domain: '.google.com' }))
        .flatMap(cookie => cookie.domain === undefined ? [] : [{ name: cookie.name, domain: cookie.domain }])
    } catch {
      return []
    }
  }

  private setGoogleLogin(status: GoogleLoginStatus): void {
    this.googleLogin = status
    this.emit({ type: 'google-login', status })
  }

  private async importGoogleLogin(
    host: ChromeGoogleLoginHost,
    executable: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const cookies = await host.run({
        executable,
        profileDir: host.profileDir(),
        signal,
        onPhase: phase => { this.setGoogleLogin({ phase }) },
      })
      this.setGoogleLogin({ phase: 'importing' })
      const imported = await this.writeGuestCookies(cookies)
      this.setGoogleLogin({
        phase: 'signed-in',
        imported,
        importedAt: host.now(),
      })
      // The sign-in page that asked for Chrome is answered now; a later sign-out
      // may ask again.
      this.autoLoginUrl = undefined
      await this.reloadGoogleTabs()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (signal.aborted || message.startsWith(BROWSER_CHROME_CANCELLED)) {
        this.setGoogleLogin({ phase: 'cancelled' })
        return
      }
      this.setGoogleLogin({ phase: 'failed', error: message })
    }
  }

  private async writeGuestCookies(cookies: readonly ChromeCdpCookie[]): Promise<number> {
    const guest = this.guestSession()
    let written = 0
    for (const cookie of toElectronCookies(cookies)) {
      try {
        await guest.cookies.set(cookie)
        written += 1
      } catch (cause) {
        this.log(`dsh-plugin-desktop: guest cookie ${cookie.name} was not imported: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    return written
  }

  private async reloadGoogleTabs(): Promise<void> {
    for (const entry of [...this.views.values()]) {
      const url = entry.webContents.getURL()
      if (!isGoogleDocument(url)) continue
      try {
        await entry.webContents.reload()
      } catch (cause) {
        this.log(`dsh-plugin-desktop: guest view ${entry.id} could not reload after Google login: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
  }
}

/** Production Chrome login: a stock Chrome window owned by this process. */
function productionChromeLogin(): ChromeGoogleLoginHost {
  return {
    resolveExecutable: defaultChromeExecutable,
    profileDir: () => join(app.getPath('userData'), 'chrome-google-login'),
    now: () => Date.now(),
    // The hand-off uses the user's own Chrome profile and no debugging port:
    // they are already signed in there, and nothing about it has to be driven.
    async open(urls) {
      const executable = defaultChromeExecutable()
      if (executable === undefined) {
        throw new Error(`${BROWSER_CHROME_NOT_FOUND}: Google Chrome is not installed`)
      }
      spawnChrome(executable, ['--new-window', ...urls])
    },
    async run(options) {
      return await runChromeGoogleLogin({
        executable: options.executable,
        profileDir: options.profileDir,
        signal: options.signal,
        onPhase: options.onPhase,
        spawn: spawnChrome,
        fetch: async url => {
          const response = await fetch(url)
          return { ok: response.ok, json: async () => await response.json() }
        },
        openSocket: openChromeCdpSocket,
        freePort: freeLoopbackPort,
        sleep: delay,
        now: Date.now,
      })
    },
  }
}

/** Names and values identify one candidate session, so a rejected one is not retried blindly. */
function isGoogleDocument(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'google.com' || host.endsWith('.google.com')
  } catch {
    return false
  }
}
