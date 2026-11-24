/**
 * What several pages of the same app share about the session strip, through localStorage.
 *
 * - Presence: each page beats a heartbeat, so a new page can tell whether it is the first one after a restart (and
 *   should restore the last strip) or a sibling of pages still open (and should start clean).
 * - Read facts: when a page shows a Session, every page stops marking it as finished and unread.
 * - Pending facts: a page that sees a Session waiting for the user says so, so pages that have not loaded that
 *   Session still show it as waiting.
 *
 * Storage and time are passed in, so the rules are testable without a browser.
 */

/** The storage a page reads and writes. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Storage keys: the page half lives in sessionStorage, the rest in localStorage. */
export const SESSION_TABS_KEYS = {
  page: 'desktop-next.session-tabs.page.v1',
  prefs: 'desktop-next.session-tabs.prefs.v1',
  snapshot: 'desktop-next.session-tabs.snapshot.v1',
  alive: 'desktop-next.session-tabs.alive.v1',
  read: 'desktop-next.session-tabs.read.v1',
  pending: 'desktop-next.session-tabs.pending.v1',
} as const

/** How often a page beats, and how long a silent beat still counts as alive. */
export const BEAT_MS = 10_000
export const ALIVE_TTL_MS = 90_000
/**
 * How long a page whose heartbeat went quiet still counts as open. A browser freezes or discards background tabs,
 * which then stop beating while still open; an Electron window is never frozen, so a quiet beat there means it died.
 * @param electron - whether this page runs in the desktop window.
 * @returns the time in ms.
 */
export const openKeepMs = (electron: boolean): number => electron ? ALIVE_TTL_MS : 3 * 24 * 3600 * 1000

/** Read facts expire after a week and keep at most this many Sessions. */
export const READ_TTL_MS = 7 * 24 * 3600 * 1000
export const MAX_READ = 200
/** Pages see the same run end a few ms apart. */
export const READ_SKEW_MS = 2000

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function readJson(store: KeyValueStore | undefined, key: string): unknown {
  if (store === undefined) return undefined
  try {
    const raw = store.getItem(key)
    return raw === null ? undefined : JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function writeJson(store: KeyValueStore | undefined, key: string, value: unknown): void {
  if (store === undefined) return
  try { store.setItem(key, JSON.stringify(value)) } catch { /* quota or private mode: memory only */ }
}

/** Heartbeat times by page, newer than `within`. */
function beats(store: KeyValueStore | undefined, now: number, within: number): Record<string, number> {
  const map = readJson(store, SESSION_TABS_KEYS.alive)
  const out: Record<string, number> = {}
  if (!isRecord(map)) return out
  for (const [page, at] of Object.entries(map)) if (typeof at === 'number' && now - at < within) out[page] = at
  return out
}

/**
 * Record this page's heartbeat, or its goodbye.
 * @param store - localStorage.
 * @param page - this document's id.
 * @param now - the current time.
 * @param options - `remove` for a goodbye, `predecessor` for the same tab's previous document to drop, and how long
 * quiet pages are kept.
 */
export function beat(store: KeyValueStore | undefined, page: string, now: number, options: {
  readonly remove?: boolean
  readonly predecessor?: string | undefined
  readonly keepMs: number
}): void {
  const next = beats(store, now, options.keepMs)
  if (options.predecessor !== undefined) delete next[options.predecessor]
  if (options.remove === true) delete next[page]
  else next[page] = now
  writeJson(store, SESSION_TABS_KEYS.alive, next)
}

/**
 * Other pages that have not said goodbye: live ones, and quiet ones still within `keepMs`.
 * @returns their ids.
 */
export function otherOpenPages(store: KeyValueStore | undefined, page: string, now: number, keepMs: number): ReadonlySet<string> {
  return new Set(Object.keys(beats(store, now, keepMs)).filter(id => id !== page))
}

/**
 * Pages beating within the live window, this one included.
 * @returns their ids.
 */
export function alivePages(store: KeyValueStore | undefined, page: string, now: number): ReadonlySet<string> {
  return new Set([page, ...Object.keys(beats(store, now, ALIVE_TTL_MS))])
}

/** Where a new page's strip comes from. */
export type InitialSource = 'session' | 'fresh' | 'snapshot'

/**
 * Decide where a page's first strip comes from.
 * - The page's own sessionStorage, written by this same tab before a reload, crash or discard: keep it. A copy the
 *   browser handed to a new tab (opened from a link, duplicated) while its owner is still open does not count.
 * - No other page open at all: the first page after a restart restores the last snapshot.
 * - Another page is open: start clean, so the two never mirror each other.
 * @param input - what storage holds and what this document knows about itself.
 * @returns the source to read.
 */
export function initialSource(input: {
  readonly hasOwn: boolean
  readonly owner: string | undefined
  readonly openPages: ReadonlySet<string>
  readonly reloadedInPlace: boolean
}): InitialSource {
  if (input.hasOwn && (input.owner === undefined || !input.openPages.has(input.owner) || input.reloadedInPlace)) return 'session'
  if (input.hasOwn || input.openPages.size > 0) return 'fresh'
  return 'snapshot'
}

// ---------------------------------------------------------------- read facts

/**
 * When each Session was last shown in a visible page, dropping expired entries.
 * @returns times by Session id.
 */
export function readReadMap(store: KeyValueStore | undefined, now: number): Record<string, number> {
  const map = readJson(store, SESSION_TABS_KEYS.read)
  const out: Record<string, number> = {}
  if (!isRecord(map)) return out
  for (const [id, at] of Object.entries(map)) if (typeof at === 'number' && now - at < READ_TTL_MS) out[id] = at
  return out
}

/**
 * Record that a visible page showed a Session, keeping the newest {@link MAX_READ} entries.
 * @param store - localStorage.
 * @param id - the Session.
 * @param at - when it was shown.
 */
export function markRead(store: KeyValueStore | undefined, id: string, at: number): void {
  if (store === undefined || id === '') return
  const map = readReadMap(store, at)
  if ((map[id] ?? 0) >= at) return
  map[id] = at
  const ids = Object.keys(map)
  if (ids.length > MAX_READ) {
    for (const stale of ids.sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0)).slice(0, ids.length - MAX_READ)) delete map[stale]
  }
  writeJson(store, SESSION_TABS_KEYS.read, map)
}

/**
 * Whether some page has shown a Session since this page started showing it as unread.
 * @param read - read times by Session.
 * @param id - the Session.
 * @param since - when this page first showed it unread.
 */
export const readElsewhere = (read: Readonly<Record<string, number>>, id: string, since: number): boolean => {
  const at = read[id]
  // A Session nobody recorded has not been read anywhere, whatever the comparison would say about a zero baseline.
  return at !== undefined && at >= since - READ_SKEW_MS
}

// ---------------------------------------------------------------- pending facts

/** A page that sees a Session waiting for the user. */
export interface PendingFact {
  readonly page: string
  readonly at: number
}

/**
 * Pending facts by Session, as stored.
 * @returns the facts, malformed entries dropped.
 */
export function readPendingMap(store: KeyValueStore | undefined): Record<string, PendingFact> {
  const map = readJson(store, SESSION_TABS_KEYS.pending)
  const out: Record<string, PendingFact> = {}
  if (!isRecord(map)) return out
  for (const [id, entry] of Object.entries(map)) {
    if (isRecord(entry) && typeof entry.page === 'string' && typeof entry.at === 'number') out[id] = { page: entry.page, at: entry.at }
  }
  return out
}

/**
 * Publish the Sessions this page sees waiting for the user, replacing what it published before. Entries of pages no
 * longer alive are dropped on the way.
 * @param store - localStorage.
 * @param page - this document's id.
 * @param ids - the Sessions this page sees waiting.
 * @param alive - pages currently alive.
 * @param now - the current time.
 */
export function publishPending(store: KeyValueStore | undefined, page: string, ids: readonly string[], alive: ReadonlySet<string>, now: number): void {
  if (store === undefined) return
  const previous = readPendingMap(store)
  const next: Record<string, PendingFact> = {}
  for (const [id, fact] of Object.entries(previous)) if (fact.page !== page && alive.has(fact.page)) next[id] = fact
  for (const id of ids) {
    const own = previous[id]
    next[id] = own !== undefined && own.page === page ? own : { page, at: now }
  }
  if (JSON.stringify(previous) !== JSON.stringify(next)) writeJson(store, SESSION_TABS_KEYS.pending, next)
}

/**
 * The Sessions other live pages report waiting for the user.
 * @returns their ids.
 */
export function remotePending(pending: Readonly<Record<string, PendingFact>>, page: string, alive: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(Object.entries(pending).filter(([, fact]) => fact.page !== page && alive.has(fact.page)).map(([id]) => id))
}
