/** Desktop-owned session-progress surface shared by Dock, Jump List, and tray jump. */

/** Stable Cordis plugin name. */
export const name = 'desktop-session-progress'

/** Maximum Dock/Jump List session entries shown flat before the overflow submenu. */
export const DESKTOP_SESSION_PROGRESS_VISIBLE_LIMIT = 3

/** Maximum title characters per Dock/Jump List session entry (ChatGPT/Codex parity). */
export const DESKTOP_SESSION_PROGRESS_TITLE_LIMIT = 35

/** Native session-progress IPC channel carrying Host-owned unread/ready snapshots. */
export const DESKTOP_SESSION_PROGRESS_CHANNEL = 'dsh-desktop:session-progress'

/** Single-session progress entry carried from the Host to the native shell. */
export interface DesktopSessionProgressEntry {
  /** Session identity used for badge aggregation and renderer jump routing. */
  readonly sessionId: string
  /** Human-facing title; falls back to a truncated session id when absent. */
  readonly title: string
  /** Whether the outcome was a failure (affects only copy, never routing). */
  readonly failed: boolean
  /** Unix epoch milliseconds when the turn finished. */
  readonly completedAt: number
}

/** Host-owned session-progress snapshot published to the native shell. */
export interface DesktopSessionProgressSnapshot {
  /** Finished-while-unfocused sessions not yet re-opened, newest first. */
  readonly unread: readonly DesktopSessionProgressEntry[]
  /** Recently active sessions for the secondary menu section, newest first. */
  readonly recent: readonly DesktopSessionProgressEntry[]
}

/** Empty session-progress snapshot used before the Host publishes state. */
export const EMPTY_DESKTOP_SESSION_PROGRESS_SNAPSHOT: DesktopSessionProgressSnapshot = Object.freeze({
  unread: Object.freeze([]),
  recent: Object.freeze([]),
})

/**
 * Truncate one Dock/Jump List session title to the shared display limit.
 * @param title - untrusted display title or session id fallback.
 * @returns the title unchanged when short, else trimmed with an ellipsis.
 */
export function truncateDesktopSessionProgressTitle(title: string): string {
  const characters = Array.from(title)
  if (characters.length <= DESKTOP_SESSION_PROGRESS_TITLE_LIMIT) return title
  return `${characters.slice(0, DESKTOP_SESSION_PROGRESS_TITLE_LIMIT - 1).join('').trimEnd()}…`
}

/**
 * Render the fallback Dock/Jump List label for a session without a known title.
 * @param sessionId - session identity used as the label seed.
 * @returns a truncated session id safe for native menu display.
 */
export function desktopSessionProgressFallbackTitle(sessionId: string): string {
  return truncateDesktopSessionProgressTitle(`Session ${sessionId}`)
}

/**
 * Parse one untrusted session-progress entry at a native boundary.
 * @param value - untrusted entry payload.
 * @returns the entry, or undefined when the payload is not a well-formed entry.
 */
export function parseDesktopSessionProgressEntry(value: unknown): DesktopSessionProgressEntry | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const entry = value as Record<string, unknown>
  if (typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) return undefined
  if (typeof entry.title !== 'string' || entry.title.length === 0) return undefined
  if (typeof entry.failed !== 'boolean') return undefined
  if (typeof entry.completedAt !== 'number' || !Number.isFinite(entry.completedAt)) return undefined
  return {
    sessionId: entry.sessionId,
    title: entry.title,
    failed: entry.failed,
    completedAt: entry.completedAt,
  }
}

/**
 * Parse one untrusted session-progress snapshot at a native boundary.
 * @param value - untrusted snapshot payload.
 * @returns the snapshot, or undefined when the payload is not a well-formed snapshot.
 */
export function parseDesktopSessionProgressSnapshot(value: unknown): DesktopSessionProgressSnapshot | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const snapshot = value as Record<string, unknown>
  if (!Array.isArray(snapshot.unread) || !Array.isArray(snapshot.recent)) return undefined
  const unread: DesktopSessionProgressEntry[] = []
  const recent: DesktopSessionProgressEntry[] = []
  for (const entry of snapshot.unread) {
    const parsed = parseDesktopSessionProgressEntry(entry)
    if (parsed === undefined) return undefined
    unread.push(parsed)
  }
  for (const entry of snapshot.recent) {
    const parsed = parseDesktopSessionProgressEntry(entry)
    if (parsed === undefined) return undefined
    recent.push(parsed)
  }
  return { unread, recent }
}
