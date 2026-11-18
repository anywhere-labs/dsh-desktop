/**
 * Hold back a Session whose transcript keeps taking down the main-window renderer (#1690).
 *
 * The official client keeps its main-view selection in localStorage and reopens it in every new
 * document, so automatic recovery reloads straight back into a transcript that just crashed the
 * renderer. Each main-window document asks here from its preload, before any page script runs,
 * whether that selection may open again. Once the same Session was on screen at two renderer
 * failures within ten minutes, it is held back for the rest of this run: the preload removes the
 * selection, and the official client opens a blank conversation in the most recent workspace
 * instead. The Session itself is untouched and can still be opened by hand; a held Session that
 * fails again simply lands elsewhere again.
 *
 * No Electron or Node imports: the sandboxed preload bundles this module too.
 */

/** Where the official ui-workspace keeps the main-view selection: whole-value JSON from `createSnapshotStore`. */
export const OFFICIAL_SELECTION_KEY = 'dsh.sessions.current'
/** Two renderer failures this close together with the same Session open hold it back. */
export const HOLD_WINDOW_MS = 10 * 60_000
/** Session ids are short; a longer value is not one. */
const MAX_SESSION_ID = 200
/** Renderer exits the page did not cause: it never started, or it ended normally. */
const NOT_PAGE_FAILURES: ReadonlySet<string> = new Set(['clean-exit', 'launch-failed', 'integrity-failure'])

/** The Session that was on screen when the main-window renderer failed. */
export interface RendererFailureSession {
  readonly sessionId: string
  /** Renderer failures with this Session on screen during this run. */
  readonly failures: number
  /** Whether the Session is held back, so this document starts without it. */
  readonly held: boolean
  /** Electron's `render-process-gone` reason for the latest failure. */
  readonly reason: string
  readonly exitCode: number
}

/** What a document that started without the held-back Session tells the interface. */
export type RendererLanding = Omit<RendererFailureSession, 'held'>

/**
 * @param value - an untrusted IPC argument.
 * @returns whether it can be a Session id.
 */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SESSION_ID
}

/**
 * Read the Session the official client will restore.
 * @param stored - the raw value under {@link OFFICIAL_SELECTION_KEY}.
 * @returns its Session id, or undefined when nothing is selected or the value is unreadable.
 */
export function selectedSessionId(stored: string | null | undefined): string | undefined {
  if (!stored) return undefined
  try {
    const value: unknown = JSON.parse(stored)
    if (typeof value !== 'object' || value === null) return undefined
    const sessionId = (value as { readonly sessionId?: unknown }).sessionId
    return isSessionId(sessionId) ? sessionId : undefined
  } catch {
    return undefined
  }
}

/**
 * @param value - the main process's answer, or what a bridge returned.
 * @returns the landing, or undefined for anything else.
 */
export function rendererLandingOf(value: unknown): RendererLanding | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { sessionId, failures, reason, exitCode } = value as Record<string, unknown>
  if (!isSessionId(sessionId) || !Number.isSafeInteger(failures) || (failures as number) < 1
    || typeof reason !== 'string' || !Number.isSafeInteger(exitCode)) return undefined
  return { sessionId, failures: failures as number, reason: reason.slice(0, 40), exitCode: exitCode as number }
}

/**
 * Run in the preload of every main-window document, before the page's scripts read the selection.
 * @param ask - the main process's synchronous answer for the Session about to be restored.
 * @param storage - the page's localStorage; it may be missing or refuse access.
 * @returns the landing when the selection was removed, otherwise undefined.
 */
export function landRendererDocument(
  ask: (sessionId: string | null) => unknown,
  storage: () => Pick<Storage, 'getItem' | 'removeItem'> | undefined,
): RendererLanding | undefined {
  let store: Pick<Storage, 'getItem' | 'removeItem'> | undefined
  let sessionId: string | undefined
  try {
    store = storage()
    sessionId = selectedSessionId(store?.getItem(OFFICIAL_SELECTION_KEY))
  } catch { /* Unavailable storage restores nothing either. */ }
  let answer: unknown
  // Asked even without a selection: the answer also settles which Session the last failure belongs to.
  try { answer = ask(sessionId ?? null) } catch { return undefined }
  const landing = rendererLandingOf(answer)
  if (landing === undefined || store === undefined || landing.sessionId !== sessionId) return undefined
  try {
    store.removeItem(OFFICIAL_SELECTION_KEY)
  } catch {
    return undefined
  }
  return landing
}

/** Main-process memory of which Session was on screen at each renderer failure during this run. */
export class RendererSessionGuard {
  /** The latest failure, until the next document names the Session it showed. */
  private pending: { readonly reason: string; readonly exitCode: number; readonly at: number } | undefined
  private readonly sessions = new Map<string, { failures: number; recent: number[] }>()
  private readonly held = new Set<string>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * The main-window renderer is gone. The selection the next document starts with is the Session
   * that was on screen, because the official client stores it as soon as it changes.
   * @param reason - Electron's `render-process-gone` reason.
   * @param exitCode - the process exit code.
   */
  failed(reason: string, exitCode: number): void {
    if (NOT_PAGE_FAILURES.has(reason)) return
    this.pending = { reason, exitCode, at: this.now() }
  }

  /**
   * A main-window document starts; only the first one after a failure is told about it.
   * @param sessionId - the Session the official client is about to restore, if any.
   * @returns the Session the last failure showed, or undefined when no failure is pending or none was on screen.
   */
  landing(sessionId: string | undefined): RendererFailureSession | undefined {
    const failure = this.pending
    this.pending = undefined
    if (failure === undefined || sessionId === undefined) return undefined
    const session = this.sessions.get(sessionId) ?? { failures: 0, recent: [] }
    session.failures += 1
    session.recent = [...session.recent, failure.at].filter(at => failure.at - at < HOLD_WINDOW_MS)
    this.sessions.set(sessionId, session)
    if (session.recent.length >= 2) this.held.add(sessionId)
    return { sessionId, failures: session.failures, held: this.held.has(sessionId), reason: failure.reason, exitCode: failure.exitCode }
  }
}
