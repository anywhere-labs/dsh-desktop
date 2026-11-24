/**
 * The session strip's runtime: one per client, shared by both seats (title bar and conversation header).
 *
 * It owns the strip's state and its storage, follows the Session the main view shows, keeps recent tabs in memory,
 * shares presence, read and pending facts with the app's other pages, handles the strip's shortcuts, sizes the
 * Windows caption row, badges the browser tab icon, and steps aside while the `dsh-multi-session` plugin draws its own
 * strip. The React seats only read it.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  assemble, clampBar, clampTitlebar, currentSession, dropIndex, effectivePlacement, jumpTarget, mostUrgent, othersOf,
  parsePage, parsePrefs, reopen as reopenTab, reorder as reorderTab, rightOf, serializePage, serializePrefs,
  shift as shiftTab, stepTarget, tabSignal, TITLEBAR_HEIGHT, togglePin as togglePinTab, warmTabs, withBarHeight,
  withCurrent, withOverflow, withoutClosed, withoutTabs, withPlacement, withTitlebarHeight,
  type Overflow, type Placement, type TabRuntime, type TabSignal, type TabState,
} from './session-tabs.ts'
import {
  alivePages, beat, BEAT_MS, initialSource, markRead, openKeepMs, otherOpenPages, publishPending, readElsewhere,
  readPendingMap, readReadMap, remotePending, SESSION_TABS_KEYS, type KeyValueStore, type PendingFact,
} from './session-tabs-sync.ts'
import { tabShortcut, TEXT_OR_WIDGET } from './session-tabs-keys.ts'
import { installIconBadge, type IconSignal } from './session-tabs-icon.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A tab kept in memory so returning to it shows its history at once, and the strip's rename of a Session. */
    sessionTabs: unknown
  }
}

/** A value seats can subscribe to. */
export interface Cell<T> {
  get(): T
  set(value: T): void
  subscribe(listener: () => void): () => void
}

/** A cell holding `initial`, notifying only on change. */
export function cell<T>(initial: T): Cell<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** One Session as the list reports it. */
export interface ListRow {
  readonly title?: string
  readonly displayTitle?: string
  readonly blank?: boolean
  readonly running?: boolean
  readonly cwd?: string
  readonly retainedBy?: { readonly mainView?: number }
}

/** The Session list snapshot. */
export interface ListSnapshot {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, ListRow>>
  readonly phase?: string
}

/** One Session's status as the status table reports it. */
export interface StatusRow {
  readonly running: boolean | undefined
  readonly pendingInteraction: unknown
  readonly completionUnread: boolean
}

interface Reference {
  readonly ready?: Promise<unknown>
  readonly binding?: { readonly session?: { rename(title: string): Promise<{ readonly ok: boolean }> } }
  release(): void
}

interface Sessions {
  readonly list: { getSnapshot(): ListSnapshot; subscribe(listener: () => void): () => void }
  retain(id: string, options: { readonly source: 'sessionTabs' }): Reference
  using<T>(id: string, options: { readonly source: 'sessionTabs' }, operation: (reference: Reference) => T | Promise<T>): Promise<T>
}

interface Services {
  readonly sessions?: Sessions
  readonly uiWorkspace?: { openSession(id: string): void; startSession(workspace?: string): void }
  readonly layout?: { selectPanel(id: null): void; readonly panelInfo?: { getSnapshot(): { readonly activePanelId: unknown } } }
  readonly workspaces?: { readonly list?: { getSnapshot(): { readonly items?: readonly { readonly workspaceId?: string; readonly sessionIds?: readonly string[] }[] } } }
  readonly shortcuts?: { readonly runtime?: string }
}

/** Elements the strip draws, so the window-wide shortcuts leave them to their own key handling. */
export const STRIP_SELECTOR = '[data-next-session-tabs],[data-next-session-tabs-menu]'
/** The stylesheet `dsh-multi-session` mounts while it runs: present, it draws the strip and this one steps aside. */
export const PLUGIN_MARK = 'style[data-dsh-multi-session]'
/** The caption height variable the desktop preload writes on <html>. */
const TITLEBAR_VAR = '--dsh-windows-titlebar-height'
const WARM_RETRY_MS = 30_000
const RESTORE_WINDOW_MS = 8000
const PERSIST_DELAY_MS = 120

const storage = (name: 'localStorage' | 'sessionStorage'): KeyValueStore | undefined => {
  try { return window[name] } catch { return undefined }
}

/** This document's id; a live plugin reload in the same page keeps it, so its sessionStorage stays its own. */
function documentId(): string {
  const holder = window as unknown as { __desktopNextSessionTabsPage?: string }
  holder.__desktopNextSessionTabsPage ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return holder.__desktopNextSessionTabsPage
}

/** Whether this document is the same tab coming back (F5, crash reload, a discarded tab re-activated). */
function reloadedInPlace(): boolean {
  try { if ((document as Document & { wasDiscarded?: boolean }).wasDiscarded === true) return true } catch { /* unsupported */ }
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return navigation?.type === 'reload'
  } catch {
    return false
  }
}

/**
 * The title a Session shows: its own, or undefined for the caller's placeholder (new for a blank Session, untitled
 * otherwise), as the sidebar names them. The list's display title is not used: without a title of its own it falls
 * back to the workspace's name or the Session id, which reads as a title it does not have.
 */
export function rowTitle(row: ListRow | undefined): string | undefined {
  const own = row?.title?.trim()
  return own ? own : undefined
}

/** The runtime facts the seats render from, beyond the strip itself. */
export interface TabFactsInput {
  readonly list: ListSnapshot
  readonly status: ReadonlyMap<string, StatusRow>
}

/** The strip's runtime. */
export interface SessionTabsController {
  readonly state: Cell<TabState>
  readonly warm: Cell<ReadonlyMap<string, 'pending' | 'ready'>>
  readonly titlebar: Cell<boolean>
  readonly yielded: Cell<boolean>
  readonly liveTitlebar: Cell<number | undefined>
  readonly liveBar: Cell<number | undefined>
  readonly icon: Cell<IconSignal | undefined>
  readonly read: Cell<Readonly<Record<string, number>>>
  readonly pending: Cell<Readonly<Record<string, PendingFact>>>
  readonly unseen: Cell<ReadonlySet<string>>
  readonly page: string
  runtime(): TabRuntime
  placement(): Placement
  current(): string | undefined
  visible(state?: TabState): readonly string[]
  /** Every tab's dot, and the most urgent one for the browser tab icon; records unseen and read transitions. */
  signals(input: TabFactsInput, panelOpen: boolean): ReadonlyMap<string, TabSignal>
  /** Record what a render showed: completions that happened unseen, Sessions the person looked at, pending facts. */
  observe(input: TabFactsInput, signals: ReadonlyMap<string, TabSignal>, panelOpen: boolean): void
  readonly actions: {
    activate(id: string): void
    newSession(from?: string): void
    close(ids: readonly string[]): void
    closeOthers(id: string): void
    closeRight(id: string): void
    reopen(target?: string): boolean
    clearClosed(): void
    reorder(id: string, to: number): void
    drop(dragged: string, target: string, side: 'before' | 'after'): void
    shift(id: string, delta: -1 | 1): void
    togglePin(id: string): void
    step(delta: -1 | 1): void
    jump(n: number): void
    rename(id: string, title: string): Promise<boolean>
    setPlacement(placement: Placement): void
    setTitlebarHeight(height: number | undefined): void
    setBarHeight(height: number | undefined): void
    setOverflow(overflow: Overflow): void
  }
  /** Start following the window; the teardown stops everything and releases every held Session. */
  install(): () => void
}

/**
 * Create the strip's runtime for one client.
 * @param ctx - the client context.
 * @returns the runtime; nothing runs until {@link SessionTabsController.install}.
 */
export function createSessionTabs(ctx: Context): SessionTabsController {
  const get = <K extends keyof Services>(name: K): Services[K] => {
    try { return (ctx as unknown as { get(name: string): unknown }).get(name) as Services[K] } catch { return undefined }
  }
  const local = storage('localStorage')
  const session = storage('sessionStorage')
  const page = documentId()
  const electron = /\bElectron\//.test(String(navigator.userAgent))
  const keepMs = openKeepMs(electron)

  // ---------------- initial strip
  const ownPage = parsePage(session?.getItem(SESSION_TABS_KEYS.page) ?? null)
  const source = initialSource({
    hasOwn: ownPage !== undefined,
    owner: ownPage?.owner,
    openPages: otherOpenPages(local, page, Date.now(), keepMs),
    reloadedInPlace: reloadedInPlace(),
  })
  const startPage = source === 'session' ? ownPage
    : source === 'snapshot' ? parsePage(local?.getItem(SESSION_TABS_KEYS.snapshot) ?? null) : undefined
  const predecessor = source === 'session' ? ownPage?.owner : undefined
  const state = cell<TabState>(assemble(startPage, parsePrefs(local?.getItem(SESSION_TABS_KEYS.prefs) ?? null)))
  let lastPrefs = serializePrefs(state.get())
  let timer: ReturnType<typeof setTimeout> | undefined
  const writePage = (): void => {
    try { session?.setItem(SESSION_TABS_KEYS.page, serializePage(state.get(), page)) } catch { /* memory only */ }
  }
  const flush = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    writePage()
    // The newest strip wins the snapshot a restart reads; it never feeds a page that is already open.
    try { local?.setItem(SESSION_TABS_KEYS.snapshot, serializePage(state.get(), page)) } catch { /* memory only */ }
    const prefs = serializePrefs(state.get())
    if (prefs !== lastPrefs) {
      lastPrefs = prefs
      try { local?.setItem(SESSION_TABS_KEYS.prefs, prefs) } catch { /* memory only */ }
    }
  }
  // Claim this tab's sessionStorage at once, so a reload before the first change reads it as its own.
  writePage()
  const update = (change: (previous: TabState) => TabState): void => {
    const next = change(state.get())
    if (next === state.get()) return
    state.set(next)
    // Bursts (dragging, rapid switching) coalesce into one write.
    timer ??= setTimeout(flush, PERSIST_DELAY_MS)
  }
  const adoptPrefs = (raw: string | null): void => {
    const prefs = parsePrefs(raw)
    const merged = { ...state.get(), ...prefs }
    const json = serializePrefs(merged)
    if (json === serializePrefs(state.get())) return
    lastPrefs = json
    state.set(merged)
  }

  // ---------------- cells
  const warm = cell<ReadonlyMap<string, 'pending' | 'ready'>>(new Map())
  const titlebarPresent = (): boolean => document.documentElement.hasAttribute('data-windows-titlebar')
  const titlebar = cell(titlebarPresent())
  const yielded = cell(document.querySelector(PLUGIN_MARK) !== null)
  const liveTitlebar = cell<number | undefined>(undefined)
  const liveBar = cell<number | undefined>(undefined)
  const icon = cell<IconSignal | undefined>(undefined)
  const read = cell<Readonly<Record<string, number>>>(readReadMap(local, Date.now()))
  const pending = cell<Readonly<Record<string, PendingFact>>>(readPendingMap(local))
  const unseen = cell<ReadonlySet<string>>(new Set())
  const unreadSince = new Map<string, number>()
  let lastSignals = new Map<string, TabSignal>()
  let lastRead: string | undefined
  let lastPending = ''

  const list = (): ListSnapshot | undefined => { try { return get('sessions')?.list.getSnapshot() } catch { return undefined } }
  const runtime = (): TabRuntime => {
    const declared = get('shortcuts')?.runtime
    if (declared === 'desktop' || declared === 'web') return declared
    return titlebar.get() ? 'desktop' : 'web'
  }
  const currentOf = (snapshot: ListSnapshot | undefined): string | undefined => {
    if (snapshot === undefined) return undefined
    const held: Record<string, number> = {}
    for (const [id, row] of Object.entries(snapshot.byId)) held[id] = row.retainedBy?.mainView ?? 0
    return currentSession(snapshot.ids.length > 0 ? snapshot.ids : Object.keys(snapshot.byId), held)
  }
  // Tabs of Sessions the list does not report (an offline workspace, a catalog still loading) stay remembered but
  // hidden, so a reload never wipes the strip before the list arrives.
  const visible = (from: TabState = state.get()): readonly string[] => {
    const byId = list()?.byId
    return byId === undefined ? [] : from.tabs.filter(id => byId[id] !== undefined)
  }
  const leavePanel = (): void => {
    const layout = get('layout')
    try { if (layout?.panelInfo?.getSnapshot().activePanelId !== null) layout?.selectPanel(null) } catch { /* layout optional */ }
  }
  const workspaceOf = (id: string): string | undefined => {
    try { return get('workspaces')?.list?.getSnapshot().items?.find(item => item.sessionIds?.includes(id))?.workspaceId } catch { return undefined }
  }
  const titles = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [id, row] of Object.entries(list()?.byId ?? {})) out[id] = rowTitle(row) ?? ''
    return out
  }
  const exists = (id: string): boolean => list()?.byId[id] !== undefined

  const actions: SessionTabsController['actions'] = {
    activate(id) {
      leavePanel()
      if (currentOf(list()) === id) return
      get('uiWorkspace')?.openSession(id)
    },
    newSession(from) {
      const base = from ?? currentOf(list())
      try { get('layout')?.selectPanel(null) } catch { /* layout optional */ }
      get('uiWorkspace')?.startSession(base === undefined ? undefined : workspaceOf(base))
    },
    close(ids) {
      const closed = withoutTabs(state.get(), ids, titles(), Date.now())
      if (closed.state === state.get()) return
      const wasCurrent = currentOf(list())
      const closingCurrent = wasCurrent !== undefined && ids.includes(wasCurrent)
      update(() => closed.state)
      if (!closingCurrent) return
      // Back to the most recently used survivor; with none left, a new Session in the same workspace.
      const survivor = closed.next !== undefined && exists(closed.next) ? closed.next : undefined
      if (survivor !== undefined) actions.activate(survivor)
      else actions.newSession(wasCurrent)
    },
    closeOthers(id) { actions.close(othersOf(state.get(), id)) },
    closeRight(id) { actions.close(rightOf(state.get(), id)) },
    reopen(target) {
      const reopened = reopenTab(state.get(), exists, Date.now(), target)
      if (reopened === undefined) {
        // Nothing left to show: forget the entries whose Session is gone.
        update(previous => {
          const closed = previous.closed.filter(entry => (target === undefined || entry.id === target) ? exists(entry.id) : true)
          return closed.length === previous.closed.length ? previous : { ...previous, closed }
        })
        return false
      }
      update(() => reopened.state)
      actions.activate(reopened.id)
      return true
    },
    clearClosed() { update(withoutClosed) },
    reorder(id, to) { update(previous => reorderTab(previous, id, to)) },
    drop(dragged, target, side) {
      const to = dropIndex(state.get(), dragged, target, side)
      if (to !== undefined) actions.reorder(dragged, to)
    },
    shift(id, delta) { update(previous => shiftTab(previous, visible(previous), id, delta)) },
    togglePin(id) { update(previous => togglePinTab(previous, id)) },
    step(delta) {
      const next = stepTarget(visible(), currentOf(list()), delta)
      if (next !== undefined) actions.activate(next)
    },
    jump(n) {
      const next = jumpTarget(visible(), n)
      if (next !== undefined) actions.activate(next)
    },
    async rename(id, title) {
      const value = title.trim()
      if (value === '') return true
      const sessions = get('sessions')
      if (sessions === undefined) return false
      try {
        const result = await sessions.using(id, { source: 'sessionTabs' }, async reference => {
          const renamer = reference.binding?.session
          return renamer === undefined ? { ok: false } : await renamer.rename(value)
        })
        return result.ok
      } catch {
        return false
      }
    },
    setPlacement(placement) { update(previous => withPlacement(previous, runtime(), placement)) },
    setTitlebarHeight(height) { update(previous => withTitlebarHeight(previous, height)) },
    setBarHeight(height) { update(previous => withBarHeight(previous, height)) },
    setOverflow(overflow) { update(previous => withOverflow(previous, overflow)) },
  }

  const noteRead = (id: string): void => {
    const now = Date.now()
    markRead(local, id, now)
    const known = read.get()
    if ((known[id] ?? 0) < now) read.set({ ...known, [id]: now })
  }

  const signals: SessionTabsController['signals'] = ({ list: snapshot, status }) => {
    const current = currentOf(snapshot)
    const now = Date.now()
    const remote = remotePending(pending.get(), page, alivePages(local, page, now))
    const warmMap = warm.get()
    const hidden = unseen.get()
    const out = new Map<string, TabSignal>()
    for (const id of state.get().tabs) {
      const row = snapshot.byId[id]
      if (row === undefined) continue
      const entry = status.get(id)
      const running = entry?.running ?? row.running
      const facts = {
        running: entry?.running,
        awaiting: entry?.pendingInteraction !== undefined && entry.pendingInteraction !== null,
        unread: entry?.completionUnread === true,
        current: id === current,
        warm: warmMap.get(id),
      }
      let signal = tabSignal({ ...facts, running: entry?.running ?? (row.running === true ? true : facts.running) })
      // A tab this page has not loaded cannot see its pending request; another page may.
      if (signal !== 'awaiting' && running === true && remote.has(id)) signal = 'awaiting'
      // A run that ended while this page was in the background counts as unread here until the page is seen.
      if (hidden.has(id) && signal !== 'awaiting' && signal !== 'running') signal = 'unread'
      if (signal === 'unread') {
        const since = unreadSince.get(id) ?? now
        if (readElsewhere(read.get(), id, since)) signal = tabSignal({ ...facts, unread: false })
      }
      out.set(id, signal)
    }
    return out
  }

  const observe: SessionTabsController['observe'] = ({ list: snapshot, status }, shown, panelOpen) => {
    const previous = lastSignals
    lastSignals = new Map(shown)
    const pageHidden = document.hidden
    let nextUnseen: Set<string> | undefined
    const hiddenNow = unseen.get()
    for (const [id, signal] of shown) {
      const was = previous.get(id)
      const busy = signal === 'running' || signal === 'awaiting'
      if (busy && hiddenNow.has(id)) { nextUnseen ??= new Set(hiddenNow); nextUnseen.delete(id) }
      else if (pageHidden && !busy && (was === 'running' || was === 'awaiting') && !hiddenNow.has(id)) { nextUnseen ??= new Set(hiddenNow); nextUnseen.add(id) }
    }
    if (nextUnseen !== undefined) unseen.set(nextUnseen)
    const now = Date.now()
    for (const [id, signal] of shown) if (signal === 'unread' && !unreadSince.has(id)) unreadSince.set(id, now)
    for (const id of [...unreadSince.keys()]) if (shown.get(id) !== 'unread') unreadSince.delete(id)
    // Looking at the visible Session in a visible page counts as reading it, for every page.
    const current = currentOf(snapshot)
    if (current !== undefined && !pageHidden && !panelOpen) {
      const was = previous.get(current)
      const ended = (was === 'running' || was === 'awaiting') && shown.get(current) !== 'running' && shown.get(current) !== 'awaiting'
      if (ended || lastRead !== current) { lastRead = current; noteRead(current) }
    }
    if (pageHidden) lastRead = undefined
    const waiting = [...status].filter(([, row]) => row.pendingInteraction !== undefined && row.pendingInteraction !== null).map(([id]) => id).sort()
    const key = waiting.join('|')
    if (key !== lastPending) {
      lastPending = key
      publishPending(local, page, waiting, alivePages(local, page, now), now)
    }
    const urgent = mostUrgent(shown.values())
    const strip = document.querySelector<HTMLElement>('[data-next-session-tabs]')
    const style = strip === null ? undefined : getComputedStyle(strip)
    const accent = style?.getPropertyValue('--dshNextTabsAccent').trim() ?? ''
    const warn = style?.getPropertyValue('--dshNextTabsWarn').trim() ?? ''
    const known = icon.get()
    if (urgent === undefined) { if (known !== undefined) icon.set(undefined); return }
    if (known?.state !== urgent || known.accent !== accent || known.warn !== warn) icon.set({ state: urgent, accent, warn })
  }

  const install = (): (() => void) => {
    const teardown: (() => void)[] = []
    let disposed = false

    // ---------------- step aside while dsh-multi-session draws its own strip
    const mark = new MutationObserver(() => { yielded.set(document.querySelector(PLUGIN_MARK) !== null) })
    mark.observe(document.head, { childList: true })
    teardown.push(() => { mark.disconnect() })

    // ---------------- caption row presence
    const caption = new MutationObserver(() => { titlebar.set(titlebarPresent()) })
    caption.observe(document.documentElement, { attributes: true, attributeFilter: ['data-windows-titlebar'] })
    teardown.push(() => { caption.disconnect() })

    // ---------------- follow the main view, keep tabs warm
    const references = new Map<string, Reference>()
    const failed = new Map<string, number>()
    let previousCurrent: string | undefined
    let restoreId = source === 'session' ? startPage?.active : undefined
    const restoreDeadline = Date.now() + RESTORE_WINDOW_MS
    // After a reload the Host may reopen whichever Session any page opened last; put this page back on its own.
    const tryRestore = (snapshot: ListSnapshot): boolean => {
      if (restoreId === undefined) return false
      if (Date.now() > restoreDeadline) { restoreId = undefined; return false }
      if (snapshot.byId[restoreId] === undefined) {
        if (snapshot.phase === 'ready' || snapshot.ids.length > 0) restoreId = undefined
        return restoreId !== undefined
      }
      const current = currentOf(snapshot)
      if (current === restoreId) { restoreId = undefined; return false }
      if (current === undefined) return true
      const id = restoreId
      restoreId = undefined
      actions.activate(id)
      return true
    }
    const reconcile = (): void => {
      if (disposed) return
      const snapshot = list()
      const sessions = get('sessions')
      if (snapshot === undefined || sessions === undefined) return
      const now = Date.now()
      for (const [id, at] of [...failed]) if (now - at > WARM_RETRY_MS) failed.delete(id)
      const busy = new Set(state.get().tabs.filter(id => snapshot.byId[id]?.running === true))
      const wanted = yielded.get()
        ? new Set<string>()
        : new Set(warmTabs(state.get(), busy).filter(id => snapshot.byId[id] !== undefined && !failed.has(id)))
      let next: Map<string, 'pending' | 'ready'> | undefined
      for (const [id, reference] of [...references]) {
        if (wanted.has(id)) continue
        references.delete(id)
        next ??= new Map(warm.get())
        next.delete(id)
        try { reference.release() } catch { /* already released */ }
      }
      for (const id of wanted) {
        if (references.has(id)) continue
        let reference: Reference
        try { reference = sessions.retain(id, { source: 'sessionTabs' }) } catch { failed.set(id, now); continue }
        references.set(id, reference)
        next ??= new Map(warm.get())
        next.set(id, 'pending')
        void Promise.resolve(reference.ready).then(() => {
          if (disposed || references.get(id) !== reference) return
          warm.set(new Map(warm.get()).set(id, 'ready'))
        }, () => {
          if (disposed || references.get(id) !== reference) return
          failed.set(id, Date.now())
          references.delete(id)
          try { reference.release() } catch { /* already released */ }
          const map = new Map(warm.get())
          map.delete(id)
          warm.set(map)
        })
      }
      if (next !== undefined) warm.set(next)
    }
    let scheduled = false
    const schedule = (): void => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(() => { scheduled = false; reconcile() })
    }
    let lastSignature = ''
    const onList = (): void => {
      const snapshot = list()
      if (snapshot === undefined) return
      if (tryRestore(snapshot)) return
      const current = currentOf(snapshot)
      if (current !== previousCurrent) {
        previousCurrent = current
        if (current !== undefined && !yielded.get()) update(previous => withCurrent(previous, current, Date.now()))
      }
      // Only membership, running state and the current Session matter for warmth.
      let signature = `${current ?? ''}|${String(yielded.get())}|`
      for (const id of state.get().tabs) {
        const row = snapshot.byId[id]
        signature += row === undefined ? '-' : row.running === true ? 'r' : 'i'
      }
      if (signature !== lastSignature) { lastSignature = signature; schedule() }
    }
    const sessions = get('sessions')
    if (sessions !== undefined) {
      try { teardown.push(sessions.list.subscribe(onList)) } catch { /* no list */ }
    }
    teardown.push(state.subscribe(() => { lastSignature = ''; onList() }))
    teardown.push(yielded.subscribe(() => { lastSignature = ''; onList() }))
    const retry = setInterval(() => { if (failed.size > 0) schedule() }, WARM_RETRY_MS)
    const restoreTimer = restoreId === undefined ? undefined : setTimeout(onList, RESTORE_WINDOW_MS + 100)
    teardown.push(() => {
      clearInterval(retry)
      if (restoreTimer !== undefined) clearTimeout(restoreTimer)
      for (const reference of references.values()) { try { reference.release() } catch { /* already released */ } }
      references.clear()
    })
    onList()

    // ---------------- presence, and preferences from the app's other pages
    if (local !== undefined) {
      let goneBefore = predecessor
      const pulse = (remove: boolean): void => {
        beat(local, page, Date.now(), { remove, predecessor: goneBefore, keepMs })
        goneBefore = undefined
      }
      const onStorage = (event: StorageEvent): void => {
        if (event.storageArea !== local) return
        if (event.key === SESSION_TABS_KEYS.prefs && event.newValue !== null) adoptPrefs(event.newValue)
        else if (event.key === SESSION_TABS_KEYS.read) read.set(readReadMap(local, Date.now()))
        else if (event.key === SESSION_TABS_KEYS.pending) pending.set(readPendingMap(local))
      }
      const onHide = (): void => { flush(); pulse(true) }
      const onShow = (): void => { pulse(false) }
      pulse(false)
      const heartbeat = setInterval(() => { pulse(false) }, BEAT_MS)
      // An entry's owner may close without cleaning up; drop it once its heartbeat expires.
      const sweep = setInterval(() => {
        const next = readPendingMap(local)
        if (JSON.stringify(next) !== JSON.stringify(pending.get())) pending.set(next)
      }, BEAT_MS * 3)
      window.addEventListener('storage', onStorage)
      window.addEventListener('pagehide', onHide)
      window.addEventListener('pageshow', onShow)
      teardown.push(() => {
        clearInterval(heartbeat)
        clearInterval(sweep)
        window.removeEventListener('storage', onStorage)
        window.removeEventListener('pagehide', onHide)
        window.removeEventListener('pageshow', onShow)
        publishPending(local, page, [], alivePages(local, page, Date.now()), Date.now())
        pulse(true)
      })
    }
    // A page coming back counts as reading the Session it shows, and forgets completions it missed.
    const onVisibility = (): void => {
      if (document.hidden) return
      if (unseen.get().size > 0) unseen.set(new Set())
      const current = currentOf(list())
      if (current !== undefined) { lastRead = current; noteRead(current) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    teardown.push(() => { document.removeEventListener('visibilitychange', onVisibility) })

    // ---------------- shortcuts
    const onKey = (event: KeyboardEvent): void => {
      if (yielded.get()) return
      const shortcut = tabShortcut(event)
      if (shortcut === undefined) return
      const target = event.target instanceof Element ? event.target : undefined
      if (target?.closest(STRIP_SELECTOR) !== null && target !== undefined) return
      if (document.querySelector('[role=dialog][aria-modal=true],[role=alertdialog]') !== null) return
      if (shortcut.kind === 'shift') {
        const focused = document.activeElement
        if (target?.closest(TEXT_OR_WIDGET) || (focused instanceof Element && focused.closest(TEXT_OR_WIDGET))) return
        if (window.getSelection()?.type === 'Range') return
        const current = currentOf(list())
        if (current === undefined || !state.get().tabs.includes(current)) return
        event.preventDefault()
        event.stopPropagation()
        actions.shift(current, shortcut.delta)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (shortcut.kind === 'step') actions.step(shortcut.delta)
      else if (shortcut.kind === 'jump') actions.jump(shortcut.n)
      else if (shortcut.kind === 'close') { const current = currentOf(list()); if (current !== undefined) actions.close([current]) }
      else if (shortcut.kind === 'reopen') actions.reopen()
      else actions.newSession()
    }
    window.addEventListener('keydown', onKey, true)
    teardown.push(() => { window.removeEventListener('keydown', onKey, true) })

    // ---------------- caption row height
    // The desktop preload writes the variable inline on <html> and rewrites it when it re-marks the document, so a
    // stylesheet cannot override it: write an important inline value and re-assert it, restoring 40px on teardown.
    const root = document.documentElement
    let applied: string | undefined
    let writing = false
    const wantedHeight = (): string | undefined => {
      if (yielded.get() || !titlebar.get()) return undefined
      const fullscreen = root.getAttribute('data-fullscreen')
      if (fullscreen !== null && fullscreen !== 'false') return undefined
      if (effectivePlacement(state.get(), runtime(), true) !== 'titlebar') return undefined
      const height = liveTitlebar.get() ?? state.get().titlebarHeight ?? TITLEBAR_HEIGHT.default
      return `${clampTitlebar(height)}px`
    }
    const renderHeight = (): void => {
      const want = wantedHeight()
      writing = true
      try {
        if (want === undefined) {
          if (applied !== undefined) { root.style.setProperty(TITLEBAR_VAR, `${TITLEBAR_HEIGHT.native}px`); applied = undefined }
          return
        }
        if (root.style.getPropertyValue(TITLEBAR_VAR).trim() !== want || root.style.getPropertyPriority(TITLEBAR_VAR) !== 'important') {
          root.style.setProperty(TITLEBAR_VAR, want, 'important')
        }
        applied = want
      } finally {
        writing = false
      }
    }
    const heightObserver = new MutationObserver(() => { if (!writing) renderHeight() })
    heightObserver.observe(root, { attributes: true, attributeFilter: ['style', 'data-fullscreen', 'data-windows-titlebar'] })
    for (const source of [state, liveTitlebar, titlebar, yielded] as const) teardown.push(source.subscribe(renderHeight))
    renderHeight()
    teardown.push(() => {
      heightObserver.disconnect()
      if (applied !== undefined && titlebarPresent()) root.style.setProperty(TITLEBAR_VAR, `${TITLEBAR_HEIGHT.native}px`)
    })

    // ---------------- browser tab icon
    teardown.push(installIconBadge(icon, () => runtime() === 'web' && !yielded.get()))
    teardown.push(yielded.subscribe(() => { if (yielded.get()) icon.set(undefined) }))

    return () => {
      disposed = true
      flush()
      for (const step of teardown.reverse()) {
        try { step() } catch { /* keep tearing down */ }
      }
    }
  }

  return {
    state, warm, titlebar, yielded, liveTitlebar, liveBar, icon, read, pending, unseen, page,
    runtime,
    placement: () => effectivePlacement(state.get(), runtime(), titlebar.get()),
    current: () => currentOf(list()),
    visible,
    signals,
    observe,
    actions,
    install,
  }
}

/** A caption-height drag value inside its bounds. */
export const dragTitlebar = (start: number, delta: number): number => clampTitlebar(start + delta)
/** A header-strip drag value inside its bounds. */
export const dragBar = (start: number, delta: number): number => clampBar(start + delta)
