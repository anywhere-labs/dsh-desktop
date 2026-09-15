/**
 * Behaviour tests for one Session's Desktop browser tabs.
 *
 * The store owns placement, the tab list, and the JSON action surface. It is
 * exercised over a scripted native guest-view service, so the assertions read
 * the same visibility, zoom, and navigation records the Desktop shell would
 * apply, without Electron or a real page.
 */

import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopNativeBrowser,
  DesktopNativeBrowserEvent,
  DesktopNativeBrowserViewOptions,
} from '../src/browser-view-service.ts'
import {
  BROWSER_CDP_TIMEOUT,
  DESKTOP_BROWSER_CDP_STALL,
  type DesktopBrowserRect,
} from '../src/desktop-browser-page.ts'
import {
  DESKTOP_BROWSER_TAB_LIMIT_COUNT,
  DesktopBrowserStore,
  type DesktopBrowserAction,
} from '../src/desktop-browser-session.ts'

/** Guest view id the store registers for one Session-local tab id. */
function viewId(tabId: string, sessionId = 'session-a'): string {
  return `desktop-browser:${sessionId}:${tabId}`
}

/** One CDP command the store issued against a guest view. */
interface NativeCommand {
  readonly method: string
  readonly params: unknown
}

/** One history entry of a guest view. */
interface HistoryEntry {
  readonly id: number
  readonly url: string
  readonly title: string
}

/** Everything the double remembers about one guest view. */
interface GuestView {
  readonly id: string
  readonly owner: string
  readonly bounds: DesktopBrowserRect[]
  readonly zooms: number[]
  readonly shown: boolean[]
  readonly navigations: string[]
  readonly steps: number[]
  readonly commands: NativeCommand[]
  readonly entries: HistoryEntry[]
  index: number
  focused: number
  closed: number
  released: boolean
}

/**
 * Scripted stand-in for the shell's native guest-view service.
 *
 * Every view keeps its own navigation history, so the store's back and forward
 * answers come from the same protocol calls Chromium would serve.
 */
class ScriptedNativeBrowser implements DesktopNativeBrowser {
  readonly version = 1 as const
  readonly views = new Map<string, GuestView>()
  readonly closedOwners: string[] = []
  /** Every native call in issue order, so relative order stays assertable. */
  readonly journal: string[] = []
  /** CDP methods that never answer, so a stalled renderer can be scripted. */
  readonly stalled = new Set<string>()
  /** Failure `createView` raises; set to script a shell that cannot host a view. */
  failCreate: Error | undefined = undefined
  private readonly listeners = new Set<(event: DesktopNativeBrowserEvent) => void>()

  /** @inheritdoc */
  async createView(options: DesktopNativeBrowserViewOptions): Promise<{ id: string }> {
    if (this.failCreate !== undefined) throw this.failCreate
    this.journal.push(`create ${options.id}`)
    this.views.set(options.id, {
      id: options.id,
      owner: options.owner,
      bounds: [],
      zooms: [],
      shown: [],
      navigations: [],
      steps: [],
      commands: [],
      entries: [{ id: 1, url: 'about:blank', title: '' }],
      index: 0,
      focused: 0,
      closed: 0,
      released: false,
    })
    return { id: options.id }
  }

  /** @inheritdoc */
  async setBounds(id: string, bounds: DesktopBrowserRect): Promise<void> {
    this.journal.push(`bounds ${id}`)
    this.view(id).bounds.push(bounds)
  }

  /** @inheritdoc */
  async setZoom(id: string, factor: number): Promise<void> {
    this.journal.push(`zoom ${id} ${String(factor)}`)
    this.view(id).zooms.push(factor)
  }

  /** @inheritdoc */
  async setVisible(id: string, visible: boolean): Promise<void> {
    this.journal.push(`visible ${id} ${String(visible)}`)
    this.view(id).shown.push(visible)
  }

  /** @inheritdoc */
  async focus(id: string): Promise<void> {
    this.journal.push(`focus ${id}`)
    this.view(id).focused += 1
  }

  /** @inheritdoc */
  async navigate(id: string, url: string): Promise<void> {
    const view = this.view(id)
    this.journal.push(`navigate ${id} ${url}`)
    view.navigations.push(url)
    const current = view.entries[view.index]
    if (current?.url !== url) {
      view.entries.push({ id: view.entries.length + 1, url, title: '' })
      view.index = view.entries.length - 1
    }
    this.emit({ type: 'navigated', id, url })
  }

  /** @inheritdoc */
  async close(id: string): Promise<void> {
    const view = this.views.get(id)
    // Releasing a view twice is a no-op, exactly as the native service behaves.
    if (view === undefined || view.released) return
    this.journal.push(`close ${id}`)
    view.released = true
    view.closed += 1
    this.emit({ type: 'closed', id, reason: 'closed' })
  }

  /** @inheritdoc */
  async closeOwner(owner: string): Promise<void> {
    this.closedOwners.push(owner)
    this.journal.push(`closeOwner ${owner}`)
    for (const view of [...this.views.values()]) {
      if (view.owner === owner && !view.released) await this.close(view.id)
    }
  }

  /** @inheritdoc */
  async command(id: string, method: string, params?: unknown): Promise<unknown> {
    const view = this.view(id)
    view.commands.push({ method, params })
    this.journal.push(`command ${id} ${method}`)
    if (this.stalled.has(method)) return await new Promise<never>(() => {})
    if (method === 'Page.getNavigationHistory') {
      return { currentIndex: view.index, entries: view.entries.map(entry => ({ ...entry })) }
    }
    if (method === 'Page.navigateToHistoryEntry') {
      const entryId = (params as { entryId?: number } | undefined)?.entryId ?? 0
      const index = view.entries.findIndex(entry => entry.id === entryId)
      if (index >= 0) {
        view.index = index
        view.steps.push(entryId)
        this.emit({ type: 'navigated', id, url: view.entries[index]!.url })
      }
      return {}
    }
    return {}
  }

  /** @inheritdoc */
  subscribe(listener: (event: DesktopNativeBrowserEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Deliver one guest event to every current subscriber. */
  emit(event: DesktopNativeBrowserEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  /** Parameters of every call to one CDP method on one view. */
  params(id: string, method: string): unknown[] {
    return (this.views.get(id)?.commands ?? []).filter(command => command.method === method)
      .map(command => command.params)
  }

  /** Require a live view, so a released view cannot be driven silently. */
  private view(id: string): GuestView {
    const view = this.views.get(id)
    if (view === undefined) throw new Error(`BROWSER_VIEW_UNKNOWN: ${id}`)
    return view
  }
}

interface StoreHarness {
  readonly native: ScriptedNativeBrowser
  readonly store: DesktopBrowserStore
  readonly report: ReturnType<typeof vi.fn>
  readonly onState: ReturnType<typeof vi.fn>
}

/** One store over a scripted shell, with its reported failures and states. */
function createStore(options: {
  readOnly?: () => boolean
  sessionId?: string
  native?: ScriptedNativeBrowser
} = {}): StoreHarness {
  const native = options.native ?? new ScriptedNativeBrowser()
  const report = vi.fn()
  const onState = vi.fn()
  const store = new DesktopBrowserStore(options.sessionId ?? 'session-a', {
    service: native,
    readOnly: options.readOnly ?? (() => false),
    report,
    onState,
  })
  return { native, store, report, onState }
}

/** Drain queued microtasks and one macrotask turn, for fire-and-forget work. */
async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

describe('Desktop browser Session store', () => {
  it('opens numbered tabs and reports the tab list, active id, and viewport', async () => {
    const { native, store, onState } = createStore()
    expect(store.sessionId).toBe('session-a')
    expect(store.isDisposed).toBe(false)
    expect(store.activeId).toBeNull()
    expect(store.state).toEqual({
      tabs: [],
      activeId: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      viewport: { width: 1280, height: 800 },
      bounds: null,
      zoom: 1,
      layout: 'fit',
      visible: false,
    })

    await expect(store.openTab()).resolves.toBe('tab-1')
    await expect(store.openTab('https://example.com/')).resolves.toBe('tab-2')

    expect(store.tabIds).toEqual(['tab-1', 'tab-2'])
    expect(store.activeId).toBe('tab-2')
    expect(store.address).toBe('https://example.com/')
    expect(store.state).toEqual({
      tabs: [
        { id: 'tab-1', title: '', url: 'about:blank', loading: false, active: false },
        { id: 'tab-2', title: '', url: 'https://example.com/', loading: false, active: true },
      ],
      activeId: 'tab-2',
      loading: false,
      canGoBack: true,
      canGoForward: false,
      viewport: { width: 1280, height: 800 },
      bounds: null,
      zoom: 1,
      layout: 'fit',
      visible: false,
    })
    expect([...native.views.values()].map(view => view.owner))
      .toEqual(['desktop-browser:session-a', 'desktop-browser:session-a'])
    expect(onState).toHaveBeenCalled()
  })

  it('derives the logical viewport from the rectangle, zoom, and layout', async () => {
    const { native, store } = createStore()
    await store.openTab()
    const bounds = { x: 0, y: 0, width: 640, height: 480 }

    await store.setViewport(bounds, { zoom: 0.5, visible: true })

    expect(store.state).toMatchObject({
      viewport: { width: 1280, height: 960 },
      bounds,
      zoom: 0.5,
      layout: 'fit',
      visible: true,
    })
    expect(native.views.get(viewId('tab-1'))?.bounds.at(-1)).toEqual(bounds)
    expect(native.views.get(viewId('tab-1'))?.zooms.at(-1)).toBe(0.5)
    expect(native.views.get(viewId('tab-1'))?.shown.at(-1)).toBe(true)

    // An omitted option keeps the previous placement.
    await store.setViewport(bounds)
    expect(store.state).toMatchObject({ zoom: 0.5, visible: true })

    const desktop = { x: 10, y: 20, width: 900, height: 600 }
    await store.setViewport(desktop, { layout: 'desktop' })
    expect(store.state.viewport).toEqual({ width: 1280, height: 853 })
    expect(store.state.zoom).toBe(0.7)
    expect(native.views.get(viewId('tab-1'))?.zooms.at(-1)).toBe(900 / 1280)

    // A zoom outside the factor range falls back to 1 in the fit layout.
    await store.setViewport(desktop, { zoom: 0, layout: 'fit' })
    expect(store.state.viewport).toEqual({ width: 900, height: 600 })
    expect(store.state.zoom).toBe(1)
  })

  it('hides inactive tabs and everything when the rectangle goes away', async () => {
    const { native, store } = createStore()
    await store.openTab()
    await store.openTab()
    const bounds = { x: 0, y: 0, width: 800, height: 600 }

    await store.setViewport(bounds, { visible: true })
    expect(native.views.get(viewId('tab-1'))?.shown.at(-1)).toBe(false)
    expect(native.views.get(viewId('tab-2'))?.shown.at(-1)).toBe(true)
    expect(native.views.get(viewId('tab-2'))?.bounds.at(-1)).toEqual(bounds)

    await store.selectTab('tab-1')
    expect(native.views.get(viewId('tab-1'))?.shown.at(-1)).toBe(true)
    expect(native.views.get(viewId('tab-2'))?.shown.at(-1)).toBe(false)

    await store.setViewport(null, { visible: true })
    expect(store.state).toMatchObject({ bounds: null, visible: false, viewport: { width: 1280, height: 800 } })
    expect(native.views.get(viewId('tab-1'))?.shown.at(-1)).toBe(false)
    expect(native.views.get(viewId('tab-2'))?.shown.at(-1)).toBe(false)

    await store.setViewport(bounds, { visible: false })
    expect(store.state.visible).toBe(false)
    expect(native.views.get(viewId('tab-1'))?.bounds.at(-1)).toEqual(bounds)
    expect(native.views.get(viewId('tab-1'))?.shown.at(-1)).toBe(false)
  })

  it('closes a tab and re-activates a neighbour', async () => {
    const { native, store } = createStore()
    await store.openTab()
    await store.openTab()
    await store.openTab()
    expect(store.activeId).toBe('tab-3')
    await store.selectTab('tab-2')
    expect(store.activeId).toBe('tab-2')

    await store.closeTab('tab-2')
    expect(store.tabIds).toEqual(['tab-1', 'tab-3'])
    expect(store.activeId).toBe('tab-3')
    expect(native.views.get(viewId('tab-2'))?.closed).toBe(1)

    await store.closeTab('tab-3')
    expect(store.tabIds).toEqual(['tab-1'])
    expect(store.activeId).toBe('tab-1')

    await expect(store.closeTab('tab-9')).rejects.toThrow('BROWSER_UNKNOWN_TAB: tab-9')
    await expect(store.selectTab('tab-9')).rejects.toThrow('BROWSER_UNKNOWN_TAB: tab-9')

    await store.closeTab()
    expect(store.tabIds).toEqual([])
    expect(store.activeId).toBeNull()
    await store.closeTab()
    expect(store.tabIds).toEqual([])
  })

  it('refuses more tabs than the Session limit', async () => {
    const { native, store } = createStore()
    for (let index = 0; index < DESKTOP_BROWSER_TAB_LIMIT_COUNT; index += 1) await store.openTab()

    expect(store.tabIds).toHaveLength(DESKTOP_BROWSER_TAB_LIMIT_COUNT)
    await expect(store.openTab()).rejects.toThrow(/^BROWSER_TAB_LIMIT/u)
    expect(store.tabIds).toHaveLength(DESKTOP_BROWSER_TAB_LIMIT_COUNT)
    expect(native.views.size).toBe(DESKTOP_BROWSER_TAB_LIMIT_COUNT)
  })

  it('runs navigation, history, and console actions against the active tab', async () => {
    const { native, store } = createStore()
    await store.openTab()
    expect((await store.run({ action: 'state' })).state.activeId).toBe('tab-1')

    const first = await store.run({ action: 'navigate', url: 'https://example.com/' })
    expect(first.state.tabs[0]?.url).toBe('https://example.com/')
    expect(first.state).toMatchObject({ canGoBack: true, canGoForward: false })
    await store.run({ action: 'navigate', url: 'https://example.com/next' })
    expect((await store.run({ action: 'history' })).history?.map(entry => entry.url))
      .toEqual(['https://example.com/next', 'https://example.com/'])

    await store.run({ action: 'back' })
    expect(store.address).toBe('https://example.com/')
    expect(store.state).toMatchObject({ canGoBack: true, canGoForward: true })
    expect(native.views.get(viewId('tab-1'))?.steps).toEqual([2])

    await store.run({ action: 'forward' })
    expect(store.address).toBe('https://example.com/next')
    expect(store.state).toMatchObject({ canGoBack: true, canGoForward: false })
    expect(native.views.get(viewId('tab-1'))?.steps).toEqual([2, 3])

    const reloaded = await store.run({ action: 'reload' })
    expect(reloaded.state.tabs[0]?.url).toBe('https://example.com/next')
    expect(native.views.get(viewId('tab-1'))?.navigations).toEqual([
      'about:blank',
      'https://example.com/',
      'https://example.com/next',
      'https://example.com/next',
    ])

    native.emit({
      type: 'cdp',
      id: viewId('tab-1'),
      method: 'Runtime.consoleAPICalled',
      params: { type: 'log', args: [{ value: 'first' }] },
    })
    native.emit({
      type: 'cdp',
      id: viewId('tab-1'),
      method: 'Runtime.consoleAPICalled',
      params: { type: 'warning', args: [{ value: 'second' }] },
    })
    expect((await store.run({ action: 'console' })).console).toEqual([
      { level: 'log', text: 'first', seq: 1, tabId: 'tab-1' },
      { level: 'warning', text: 'second', seq: 2, tabId: 'tab-1' },
    ])
    expect((await store.run({ action: 'console', since: 1 })).console)
      .toEqual([{ level: 'warning', text: 'second', seq: 2, tabId: 'tab-1' }])

    await store.run({ action: 'stop' })
    expect(native.views.get(viewId('tab-1'))?.commands.at(-1)?.method).toBe('Page.stopLoading')
    await store.run({ action: 'focus' })
    expect(native.views.get(viewId('tab-1'))?.focused).toBe(1)
  })

  it('runs pointer, keyboard, viewport, and tab actions', async () => {
    const { native, store } = createStore()
    await store.openTab()
    await store.openTab()

    await store.run({ action: 'move', x: 12, y: 34 })
    await store.run({ action: 'click', x: 5, y: 6 })
    await store.run({ action: 'type', text: 'hello' })
    await store.run({ action: 'press', key: 'Enter' })
    await store.run({ action: 'scroll', deltaY: 200 })

    const active = native.views.get(viewId('tab-2'))
    expect(native.params(viewId('tab-2'), 'Input.insertText')).toEqual([{ text: 'hello' }])
    expect(native.params(viewId('tab-2'), 'Input.dispatchMouseEvent').at(-1)).toMatchObject({
      type: 'mouseWheel',
      deltaY: 200,
      deltaX: 0,
    })
    expect(native.params(viewId('tab-2'), 'Input.dispatchMouseEvent').some((params) => {
      return (params as { type?: string }).type === 'mousePressed'
    })).toBe(true)
    expect(native.params(viewId('tab-2'), 'Input.dispatchKeyEvent').at(-2)).toMatchObject({ type: 'keyDown', key: 'Enter' })
    expect(native.params(viewId('tab-1'), 'Input.insertText')).toEqual([])

    const bounds = { x: 0, y: 0, width: 640, height: 480 }
    const placed = await store.run({ action: 'viewport', bounds, zoom: 0.5, visible: true })
    expect(placed.state).toMatchObject({ bounds, visible: true, viewport: { width: 1280, height: 960 } })

    const listed = await store.run({ action: 'tabs', op: 'list' })
    expect(listed.state.tabs.map(tab => tab.id)).toEqual(['tab-1', 'tab-2'])
    const created = await store.run({ action: 'tabs', op: 'new', url: 'https://example.com/third' })
    expect(created.state.activeId).toBe('tab-3')
    expect(created.state.tabs.map(tab => tab.url))
      .toEqual(['about:blank', 'about:blank', 'https://example.com/third'])
    const selected = await store.run({ action: 'tabs', op: 'select', tab: 'tab-1' })
    expect(selected.state.activeId).toBe('tab-1')
    const closed = await store.run({ action: 'tabs', op: 'close', tab: 'tab-1' })
    expect(closed.state.tabs.map(tab => tab.id)).toEqual(['tab-2', 'tab-3'])
    expect(closed.state.activeId).toBe('tab-2')
    await expect(store.run({ action: 'tabs', op: 'select' })).rejects.toThrow('BROWSER_UNKNOWN_TAB')
    expect(active?.closed).toBe(0)
  })

  it('rejects an action outside the contract and one without a tab', async () => {
    const { store } = createStore()

    await expect(store.run({ action: 'navigate', url: 'https://example.com/' })).rejects.toThrow('BROWSER_NO_TAB')
    await expect(store.run({ action: 'click', x: 1, y: 2 })).rejects.toThrow('BROWSER_NO_TAB')
    await expect(store.run({ action: 'launch' } as unknown as DesktopBrowserAction))
      .rejects.toThrow('BROWSER_INVALID_ACTION: launch')
  })

  it('answers a read-only Session with BROWSER_READ_ONLY for page mutations', async () => {
    const { native, store } = createStore({ readOnly: () => true })
    await store.openTab()

    const mutations: DesktopBrowserAction[] = [
      { action: 'navigate', url: 'https://example.com/' },
      { action: 'back' },
      { action: 'forward' },
      { action: 'reload' },
      { action: 'click', x: 1, y: 2 },
      { action: 'move', x: 1, y: 2 },
      { action: 'type', text: 'text' },
      { action: 'press', key: 'Enter' },
      { action: 'scroll', deltaY: 10 },
      { action: 'tabs', op: 'new' },
      { action: 'tabs', op: 'select', tab: 'tab-1' },
      { action: 'tabs', op: 'close', tab: 'tab-1' },
    ]
    for (const action of mutations) await expect(store.run(action)).rejects.toThrow('BROWSER_READ_ONLY')
    expect(native.views.get(viewId('tab-1'))?.navigations).toEqual(['about:blank'])

    await expect(store.run({ action: 'state' })).resolves.toBeDefined()
    await expect(store.run({ action: 'console' })).resolves.toBeDefined()
    await expect(store.run({ action: 'history' })).resolves.toBeDefined()
    await expect(store.run({ action: 'tabs', op: 'list' })).resolves.toBeDefined()
    // Geometry, focus, and stop stay available: they report or end work rather
    // than changing the document.
    await expect(store.run({ action: 'viewport', bounds: null })).resolves.toBeDefined()
    await expect(store.run({ action: 'focus' })).resolves.toBeDefined()
    await expect(store.run({ action: 'stop' })).resolves.toBeDefined()

    const writable = createStore({ readOnly: () => false })
    await writable.store.openTab()
    await expect(writable.store.run({ action: 'navigate', url: 'https://example.com/' }))
      .resolves.toBeDefined()
  })

  it('serializes overlapping work in arrival order', async () => {
    const { store } = createStore()
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })

    const first = store.queue(async () => {
      order.push('first:start')
      await gate
      order.push('first:end')
      return 'first'
    })
    const second = store.queue(async () => {
      order.push('second')
      return 'second'
    })
    await settle()
    expect(order).toEqual(['first:start'])

    release()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(order).toEqual(['first:start', 'first:end', 'second'])

    await expect(store.queue(async () => { throw new Error('BROWSER_INVALID_ACTION: nope') }))
      .rejects.toThrow('BROWSER_INVALID_ACTION')
    await expect(store.queue(async () => 'after')).resolves.toBe('after')
  })

  it('opens a tab for a window-open event and removes one on close', async () => {
    const { native, store, report } = createStore()
    await store.openTab()

    native.emit({ type: 'window-open', id: viewId('tab-1'), url: 'https://example.com/popup' })
    await settle()
    expect(store.tabIds).toEqual(['tab-1', 'tab-2'])
    expect(store.activeId).toBe('tab-2')
    expect(store.address).toBe('https://example.com/popup')
    expect(native.views.get(viewId('tab-2'))?.owner).toBe('desktop-browser:session-a')

    native.emit({ type: 'closed', id: viewId('tab-2'), reason: 'closed' })
    await settle()
    expect(store.tabIds).toEqual(['tab-1'])
    expect(store.activeId).toBe('tab-1')
    expect(native.views.get(viewId('tab-2'))?.closed).toBe(0)
    expect(report).not.toHaveBeenCalled()

    const full = createStore()
    for (let index = 0; index < DESKTOP_BROWSER_TAB_LIMIT_COUNT; index += 1) await full.store.openTab()
    full.native.emit({ type: 'window-open', id: viewId('tab-1'), url: 'https://example.com/late' })
    await settle()
    expect(full.store.tabIds).toHaveLength(DESKTOP_BROWSER_TAB_LIMIT_COUNT)
    expect(full.report).toHaveBeenCalledWith(expect.stringContaining('refused a popup'))
  })

  it('disposes every view once and rejects later actions', async () => {
    const { native, store, onState } = createStore()
    await store.openTab()
    await store.openTab()

    await store.dispose()
    expect(store.isDisposed).toBe(true)
    expect(store.tabIds).toEqual([])
    expect(store.activeId).toBeNull()
    expect(store.state.tabs).toEqual([])
    expect(native.views.get(viewId('tab-1'))?.closed).toBe(1)
    expect(native.views.get(viewId('tab-2'))?.closed).toBe(1)
    expect(native.closedOwners).toEqual(['desktop-browser:session-a'])

    await store.dispose()
    expect(native.views.get(viewId('tab-1'))?.closed).toBe(1)
    expect(native.closedOwners).toEqual(['desktop-browser:session-a'])
    expect(onState).toHaveBeenCalled()

    await expect(store.openTab()).rejects.toThrow('BROWSER_UNAVAILABLE')
    await expect(store.run({ action: 'navigate', url: 'https://example.com/' })).rejects.toThrow('BROWSER_NO_TAB')
  })

  it('rolls back a tab whose guest view cannot be created', async () => {
    const { native, store, report } = createStore()

    native.failCreate = new Error('BROWSER_VIEW_UNAVAILABLE: no desktop window can host a guest view')
    await expect(store.openTab()).rejects.toThrow('BROWSER_VIEW_UNAVAILABLE')
    expect(store.tabIds).toEqual([])
    expect(store.state.error).toBe('BROWSER_VIEW_UNAVAILABLE')
    expect(report).toHaveBeenCalledWith(expect.stringContaining('could not open a tab'))

    native.failCreate = new Error('the shell vanished')
    await expect(store.openTab()).rejects.toThrow('the shell vanished')
    expect(store.state.error).toBe('BROWSER_UNAVAILABLE')

    native.failCreate = undefined
    // Tab ids are never reused, so the failed attempts keep their numbers.
    await expect(store.openTab()).resolves.toBe('tab-3')
    expect(store.tabIds).toEqual(['tab-3'])
    expect(store.state.error).toBeUndefined()
  })

  it('contains a failing state listener', async () => {
    const native = new ScriptedNativeBrowser()
    const report = vi.fn()
    const store = new DesktopBrowserStore('session-a', {
      service: native,
      report,
      onState: () => { throw new Error('listener failed') },
    })

    await store.openTab()

    expect(report).toHaveBeenCalledWith(expect.stringContaining('desktop browser state listener failed: listener failed'))
  })

  it('keeps two Sessions on separate guest views for the same tab id', async () => {
    const native = new ScriptedNativeBrowser()
    const a = createStore({ native, sessionId: 'session-a' })
    const b = createStore({ native, sessionId: 'session-b' })

    // Both Sessions' first tab is tab-1, and the native surface indexes guest
    // views by id alone, so the view id has to carry its owner.
    await expect(a.store.openTab()).resolves.toBe('tab-1')
    await expect(b.store.openTab()).resolves.toBe('tab-1')
    expect([...native.views.keys()])
      .toEqual(['desktop-browser:session-a:tab-1', 'desktop-browser:session-b:tab-1'])
    expect(native.views.get(viewId('tab-1', 'session-b'))?.owner).toBe('desktop-browser:session-b')

    const before = [...(native.views.get(viewId('tab-1', 'session-b'))?.commands ?? [])]
    await a.store.run({ action: 'navigate', url: 'https://a.example/' })

    // The driven Session loaded its own view, and only its own.
    expect(native.views.get(viewId('tab-1'))?.navigations)
      .toEqual(['about:blank', 'https://a.example/'])
    expect(a.store.address).toBe('https://a.example/')
    expect(native.views.get(viewId('tab-1', 'session-b'))?.navigations).toEqual(['about:blank'])
    expect(native.views.get(viewId('tab-1', 'session-b'))?.commands).toEqual(before)
    expect(b.store.address).toBe('about:blank')

    // The tab ids the panel and the Agent exchange stay Session-local.
    expect(a.store.state.tabs.map(tab => tab.id)).toEqual(['tab-1'])
    expect(b.store.state.tabs.map(tab => tab.id)).toEqual(['tab-1'])
  })

  it('gives a fresh tab one blank document before the requested address', async () => {
    const { native, store } = createStore()

    await store.openTab()
    expect(native.views.get(viewId('tab-1'))?.navigations).toEqual(['about:blank'])
    await store.setViewport({ x: 0, y: 0, width: 640, height: 480 }, { visible: true })
    expect(native.views.get(viewId('tab-1'))?.navigations).toEqual(['about:blank'])

    await store.openTab('https://example.test/')

    // The blank document is what gives the new view a renderer; the address
    // the caller asked for is committed after it, never instead of it.
    expect(native.views.get(viewId('tab-2'))?.navigations)
      .toEqual(['about:blank', 'https://example.test/'])
    expect(native.journal.filter(entry => entry.startsWith(`navigate ${viewId('tab-2')} `))).toEqual([
      `navigate ${viewId('tab-2')} about:blank`,
      `navigate ${viewId('tab-2')} https://example.test/`,
    ])
    expect(store.tabIds).toEqual(['tab-1', 'tab-2'])
    expect(store.activeId).toBe('tab-2')
    expect(store.address).toBe('https://example.test/')
  })

  it('places a fresh tab before its first protocol command', async () => {
    const { native, store } = createStore()
    await store.openTab()
    const bounds = { x: 10, y: 20, width: 640, height: 480 }
    await store.setViewport(bounds, { visible: true })

    await store.openTab()

    const view = viewId('tab-2')
    // A guest view that was never given a rectangle spawns no renderer, so the
    // placement and the blank document both have to precede the protocol.
    const first = native.journal.indexOf(`command ${view} Page.enable`)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(native.journal.indexOf(`bounds ${view}`)).toBeLessThan(first)
    expect(native.journal.indexOf(`visible ${view} true`)).toBeLessThan(first)
    expect(native.journal.indexOf(`navigate ${view} about:blank`)).toBeLessThan(first)
    expect(native.views.get(view)?.bounds.at(-1)).toEqual(bounds)
    expect(native.views.get(view)?.shown.at(-1)).toBe(true)
    expect(native.views.get(viewId('tab-1'))?.shown.at(-1)).toBe(false)
  })

  it('rejects a stalled command at its budget and keeps the queue moving', async () => {
    const { native, store } = createStore()
    await store.openTab()
    native.stalled.add('Page.stopLoading')

    vi.useFakeTimers()
    try {
      const stalled = store.queue(async () => await store.run({ action: 'stop' }))
      const rejected = expect(stalled).rejects.toThrow(
        `${DESKTOP_BROWSER_CDP_STALL}: Page.stopLoading did not answer within ${String(BROWSER_CDP_TIMEOUT)}ms`,
      )
      await vi.advanceTimersByTimeAsync(BROWSER_CDP_TIMEOUT)
      await rejected
    } finally {
      vi.useRealTimers()
    }

    // The command that never answered no longer holds the Session's queue.
    const answered = await store.queue(async () => await store.run({ action: 'state' }))
    expect(answered.state.activeId).toBe('tab-1')
    await store.queue(async () => await store.run({ action: 'focus' }))
    expect(native.views.get(viewId('tab-1'))?.focused).toBe(1)
  })
})
