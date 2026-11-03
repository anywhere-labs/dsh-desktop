/**
 * Built-in Tokens Anywhere sign-in window rules (dsh-desktop#1583). The Host's account sends the authorize page and
 * its loopback redirect URI; the window lets the sign-in pages load, stops the navigation to the redirect URI and
 * delivers it from the main process to the Host's one-shot listener, which checks the state and redeems the code.
 * The page itself never reaches a loopback address, so it cannot probe local services.
 */
import type { PlatformLoginDecision } from './platform-login-window.ts'

/** Sign-in partition; no `persist:` prefix, so Tokens and Agents Anywhere cookies never reach disk. */
export const ANYWHERE_LOGIN_PARTITION = 'dsh-anywhere-login'
/** The Host holds the callback response until the code is redeemed and the models are set up. */
const CALLBACK_TIMEOUT = 2 * 60_000
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']

/** The URL scheme DSH Next claims; only packaged builds register it. */
export const DSH_URL_SCHEME = 'dsh'
/**
 * The link Tokens Anywhere's console opens DSH with. It is only a trigger: it carries no code, token or state, and a
 * link with anything more is ignored, so nobody can slip their own authorization into DSH (login CSRF). The sign-in
 * it starts is DSH's own, with its own PKCE and state.
 */
export const ANYWHERE_LOGIN_LINK = `${DSH_URL_SCHEME}://v1/tokens/login`

export function isAnywhereLoginLink(value: string): boolean {
  return value === ANYWHERE_LOGIN_LINK || value === `${ANYWHERE_LOGIN_LINK}/`
}

function isLoopback(url: URL): boolean {
  return LOOPBACK.includes(url.hostname) || url.hostname.startsWith('127.')
}

/**
 * Whether a Tokens Anywhere origin is a development server on this computer, whose sign-in pages (and the Agents
 * Anywhere it signs in with) are loopback HTTP too.
 */
export function isLocalSignIn(authorizeUrl: string): boolean {
  if (!URL.canParse(authorizeUrl)) return false
  const url = new URL(authorizeUrl)
  return url.protocol === 'http:' && isLoopback(url)
}

/**
 * Decide one request made inside the Tokens sign-in window.
 * @param value - request URL.
 * @param resourceType - Electron `webRequest` resource type.
 * @param callback - the current attempt's redirect URI, or `undefined` between attempts.
 * @param local - whether the sign-in pages are served on this computer (development).
 * @returns `callback` for the navigation to the redirect URI, `allow` for the sign-in pages, else `cancel`.
 */
export function classifyAnywhereLoginRequest(value: string, resourceType: string, callback: string | undefined, local: boolean): PlatformLoginDecision {
  if (!URL.canParse(value)) return 'cancel'
  const url = new URL(value)
  if (['about:', 'data:', 'blob:'].includes(url.protocol)) return resourceType === 'mainFrame' ? 'cancel' : 'allow'
  if (url.username !== '' || url.password !== '') return 'cancel'
  if (callback !== undefined && URL.canParse(callback)) {
    const expected = new URL(callback)
    if (url.origin === expected.origin) return resourceType === 'mainFrame' && url.pathname === expected.pathname ? 'callback' : 'cancel'
  }
  if (isLoopback(url)) return local && (url.protocol === 'http:' || (url.protocol === 'ws:' && !['mainFrame', 'subFrame'].includes(resourceType))) ? 'allow' : 'cancel'
  if (url.protocol === 'https:') return 'allow'
  return url.protocol === 'wss:' && !['mainFrame', 'subFrame'].includes(resourceType) ? 'allow' : 'cancel'
}

/**
 * Hand an intercepted callback to the Host's listener.
 * @param url - the navigation the window stopped.
 * @param callback - the attempt's redirect URI; anything else is refused.
 * @param fetchImpl - HTTP client, replaceable in tests.
 * @returns the listener's status: 302 once it handled the callback, 4xx for a stale or foreign one.
 */
export async function deliverAnywhereCallback(url: string, callback: string | undefined, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (callback === undefined || !URL.canParse(url) || !URL.canParse(callback)) throw new Error('No Tokens Anywhere sign-in is waiting')
  const source = new URL(url)
  const expected = new URL(callback)
  if (source.origin !== expected.origin || source.pathname !== expected.pathname || expected.protocol !== 'http:' || !isLoopback(expected)) {
    throw new Error('Not the Tokens Anywhere sign-in callback')
  }
  source.hash = ''
  const response = await fetchImpl(source, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(CALLBACK_TIMEOUT) })
  await response.body?.cancel()
  return response.status
}
