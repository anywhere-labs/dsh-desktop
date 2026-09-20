/** Renderer-side consumer for the pending Dock/Jump List session jump. */

import { DESKTOP_SESSION_JUMP_PATH, type DesktopSessionJumpResponse } from '../desktop-settings-contract.ts'

const SESSION_JUMP_POLL_INTERVAL_MS = 2_000
const SESSION_JUMP_START_DELAY_MS = 1_500

/**
 * Parse one untrusted session-jump response at the renderer boundary.
 * @param value - untrusted response payload.
 * @returns the session id, or undefined when nothing was queued or the payload is malformed.
 */
export function parseDesktopSessionJumpResponse(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const sessionId = (value as { sessionId?: unknown }).sessionId
  if (sessionId === undefined) return undefined
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  return sessionId
}

export interface DesktopSessionJumpReader {
  /** Open one session by id; unknown ids fail loud inside the domain. */
  open(sessionId: string): void
}

/**
 * Poll the session-jump route and open the queued session exactly once.
 *
 * Runs on the client Cordis context: `ctx.sessions` is the client
 * `ISessions` face whose `open(id)` selects a session as current. Unknown
 * ids throw inside the domain and are logged without breaking the poll.
 * @param ctx - client context carrying the sessions service.
 * @param fetcher - fetch seam for tests.
 * @returns a disposer stopping the poll loop.
 */
export interface DesktopSessionJumpScope {
  readonly setTimeout: typeof globalThis.setTimeout
  readonly clearTimeout: typeof globalThis.clearTimeout
  readonly document?: {
    readonly visibilityState?: string
    addEventListener(type: string, listener: () => void): void
    removeEventListener(type: string, listener: () => void): void
  }
}

export function startDesktopSessionJumpPoll(
  ctx: { sessions: DesktopSessionJumpReader },
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  scope: DesktopSessionJumpScope = globalThis as unknown as DesktopSessionJumpScope,
): () => void {
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const poll = async (): Promise<void> => {
    try {
      const response = await fetcher(DESKTOP_SESSION_JUMP_PATH, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      if (response.ok) {
        const sessionId = parseDesktopSessionJumpResponse(await response.json())
        if (sessionId !== undefined) {
          try {
            ctx.sessions.open(sessionId)
          } catch (cause) {
            console.error('dsh-plugin-desktop: failed to open jumped session', cause)
          }
        }
      }
    } catch (cause) {
      console.error('dsh-plugin-desktop: failed to poll the session jump route', cause)
    } finally {
      if (active) timer = scope.setTimeout(() => { void poll() }, SESSION_JUMP_POLL_INTERVAL_MS)
    }
  }
  timer = scope.setTimeout(() => { void poll() }, SESSION_JUMP_START_DELAY_MS)
  const onVisible = (): void => {
    if (scope.document?.visibilityState === 'visible') void poll()
  }
  scope.document?.addEventListener('visibilitychange', onVisible)
  return () => {
    active = false
    if (timer !== undefined) scope.clearTimeout(timer)
    scope.document?.removeEventListener('visibilitychange', onVisible)
  }
}

export type { DesktopSessionJumpResponse }
