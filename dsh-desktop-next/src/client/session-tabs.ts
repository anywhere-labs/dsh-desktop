/**
 * Session tabs: the model behind the open-Session strip.
 *
 * A tab is a Session this window has open, not a Session the Host lists: opening one adds it, closing it leaves the
 * Session alone. The strip has two halves with different owners:
 * - the page half (tabs, pinned group, last activation times, the active tab) belongs to one browser tab or window
 *   and is kept in that page's sessionStorage, so two windows never overwrite each other's strip;
 * - the shared half (placement, heights, overflow mode, recently closed) is a preference of the person and is kept in
 *   localStorage, so changing it in one window changes it in every window.
 *
 * Every function here is pure: given a state it returns the next one, or the same object when nothing changes.
 */

/** One tab closed from the strip, kept so it can be reopened where it was. */
export interface ClosedTab {
  readonly id: string
  readonly title: string
  readonly index: number
  readonly at: number
  readonly pinned: boolean
}

/** Where the strip renders: in the Windows caption row, or below the conversation header. */
export type Placement = 'titlebar' | 'below'
/** Desktop window or ordinary browser page; each keeps its own placement. */
export type TabRuntime = 'desktop' | 'web'
/** What the strip does when its tabs do not fit. */
export type Overflow = 'scroll' | 'shrink'

/** The strip: page-owned tabs plus shared preferences. */
export interface TabState {
  readonly tabs: readonly string[]
  /** The leading group of `tabs`, in tab order. */
  readonly pinned: readonly string[]
  readonly seen: Readonly<Record<string, number>>
  readonly active?: string | undefined
  readonly placement: Readonly<Partial<Record<TabRuntime, Placement>>>
  readonly titlebarHeight?: number | undefined
  readonly barHeight?: number | undefined
  readonly overflow: Overflow
  readonly closed: readonly ClosedTab[]
}

/** No tabs yet: the first Session the window opens starts the strip. */
export const EMPTY_TABS: TabState = { tabs: [], pinned: [], seen: {}, placement: {}, overflow: 'scroll', closed: [] }

/** Tabs remembered at most; past it the stalest unpinned tab goes. */
export const MAX_TABS = 60
/** Closed tabs remembered at most. */
export const MAX_CLOSED = 20
/** Idle tabs kept in memory besides the visible, pinned and busy ones. */
export const MAX_WARM = 8

/** Caption row height bounds, default and menu presets, in px. */
export const TITLEBAR_HEIGHT = { min: 30, max: 48, default: 36, native: 40, presets: [32, 36, 40, 44] } as const
/** Header strip height bounds, default and menu presets, in px. */
export const BAR_HEIGHT = { min: 28, max: 52, default: 38, presets: [32, 38, 44, 50] } as const

/** A caption height inside its bounds. */
export const clampTitlebar = (value: number): number => Math.max(TITLEBAR_HEIGHT.min, Math.min(TITLEBAR_HEIGHT.max, Math.round(value)))
/** A header strip height inside its bounds. */
export const clampBar = (value: number): number => Math.max(BAR_HEIGHT.min, Math.min(BAR_HEIGHT.max, Math.round(value)))

// ---------------------------------------------------------------- status

/** What a tab's dot says about its Session. */
export type TabSignal = 'awaiting' | 'running' | 'unread' | 'connecting' | 'idle' | 'cold'

/** The facts a tab's dot is derived from. */
export interface TabFacts {
  /** The Host's running state; undefined until a baseline arrives. */
  readonly running: boolean | undefined
  /** Whether the Session waits for the user's approval or answer. */
  readonly awaiting: boolean
  /** Whether a completion arrived that nobody has looked at. */
  readonly unread: boolean
  /** Whether this tab is the visible Session. */
  readonly current: boolean
  /** This window's hold on the Session: opening, held, or none. */
  readonly warm: 'pending' | 'ready' | undefined
}

/**
 * The dot one tab shows. A request waiting for the user outranks work in progress, which outranks a finished run
 * nobody has looked at; a Session still opening shows as connecting, and one this window does not hold as cold.
 * @param facts - what the Host and this window know about the Session.
 * @returns the state to show.
 */
export function tabSignal(facts: TabFacts): TabSignal {
  if (facts.awaiting) return 'awaiting'
  if (facts.running === true) return 'running'
  if (facts.unread) return 'unread'
  if ((facts.current || facts.warm === 'pending') && facts.running === undefined && facts.warm !== 'ready') return 'connecting'
  if (!facts.current && facts.warm === undefined) return 'cold'
  return 'idle'
}

const URGENCY: Readonly<Record<TabSignal, number>> = { awaiting: 4, running: 3, unread: 2, connecting: 1, idle: 0, cold: 0 }

/**
 * The state the whole strip reports, for the browser tab icon.
 * @param signals - every tab's dot.
 * @returns the most urgent one, or undefined when all are idle.
 */
export function mostUrgent(signals: Iterable<TabSignal>): TabSignal | undefined {
  let best: TabSignal | undefined
  for (const signal of signals) if (URGENCY[signal] > 0 && (best === undefined || URGENCY[signal] > URGENCY[best])) best = signal
  return best
}

// ---------------------------------------------------------------- following the window

/**
 * The Session the strip shows as current: the first one, in list order, that the main view holds.
 * @param order - Session ids in list order.
 * @param held - how many main views hold each Session.
 * @returns that Session's id, or undefined before any Session is open.
 */
export function currentSession(order: readonly string[], held: Readonly<Record<string, number>>): string | undefined {
  for (const id of order) if ((held[id] ?? 0) > 0) return id
  return undefined
}

/** Pinned tabs first, both groups keeping their order. */
function normalized(state: TabState, tabs: readonly string[], pinned: ReadonlySet<string>): TabState {
  const ordered = [...tabs.filter(id => pinned.has(id)), ...tabs.filter(id => !pinned.has(id))]
  return { ...state, tabs: ordered, pinned: ordered.filter(id => pinned.has(id)) }
}

/**
 * The strip after a Session becomes visible. An open tab is activated; a new one goes right after the tab that was
 * active (never inside the pinned group), and past the cap the stalest unpinned tab is dropped.
 * @param state - the strip.
 * @param id - the Session now visible.
 * @param now - the activation time.
 * @returns the next strip; the same object when nothing changed.
 */
export function withCurrent(state: TabState, id: string | undefined, now: number): TabState {
  if (id === undefined) return state
  if (state.tabs.includes(id)) {
    if (state.active === id) return state
    return { ...state, active: id, seen: { ...state.seen, [id]: now } }
  }
  const tabs = [...state.tabs]
  const after = state.active === undefined ? -1 : tabs.indexOf(state.active)
  tabs.splice(Math.max(state.pinned.length, after + 1), 0, id)
  const seen: Record<string, number> = { ...state.seen, [id]: now }
  while (tabs.length > MAX_TABS) {
    let victim: string | undefined
    let oldest = Infinity
    for (const candidate of tabs) {
      if (candidate === id || state.pinned.includes(candidate)) continue
      const at = seen[candidate] ?? 0
      if (at < oldest) { oldest = at; victim = candidate }
    }
    if (victim === undefined) break
    tabs.splice(tabs.indexOf(victim), 1)
    delete seen[victim]
  }
  return { ...state, tabs, seen, active: id, closed: state.closed.filter(entry => entry.id !== id) }
}

/**
 * The strip without tabs whose Session the list no longer reports.
 * @param state - the strip.
 * @param known - the Sessions the list reports.
 * @returns the next strip; the same object when every tab is still listed.
 */
export function withoutMissing(state: TabState, known: ReadonlySet<string>): TabState {
  if (state.tabs.every(id => known.has(id))) return state
  const tabs = state.tabs.filter(id => known.has(id))
  const seen = Object.fromEntries(Object.entries(state.seen).filter(([id]) => known.has(id)))
  const active = state.active !== undefined && known.has(state.active) ? state.active : mostRecent(tabs, seen)
  return { ...state, tabs, pinned: state.pinned.filter(id => known.has(id)), seen, active }
}

/**
 * The Session most recently activated among these.
 * @param tabs - candidates in strip order.
 * @param seen - when each was last activated.
 * @returns the latest one, the last on a tie, or undefined for no candidates.
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

// ---------------------------------------------------------------- closing and reopening

/**
 * The strip without these tabs, remembering them for reopening.
 * @param state - the strip.
 * @param ids - the tabs to close; ids that are not open are ignored.
 * @param titles - the title to remember for each Session.
 * @param now - the closing time.
 * @returns the next strip, and the Session to switch to when the active tab closed: the most recently used survivor.
 */
export function withoutTabs(state: TabState, ids: readonly string[], titles: Readonly<Record<string, string>>, now: number): {
  readonly state: TabState
  readonly next?: string
} {
  const closing = new Set(ids.filter(id => state.tabs.includes(id)))
  if (closing.size === 0) return { state }
  const records: ClosedTab[] = [...closing].map(id => ({
    id, title: titles[id] ?? '', index: state.tabs.indexOf(id), at: now, pinned: state.pinned.includes(id),
  }))
  const tabs = state.tabs.filter(id => !closing.has(id))
  const seen = { ...state.seen }
  for (const id of closing) delete seen[id]
  const closed = [...records.reverse(), ...state.closed.filter(entry => !closing.has(entry.id))].slice(0, MAX_CLOSED)
  const leaving = state.active !== undefined && closing.has(state.active)
  const next = leaving ? mostRecent(tabs, state.seen) : undefined
  return {
    state: { ...state, tabs, pinned: state.pinned.filter(id => !closing.has(id)), seen, closed, active: leaving ? next : state.active },
    ...next === undefined ? {} : { next },
  }
}

/** The unpinned tabs besides this one: what "close others" closes. */
export const othersOf = (state: TabState, id: string): readonly string[] =>
  state.tabs.filter(tab => tab !== id && !state.pinned.includes(tab))

/** The unpinned tabs to the right of this one: what "close to the right" closes. */
export const rightOf = (state: TabState, id: string): readonly string[] => {
  const at = state.tabs.indexOf(id)
  return at < 0 ? [] : state.tabs.slice(at + 1).filter(tab => !state.pinned.includes(tab))
}

/**
 * Reopen a closed tab where it was, pinned again if it was pinned.
 * @param state - the strip.
 * @param exists - whether a Session still exists.
 * @param now - the reopening time.
 * @param target - the closed tab to reopen; absent, the most recently closed one that still exists.
 * @returns the next strip and the Session to show; undefined when nothing can be reopened. Closed entries before the
 * reopened one whose Session is gone are dropped with it.
 */
export function reopen(state: TabState, exists: (id: string) => boolean, now: number, target?: string): {
  readonly state: TabState
  readonly id: string
} | undefined {
  const pool = target === undefined ? state.closed : state.closed.filter(entry => entry.id === target)
  const record = pool.find(entry => exists(entry.id))
  if (record === undefined) return undefined
  const skipped = new Set(pool.slice(0, pool.indexOf(record)))
  const tabs = state.tabs.filter(id => id !== record.id)
  tabs.splice(Math.min(record.index, tabs.length), 0, record.id)
  const pinned = new Set(state.pinned)
  if (record.pinned) pinned.add(record.id)
  const closed = state.closed.filter(entry => entry.id !== record.id && !skipped.has(entry))
  const next = normalized({ ...state, seen: { ...state.seen, [record.id]: now }, closed }, tabs, pinned)
  return { state: next, id: record.id }
}

/** The strip with an empty recently-closed list. */
export const withoutClosed = (state: TabState): TabState => state.closed.length === 0 ? state : { ...state, closed: [] }

/**
 * The Sessions a closed tab list can still show.
 * @param state - the strip.
 * @param exists - whether a Session still exists.
 * @returns the most recently closed one that does.
 */
export function reopenTarget(state: TabState, exists: (id: string) => boolean): string | undefined {
  return state.closed.find(entry => exists(entry.id))?.id
}

// ---------------------------------------------------------------- arranging

/**
 * Move a tab to a position inside its own group: pinned tabs stay among pinned ones, the rest after them.
 * @param state - the strip.
 * @param id - the tab to move.
 * @param to - the wanted index in `tabs`.
 * @returns the next strip; the same object when the tab does not move.
 */
export function reorder(state: TabState, id: string, to: number): TabState {
  const from = state.tabs.indexOf(id)
  if (from < 0) return state
  const isPinned = state.pinned.includes(id)
  const low = isPinned ? 0 : state.pinned.length
  const high = isPinned ? state.pinned.length - 1 : state.tabs.length - 1
  const index = Math.max(low, Math.min(high, to))
  if (index === from) return state
  const tabs = [...state.tabs]
  const [moved] = tabs.splice(from, 1)
  tabs.splice(index, 0, moved as string)
  return { ...state, tabs, pinned: tabs.filter(tab => state.pinned.includes(tab)) }
}

/**
 * The index a dragged tab lands on when dropped beside another.
 * @param state - the strip.
 * @param dragged - the tab being dragged.
 * @param target - the tab it is dropped on.
 * @param side - which half of the target it is over.
 * @returns the index for {@link reorder}, or undefined across the pinned boundary.
 */
export function dropIndex(state: TabState, dragged: string, target: string, side: 'before' | 'after'): number | undefined {
  if (state.pinned.includes(dragged) !== state.pinned.includes(target)) return undefined
  const from = state.tabs.indexOf(dragged)
  let to = state.tabs.indexOf(target) + (side === 'after' ? 1 : 0)
  if (from < to) to -= 1
  return to
}

/**
 * Move a tab one place among the visible tabs of its group.
 * @param state - the strip.
 * @param visible - the tabs on screen, in order.
 * @param id - the tab to move.
 * @param delta - -1 for left, 1 for right.
 * @returns the next strip; the same object at a group edge.
 */
export function shift(state: TabState, visible: readonly string[], id: string, delta: -1 | 1): TabState {
  const at = visible.indexOf(id)
  const neighbour = at < 0 ? undefined : visible[at + delta]
  if (neighbour === undefined) return state
  if (state.pinned.includes(id) !== state.pinned.includes(neighbour)) return state
  return reorder(state, id, state.tabs.indexOf(neighbour))
}

/**
 * Pin or unpin a tab. Pinning appends it to the pinned group; unpinning puts it right after that group.
 * @param state - the strip.
 * @param id - the tab.
 * @returns the next strip; the same object for a tab that is not open.
 */
export function togglePin(state: TabState, id: string): TabState {
  if (!state.tabs.includes(id)) return state
  const isPinned = state.pinned.includes(id)
  const pinned = new Set(state.pinned)
  if (isPinned) pinned.delete(id)
  else pinned.add(id)
  const rest = state.tabs.filter(tab => tab !== id)
  rest.splice(isPinned ? pinned.size : pinned.size - 1, 0, id)
  return normalized(state, rest, pinned)
}

/**
 * The tab a step to the left or right activates, wrapping around.
 * @param visible - the tabs on screen, in order.
 * @param current - the visible Session.
 * @param delta - -1 or 1.
 * @returns the tab to activate, or undefined for an empty strip.
 */
export function stepTarget(visible: readonly string[], current: string | undefined, delta: -1 | 1): string | undefined {
  if (visible.length === 0) return undefined
  const at = current === undefined ? -1 : visible.indexOf(current)
  const index = at < 0 ? 0 : at + delta
  return visible[((index % visible.length) + visible.length) % visible.length]
}

/**
 * The tab a number key activates: 1–8 by position, 9 the last.
 * @param visible - the tabs on screen, in order.
 * @param n - the digit pressed.
 * @returns the tab, or undefined past the end.
 */
export const jumpTarget = (visible: readonly string[], n: number): string | undefined =>
  n >= 9 ? visible[visible.length - 1] : visible[n - 1]

/**
 * The tabs worth holding in memory: the visible one, every pinned or busy tab, and the most recent of the rest.
 * @param state - the strip.
 * @param busy - the Sessions reported running or waiting for the user.
 * @param max - how many other tabs to keep.
 * @returns the Session ids to hold, in strip order.
 */
export function warmTabs(state: TabState, busy: ReadonlySet<string>, max: number = MAX_WARM): readonly string[] {
  const keep = new Set<string>()
  if (state.active !== undefined) keep.add(state.active)
  for (const id of state.tabs) if (busy.has(id) || state.pinned.includes(id)) keep.add(id)
  const rest = state.tabs
    .filter(id => !keep.has(id))
    .sort((a, b) => (state.seen[b] ?? 0) - (state.seen[a] ?? 0))
    .slice(0, Math.max(0, max))
  for (const id of rest) keep.add(id)
  return state.tabs.filter(id => keep.has(id))
}

// ---------------------------------------------------------------- preferences

/** Where the strip renders on this runtime: below the header without a caption row, else as chosen (title bar by default). */
export function effectivePlacement(state: TabState, runtime: TabRuntime, hasTitlebar: boolean): Placement {
  if (!hasTitlebar) return 'below'
  return state.placement[runtime] ?? 'titlebar'
}

/** The strip placed here on this runtime. */
export const withPlacement = (state: TabState, runtime: TabRuntime, placement: Placement): TabState =>
  state.placement[runtime] === placement ? state : { ...state, placement: { ...state.placement, [runtime]: placement } }

/** The strip with this caption height; undefined restores the default. */
export const withTitlebarHeight = (state: TabState, height: number | undefined): TabState => {
  const value = height === undefined ? undefined : clampTitlebar(height)
  return value === state.titlebarHeight ? state : { ...state, titlebarHeight: value }
}

/** The strip with this header strip height; undefined restores the default. */
export const withBarHeight = (state: TabState, height: number | undefined): TabState => {
  const value = height === undefined ? undefined : clampBar(height)
  return value === state.barHeight ? state : { ...state, barHeight: value }
}

/** The strip with this overflow mode. */
export const withOverflow = (state: TabState, overflow: Overflow): TabState =>
  state.overflow === overflow ? state : { ...state, overflow }

/** The title a tab shows: the Session's own, or a placeholder before the Host projects one. */
export function tabTitle(title: string | undefined, fallback: string): string {
  const text = (title ?? '').trim()
  return text === '' ? fallback : text
}

// ---------------------------------------------------------------- storage

/** The page half as stored, with the document that wrote it. */
export interface StoredPage {
  readonly tabs: readonly string[]
  readonly pinned: readonly string[]
  readonly seen: Readonly<Record<string, number>>
  readonly active?: string | undefined
  readonly owner?: string | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item !== ''))]
  : []
const parse = (raw: string | null): unknown => {
  if (raw === null) return undefined
  try { return JSON.parse(raw) as unknown } catch { return undefined }
}

/**
 * Read a stored page half, dropping anything malformed.
 * @param raw - the stored JSON, or null.
 * @returns the page half, or undefined when nothing usable is stored.
 */
export function parsePage(raw: string | null): StoredPage | undefined {
  const value = parse(raw)
  if (!isRecord(value)) return undefined
  const tabs = strings(value.tabs).slice(-MAX_TABS)
  const pinnedSet = new Set(strings(value.pinned).filter(id => tabs.includes(id)))
  const ordered = [...tabs.filter(id => pinnedSet.has(id)), ...tabs.filter(id => !pinnedSet.has(id))]
  const seen: Record<string, number> = {}
  if (isRecord(value.seen)) {
    for (const id of ordered) {
      const at = value.seen[id]
      if (typeof at === 'number' && Number.isFinite(at)) seen[id] = at
    }
  }
  const active = typeof value.active === 'string' && ordered.includes(value.active) ? value.active : undefined
  const owner = typeof value.owner === 'string' ? value.owner : undefined
  return { tabs: ordered, pinned: ordered.filter(id => pinnedSet.has(id)), seen, active, owner }
}

/** The page half to store, tagged with the document that owns it. */
export function serializePage(state: TabState, owner: string): string {
  return JSON.stringify({ version: 1, tabs: state.tabs, pinned: state.pinned, seen: state.seen, active: state.active, owner })
}

/** The shared half as read from storage. */
export type StoredPrefs = Pick<TabState, 'placement' | 'titlebarHeight' | 'barHeight' | 'overflow' | 'closed'>

/**
 * Read stored preferences, dropping anything malformed.
 * @param raw - the stored JSON, or null.
 * @returns the preferences, defaults for whatever is missing.
 */
export function parsePrefs(raw: string | null): StoredPrefs {
  const value = parse(raw)
  const record = isRecord(value) ? value : {}
  const placement: Partial<Record<TabRuntime, Placement>> = {}
  if (isRecord(record.placement)) {
    for (const runtime of ['desktop', 'web'] as const) {
      const chosen = record.placement[runtime]
      if (chosen === 'titlebar' || chosen === 'below') placement[runtime] = chosen
    }
  }
  const number = (input: unknown): number | undefined => typeof input === 'number' && Number.isFinite(input) ? input : undefined
  const titlebar = number(record.titlebarHeight)
  const bar = number(record.barHeight)
  const closed: ClosedTab[] = []
  if (Array.isArray(record.closed)) {
    for (const entry of record.closed) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') continue
      closed.push({
        id: entry.id,
        title: typeof entry.title === 'string' ? entry.title : '',
        index: number(entry.index) ?? 0,
        at: number(entry.at) ?? 0,
        pinned: entry.pinned === true,
      })
      if (closed.length === MAX_CLOSED) break
    }
  }
  return {
    placement,
    titlebarHeight: titlebar === undefined ? undefined : clampTitlebar(titlebar),
    barHeight: bar === undefined ? undefined : clampBar(bar),
    overflow: record.overflow === 'shrink' ? 'shrink' : 'scroll',
    closed,
  }
}

/** The shared half to store. */
export function serializePrefs(state: TabState): string {
  return JSON.stringify({
    version: 1, placement: state.placement, titlebarHeight: state.titlebarHeight, barHeight: state.barHeight,
    overflow: state.overflow, closed: state.closed,
  })
}

/** A strip assembled from a stored page half and stored preferences. */
export function assemble(page: StoredPage | undefined, prefs: StoredPrefs): TabState {
  return {
    ...EMPTY_TABS,
    ...prefs,
    ...page === undefined ? {} : { tabs: page.tabs, pinned: page.pinned, seen: page.seen, active: page.active },
  }
}
