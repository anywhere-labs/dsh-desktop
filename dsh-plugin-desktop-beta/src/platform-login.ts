/**
 * Hand DeepSeek Platform sign-in attempts from the Host to the Electron shell.
 *
 * The upstream account UI only starts an attempt and offers "the page did not
 * open automatically? copy the link"; opening the page is left to a native
 * subscriber of the Host's `deepseekAccount` service. This module is that
 * subscriber. It holds no Electron imports so the Host, the RPC bridge, and
 * the main process share one request shape and one destination rule.
 *
 * Cores without the account service (0.1.5-rc.2) never activate the watcher.
 */

/** Attempt fields read here; mirrors `SignInAttemptView` in `@deepseek-ai/dsh-deepseek-account`. */
interface PlatformLoginAttempt {
  readonly id: string
  readonly phase: string
  readonly authorizeUrl?: string | undefined
}

/** The `watch` face of the Host's `deepseekAccount` service. */
export interface PlatformLoginAccount {
  watch(signal: AbortSignal): AsyncIterable<{ readonly attempt: PlatformLoginAttempt | null }>
}

/**
 * Shell request: open an attempt's authorization page, or settle an attempt that ended.
 * `external` opens the system browser, which can reach the Host's loopback
 * callback only while ordinary browser access is on. `focus` asks for the
 * application after a failed or expired attempt, which leaves the page on a
 * Platform document instead of a completion page.
 */
export type DesktopPlatformLoginRequest =
  | { readonly action: 'open'; readonly url: string; readonly external: boolean }
  | { readonly action: 'close'; readonly focus: boolean }

const ENDED = new Set(['succeeded', 'cancelled', 'failed', 'expired'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Same destination rule as upstream Desktop's account backend: HTTPS, or loopback HTTP for development.
 * @param value - candidate authorization URL.
 * @returns whether the shell may navigate to it.
 */
export function isPlatformLoginDestination(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.username === '' && url.password === ''
      && (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
  } catch {
    return false
  }
}

/**
 * Validate a request that crossed the Host/native process boundary.
 * @param value - untrusted RPC argument.
 * @returns a request containing only the declared fields.
 */
export function parseDesktopPlatformLoginRequest(value: unknown): DesktopPlatformLoginRequest {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>
    if (candidate.action === 'open' && isPlatformLoginDestination(candidate.url) && typeof candidate.external === 'boolean') {
      return { action: 'open', url: candidate.url, external: candidate.external }
    }
    if (candidate.action === 'close' && typeof candidate.focus === 'boolean') {
      return { action: 'close', focus: candidate.focus }
    }
  }
  throw new TypeError('dsh-plugin-desktop: invalid platform sign-in request')
}

/**
 * Open each attempt's authorization page once, and settle each ended attempt once.
 * @param account - Host account service.
 * @param request - delivers one request to the Electron shell.
 * @param external - whether a page opened now should use the system browser.
 * @param signal - watcher lifetime; ending it never cancels a sign-in.
 */
export async function watchPlatformLogin(
  account: PlatformLoginAccount,
  request: (value: DesktopPlatformLoginRequest) => void,
  external: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  let opened: string | undefined
  let ended: string | undefined
  for await (const view of account.watch(signal)) {
    const attempt = view.attempt
    if (attempt === null) continue
    if (attempt.phase === 'waiting-browser' && opened !== attempt.id && isPlatformLoginDestination(attempt.authorizeUrl)) {
      opened = attempt.id
      request({ action: 'open', url: attempt.authorizeUrl, external: external() })
    }
    if (ENDED.has(attempt.phase) && ended !== attempt.id) {
      ended = attempt.id
      request({ action: 'close', focus: attempt.phase === 'failed' || attempt.phase === 'expired' })
    }
  }
}
