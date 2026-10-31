/**
 * Hand DeepSeek Platform sign-in attempts to the Electron shell.
 *
 * The official Web UI only starts an attempt and shows "page did not open
 * automatically? copy link"; opening the page is left to a native account
 * subscriber (upstream apps/desktop main.ts watches `account/watch` for this).
 * Next's Host runs in the same process as the account service, so it watches
 * the service directly and asks the shell to open the page.
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
 * Shell request: open an attempt's authorization page, or settle it once it ended.
 * `focus` asks for the application after a failed or expired attempt, which
 * leaves the page on a Platform document instead of a completion page.
 */
export type PlatformLoginRequest = { readonly action: 'open'; readonly url: string } | { readonly action: 'close'; readonly focus: boolean }

const ENDED = ['succeeded', 'cancelled', 'failed', 'expired']

/**
 * Open each attempt's authorization page once, and settle each ended attempt once.
 * @param account - Host account service.
 * @param request - delivers one request to the Electron shell.
 * @param signal - watcher lifetime; ending it never cancels a login.
 */
export async function watchPlatformLogin(
  account: PlatformLoginAccount,
  request: (value: PlatformLoginRequest) => void,
  signal: AbortSignal,
): Promise<void> {
  let opened: string | undefined
  let ended: string | undefined
  for await (const view of account.watch(signal)) {
    const attempt = view.attempt
    if (attempt === null) continue
    if (attempt.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && opened !== attempt.id) {
      opened = attempt.id
      request({ action: 'open', url: attempt.authorizeUrl })
    }
    if (ENDED.includes(attempt.phase) && ended !== attempt.id) {
      ended = attempt.id
      request({ action: 'close', focus: attempt.phase === 'failed' || attempt.phase === 'expired' })
    }
  }
}
