/**
 * Per-Session tab store for the Desktop browser surface.
 *
 * One Session owns one set of guest pages inside the single Desktop window.
 * The store owns placement (the rectangle the panel measured, the zoom that
 * turns that rectangle into the logical viewport the Agent drives, and whether
 * the panel can see the page at all), the tab list, and the JSON action surface
 * shared by the panel and the Cordis service. It never renders and never talks
 * to Electron, so both the Agent tool and the panel chrome sit on top of it.
 */

import type { DesktopNativeBrowser } from './browser-view-service.ts'
import {
  DEFAULT_DESKTOP_BROWSER_VIEWPORT,
  DesktopBrowserPage,
  redactText,
  type DesktopBrowserConsoleEntry,
  type DesktopBrowserHistoryEntry,
  type DesktopBrowserPageEvent,
  type DesktopBrowserRect,
} from './desktop-browser-page.ts'

/** Stable code returned when a Session opens more tabs than the Desktop limit. */
export const DESKTOP_BROWSER_TAB_LIMIT = 'BROWSER_TAB_LIMIT'

/** Stable code returned for an action outside the panel contract. */
export const DESKTOP_BROWSER_INVALID_ACTION = 'BROWSER_INVALID_ACTION'

/** Stable code returned when a Session is not allowed to mutate the page. */
export const DESKTOP_BROWSER_READ_ONLY = 'BROWSER_READ_ONLY'

/** Stable code returned when no tab exists yet. */
export const DESKTOP_BROWSER_NO_TAB = 'BROWSER_NO_TAB'

/** Stable code returned for a tab id outside the visible set. */
export const DESKTOP_BROWSER_UNKNOWN_TAB = 'BROWSER_UNKNOWN_TAB'

/** Stable code returned when the native guest view cannot be created. */
export const DESKTOP_BROWSER_UNAVAILABLE = 'BROWSER_UNAVAILABLE'

/** Tabs one Session may keep open at once. */
export const DESKTOP_BROWSER_TAB_LIMIT_COUNT = 12

/** Logical width of the desktop layout, in CSS pixels. */
export const DESKTOP_BROWSER_LAYOUT_WIDTH = 1280

/** How the logical viewport is derived from the panel's rectangle. */
export type DesktopBrowserLayout = 'fit' | 'desktop'

/** The tab list the panel renders. */
export interface DesktopBrowserTabInfo {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly loading: boolean
  readonly active: boolean
}

/** Placement the panel reports for the active page. */
export interface DesktopBrowserViewport {
  /** Placeholder rectangle in renderer CSS pixels, or `null` when there is none. */
  readonly bounds: DesktopBrowserRect | null
  /** Fit zoom factor; ignored in the desktop layout. */
  readonly zoom: number
  /** How the logical viewport relates to the rectangle. */
  readonly layout: DesktopBrowserLayout
  /** Whether the panel can see the page right now. */
  readonly visible: boolean
}

/** Everything the panel needs to paint one state. */
export interface DesktopBrowserState {
  readonly tabs: readonly DesktopBrowserTabInfo[]
  readonly activeId: string | null
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  /** Logical CSS viewport the Agent's coordinates refer to. */
  readonly viewport: { readonly width: number; readonly height: number }
  /** Placeholder rectangle the panel last reported, in renderer CSS pixels. */
  readonly bounds: DesktopBrowserRect | null
  /** Logical zoom percentage applied to the page, for the panel's own label. */
  readonly zoom: number
  /** Active layout of the logical viewport. */
  readonly layout: DesktopBrowserLayout
  /** Whether the panel reports the page as visible. */
  readonly visible: boolean
  /** Last failure code the store surfaced, if any. */
  readonly error?: string
}

/** One console line together with the tab that produced it. */
export interface DesktopBrowserConsoleLine extends DesktopBrowserConsoleEntry {
  readonly tabId: string
}

/** Actions the panel and the Cordis service may request. */
export type DesktopBrowserAction =
  | { readonly action: 'state' }
  | { readonly action: 'tabs'; readonly op?: 'list' | 'new' | 'select' | 'close'; readonly tab?: string; readonly url?: string }
  | { readonly action: 'navigate'; readonly url: string }
  | { readonly action: 'back' }
  | { readonly action: 'forward' }
  | { readonly action: 'reload' }
  | { readonly action: 'stop' }
  | { readonly action: 'viewport'; readonly bounds: DesktopBrowserRect | null; readonly zoom?: number; readonly layout?: DesktopBrowserLayout; readonly visible?: boolean }
  | { readonly action: 'focus' }
  | { readonly action: 'click'; readonly x: number; readonly y: number }
  | { readonly action: 'move'; readonly x: number; readonly y: number }
  | { readonly action: 'type'; readonly text: string }
  | { readonly action: 'press'; readonly key: string }
  | { readonly action: 'scroll'; readonly deltaY: number; readonly deltaX?: number }
  | { readonly action: 'console'; readonly since?: number }
  | { readonly action: 'history' }

/** Answer of one action call. */
export interface DesktopBrowserActionResult {
  readonly state: DesktopBrowserState
  readonly console?: readonly DesktopBrowserConsoleLine[]
  readonly history?: readonly DesktopBrowserHistoryEntry[]
}

/** Inputs the store needs from its owning Host plugin. */
export interface DesktopBrowserStoreOptions {
  /** Native guest-view service provided by the Desktop shell. */
  readonly service: DesktopNativeBrowser
  /** Allowlisted top-level origins; omitted means any http(s) page. */
  readonly allowOrigins?: readonly string[] | undefined
  /** Whether the Session owning these tabs may mutate the page. */
  readonly readOnly?: () => boolean
  /** Sink for non-fatal failures. */
  readonly report?: (message: string) => void
  /** Notified after every state change, so the panel channel can push. */
  readonly onState?: (state: DesktopBrowserState) => void
}

interface TabEntry {
  readonly id: string
  readonly page: DesktopBrowserPage
  unsubscribe: () => void
}

/** One Session's tabs inside the single Desktop browser window. */
export class DesktopBrowserStore {
  private readonly options: DesktopBrowserStoreOptions
  private readonly tabs: TabEntry[] = []
  /** Native owner string grouping every guest view of this store. */
  private readonly owner: string
  private active: TabEntry | undefined
  private sequence = 0
  private placement: DesktopBrowserViewport = { bounds: null, zoom: 1, layout: 'fit', visible: false }
  private error: string | undefined
  private disposed = false
  /** Tail of the serialized action chain; see {@link queue}. */
  private serial: Promise<unknown> = Promise.resolve()
  /** Navigation position of the active tab, refreshed from its own history. */
  private navigation: { entries: number; index: number } = { entries: 0, index: 0 }

  /**
   * @param sessionId - owning Session, also used to group its native guest views.
   * @param options - native service, policy, and notification sinks.
   */
  constructor(sessionId: string, options: DesktopBrowserStoreOptions) {
    this.sessionId = sessionId
    this.owner = `desktop-browser:${sessionId}`
    this.options = options
  }

  /** The Session these tabs belong to. */
  readonly sessionId: string

  /** Whether this store still owns live tabs. */
  get isDisposed(): boolean { return this.disposed }

  /** Tab ids in display order. */
  get tabIds(): readonly string[] { return this.tabs.map(tab => tab.id) }

  /** The active tab id, or `null` when the Session has no tab. */
  get activeId(): string | null { return this.active?.id ?? null }

  /** The active page, when one exists. */
  get activePage(): DesktopBrowserPage | undefined { return this.active?.page }

  /** The bound address of the active page, for diagnostics. */
  get address(): string { return this.active?.page.state.url ?? '' }

  /** The tab list and navigation state the panel renders. */
  get state(): DesktopBrowserState {
    const active = this.active
    return {
      tabs: this.tabs.map(tab => ({
        id: tab.id,
        title: tab.page.state.title,
        url: tab.page.state.url,
        loading: tab.page.state.loading,
        active: tab.id === active?.id,
      })),
      activeId: active?.id ?? null,
      loading: active?.page.state.loading ?? false,
      canGoBack: this.navigation.index > 0,
      canGoForward: this.navigation.index < this.navigation.entries - 1,
      viewport: this.logicalViewport(),
      bounds: this.placement.bounds,
      zoom: this.placement.layout === 'desktop' ? this.desktopZoom() : this.placement.zoom,
      layout: this.placement.layout,
      visible: this.placement.visible,
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  /** The logical width one report asks for, before the height follows the aspect ratio. */
  private logicalWidth(): number {
    const bounds = this.placement.bounds
    if (bounds === null) return DEFAULT_DESKTOP_BROWSER_VIEWPORT.width
    if (this.placement.layout === 'desktop') return DESKTOP_BROWSER_LAYOUT_WIDTH
    return Math.max(1, Math.round(bounds.width / this.placement.zoom))
  }

  /** Zoom label for the desktop layout: how much the 1280-pixel page is scaled. */
  private desktopZoom(): number {
    const bounds = this.placement.bounds
    if (bounds === null || bounds.width < 1) return 1
    return Math.round((bounds.width / DESKTOP_BROWSER_LAYOUT_WIDTH) * 100) / 100
  }

  /** The zoom factor the native view is set to, so the page matches the logical viewport. */
  private nativeZoom(): number {
    const bounds = this.placement.bounds
    if (bounds === null || bounds.width < 1) return 1
    return bounds.width / this.logicalWidth()
  }

  /** The logical CSS viewport implied by the last reported rectangle and layout. */
  private logicalViewport(): { width: number; height: number } {
    const bounds = this.placement.bounds
    if (bounds === null || bounds.width < 1 || bounds.height < 1) return { ...DEFAULT_DESKTOP_BROWSER_VIEWPORT }
    const width = this.logicalWidth()
    return { width, height: Math.max(1, Math.round(bounds.height * width / bounds.width)) }
  }

  /**
   * Open one tab and make it active.
   * @param url - address to load, or `about:blank` for an empty tab.
   * @returns the new tab id.
   */
  async openTab(url = 'about:blank'): Promise<string> {
    if (this.disposed) throw new Error(`${DESKTOP_BROWSER_UNAVAILABLE}: this Session's browser is closed`)
    if (this.tabs.length >= DESKTOP_BROWSER_TAB_LIMIT_COUNT) {
      throw new Error(`${DESKTOP_BROWSER_TAB_LIMIT}: a Session keeps at most ${String(DESKTOP_BROWSER_TAB_LIMIT_COUNT)} tabs`)
    }
    const id = `tab-${String(++this.sequence)}`
    const page = new DesktopBrowserPage({
      service: this.options.service,
      // The native surface indexes guest views by id alone, so the view id
      // carries the Session owner while the tab id stays Session-local.
      viewId: `${this.owner}:${id}`,
      owner: this.owner,
      ...(this.options.allowOrigins === undefined ? {} : { allowOrigins: this.options.allowOrigins }),
      report: message => { this.options.report?.(message) },
      onChange: () => { this.changed() },
      // The guest view needs its rectangle before the first protocol command,
      // so the new tab is placed while it is still opening.
      onViewCreated: async () => { await this.placeAll() },
    })
    const entry: TabEntry = { id, page, unsubscribe: () => {} }
    const unsubscribe = page.onEvent(event => { this.pageEvent(entry, event) })
    this.tabs.push(entry)
    // The new tab is active while it opens, so the placement hook can give its
    // view a rectangle; a failed open restores whatever was active before.
    const previous = this.active
    this.active = entry
    try {
      await page.open(url)
    } catch (cause) {
      unsubscribe()
      await page.close().catch(() => {})
      const index = this.tabs.indexOf(entry)
      if (index >= 0) this.tabs.splice(index, 1)
      this.active = previous
      const message = cause instanceof Error ? cause.message : String(cause)
      this.error = message.startsWith('BROWSER_') ? message.split(':')[0]! : DESKTOP_BROWSER_UNAVAILABLE
      this.options.report?.(`desktop browser could not open a tab: ${message}`)
      this.changed()
      throw cause
    }
    entry.unsubscribe = unsubscribe
    this.error = undefined
    await this.placeAll()
    await this.refreshNavigation()
    this.changed()
    return id
  }

  /**
   * Close one tab, or the active tab when no id is given.
   * @param id - tab id from a previous state answer.
   */
  async closeTab(id?: string): Promise<void> {
    const entry = id === undefined ? this.active : this.tabs.find(tab => tab.id === id)
    if (entry === undefined) {
      if (id !== undefined) throw new Error(`${DESKTOP_BROWSER_UNKNOWN_TAB}: ${id}`)
      return
    }
    const index = this.tabs.indexOf(entry)
    if (index >= 0) this.tabs.splice(index, 1)
    entry.unsubscribe()
    await entry.page.close().catch((cause: unknown) => {
      this.options.report?.(`desktop browser could not close ${entry.id}: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
    if (this.active === entry) {
      this.active = this.tabs[Math.min(Math.max(index, 0), this.tabs.length - 1)]
    }
    await this.placeAll()
    await this.refreshNavigation()
    this.changed()
  }

  /**
   * Make one existing tab active.
   * @param id - tab id from a previous state answer.
   */
  async selectTab(id: string): Promise<void> {
    const entry = this.tabs.find(tab => tab.id === id)
    if (entry === undefined) throw new Error(`${DESKTOP_BROWSER_UNKNOWN_TAB}: ${id}`)
    this.active = entry
    await this.placeAll()
    await this.refreshNavigation()
    this.changed()
  }

  /** Place every tab: the active one at the reported rectangle, the rest hidden. */
  private async placeAll(): Promise<void> {
    const zoom = this.nativeZoom()
    for (const tab of this.tabs) {
      const isActive = tab.id === this.active?.id
      const bounds = isActive ? this.placement.bounds : null
      const visible = isActive && this.placement.visible && this.placement.bounds !== null
      await tab.page.place(bounds, zoom, visible).catch((cause: unknown) => {
        this.options.report?.(`desktop browser could not place ${tab.id}: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
    }
  }

  /**
   * Report one placement update coming from the panel.
   * @param bounds - placeholder rectangle in renderer CSS pixels, or `null`.
   * @param viewport - zoom, layout, and visibility the panel asks for.
   */
  async setViewport(
    bounds: DesktopBrowserRect | null,
    viewport: { zoom?: number; layout?: DesktopBrowserLayout; visible?: boolean } = {},
  ): Promise<void> {
    const zoom = viewport.zoom ?? this.placement.zoom
    this.placement = {
      bounds,
      zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
      layout: viewport.layout ?? this.placement.layout,
      visible: bounds === null ? false : viewport.visible ?? this.placement.visible,
    }
    await this.placeAll()
    this.changed()
  }

  /** Ask the native layer to focus the active guest view. */
  async focus(): Promise<void> {
    await this.active?.page.focus()
  }

  /** Forward one page event to state listeners. */
  private pageEvent(entry: TabEntry, event: DesktopBrowserPageEvent): void {
    if (event.type === 'window-open') {
      // A site-opened window becomes another tab of the same Session, which is
      // what a desktop browser does with a target=_blank link.
      void this.openTab(event.url).catch((cause: unknown) => {
        this.options.report?.(`desktop browser refused a popup: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
      return
    }
    if (event.type === 'closed' && this.tabs.includes(entry)) {
      void this.closeTab(entry.id).catch(() => {})
      return
    }
    this.changed()
  }

  /** Notify the panel channel, containing every listener failure. */
  private changed(): void {
    try {
      this.options.onState?.(this.state)
    } catch (cause) {
      this.options.report?.(`desktop browser state listener failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  /** Whether a mutating action is allowed for the owning Session. */
  private assertWritable(): void {
    if (this.options.readOnly?.() === true) {
      throw new Error(`${DESKTOP_BROWSER_READ_ONLY}: this Session cannot change the page`)
    }
  }

  /** Require an active tab for a page-scoped action. */
  private requireActive(): DesktopBrowserPage {
    const page = this.active?.page
    if (page === undefined) throw new Error(`${DESKTOP_BROWSER_NO_TAB}: open a tab first`)
    return page
  }

  /** Console lines of the active tab above one sequence cursor. */
  consoleSince(since = 0): readonly DesktopBrowserConsoleLine[] {
    const active = this.active
    if (active === undefined) return []
    return active.page.console.filter(entry => entry.seq > since).map(entry => ({ ...entry, tabId: active.id }))
  }

  /** Visited pages of the active tab, newest first. */
  history(): readonly DesktopBrowserHistoryEntry[] {
    return this.active?.page.visits ?? []
  }

  /**
   * Run one panel or service action.
   * @param action - validated action payload.
   * @returns the resulting state together with action-specific payloads.
   */
  async run(action: DesktopBrowserAction): Promise<DesktopBrowserActionResult> {
    switch (action.action) {
      case 'state':
        return { state: this.state }
      case 'history':
        return { state: this.state, history: this.history() }
      case 'console':
        return { state: this.state, console: this.consoleSince(action.since ?? 0) }
      case 'tabs':
        return await this.runTabs(action)
      case 'navigate':
        this.assertWritable()
        await this.requireActive().goto(action.url)
        await this.refreshNavigation()
        return { state: this.state }
      case 'back':
      case 'forward': {
        this.assertWritable()
        await this.requireActive().historyStep(action.action === 'back' ? -1 : 1)
        await this.refreshNavigation()
        return { state: this.state }
      }
      case 'reload':
        this.assertWritable()
        await this.requireActive().reload()
        await this.refreshNavigation()
        return { state: this.state }
      case 'stop':
        await this.cdpActive('Page.stopLoading')
        return { state: this.state }
      case 'viewport':
        await this.setViewport(action.bounds, {
          ...(action.zoom === undefined ? {} : { zoom: action.zoom }),
          ...(action.layout === undefined ? {} : { layout: action.layout }),
          ...(action.visible === undefined ? {} : { visible: action.visible }),
        })
        return { state: this.state }
      case 'focus':
        await this.focus()
        return { state: this.state }
      case 'move':
        this.assertWritable()
        await this.requireActive().move(action.x, action.y)
        return { state: this.state }
      case 'click':
        this.assertWritable()
        await this.requireActive().click(action.x, action.y)
        return { state: this.state }
      case 'type':
        this.assertWritable()
        await this.requireActive().insertText(action.text)
        return { state: this.state }
      case 'press':
        this.assertWritable()
        await this.requireActive().press(action.key)
        return { state: this.state }
      case 'scroll':
        this.assertWritable()
        await this.requireActive().scroll(action.deltaY, action.deltaX ?? 0)
        return { state: this.state }
      default: {
        const unknown = action as { readonly action?: unknown }
        throw new Error(`${DESKTOP_BROWSER_INVALID_ACTION}: ${String(unknown.action)}`)
      }
    }
  }

  /** The tab branch of the action surface. */
  private async runTabs(action: { readonly op?: 'list' | 'new' | 'select' | 'close'; readonly tab?: string; readonly url?: string }): Promise<DesktopBrowserActionResult> {
    const op = action.op ?? 'list'
    if (op !== 'list') this.assertWritable()
    if (op === 'list') return { state: this.state }
    if (op === 'new') {
      await this.openTab(action.url ?? 'about:blank')
      return { state: this.state }
    }
    if (action.tab === undefined) throw new Error(`${DESKTOP_BROWSER_UNKNOWN_TAB}: ${op} needs a tab id`)
    if (op === 'select') await this.selectTab(action.tab)
    else await this.closeTab(action.tab)
    return { state: this.state }
  }

  /** Run one CDP command on the active tab, if it has one. */
  private async cdpActive(method: string, params?: unknown): Promise<unknown> {
    return await this.requireActive().command(method, params)
  }

  /** Re-read the active tab's own history so back and forward stay honest. */
  private async refreshNavigation(): Promise<void> {
    const page = this.active?.page
    if (page === undefined) {
      this.navigation = { entries: 0, index: 0 }
      return
    }
    try {
      const history = await page.navigationHistory()
      this.navigation = { entries: history.entries.length, index: history.index }
    } catch (cause) {
      this.options.report?.(`desktop browser could not read navigation state: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  /**
   * Serialize one work item behind every previously issued action, so two panel
   * clicks or an Agent call never interleave on the same guest view.
   * @param work - operation to run once its predecessors settle.
   * @returns the operation's own result.
   */
  queue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work)
    this.serial = next.then(() => undefined, () => undefined)
    return next
  }

  /** Bounded page text of the active tab, for the Agent's `visible_text`. */
  async visibleText(): Promise<string> {
    return await this.requireActive().visibleText()
  }

  /** Bounded HTML of the active tab. */
  async pageContent(): Promise<string> {
    return await this.requireActive().content()
  }

  /** Redact one long answer, exposed for the Agent tool. */
  static redact(input: string): string {
    return redactText(input)
  }

  /** Close every tab and release every guest view of this Session. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const entries = [...this.tabs]
    this.tabs.length = 0
    this.active = undefined
    for (const entry of entries) {
      entry.unsubscribe()
      await entry.page.close().catch(() => {})
    }
    await this.options.service.closeOwner(this.owner).catch((cause: unknown) => {
      this.options.report?.(`desktop browser could not release its views: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
    this.changed()
  }
}
