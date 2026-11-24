/**
 * Session tabs: the open-session strip in the conversation header, its remembered set, and the state each tab shows.
 *
 * A tab is a Session this window has open, not a Session the Host lists: opening one adds it, closing it leaves the
 * Session alone. The set lives in sessionStorage so a reload comes back to the same tabs, and the visible Session
 * always has a tab even when something else opened it (the sidebar, a link, a resumed task).
 */

/** One Session a tab was closed from, kept so it can be reopened. */
export interface ClosedTab {
  readonly id: string
  readonly title: string
  readonly index: number
}

/** The remembered strip: its tabs in order, the one last activated, and the recently closed. */
export interface TabState {
  readonly tabs: readonly string[]
  readonly active?: string
  readonly seen: Readonly<Record<string, number>>
  readonly closed: readonly ClosedTab[]
}

/** No tabs yet: the first Session the window opens starts the strip. */
export const EMPTY_TABS: TabState = { tabs: [], seen: {}, closed: [] }

/** Tabs remembered at most, the ones past this dropped oldest first. */
export const MAX_TABS = 60
/** Closed tabs remembered at most. */
export const MAX_CLOSED = 20
/** Warm tabs kept besides the visible one: reopening one shows its history at once. */
export const MAX_WARM = 8

/** What a tab's dot says about its Session. */
export type TabSignal = 'awaiting' | 'running' | 'unread' | 'idle' | 'cold'

/** The facts a tab's dot is derived from. */
export interface TabFacts {
  /** Whether the Host reports the Session running. */
  readonly running: boolean | undefined
  /** Whether the Session waits for the user's approval or answer. */
  readonly awaiting: boolean
  /** Whether a completion arrived that the user has not looked at. */
  readonly unread: boolean
  /** Whether this window holds the Session in memory. */
  readonly warm: boolean
}

/**
 * The dot one tab shows: a request waiting for the user outranks work in progress, which outranks a finished run
 * nobody has looked at, and only a Session this window holds can be reported idle rather than cold.
 * @param facts - what the Host and this window know about the Session.
 * @returns the state to show.
 */
export function tabSignal(facts: TabFacts): TabSignal {
  if (facts.awaiting) return 'awaiting'
  if (facts.running === true) return 'running'
  if (facts.unread) return 'unread'
  return facts.warm ? 'idle' : 'cold'
}

/**
 * The Session the strip shows as current: the one the main view holds.
 * @param retained - per-Session counts of what holds it, as the list reports them.
 * @returns that Session's id, or undefined before any Session is open.
 */
export function currentSession(retained: Readonly<Record<string, number>>): string | undefined {
  for (const [id, count] of Object.entries(retained)) if (count > 0) return id
  return undefined
}

/**
 * The strip after a Session becomes current: an open tab is activated, a new one is appended.
 * @param state - the remembered strip.
 * @param id - the Session that is now visible.
 * @returns the next strip; the same object when the tab is already current.
 */
export function withCurrent(state: TabState, id: string | undefined): TabState {
  if (id === undefined) return state
  const present = state.tabs.includes(id)
  const at = Date.now()
  if (present && state.active === id) {
    const seen = state.seen[id] === at ? state.seen : { ...state.seen, [id]: at }
    return seen === state.seen ? state : { ...state, seen }
  }
  const tabs = present ? state.tabs : [...state.tabs, id].slice(-MAX_TABS)
  return { ...state, tabs, active: id, seen: { ...state.seen, [id]: at } }
}

/**
 * The strip without these tabs, remembering them for reopening.
 * @param state - the remembered strip.
 * @param ids - the tabs to close; ids that are not open are ignored.
 * @param titles - the title to remember for each Session, as the list reports it.
 * @returns the next strip and the Session to activate, chosen among the tabs still open.
 */
export function withoutTabs(state: TabState, ids: readonly string[], titles: Readonly<Record<string, string>>): {
  state: TabState
  next?: string
} {
  const closing = new Set(ids.filter(id => state.tabs.includes(id)))
  if (closing.size === 0) return { state }
  const at = Date.now()
  const remembered = [...closing].map(id => ({ id, title: titles[id] ?? '', index: state.tabs.indexOf(id), closedAt: at }))
  const tabs = state.tabs.filter(id => !closing.has(id))
  const seen = { ...state.seen }
  for (const id of closing) delete seen[id]
  const closed = [...remembered.reverse(), ...state.closed.filter(entry => !closing.has(entry.id))]
    .slice(0, MAX_CLOSED)
    .map(({ id, title, index }) => ({ id, title, index }))
  // The tab closed last was the one most recently looked at, so its neighbour is the one to fall back to.
  const next = state.active !== undefined && closing.has(state.active)
    ? mostRecent(tabs, state.seen)
    : state.active
  return {
    state: { tabs, seen, closed, ...next === undefined ? {} : { active: next } },
    ...next === undefined ? {} : { next },
  }
}

/**
 * The Session most recently activated among these.
 * @param tabs - candidate Sessions in strip order.
 * @param seen - when each was last activated.
 * @returns the latest one, or undefined for no candidates.
 */
export function mostRecent(tabs: readonly string[], seen: Readonly<Record<string, number>>): string | undefined {
  let best: string | undefined
  let at = -1
  for (const id of tabs) {
    const when = seen[id] ?? 0
    if (when >= at) { at = when; best = id }
  }
  return best
}

/**
 * The Session a reopened tab would show, taken from the recently closed.
 * @param state - the remembered strip.
 * @param open - the Sessions that still exist, by id.
 * @returns the Session to reopen, or undefined when every closed one is gone.
 */
export function reopenTarget(state: TabState, open: ReadonlySet<string>): string | undefined {
  return state.closed.find(entry => open.has(entry.id))?.id
}

/**
 * The tabs worth holding in memory: the visible one, every tab whose Session is busy, and the most recent of the
 * rest up to `max`.
 * @param state - the remembered strip.
 * @param busy - the Sessions reported running or waiting for the user.
 * @param max - how many idle tabs to keep besides the busiest ones.
 * @returns the Session ids to retain, in strip order.
 */
export function warmTabs(state: TabState, busy: ReadonlySet<string>, max: number = MAX_WARM): readonly string[] {
  const keep = new Set<string>()
  if (state.active !== undefined) keep.add(state.active)
  for (const id of state.tabs) if (busy.has(id)) keep.add(id)
  const rest = state.tabs
    .filter(id => !keep.has(id))
    .sort((a, b) => (state.seen[b] ?? 0) - (state.seen[a] ?? 0))
    .slice(0, Math.max(0, max))
  for (const id of rest) keep.add(id)
  return state.tabs.filter(id => keep.has(id))
}

/**
 * The strip with the tabs this Session list no longer has dropped.
 * @param state - the remembered strip.
 * @param known - the Sessions the list currently reports.
 * @returns the next strip; the same object when every tab is still listed.
 */
export function withoutMissing(state: TabState, known: ReadonlySet<string>): TabState {
  const tabs = state.tabs.filter(id => known.has(id))
  if (tabs.length === state.tabs.length) return state
  const seen = Object.fromEntries(Object.entries(state.seen).filter(([id]) => known.has(id)))
  const active = state.active !== undefined && known.has(state.active) ? state.active : mostRecent(tabs, seen)
  return { tabs, seen, closed: state.closed, ...active === undefined ? {} : { active } }
}

/** The title a tab shows: the Session's own, or a placeholder before the Host projects one. */
export function tabTitle(title: string | undefined, fallback: string): string {
  const text = (title ?? '').trim()
  return text === '' ? fallback : text
}

/**
 * Read a remembered strip, dropping anything malformed.
 * @param raw - the stored JSON, or null when nothing was stored.
 * @returns the strip, or the empty one when the value cannot be read.
 */
export function parseTabState(raw: string | null): TabState {
  if (raw === null) return EMPTY_TABS
  let value: unknown
  try { value = JSON.parse(raw) } catch { return EMPTY_TABS }
  if (typeof value !== 'object' || value === null) return EMPTY_TABS
  const record = value as Record<string, unknown>
  const ids = (input: unknown): string[] => Array.isArray(input)
    ? [...new Set(input.filter((item): item is string => typeof item === 'string' && item !== ''))].slice(0, MAX_TABS)
    : []
  const tabs = ids(record.tabs)
  const seen: Record<string, number> = {}
  if (typeof record.seen === 'object' && record.seen !== null) {
    for (const [id, when] of Object.entries(record.seen as Record<string, unknown>)) {
      if (tabs.includes(id) && typeof when === 'number' && Number.isFinite(when)) seen[id] = when
    }
  }
  const closed: ClosedTab[] = []
  if (Array.isArray(record.closed)) {
    for (const entry of record.closed.slice(0, MAX_CLOSED)) {
      if (typeof entry !== 'object' || entry === null) continue
      const item = entry as Record<string, unknown>
      if (typeof item.id !== 'string' || item.id === '') continue
      closed.push({ id: item.id, title: typeof item.title === 'string' ? item.title : '', index: typeof item.index === 'number' ? item.index : 0 })
    }
  }
  const active = typeof record.active === 'string' && tabs.includes(record.active) ? record.active : undefined
  return { tabs, seen, closed, ...active === undefined ? {} : { active } }
}

/**
 * The strip as stored; a version tag keeps an older shape from being read as this one.
 * @param state - the strip to store.
 * @returns the JSON to write.
 */
export function serializeTabState(state: TabState): string {
  return JSON.stringify({ version: 1, tabs: state.tabs, active: state.active, seen: state.seen, closed: state.closed })
}
