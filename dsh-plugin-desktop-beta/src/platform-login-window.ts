/**
 * Built-in DeepSeek Platform sign-in window.
 *
 * The Platform finishes sign-in by navigating to the Host's loopback
 * `/oauth/callback`. An ordinary browser cannot reach that route unless
 * browser access is enabled, because Next's Host admits only the native
 * renderer. This window instead stops the callback navigation and replays it
 * from the main process with the native credentials, so the Host sees the same
 * request the Desktop renderer would make. The Host keeps its PKCE and state
 * checks; this module only carries the request across the browser-access gate.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions, Session, WebContents } from 'electron'
import { NATIVE_ACCESS_HEADER } from './desktop-contract.ts'

/** Sign-in partition; no `persist:` prefix, so Platform cookies never reach disk. */
export const PLATFORM_LOGIN_PARTITION = 'dsh-platform-login'
const CALLBACK_PATH = '/oauth/callback'
/** The Host holds the callback response until the exchange settles; an attempt lasts at most minutes. */
const CALLBACK_TIMEOUT = 15 * 60_000
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']

/** Native Host credentials, as published by `NextDesktopRuntime.auth`. */
export interface PlatformLoginHost {
  readonly url: string
  readonly cookie: string
  readonly token: string
}

export type PlatformLoginDecision = 'allow' | 'cancel' | 'callback'

/**
 * Decide one request made inside the sign-in window.
 * @param value - request URL.
 * @param resourceType - Electron `webRequest` resource type.
 * @param hostOrigin - current Host origin, or `undefined` while the Host is down.
 * @returns `callback` for the Host's OAuth callback navigation, `allow` for public Platform traffic, else `cancel`.
 */
export function classifyPlatformLoginRequest(value: string, resourceType: string, hostOrigin: string | undefined): PlatformLoginDecision {
  if (!URL.canParse(value)) return 'cancel'
  const url = new URL(value)
  if (['about:', 'data:', 'blob:'].includes(url.protocol)) return resourceType === 'mainFrame' ? 'cancel' : 'allow'
  if (url.username !== '' || url.password !== '') return 'cancel'
  if (hostOrigin !== undefined && url.origin === hostOrigin) {
    return resourceType === 'mainFrame' && url.pathname === CALLBACK_PATH ? 'callback' : 'cancel'
  }
  // Loopback and plaintext traffic never belongs to the Platform; refusing it keeps the page from probing local services.
  if (LOOPBACK.includes(url.hostname) || url.hostname.startsWith('127.')) return 'cancel'
  if (url.protocol === 'https:') return 'allow'
  return url.protocol === 'wss:' && !['mainFrame', 'subFrame'].includes(resourceType) ? 'allow' : 'cancel'
}

/**
 * Replay an intercepted callback against the Host as the native renderer.
 * @param callback - callback URL the Platform navigated to.
 * @param host - native Host credentials.
 * @param fetchImpl - HTTP client, replaceable in tests.
 * @returns the Host's status: 302 after success, 204 after a failed exchange, 4xx for a stale or foreign callback.
 */
export async function forwardPlatformLoginCallback(callback: string, host: PlatformLoginHost, fetchImpl: typeof fetch = fetch): Promise<number> {
  const source = new URL(callback)
  const target = new URL(host.url)
  if (source.origin !== target.origin || source.pathname !== CALLBACK_PATH) throw new Error('Not a Host sign-in callback')
  target.pathname = source.pathname
  target.search = source.search
  target.hash = ''
  const response = await fetchImpl(target, {
    method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(CALLBACK_TIMEOUT),
    headers: { cookie: host.cookie, [NATIVE_ACCESS_HEADER]: host.token },
  })
  await response.body?.cancel()
  return response.status
}

export interface PlatformLoginWindowOptions {
  /** Electron `BrowserWindow` constructor. */
  readonly BrowserWindow: new (options: BrowserWindowConstructorOptions) => BrowserWindow
  /** Resolves the sign-in partition, normally `session.fromPartition`. */
  readonly session: (partition: string) => Session
  /** Current native Host credentials, or `undefined` while the Host is down. */
  readonly host: () => PlatformLoginHost | undefined
  /** Window the sign-in page belongs to. */
  readonly parent: () => BrowserWindow | undefined
  readonly title: () => string
  readonly dark: () => boolean
  readonly warn: (error: unknown) => void
}

/** Owns the single built-in sign-in window and its in-memory session. */
export class PlatformLoginWindow {
  private window: BrowserWindow | undefined
  private readonly popups = new Set<BrowserWindow>()
  private configured: Session | undefined
  private clearing: Promise<void> = Promise.resolve()

  constructor(private readonly options: PlatformLoginWindowOptions) {}

  /**
   * Show an attempt's authorization page, replacing any earlier sign-in window.
   * @param url - authorization URL validated by host-process.ts.
   */
  open(url: string): void {
    const loginSession = this.loginSession()
    const previous = this.window
    this.window = undefined
    for (const popup of [...this.popups]) if (!popup.isDestroyed()) popup.destroy()
    if (previous !== undefined && !previous.isDestroyed()) previous.destroy()
    this.clear(loginSession)
    const parent = this.options.parent()
    const window = new this.options.BrowserWindow({
      width: 520, height: 720, minWidth: 400, minHeight: 560, show: false,
      title: this.options.title(), autoHideMenuBar: true,
      backgroundColor: this.options.dark() ? '#1f1f1f' : '#ffffff',
      ...(parent !== undefined && !parent.isDestroyed() ? { parent } : {}),
      webPreferences: popupPreferences(loginSession),
    })
    this.window = window
    this.guard(window.webContents, loginSession)
    window.on('page-title-updated', (event) => { event.preventDefault() })
    window.once('ready-to-show', () => { if (!window.isDestroyed()) { window.show(); window.focus() } })
    window.on('closed', () => {
      if (this.window !== window) return
      this.window = undefined
      this.clear(loginSession)
    })
    void this.clearing.then(async () => {
      if (!window.isDestroyed()) await window.loadURL(url)
    }).catch((error: unknown) => {
      // ERR_ABORTED (-3) is a cancelled navigation, including the intercepted callback.
      if (!String(error).includes('ERR_ABORTED')) this.options.warn(error)
    })
  }

  /** Close the sign-in window, if any, and forget its Platform cookies. */
  close(): void {
    const window = this.window
    for (const popup of [...this.popups]) if (!popup.isDestroyed()) popup.destroy()
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  private loginSession(): Session {
    const loginSession = this.options.session(PLATFORM_LOGIN_PARTITION)
    if (this.configured === loginSession) return loginSession
    this.configured = loginSession
    loginSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    loginSession.setPermissionCheckHandler(() => false)
    loginSession.setDevicePermissionHandler(() => false)
    loginSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
    loginSession.on('will-download', (event) => { event.preventDefault() })
    loginSession.webRequest.onBeforeRequest((details, callback) => {
      const host = this.options.host()
      const decision = classifyPlatformLoginRequest(details.url, details.resourceType,
        host === undefined ? undefined : new URL(host.url).origin)
      callback({ cancel: decision !== 'allow' })
      if (decision === 'callback' && host !== undefined) {
        forwardPlatformLoginCallback(details.url, host).then((status) => {
          // The account watcher closes the window once the attempt ends; only an unexpected answer is worth a note.
          if (status !== 204 && status !== 302) this.options.warn(new Error(`Platform sign-in callback returned HTTP ${status}`))
        }, (error: unknown) => { this.options.warn(error) })
      }
    })
    return loginSession
  }

  private guard(contents: WebContents, loginSession: Session): void {
    // Third-party sign-in providers may open a popup; keep it in the same guarded session.
    contents.setWindowOpenHandler(({ url }) => classifyPlatformLoginRequest(url, 'mainFrame', undefined) === 'allow'
      ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: popupPreferences(loginSession) } }
      : { action: 'deny' })
    contents.on('did-create-window', (child) => {
      this.popups.add(child)
      child.once('closed', () => { this.popups.delete(child) })
      this.guard(child.webContents, loginSession)
    })
    contents.on('will-attach-webview', (event) => { event.preventDefault() })
    contents.on('login', (event, _details, _authInfo, callback) => { event.preventDefault(); callback() })
  }

  private clear(loginSession: Session): void {
    this.clearing = this.clearing.then(() => loginSession.clearStorageData()).catch((error: unknown) => { this.options.warn(error) })
  }
}

function popupPreferences(loginSession: Session): BrowserWindowConstructorOptions['webPreferences'] {
  return { session: loginSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false }
}
