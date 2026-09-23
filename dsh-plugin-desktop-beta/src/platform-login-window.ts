/**
 * Built-in DeepSeek Platform sign-in window.
 *
 * The Platform finishes sign-in by navigating to the Host's loopback
 * `/oauth/callback`. An ordinary browser cannot reach that route unless
 * browser access is enabled, because the Desktop WebServer gate admits only
 * the Electron renderer. This window instead stops the callback navigation and
 * replays it from the main process with the renderer's session cookie and
 * generation capability, so the Host sees the request the renderer would make.
 * The Host keeps its PKCE and state checks; this module only carries the
 * request across the browser-access gate.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions, Session, WebContents } from 'electron'

/** Sign-in partition; no `persist:` prefix, so Platform cookies never reach disk. */
export const PLATFORM_LOGIN_PARTITION = 'dsh-desktop-platform-login'
const CALLBACK_PATH = '/oauth/callback'
/** The Host holds the callback response until the exchange settles; an attempt lasts at most minutes. */
const CALLBACK_TIMEOUT_MS = 15 * 60_000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Credentials that admit a replayed callback through the Desktop WebServer gate. */
export interface PlatformLoginHost {
  /** Origin of the renderer URL; the Platform redirects to this origin. */
  readonly origin: string
  /** Serialized `Cookie` header from the renderer session. */
  readonly cookie: string
  /** Generation-scoped renderer capability header. */
  readonly header: { readonly name: string; readonly value: string }
}

export type PlatformLoginDecision = 'allow' | 'cancel' | 'callback'

/**
 * Decide one request made inside the sign-in window.
 * @param value - request URL.
 * @param resourceType - Electron `webRequest` resource type.
 * @param hostOrigin - current Host origin, or `undefined` while no shell is mounted.
 * @returns `callback` for the Host's OAuth callback navigation, `allow` for public Platform traffic, else `cancel`.
 */
export function classifyPlatformLoginRequest(value: string, resourceType: string, hostOrigin: string | undefined): PlatformLoginDecision {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'cancel'
  }
  if (['about:', 'data:', 'blob:'].includes(url.protocol)) return resourceType === 'mainFrame' ? 'cancel' : 'allow'
  if (url.username !== '' || url.password !== '') return 'cancel'
  if (hostOrigin !== undefined && url.origin === hostOrigin) {
    return resourceType === 'mainFrame' && url.pathname === CALLBACK_PATH ? 'callback' : 'cancel'
  }
  // Loopback and plaintext traffic never belongs to the Platform; refusing it keeps the page from probing local services.
  if (LOOPBACK_HOSTS.has(url.hostname) || url.hostname.startsWith('127.')) return 'cancel'
  if (url.protocol === 'https:') return 'allow'
  return url.protocol === 'wss:' && !['mainFrame', 'subFrame'].includes(resourceType) ? 'allow' : 'cancel'
}

/**
 * Replay an intercepted callback against the Host as the Electron renderer.
 * @param callback - callback URL the Platform navigated to.
 * @param host - renderer credentials for the current shell generation.
 * @param fetchImpl - HTTP client, replaceable in tests.
 * @returns the Host's status: 302 after success, 204 after a failed exchange, 4xx for a stale or foreign callback.
 */
export async function forwardPlatformLoginCallback(
  callback: string,
  host: PlatformLoginHost,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const source = new URL(callback)
  const target = new URL(host.origin)
  if (source.origin !== target.origin || source.pathname !== CALLBACK_PATH) {
    throw new Error('dsh-plugin-desktop: not a Host sign-in callback')
  }
  target.pathname = source.pathname
  target.search = source.search
  target.hash = ''
  const response = await fetchImpl(target, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    headers: {
      ...(host.cookie === '' ? {} : { cookie: host.cookie }),
      [host.header.name]: host.header.value,
    },
  })
  await response.body?.cancel()
  return response.status
}

/**
 * Carry the effective palette into the Platform sign-in page, as upstream Desktop does.
 * @param authorizeUrl - authorization URL already validated at the process boundary.
 * @param dark - whether the application currently renders dark.
 * @returns the URL carrying `theme=light` or `theme=dark`.
 */
export function platformLoginUrl(authorizeUrl: string, dark: boolean): string {
  const url = new URL(authorizeUrl)
  url.searchParams.set('theme', dark ? 'dark' : 'light')
  return url.href
}

/** Caption of the built-in sign-in window. */
export const PLATFORM_LOGIN_TITLE = { zh: '登录 DeepSeek', en: 'Sign in to DeepSeek' } as const

export interface PlatformLoginWindowOptions {
  /** Electron `BrowserWindow` constructor. */
  readonly BrowserWindow: new (options: BrowserWindowConstructorOptions) => BrowserWindow
  /** Resolves the sign-in partition, normally `session.fromPartition`. */
  readonly session: (partition: string) => Session
  /** Origin of the mounted renderer, or `undefined` while no shell is mounted. */
  readonly hostOrigin: () => string | undefined
  /** Resolve renderer credentials when a callback is intercepted. */
  readonly host: () => Promise<PlatformLoginHost | undefined>
  /** Window the sign-in page belongs to. */
  readonly parent: () => BrowserWindow | undefined
  readonly title: () => string
  readonly dark: () => boolean
  readonly warn: (message: string) => void
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
   * @param url - authorization URL validated at the process boundary.
   */
  open(url: string): void {
    const loginSession = this.loginSession()
    this.close()
    this.window = undefined
    this.clear(loginSession)
    const parent = this.options.parent()
    const window = new this.options.BrowserWindow({
      width: 520,
      height: 720,
      minWidth: 400,
      minHeight: 560,
      show: false,
      title: this.options.title(),
      autoHideMenuBar: true,
      backgroundColor: this.options.dark() ? '#1f1f1f' : '#ffffff',
      ...(parent !== undefined && !parent.isDestroyed() ? { parent } : {}),
      webPreferences: popupPreferences(loginSession),
    })
    this.window = window
    this.guard(window.webContents, loginSession)
    window.on('page-title-updated', (event) => { event.preventDefault() })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) {
        window.show()
        window.focus()
      }
    })
    window.on('closed', () => {
      if (this.window !== window) return
      this.window = undefined
      this.clear(loginSession)
    })
    void this.clearing.then(async () => {
      if (!window.isDestroyed()) await window.loadURL(url)
    }).catch((error: unknown) => {
      // ERR_ABORTED (-3) is a cancelled navigation, including the intercepted callback.
      if (!String(error).includes('ERR_ABORTED')) this.options.warn(`dsh-plugin-desktop: platform sign-in page failed: ${String(error)}`)
    })
  }

  /** Close the sign-in window and its popups, if any; closing forgets the Platform cookies. */
  close(): void {
    for (const popup of [...this.popups]) if (!popup.isDestroyed()) popup.destroy()
    const window = this.window
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
      const decision = classifyPlatformLoginRequest(details.url, details.resourceType, this.options.hostOrigin())
      callback({ cancel: decision !== 'allow' })
      if (decision === 'callback') this.forward(details.url)
    })
    return loginSession
  }

  private forward(callback: string): void {
    void this.options.host().then(async (host) => {
      if (host === undefined) throw new Error('the Desktop shell is not mounted')
      const status = await forwardPlatformLoginCallback(callback, host)
      // The account watcher closes the window once the attempt ends; only an unexpected answer is worth a note.
      if (status !== 204 && status !== 302) this.options.warn(`dsh-plugin-desktop: platform sign-in callback returned HTTP ${String(status)}`)
    }).catch((error: unknown) => {
      this.options.warn(`dsh-plugin-desktop: platform sign-in callback failed: ${error instanceof Error ? error.message : String(error)}`)
    })
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
    contents.on('login', (event, _details, _authInfo, callback) => {
      event.preventDefault()
      callback()
    })
  }

  private clear(loginSession: Session): void {
    this.clearing = this.clearing
      .then(() => loginSession.clearStorageData())
      .catch((error: unknown) => { this.options.warn(`dsh-plugin-desktop: failed to clear platform sign-in data: ${String(error)}`) })
  }
}

function popupPreferences(loginSession: Session): Electron.WebPreferences {
  return { session: loginSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false }
}
