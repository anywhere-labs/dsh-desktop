/**
 * Sign in to Google in a stock Chrome window, then copy the resulting cookies
 * into the Desktop guest profile.
 *
 * Google refuses Electron as a login client even when the guest describes
 * itself as Chrome. The login therefore happens in a real Chrome the user
 * already trusts; only the cookies come back.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { GoogleLoginPhase } from './google-login-status.ts'

export type { GoogleLoginPhase }

/** Stable failure when no Google Chrome binary can be found. */
export const BROWSER_CHROME_NOT_FOUND = 'BROWSER_CHROME_NOT_FOUND'

/** Stable failure when Chrome did not open a debugging port. */
export const BROWSER_CHROME_UNAVAILABLE = 'BROWSER_CHROME_UNAVAILABLE'

/** Stable failure when the user closed Chrome before a session appeared. */
export const BROWSER_CHROME_CLOSED = 'BROWSER_CHROME_CLOSED'

/** Stable failure when the user cancelled the Chrome window. */
export const BROWSER_CHROME_CANCELLED = 'BROWSER_CHROME_CANCELLED'

/** Stable failure when Chrome stayed open without a Google session. */
export const BROWSER_CHROME_LOGIN_TIMEOUT = 'BROWSER_CHROME_LOGIN_TIMEOUT'

/** Page Chrome opens so the user can finish Google's own sign-in. */
export const GOOGLE_LOGIN_URL = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp'

/** How long the user has to finish signing in. */
export const GOOGLE_LOGIN_TIMEOUT_MS = 10 * 60_000

/** How long one debugging command may take before its poll moves on. */
const CDP_CALL_TIMEOUT_MS = 15_000

/** How long the user's own input keeps a page entitled to ask for Chrome. */
export const GOOGLE_LOGIN_GESTURE_MS = 60_000

/** Cookie names that mean a Google account session exists. */
export const GOOGLE_SESSION_COOKIES = new Set([
  'SID',
  'SSID',
  '__Secure-1PSID',
  '__Secure-3PSID',
])

/** Host suffixes whose cookies belong to the Google account. */
const GOOGLE_COOKIE_HOSTS = [
  'google.com',
  'googleapis.com',
  'googleusercontent.com',
  'gstatic.com',
  'youtube.com',
  'ytimg.com',
  'ggpht.com',
]

/** Hosts whose pages cannot be used in this window without a Google account. */
const GOOGLE_ACCOUNT_HOSTS = ['gemini.google.com']

/** Sign-in routes Google serves from its account host. */
const GOOGLE_SIGN_IN_PATHS = ['signin', 'servicelogin', 'accountchooser']

/** One cookie as Chrome's debugging protocol reports it. */
export interface ChromeCdpCookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path?: string
  readonly expires?: number
  readonly httpOnly?: boolean
  readonly secure?: boolean
  readonly session?: boolean
  readonly sameSite?: string
  readonly partitionKey?: unknown
}

/** One cookie in the shape Electron's session accepts. */
export interface ElectronCookieInput {
  readonly url: string
  readonly name: string
  readonly value: string
  /** Omitted for `__Host-` cookies, which Chromium only accepts without it. */
  readonly domain?: string
  readonly path: string
  readonly secure: boolean
  readonly httpOnly: boolean
  readonly expirationDate?: number
  readonly sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/**
 * Whether an address is Google's own sign-in form.
 * @param url - page address.
 */
export function isGoogleSignInUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.hostname !== 'accounts.google.com') return false
  const path = parsed.pathname.toLowerCase()
  return GOOGLE_SIGN_IN_PATHS.some(segment => path.includes(segment))
}

/**
 * Whether a page needs a Google account this window cannot sign in to.
 *
 * Google renders its own sign-in form on `accounts.google.com`, and Gemini keeps
 * its address while it shows a signed-out landing page, so both the account host
 * on a sign-in route and Gemini itself count.
 * @param url - guest page address.
 */
export function needsGoogleAccount(url: string): boolean {
  try {
    if (GOOGLE_ACCOUNT_HOSTS.includes(new URL(url).hostname)) return true
  } catch {
    return false
  }
  return isGoogleSignInUrl(url)
}

/**
 * Whether one cookie host belongs to Google's account.
 * @param domain - cookie domain, with or without a leading dot.
 */
export function isGoogleCookieHost(domain: string): boolean {
  const host = domain.startsWith('.') ? domain.slice(1) : domain
  return GOOGLE_COOKIE_HOSTS.some(suffix => host === suffix || host.endsWith(`.${suffix}`))
}

/**
 * Whether a cookie list contains a Google account session.
 * @param cookies - cookies from Chrome or from the guest profile.
 */
export function googleSignedIn(cookies: readonly { name: string; domain: string }[]): boolean {
  return cookies.some(cookie => isGoogleCookieHost(cookie.domain) && GOOGLE_SESSION_COOKIES.has(cookie.name))
}

/**
 * Reconstruct the URL Electron requires to write one cookie.
 * @param cookie - cookie from Chrome.
 */
export function chromeCookieUrl(cookie: ChromeCdpCookie): string {
  const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
  const protocol = cookie.secure === true ? 'https' : 'http'
  const path = cookie.path === undefined || cookie.path === '' ? '/' : cookie.path
  return `${protocol}://${host}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Map Chrome's SameSite token onto Electron's.
 * @param value - CDP `sameSite` field.
 */
export function electronSameSite(value: string | undefined): ElectronCookieInput['sameSite'] {
  switch (value?.toLowerCase()) {
    case 'strict':
      return 'strict'
    case 'lax':
      return 'lax'
    case 'none':
      return 'no_restriction'
    default:
      return 'unspecified'
  }
}

/**
 * Convert one Chrome cookie into an Electron `cookies.set` payload.
 * @param cookie - cookie from Chrome.
 * @returns the payload, or `undefined` when the cookie is partitioned or empty.
 */
export function toElectronCookie(cookie: ChromeCdpCookie): ElectronCookieInput | undefined {
  if (cookie.name === '' || cookie.partitionKey !== undefined) return undefined
  if (!isGoogleCookieHost(cookie.domain)) return undefined
  const session = cookie.session === true || cookie.expires === undefined || cookie.expires < 0
  // A `__Host-` cookie is only valid without a Domain attribute and at the root
  // path, so its host may appear in the url alone; Chromium rejects the cookie
  // otherwise. Google keeps its account session in `__Host-GAPS`.
  const hostOnly = cookie.name.startsWith('__Host-')
  return {
    url: chromeCookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    ...(hostOnly ? {} : { domain: cookie.domain }),
    path: hostOnly ? '/' : cookie.path === undefined || cookie.path === '' ? '/' : cookie.path,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: electronSameSite(cookie.sameSite),
    ...(session ? {} : { expirationDate: cookie.expires }),
  }
}

/**
 * Convert Chrome's cookie list into Electron writes, dropping unrelated cookies.
 * @param cookies - cookies from Chrome.
 */
export function toElectronCookies(cookies: readonly ChromeCdpCookie[]): ElectronCookieInput[] {
  const written: ElectronCookieInput[] = []
  for (const cookie of cookies) {
    const next = toElectronCookie(cookie)
    if (next !== undefined) written.push(next)
  }
  return written
}

/**
 * Locate a stock Chrome (or Chromium) binary on this machine.
 * @param input - platform, environment, and filesystem probe.
 */
export function resolveChromeExecutable(input: {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homedir: string
  exists: (path: string) => boolean
}): string | undefined {
  const fromEnv = input.env.DSH_CHROME_PATH ?? input.env.CHROME_PATH
  if (typeof fromEnv === 'string' && fromEnv !== '' && input.exists(fromEnv)) return fromEnv
  const home = input.homedir
  const candidates: string[] = []
  if (input.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    )
  } else if (input.platform === 'win32') {
    const local = input.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const programFiles = input.env.PROGRAMFILES ?? 'C:\\Program Files'
    const programFilesX86 = input.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
    candidates.push(
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    )
  } else {
    candidates.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    )
  }
  const pathDirs = (input.env.PATH ?? '').split(delimiter).filter(dir => dir !== '')
  const names = input.platform === 'win32'
    ? ['chrome.exe', 'google-chrome.exe']
    : ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']
  for (const dir of pathDirs) {
    for (const name of names) candidates.push(join(dir, name))
  }
  return candidates.find(path => input.exists(path))
}

/** A debugging-protocol socket the login runner can talk to. */
export interface ChromeCdpSocket {
  readonly ready: Promise<void>
  send(data: string): void
  onMessage(listener: (data: string) => void): () => void
  close(): void
}

/** Inputs the Chrome login runner needs, so tests can script the process. */
export interface ChromeGoogleLoginRunOptions {
  readonly executable: string
  readonly profileDir: string
  readonly url?: string
  readonly timeoutMs?: number
  readonly signal: AbortSignal
  readonly spawn: (command: string, args: readonly string[]) => ChildProcess
  readonly fetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>
  readonly openSocket: (url: string) => ChromeCdpSocket
  readonly freePort: () => Promise<number>
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly onPhase: (phase: Extract<GoogleLoginPhase, 'launching' | 'waiting'>) => void
}

/**
 * Bind an ephemeral loopback port for Chrome's debugging server.
 * @returns a free TCP port on 127.0.0.1.
 */
export async function freeLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      server.close(error => {
        if (error !== undefined) reject(error)
        else resolve(address.port)
      })
    })
  })
}

/**
 * Open a Chrome debugging-protocol socket with the Node WebSocket.
 * @param url - `webSocketDebuggerUrl` from `/json/version`.
 */
export function openChromeCdpSocket(url: string): ChromeCdpSocket {
  const socket = new WebSocket(url)
  const listeners = new Set<(data: string) => void>()
  socket.addEventListener('message', event => {
    const data = typeof event.data === 'string' ? event.data : String(event.data)
    for (const listener of [...listeners]) listener(data)
  })
  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => { resolve() }, { once: true })
    socket.addEventListener('error', () => {
      reject(new Error(`${BROWSER_CHROME_UNAVAILABLE}: Chrome debugging socket failed`))
    }, { once: true })
  })
  return {
    ready,
    send(data) { socket.send(data) },
    onMessage(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    close() { socket.close() },
  }
}

/**
 * Launch Chrome, wait until the user has a Google session, and return its cookies.
 * @param options - process, protocol, and clock dependencies.
 */
export async function runChromeGoogleLogin(options: ChromeGoogleLoginRunOptions): Promise<readonly ChromeCdpCookie[]> {
  const url = options.url ?? GOOGLE_LOGIN_URL
  const timeoutMs = options.timeoutMs ?? GOOGLE_LOGIN_TIMEOUT_MS
  const deadline = options.now() + timeoutMs
  options.onPhase('launching')
  const port = await options.freePort()
  const child = options.spawn(options.executable, [
    `--remote-debugging-port=${String(port)}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${options.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    url,
  ])
  let closed = false
  child.once('exit', () => { closed = true })
  child.once('error', () => { closed = true })
  let socket: ChromeCdpSocket | undefined
  try {
    const version = await waitForDebugger(options, port, deadline, () => closed)
    socket = options.openSocket(version)
    await socket.ready
    options.onPhase('waiting')
    return await waitForGoogleCookies(options, socket, deadline, () => closed)
  } finally {
    socket?.close()
    if (!closed) child.kill()
  }
}

/** Wait until Chrome's debugging HTTP endpoint answers. */
async function waitForDebugger(
  options: ChromeGoogleLoginRunOptions,
  port: number,
  deadline: number,
  closed: () => boolean,
): Promise<string> {
  while (options.now() < deadline) {
    throwIfStopped(options, closed)
    try {
      const response = await options.fetch(`http://127.0.0.1:${String(port)}/json/version`)
      if (response.ok) {
        const body = await response.json() as { webSocketDebuggerUrl?: unknown }
        if (typeof body.webSocketDebuggerUrl === 'string' && body.webSocketDebuggerUrl !== '') {
          return body.webSocketDebuggerUrl
        }
      }
    } catch {
      // Chrome is still starting.
    }
    await options.sleep(200)
  }
  throw new Error(`${BROWSER_CHROME_UNAVAILABLE}: Chrome did not open a debugging port`)
}

/** Poll Chrome until it reports a Google session and has left the sign-in form. */
async function waitForGoogleCookies(
  options: ChromeGoogleLoginRunOptions,
  socket: ChromeCdpSocket,
  deadline: number,
  closed: () => boolean,
): Promise<readonly ChromeCdpCookie[]> {
  const client = new CdpClient(socket)
  while (options.now() < deadline) {
    throwIfStopped(options, closed)
    const cookies = await client.cookies()
    if (googleSignedIn(cookies) && await chromeLeftSignIn(client)) return cookies
    await options.sleep(1_000)
  }
  throw new Error(`${BROWSER_CHROME_LOGIN_TIMEOUT}: Chrome was still waiting for a Google session`)
}

/**
 * Whether Chrome itself has finished signing in.
 *
 * Chrome is the only party that can say whether the session it holds still
 * authenticates: a profile keeps Google's session cookies long after Google
 * stops honouring them, and their names alone look like a sign-in. The sign-in
 * window is opened on Google's form and leaves it only once the account is
 * really there, so its own pages are the answer.
 */
async function chromeLeftSignIn(client: CdpClient): Promise<boolean> {
  let targets: { type?: string; url?: string }[]
  try {
    targets = await client.targets()
  } catch {
    // Chrome did not answer this poll; the next one decides.
    return false
  }
  const pages = targets
    .filter(target => target.type === 'page' && (target.url ?? '') !== '')
    .map(target => target.url ?? '')
  return pages.length > 0 && pages.every(url => !isGoogleSignInUrl(url))
}

function throwIfStopped(options: ChromeGoogleLoginRunOptions, closed: () => boolean): void {
  if (options.signal.aborted) {
    throw new Error(`${BROWSER_CHROME_CANCELLED}: Chrome Google login was cancelled`)
  }
  if (closed()) {
    throw new Error(`${BROWSER_CHROME_CLOSED}: Chrome closed before a Google session appeared`)
  }
}

/**
 * Whether Chrome answered that a debugging command does not exist.
 * @param cause - rejection of one protocol call.
 */
function isUnknownCdpMethod(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /wasn't found|isn't found|not found|Unknown method|does not exist/i.test(message)
}

/** One debugging-protocol session over a JSON WebSocket. */
class CdpClient {
  private nextId = 0
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  constructor(socket: ChromeCdpSocket) {
    socket.onMessage(data => {
      let message: { id?: unknown; result?: unknown; error?: { message?: unknown } }
      try {
        message = JSON.parse(data) as typeof message
      } catch {
        return
      }
      if (typeof message.id !== 'number') return
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) {
        pending.reject(new Error(typeof message.error.message === 'string' ? message.error.message : 'Chrome debugging command failed'))
        return
      }
      pending.resolve(message.result)
    })
    this.send = (payload: string) => { socket.send(payload) }
  }

  private readonly send: (payload: string) => void

  /**
   * Every cookie of Chrome's default browser context.
   *
   * The browser endpoint answers `Storage.getCookies`; the older
   * `Network.getAllCookies` disappears from it in current Chrome builds, so the
   * modern command is tried first and the legacy one only as a fallback.
   */
  async cookies(): Promise<ChromeCdpCookie[]> {
    const result = await this.cookieList()
    if (!Array.isArray(result.cookies)) return []
    return result.cookies.filter((cookie): cookie is ChromeCdpCookie => {
      return cookie !== null && typeof cookie === 'object'
        && typeof (cookie as ChromeCdpCookie).name === 'string'
        && typeof (cookie as ChromeCdpCookie).value === 'string'
        && typeof (cookie as ChromeCdpCookie).domain === 'string'
    })
  }

  /** Every target Chrome currently serves, including its open pages. */
  async targets(): Promise<{ type?: string; url?: string }[]> {
    const result = await this.call('Target.getTargets') as { targetInfos?: { type?: string; url?: string }[] }
    return Array.isArray(result.targetInfos) ? result.targetInfos : []
  }

  /** Read the cookie list with the command this Chrome build answers. */
  private async cookieList(): Promise<{ cookies?: unknown }> {
    try {
      return await this.call('Storage.getCookies') as { cookies?: unknown }
    } catch (cause) {
      if (!isUnknownCdpMethod(cause)) throw cause
      return await this.call('Network.getAllCookies') as { cookies?: unknown }
    }
  }

  private call(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      // A debugging server that stops answering must not stall the poll.
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${BROWSER_CHROME_UNAVAILABLE}: Chrome did not answer ${method}`))
      }, CDP_CALL_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
      this.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }))
    })
  }
}

/**
 * Default Chrome executable lookup against this process.
 * @returns an absolute path, or `undefined` when Chrome is not installed.
 */
export function defaultChromeExecutable(): string | undefined {
  return resolveChromeExecutable({
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    exists: existsSync,
  })
}

/**
 * Default sleep used by the production Chrome runner.
 * @param ms - delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Spawn Chrome as a child of the Desktop process.
 * @param command - Chrome binary.
 * @param args - Chrome switches and the login URL.
 */
export function spawnChrome(command: string, args: readonly string[]): ChildProcess {
  return spawn(command, [...args], {
    stdio: 'ignore',
    windowsHide: false,
  })
}
