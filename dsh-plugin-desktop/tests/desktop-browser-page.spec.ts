// @vitest-environment jsdom
/**
 * Behaviour tests for one Desktop guest page.
 *
 * Electron never loads here. A scripted `DesktopNativeBrowser` double records
 * every native call, answers CDP commands from canned results, and delivers
 * guest events on demand, so navigation policy, placement, pointer and
 * keyboard input, bounded reads, and teardown are observed through the same
 * interface the Desktop shell implements.
 */

import { describe, expect, it, vi } from 'vitest'
import { isAllowedBrowserViewCdpMethod } from '../src/browser-view-cdp.ts'
import type {
  DesktopNativeBrowser,
  DesktopNativeBrowserEvent,
  DesktopNativeBrowserViewOptions,
} from '../src/browser-view-service.ts'
import {
  BROWSER_CDP_TIMEOUT,
  BROWSER_NAVIGATION_TIMEOUT,
  DEFAULT_DESKTOP_BROWSER_VIEWPORT,
  DESKTOP_BROWSER_CDP_STALL,
  DesktopBrowserPage,
  describeLocator,
  elementExpression,
  keyDescriptor,
  parsePress,
  redactText,
  renderAccessibilityTree,
  type DesktopBrowserPageEvent,
  type DesktopBrowserRect,
} from '../src/desktop-browser-page.ts'

/** One CDP command the page issued against a guest view. */
interface NativeCommand {
  readonly method: string
  readonly params: unknown
}

/** Everything the double remembers about one guest view. */
interface GuestView {
  readonly id: string
  readonly owner: string
  readonly allowOrigins: readonly string[] | undefined
  readonly commands: NativeCommand[]
  readonly bounds: DesktopBrowserRect[]
  readonly zooms: number[]
  readonly shown: boolean[]
  readonly navigations: string[]
  focused: number
  closed: number
  readonly entries: Array<{ id: number; url: string; title: string }>
  index: number
}

/**
 * Scripted stand-in for the shell's native guest-view service.
 *
 * Canned CDP answers cover the methods the page issues; `answers` overrides one
 * method wholesale and `failures` makes it reject, which is how the failure
 * branches of the page are reached without Electron.
 */
class ScriptedNativeBrowser implements DesktopNativeBrowser {
  readonly version = 1 as const
  readonly views = new Map<string, GuestView>()
  readonly created: DesktopNativeBrowserViewOptions[] = []
  readonly answers = new Map<string, unknown>()
  readonly failures = new Map<string, Error>()
  /** Every native call in issue order, so relative order stays assertable. */
  readonly journal: string[] = []
  /** CDP methods that never answer, so a stalled renderer can be scripted. */
  readonly stalled = new Set<string>()
  /** CDP methods that stall once and then answer, so a retry stays observable. */
  readonly stallOnce = new Set<string>()
  /** Box reported once the page has been scrolled, for a target the page reveals late. */
  boxAfterScroll: DesktopBrowserRect | null | undefined = undefined
  /** Answer of the candidate-name query that reports a locator miss. */
  candidates: { names: readonly string[]; similar: readonly string[] } = { names: [], similar: [] }
  /** Replaces the automatic `navigated` event; `undefined` lands the address. */
  navigateHook: ((view: GuestView, url: string) => void) | undefined = undefined
  /** Answer for `document.body.innerText`. */
  innerText = 'Visible page text'
  /** Answer for `document.documentElement.outerHTML`. */
  html = '<html><body>Example</body></html>'
  /** Links the layout query returns. */
  links: readonly { text: string; href: string }[] = [{ text: 'Example', href: 'https://example.com/' }]
  /** Layout report the layout query returns. */
  layout: unknown = {
    viewport: { width: 1024, height: 768, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0, width: 1024, height: 2000 },
    body: { x: 0, y: 0, width: 1024, height: 2000 },
    headings: [{ tag: 'H1', text: 'Example' }],
  }
  /** Object id `Runtime.evaluate` hands back for an element expression. */
  objectId: string | undefined = 'remote-1'
  /** Text the element reports back after a fill; the last insertion by default. */
  holdOverride: string | undefined = undefined
  /** Whether the resolved element reports itself as null. */
  nullObject = false
  /** Rectangle `getBoundingClientRect` reports, or `null` for a flat element. */
  box: DesktopBrowserRect | null = { x: 10, y: 20, width: 100, height: 40 }
  /** Failure `createView` raises; set to script a shell that cannot host a view. */
  failCreate: Error | undefined = undefined
  private readonly listeners = new Set<(event: DesktopNativeBrowserEvent) => void>()
  /** Whether the shell was asked to scroll a matched element into view. */
  private scrolled = false

  /** Number of live event subscribers, so teardown can be observed. */
  get subscriptions(): number { return this.listeners.size }

  /** @inheritdoc */
  async createView(options: DesktopNativeBrowserViewOptions): Promise<{ id: string }> {
    if (this.failCreate !== undefined) throw this.failCreate
    this.created.push(options)
    this.journal.push(`create ${options.id}`)
    this.views.set(options.id, {
      id: options.id,
      owner: options.owner,
      allowOrigins: options.allowOrigins,
      commands: [],
      bounds: [],
      zooms: [],
      shown: [],
      navigations: [],
      focused: 0,
      closed: 0,
      entries: [{ id: 1, url: 'about:blank', title: '' }],
      index: 0,
    })
    return { id: options.id }
  }

  /** @inheritdoc */
  async setBounds(id: string, bounds: DesktopBrowserRect): Promise<void> {
    const view = this.view(id)
    this.journal.push(`bounds ${id}`)
    view.bounds.push(bounds)
  }

  /** @inheritdoc */
  async setZoom(id: string, factor: number): Promise<void> {
    const view = this.view(id)
    this.journal.push(`zoom ${id} ${String(factor)}`)
    view.zooms.push(factor)
  }

  /** @inheritdoc */
  async setVisible(id: string, visible: boolean): Promise<void> {
    const view = this.view(id)
    this.journal.push(`visible ${id} ${String(visible)}`)
    view.shown.push(visible)
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
    if (this.navigateHook !== undefined) {
      this.navigateHook(view, url)
      return
    }
    this.land(view, url)
  }

  /** @inheritdoc */
  async close(id: string): Promise<void> {
    const view = this.view(id)
    this.journal.push(`close ${id}`)
    view.closed += 1
    this.emit({ type: 'closed', id, reason: 'closed' })
  }

  /** @inheritdoc */
  async closeOwner(owner: string): Promise<void> {
    this.journal.push(`closeOwner ${owner}`)
    for (const view of [...this.views.values()]) if (view.owner === owner) await this.close(view.id)
  }

  /** @inheritdoc */
  async command(id: string, method: string, params?: unknown): Promise<unknown> {
    const view = this.view(id)
    view.commands.push({ method, params })
    this.journal.push(`command ${id} ${method}`)
    if (this.stalled.has(method)) return await new Promise<never>(() => {})
    if (this.stallOnce.delete(method)) return await new Promise<never>(() => {})
    const failure = this.failures.get(method)
    if (failure !== undefined) throw failure
    if (this.answers.has(method)) return this.answers.get(method)
    return this.canned(method, params)
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

  /** CDP method names one view was asked for, in order. */
  methods(id: string): string[] {
    return (this.views.get(id)?.commands ?? []).map(command => command.method)
  }

  /** Parameters of every call to one CDP method on one view. */
  params(id: string, method: string): unknown[] {
    return (this.views.get(id)?.commands ?? []).filter(command => command.method === method)
      .map(command => command.params)
  }

  /** Record one document in a view's own history and report the navigation. */
  private land(view: GuestView, url: string): void {
    const current = view.entries[view.index]
    if (current?.url !== url) {
      view.entries.push({ id: view.entries.length + 1, url, title: '' })
      view.index = view.entries.length - 1
    }
    this.emit({ type: 'navigated', id: view.id, url })
  }

  /** The canned CDP answer of one method, keyed by the page's own call shape. */
  private canned(method: string, params: unknown): unknown {
    switch (method) {
      case 'Runtime.evaluate':
        return this.evaluate(String((params as { expression?: unknown } | undefined)?.expression ?? ''))
      case 'Runtime.callFunctionOn':
        return this.callFunction(params)
      case 'Page.getNavigationHistory':
        return { currentIndex: 0, entries: [{ id: 1, url: 'about:blank', title: '' }] }
      case 'Page.getLayoutMetrics':
        return { cssLayoutViewport: { clientWidth: 1024, clientHeight: 768 }, contentSize: { width: 2000, height: 3000 } }
      case 'Page.captureScreenshot':
        return { data: 'ZmFrZS1qcGVn' }
      case 'Accessibility.getFullAXTree':
        return { nodes: [] }
      case 'Page.navigateToHistoryEntry':
        return {}
      default:
        return {}
    }
  }

  /** The canned by-value answer of one evaluated expression. */
  private evaluate(expression: string): unknown {
    if (expression === 'document.title') return { result: { type: 'string', value: 'Example Domain' } }
    if (expression.includes('document.body.innerText')) return { result: { type: 'string', value: this.innerText } }
    if (expression.includes('documentElement.outerHTML')) return { result: { type: 'string', value: this.html } }
    if (expression.includes("querySelectorAll('a[href]')")) return { result: { value: this.links } }
    if (expression.includes('window.innerWidth')) return { result: { value: this.layout } }
    if (expression.includes('similar: names')) return { result: { value: this.candidates } }
    if (this.objectId === undefined) return { result: {} }
    return { result: { objectId: this.objectId } }
  }

  /** The canned answer of one `Runtime.callFunctionOn` invocation. */
  private callFunction(params: unknown): unknown {
    const declaration = String((params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration ?? '')
    if (declaration.includes('this === null')) return { result: { value: this.nullObject } }
    if (declaration.includes('innerText')) {
      const typed = this.params('tab-1', 'Input.insertText').at(-1) as { text?: string } | undefined
      return { result: { value: this.holdOverride ?? typed?.text ?? '' } }
    }
    if (declaration.includes('scrollIntoView')) {
      this.scrolled = true
      return { result: { value: null } }
    }
    if (declaration.includes('getBoundingClientRect')) {
      return { result: { value: this.scrolled && this.boxAfterScroll !== undefined ? this.boxAfterScroll : this.box } }
    }
    return { result: { value: true } }
  }

  /** Require a live view, so a released view cannot be driven silently. */
  private view(id: string): GuestView {
    const view = this.views.get(id)
    if (view === undefined) throw new Error(`BROWSER_VIEW_UNKNOWN: ${id}`)
    return view
  }
}

interface PageHarness {
  readonly native: ScriptedNativeBrowser
  readonly page: DesktopBrowserPage
  readonly report: ReturnType<typeof vi.fn>
  readonly events: DesktopBrowserPageEvent[]
}

/** One page over a fresh scripted shell, with its reported failures and events. */
function createPage(options: { allowOrigins?: readonly string[]; viewId?: string } = {}): PageHarness {
  const native = new ScriptedNativeBrowser()
  const report = vi.fn()
  const events: DesktopBrowserPageEvent[] = []
  const viewId = options.viewId ?? 'tab-1'
  const page = new DesktopBrowserPage({
    service: native,
    viewId,
    owner: 'desktop-browser:session-a',
    ...(options.allowOrigins === undefined ? {} : { allowOrigins: options.allowOrigins }),
    // The owner places the view as soon as it exists; recorded in the same
    // journal so its order against the protocol commands stays observable.
    onViewCreated: () => { native.journal.push(`placed ${viewId}`) },
    report,
  })
  page.onEvent(event => { events.push(event) })
  return { native, page, report, events }
}

/** One accessibility node in the exact shape `Accessibility.getFullAXTree` answers. */
function axNode(
  node: Parameters<typeof renderAccessibilityTree>[0][number],
): Parameters<typeof renderAccessibilityTree>[0][number] {
  return node
}

describe('Desktop guest page', () => {
  it('creates an owner-scoped guest view and enables CDP once', async () => {
    const { native, page } = createPage()

    await page.open()

    expect(native.created).toEqual([{ id: 'tab-1', owner: 'desktop-browser:session-a' }])
    expect(native.methods('tab-1')).toEqual(['Page.enable', 'Runtime.enable'])
    expect(native.views.get('tab-1')?.navigations).toEqual(['about:blank'])
    expect(page.id).toBe('tab-1')
    expect(page.viewOwner).toBe('desktop-browser:session-a')
    expect(page.state).toEqual({
      tabId: 'tab-1',
      url: 'about:blank',
      title: '',
      loading: false,
      frameUrl: 'about:blank',
    })
    expect(page.isClosed).toBe(false)

    await page.command('Page.getLayoutMetrics')
    expect(native.methods('tab-1').filter(method => method === 'Page.enable')).toHaveLength(1)
  })

  it('commits the blank document, and places the view, before the first CDP command', async () => {
    const { native, page } = createPage()

    await page.open('https://example.test/')

    const first = native.journal.indexOf('command tab-1 Page.enable')
    // A view that has never been given a document has no renderer, and the
    // first command sent to one is never answered, so both the placement and
    // the blank document have to land first.
    expect(first).toBeGreaterThanOrEqual(0)
    expect(native.journal.indexOf('placed tab-1')).toBeLessThan(first)
    expect(native.journal.indexOf('navigate tab-1 about:blank')).toBeLessThan(first)
    // The blank document is a precondition of the protocol, not a replacement
    // for the address the caller asked for.
    expect(native.journal.filter(entry => entry.startsWith('navigate tab-1 '))).toEqual([
      'navigate tab-1 about:blank',
      'navigate tab-1 https://example.test/',
    ])
    expect(page.state.url).toBe('https://example.test/')
  })

  it('opens an empty view with exactly one blank document', async () => {
    const { native, page } = createPage()

    await page.open()

    expect(native.views.get('tab-1')?.navigations).toEqual(['about:blank'])
    await page.command('Page.getLayoutMetrics')
    await page.snapshot()
    expect(native.journal.filter(entry => entry.startsWith('navigate tab-1 '))).toEqual(['navigate tab-1 about:blank'])
  })

  it('fails a mutating CDP command that never answers at its own budget', async () => {
    const { native, page } = createPage()
    await page.open()
    native.stalled.add('Input.dispatchMouseEvent')

    vi.useFakeTimers()
    try {
      const pending = page.click(10, 20)
      const rejected = expect(pending).rejects.toThrow(
        `${DESKTOP_BROWSER_CDP_STALL}: Input.dispatchMouseEvent did not answer within ${String(BROWSER_CDP_TIMEOUT)}ms`,
      )
      await vi.advanceTimersByTimeAsync(BROWSER_CDP_TIMEOUT)
      await rejected
    } finally {
      vi.useRealTimers()
    }

    // A click must never be repeated behind the caller's back: one budget, one attempt.
    expect(native.methods('tab-1').filter(method => method === 'Input.dispatchMouseEvent')).toHaveLength(1)
  })

  it('retries one stalled read-only command instead of reporting a busy page', async () => {
    const { native, page } = createPage()
    await page.open()
    native.stallOnce.add('Page.captureScreenshot')

    vi.useFakeTimers()
    try {
      const pending = page.screenshot()
      await vi.advanceTimersByTimeAsync(BROWSER_CDP_TIMEOUT)
      const shot = await pending
      expect(shot).toEqual({ data: 'ZmFrZS1qcGVn', mediaType: 'image/jpeg' })
    } finally {
      vi.useRealTimers()
    }

    expect(native.methods('tab-1').filter(method => method === 'Page.captureScreenshot')).toHaveLength(2)
  })

  it('reports the names the page renders when a locator matches nothing', async () => {
    const { native, page } = createPage()
    await page.open()
    native.objectId = undefined
    native.candidates = { names: ['Search arXiv', 'All fields'], similar: ['Search term or terms'] }

    const failure = await page.fillTarget({ role: 'textbox', name: 'Search term' }, 'self-evolution')
      .then(() => undefined, (cause: unknown) => cause as Error)
    expect(failure?.message).toContain('BROWSER_ELEMENT_NOT_FOUND: no element matched textbox "Search term"')
    expect(failure?.message).toContain('visible textbox names on the page: "Search arXiv", "All fields"')
    expect(failure?.message).toContain('did you mean "Search term or terms"?')
    expect(native.methods('tab-1')).not.toContain('Runtime.callFunctionOn')
  })

  it('scrolls a matched but flat target into view before declaring it invisible', async () => {
    const { native, page } = createPage()
    await page.open()
    native.box = null
    native.boxAfterScroll = { x: 4, y: 8, width: 20, height: 10 }

    await expect(page.clickTarget({ role: 'button', name: 'Continue' })).resolves.toEqual({ x: 14, y: 13, width: 20, height: 10 })
    expect(native.methods('tab-1')).toContain('Input.dispatchMouseEvent')
  })

  it('declares a target that stays flat invisible, and points at the snapshot', async () => {
    const { native, page } = createPage()
    await page.open()
    native.box = null

    await expect(page.clickTarget({ role: 'button', name: 'Continue' })).rejects.toThrow(
      /^BROWSER_ELEMENT_NOT_VISIBLE: button "Continue" exists in the page but carries no visible box/u,
    )
  })

  it('accepts allowlisted http pages and refuses every other address', async () => {
    const { native, page } = createPage({ allowOrigins: ['https://allowed.example'] })
    await page.open()
    expect(native.created[0]?.allowOrigins).toEqual(['https://allowed.example'])

    expect(page.navigationTarget('allowed.example/docs')).toBe('https://allowed.example/docs')
    await expect(page.goto('https://blocked.example/')).rejects.toThrow('BROWSER_ORIGIN_DENIED')
    await expect(page.goto('ftp://allowed.example/file')).rejects.toThrow('BROWSER_HTTP_URL_REQUIRED')
    await expect(page.goto('https://user:secret@allowed.example/')).rejects.toThrow('BROWSER_HTTP_URL_REQUIRED')
    await expect(page.goto('   ')).rejects.toThrow('BROWSER_INVALID_URL')
    expect(native.views.get('tab-1')?.navigations).toEqual(['about:blank'])

    const state = await page.goto('allowed.example/page')
    expect(state.url).toBe('https://allowed.example/page')
    expect(native.views.get('tab-1')?.navigations)
      .toEqual(['about:blank', 'https://allowed.example/page'])

    await expect(page.goto('about:blank')).resolves.toMatchObject({ url: 'about:blank' })
  })

  it('places, zooms, and shows the guest view, and hides it without a rectangle', async () => {
    const { native, page } = createPage()
    await page.open()
    const bounds = { x: 40, y: 80, width: 640, height: 480 }

    await page.place(bounds, 0.5, true)
    const view = native.views.get('tab-1')
    expect(view?.bounds).toEqual([bounds])
    expect(view?.zooms).toEqual([0.5])
    expect(view?.shown).toEqual([true])

    await page.place(null, 0.5, true)
    expect(view?.bounds).toHaveLength(1)
    expect(view?.zooms).toHaveLength(1)
    expect(view?.shown).toEqual([true, false])

    await page.place(bounds, 0, true)
    expect(view?.zooms).toEqual([0.5])
    expect(view?.shown).toEqual([true, false, true])

    await page.focus()
    expect(view?.focused).toBe(1)
  })

  it('moves the pointer and clicks by viewport coordinate', async () => {
    const { native, page } = createPage()
    await page.open()

    await page.move(10.6, 20.4)
    expect(native.params('tab-1', 'Input.dispatchMouseEvent'))
      .toEqual([{ type: 'mouseMoved', x: 11, y: 20, button: 'none', buttons: 0 }])

    await page.click(100, 50)
    expect(native.params('tab-1', 'Input.dispatchMouseEvent')).toEqual([
      { type: 'mouseMoved', x: 11, y: 20, button: 'none', buttons: 0 },
      { type: 'mouseMoved', x: 100, y: 50, button: 'none', buttons: 0 },
      { type: 'mousePressed', x: 100, y: 50, button: 'left', buttons: 1, clickCount: 1 },
      { type: 'mouseReleased', x: 100, y: 50, button: 'left', buttons: 0, clickCount: 1 },
    ])

    await page.click(5, 6, { button: 'right', clickCount: 2 })
    const events = native.params('tab-1', 'Input.dispatchMouseEvent')
    expect(events.at(-2)).toEqual({ type: 'mousePressed', x: 5, y: 6, button: 'right', buttons: 2, clickCount: 2 })
    expect(events.at(-1)).toEqual({ type: 'mouseReleased', x: 5, y: 6, button: 'right', buttons: 0, clickCount: 2 })
  })

  it('clicks a target resolved by selector or by role and name', async () => {
    const { native, page } = createPage()
    await page.open()

    const box = await page.clickElement('#go')
    expect(box).toEqual({ x: 60, y: 40, width: 100, height: 40 })
    // A selector locator resolves through the same helper as a role locator, so a
    // hidden twin of the node never wins over the one on screen.
    const resolved = native.params('tab-1', 'Runtime.evaluate')[0] as { expression: string; returnByValue: boolean }
    expect(resolved.expression).toContain('"#go"')
    expect(resolved.expression).toContain('matches.find(visible)')
    expect(resolved.returnByValue).toBe(false)
    const wheel = native.params('tab-1', 'Input.dispatchMouseEvent').at(-2)
    expect(wheel).toEqual({ type: 'mousePressed', x: 60, y: 40, button: 'left', buttons: 1, clickCount: 1 })

    const locator = { role: 'button', name: 'Sign in' } as const
    await page.clickTarget(locator)
    expect(native.params('tab-1', 'Runtime.evaluate').at(-1))
      .toEqual({ expression: elementExpression(locator), returnByValue: false, awaitPromise: false })

    await expect(page.boundingBox('#go')).resolves.toEqual({ x: 10, y: 20, width: 100, height: 40 })
  })

  it('reports a missing or flat target with a stable code', async () => {
    const { native, page } = createPage()
    await page.open()

    native.objectId = undefined
    await expect(page.fill('#missing', 'text')).rejects.toThrow('BROWSER_ELEMENT_NOT_FOUND')
    await expect(page.boundingBox('#missing')).resolves.toBeUndefined()
    await expect(page.clickElement('#missing')).rejects.toThrow('BROWSER_ELEMENT_NOT_FOUND: no element matched #missing')

    native.objectId = 'remote-1'
    native.nullObject = true
    await expect(page.boundingBox('#gone')).resolves.toBeUndefined()
    // A locator that resolves to nothing is a miss, not an invisible element:
    // the Agent is told which names the page does render instead.
    await expect(page.clickTarget({ role: 'button', name: 'Sign in' }))
      .rejects.toThrow('BROWSER_ELEMENT_NOT_FOUND: no element matched button "Sign in"')

    native.nullObject = false
    native.box = null
    await expect(page.clickElement('#flat')).rejects.toThrow('BROWSER_ELEMENT_NOT_VISIBLE')
  })

  it('leaves the document of a rich editor alone and verifies the text landed', async () => {
    const { native, page } = createPage()
    await page.open()

    await page.fill('div[contenteditable="true"]', '黑洞')
    const preparation = native.params('tab-1', 'Runtime.callFunctionOn').at(-2) as { functionDeclaration: string }
    // The editor owns its document: rewriting it would leave the framework's
    // state ahead of the DOM and drop the keystrokes that follow.
    expect(preparation.functionDeclaration).toContain('selectNodeContents')
    expect(preparation.functionDeclaration).not.toContain('textContent = ')
    expect(native.params('tab-1', 'Input.insertText').at(-1)).toEqual({ text: '黑洞' })
    // The value is read back, so a page that silently refuses it is not reported
    // as a successful fill.
    expect((native.params('tab-1', 'Runtime.callFunctionOn').at(-1) as { functionDeclaration: string }).functionDeclaration)
      .toContain('innerText')
    expect(native.methods('tab-1').filter(method => method === 'Input.dispatchMouseEvent')).toHaveLength(0)
  })

  it('clicks a rich editor once and then reports a value the page refused', async () => {
    const { native, page } = createPage()
    await page.open()
    native.box = { x: 10, y: 20, width: 100, height: 30 }
    native.holdOverride = ''

    await expect(page.fill('div[contenteditable="true"]', '黑洞')).rejects.toThrow('BROWSER_FILL_REJECTED')
    // One trusted pointer attempt before giving up, and the Agent is told to
    // type the value instead of assuming the field is filled.
    expect(native.methods('tab-1').filter(method => method === 'Input.dispatchMouseEvent').length).toBeGreaterThan(0)
    expect(native.params('tab-1', 'Input.insertText')).toHaveLength(2)
  })

  it('prefers the visible node when a selector matches several', async () => {
    const expression = elementExpression({ selector: 'div[contenteditable="true"]:visible' })
    // `:visible` is not CSS; it is dropped so the locator still matches, and the
    // hidden twin some editors keep never wins over the editor on screen.
    expect(expression).toContain('div[contenteditable=\\"true\\"]')
    expect(expression).toContain("endsWith(':visible')")
    expect(expression).toContain('matches.find(visible)')
  })

  it('types, fills, and clears a field through CDP input', async () => {
    const { native, page } = createPage()
    await page.open()

    await page.insertText('hello')
    expect(native.params('tab-1', 'Input.insertText')).toEqual([{ text: 'hello' }])

    await page.fill('#name', 'Ada')
    // `fill` addresses the field by its raw selector; the visibility preference
    // belongs to the locator helper both forms share.
    expect(native.params('tab-1', 'Runtime.evaluate').at(-1)).toEqual({
      expression: '#name',
      returnByValue: false,
      awaitPromise: false,
    })
    // The last call of a fill is the read-back; the focus and clear step precedes it.
    const focus = native.params('tab-1', 'Runtime.callFunctionOn').at(-2) as { objectId: string; functionDeclaration: string }
    expect(focus.objectId).toBe('remote-1')
    expect(focus.functionDeclaration).toContain('this.focus()')
    expect(focus.functionDeclaration).toContain('this.select()')
    expect(native.params('tab-1', 'Input.insertText').at(-1)).toEqual({ text: 'Ada' })

    const locator = { role: 'textbox', name: 'Name' } as const
    await page.fillTarget(locator, 'Grace')
    expect(native.params('tab-1', 'Runtime.evaluate').at(-1))
      .toEqual({ expression: elementExpression(locator), returnByValue: false, awaitPromise: false })
    expect(native.params('tab-1', 'Input.insertText').at(-1)).toEqual({ text: 'Grace' })

    await page.fill('#name', '')
    expect(native.params('tab-1', 'Input.insertText')).toHaveLength(3)
  })

  it('presses named keys and chords with the documented descriptors', async () => {
    const { native, page } = createPage()
    await page.open()

    await page.press('Enter')
    expect(native.params('tab-1', 'Input.dispatchKeyEvent')).toEqual([
      {
        type: 'keyDown',
        modifiers: 0,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: '\r',
        unmodifiedText: '\r',
      },
      { type: 'keyUp', modifiers: 0, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
    ])

    await page.press('Control+A')
    const chord = native.params('tab-1', 'Input.dispatchKeyEvent').at(-2)
    expect(chord).toEqual({
      type: 'keyDown',
      modifiers: 2,
      key: 'A',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      text: 'A',
      unmodifiedText: 'A',
    })

    await page.press('Shift+Tab')
    expect(native.params('tab-1', 'Input.dispatchKeyEvent').at(-2)).toMatchObject({
      type: 'keyDown',
      modifiers: 8,
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      text: '\t',
    })

    await page.press('ArrowDown')
    expect(native.params('tab-1', 'Input.dispatchKeyEvent').at(-2)).toEqual({
      type: 'keyDown',
      modifiers: 0,
      key: 'ArrowDown',
      code: 'ArrowDown',
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 40,
    })

    await expect(page.press('')).rejects.toThrow('BROWSER_INVALID_KEY')
    await expect(page.press('Bogus+A')).rejects.toThrow('BROWSER_INVALID_KEY: Bogus is not a modifier')
  })

  it('expands chords and single characters without a live page', () => {
    expect(parsePress('Enter')).toEqual({ modifiers: 0, key: 'Enter' })
    expect(parsePress('Control+A')).toEqual({ modifiers: 2, key: 'A' })
    expect(parsePress('Shift+Tab')).toEqual({ modifiers: 8, key: 'Tab' })
    expect(parsePress('Ctrl+Shift+ArrowUp')).toEqual({ modifiers: 10, key: 'ArrowUp' })
    expect(parsePress('Cmd+K')).toEqual({ modifiers: 4, key: 'K' })
    expect(parsePress('Control+')).toEqual({ modifiers: 0, key: 'Control' })
    expect(() => parsePress('')).toThrow('BROWSER_INVALID_KEY: a chord needs a key')
    expect(() => parsePress('Bogus+A')).toThrow('BROWSER_INVALID_KEY: Bogus is not a modifier')

    expect(keyDescriptor('Enter')).toEqual({ code: 'Enter', keyCode: 13, text: '\r', key: 'Enter' })
    expect(keyDescriptor('PageDown')).toEqual({ code: 'PageDown', keyCode: 34, key: 'PageDown' })
    expect(keyDescriptor('z')).toEqual({ code: 'KeyZ', keyCode: 90, text: 'z', key: 'z' })
    // A name outside the table degenerates to its first character.
    expect(keyDescriptor('Bogus')).toEqual({ code: 'KeyB', keyCode: 66, text: 'B', key: 'B' })
    expect(() => keyDescriptor('')).toThrow('BROWSER_INVALID_KEY: an empty key cannot be pressed')
  })

  it('scrolls the wheel at the page centre or at a named point', async () => {
    const { native, page } = createPage()
    await page.open()

    expect(await page.viewportSize()).toEqual({ width: 1024, height: 768 })
    await page.scroll(120)
    expect(native.params('tab-1', 'Input.dispatchMouseEvent').at(-1)).toEqual({
      type: 'mouseWheel',
      x: 512,
      y: 384,
      deltaX: 0,
      deltaY: 120,
      button: 'none',
      buttons: 0,
    })

    await page.scroll(-200, 10, { x: 5, y: 6 })
    expect(native.params('tab-1', 'Input.dispatchMouseEvent').at(-1))
      .toMatchObject({ type: 'mouseWheel', x: 5, y: 6, deltaX: 10, deltaY: -200 })

    native.failures.set('Page.getLayoutMetrics', new Error('no metrics'))
    await expect(page.viewportSize()).resolves.toEqual({ ...DEFAULT_DESKTOP_BROWSER_VIEWPORT })
    await page.scroll(40)
    expect(native.params('tab-1', 'Input.dispatchMouseEvent').at(-1))
      .toMatchObject({ x: 640, y: 400, deltaY: 40 })
  })

  it('reads bounded page text, content, and the four inspect shapes', async () => {
    const { native, page } = createPage()
    await page.open()

    await expect(page.title()).resolves.toBe('Example Domain')
    await expect(page.inspect('title')).resolves.toBe('Example Domain')

    native.innerText = 'x'.repeat(30_000)
    const text = await page.visibleText()
    expect(text.startsWith('x'.repeat(24_000))).toBe(true)
    expect(text).toContain('(6000 more characters)')
    await expect(page.inspect('visible_text')).resolves.toBe(text)

    native.html = 'y'.repeat(30_000)
    const content = await page.content()
    expect(content.startsWith('y'.repeat(24_000))).toBe(true)
    expect(content).toContain('(6000 more characters)')

    await expect(page.inspect('links')).resolves.toEqual(native.links)
    expect(String((native.params('tab-1', 'Runtime.evaluate').at(-1) as { expression: string }).expression))
      .toContain("querySelectorAll('a[href]')")

    await expect(page.inspect('layout')).resolves.toEqual(native.layout)
    expect(String((native.params('tab-1', 'Runtime.evaluate').at(-1) as { expression: string }).expression))
      .toContain('devicePixelRatio')

    await expect(page.inspect('bogus' as never)).rejects.toThrow('BROWSER_INVALID_EXPRESSION: bogus')

    native.answers.set('Runtime.evaluate', { result: { unserializableValue: 'NaN' } })
    await expect(page.evaluate('0/0')).resolves.toBeNaN()

    native.answers.set('Runtime.evaluate', {
      exceptionDetails: { exception: { description: 'ReferenceError: nope is not defined\n    at <anonymous>:1:1' } },
    })
    await expect(page.evaluate('nope')).rejects
      .toThrow('BROWSER_EVALUATION_FAILED: ReferenceError: nope is not defined')
  })

  it('renders a bounded accessibility snapshot of the live tree', async () => {
    const { native, page } = createPage()
    await page.open()
    native.answers.set('Accessibility.getFullAXTree', {
      nodes: [
        axNode({ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example Domain' }, childIds: ['2'] }),
        axNode({ nodeId: '2', role: { value: 'button' }, name: { value: 'Sign in' } }),
      ],
    })

    const snapshot = await page.snapshot()
    expect(snapshot).toEqual({
      url: 'about:blank',
      title: 'Example Domain',
      text: '- RootWebArea "Example Domain"\n  - button "Sign in"',
      nodes: 2,
      truncated: false,
    })

    native.answers.set('Accessibility.getFullAXTree', {
      nodes: Array.from({ length: 700 }, (_unused, index) => axNode({
        nodeId: `n-${String(index)}`,
        role: { value: 'button' },
        name: { value: `Button ${String(index)}` },
      })),
    })
    const capped = await page.snapshot()
    expect(capped.nodes).toBe(600)
    expect(capped.truncated).toBe(true)
    expect(capped.text.split('\n')).toHaveLength(600)
  })

  it('renders accessibility depth, values, and the documented caps', () => {
    const rendered = renderAccessibilityTree([
      axNode({
        nodeId: 'root',
        role: { value: 'RootWebArea' },
        name: { value: '  Example\n  Domain ' },
        childIds: ['button', 'ignored'],
      }),
      axNode({ nodeId: 'button', role: { value: 'button' }, name: { value: 'Sign in' }, childIds: ['label'] }),
      axNode({ nodeId: 'label', role: { value: 'StaticText' }, name: { value: 'Sign in' } }),
      axNode({ nodeId: 'field', role: { value: 'textbox' }, value: { value: 'Ada Lovelace' } }),
      axNode({ nodeId: 'ignored', ignored: true, name: { value: 'hidden' } }),
      axNode({ nodeId: 'empty', role: { value: 'generic' } }),
    ])

    expect(rendered.text).toBe([
      '- RootWebArea "Example Domain"',
      '  - button "Sign in"',
      '    - StaticText "Sign in"',
      '- textbox value="Ada Lovelace"',
    ].join('\n'))
    // Every visited node spends budget, including the ignored and the unnamed one.
    expect(rendered).toMatchObject({ nodes: 6, truncated: false })

    const wide = renderAccessibilityTree(Array.from({ length: 25 }, (_unused, index) => axNode({
      nodeId: `w-${String(index)}`,
      role: { value: 'generic' },
      name: { value: 'x'.repeat(1000) },
    })))
    expect(wide.truncated).toBe(true)
    expect(wide.nodes).toBe(20)
    expect(wide.text).toHaveLength(20_000)

    const deep = renderAccessibilityTree(Array.from({ length: 700 }, (_unused, index) => axNode({
      nodeId: `d-${String(index)}`,
      role: { value: 'button' },
      name: { value: `Button ${String(index)}` },
    })))
    expect(deep.nodes).toBe(600)
    expect(deep.text.split('\n')).toHaveLength(600)
  })

  it('bounds long text and describes locators', () => {
    expect(redactText('short')).toBe('short')
    expect(redactText('x'.repeat(50), 10).startsWith('x'.repeat(10))).toBe(true)
    expect(redactText('x'.repeat(50), 10)).toContain('(40 more characters)')
    expect(redactText('x'.repeat(50))).toBe('x'.repeat(50))

    expect(describeLocator({ selector: '#go' })).toBe('#go')
    expect(describeLocator({ role: 'button', name: 'Sign in' })).toBe('button "Sign in"')
    expect(describeLocator({ role: 'link' })).toBe('link')
    expect(describeLocator({})).toBe('')

    expect(elementExpression({ selector: '#go' })).toContain('"#go"')
    const roleExpression = elementExpression({ role: 'button', name: 'Sign "in"' })
    expect(roleExpression).toContain('button,input[type=button]')
    expect(roleExpression).toContain(JSON.stringify('Sign "in"'))
    expect(elementExpression({ role: 'textbox' })).toContain('textarea,[contenteditable=true]')
  })

  it('resolves a role and name to one visible element of a real document', () => {
    document.body.innerHTML = [
      '<button id="sign-in" aria-label="Sign in">Go</button>',
      '<button id="hidden" style="display:none">Sign in</button>',
      '<div id="save" role="button" aria-label="Save">Save</div>',
      '<a id="docs" href="/docs">Docs</a>',
      '<input id="name" placeholder="Name">',
    ].join('')
    const rect = { x: 0, y: 0, width: 20, height: 10, top: 0, left: 0, right: 20, bottom: 10, toJSON: () => ({}) }
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = () => rect as DOMRect
    const resolve = (locator: Parameters<typeof elementExpression>[0]): Element | null => {
      return new Function(`return ${elementExpression(locator)}`)() as Element | null
    }

    try {
      expect(resolve({ role: 'button', name: 'Sign in' })?.id).toBe('sign-in')
      expect(resolve({ role: 'button', name: 'Sign' })?.id).toBe('sign-in')
      expect(resolve({ role: 'button' })?.id).toBe('sign-in')
      expect(resolve({ role: 'button', name: 'Save' })?.id).toBe('save')
      expect(resolve({ role: 'link', name: 'Docs' })?.id).toBe('docs')
      expect(resolve({ role: 'textbox', name: 'Name' })?.id).toBe('name')
      expect(resolve({ role: 'button', name: 'Absent' })).toBeNull()
      expect(resolve({ selector: '#docs' })?.id).toBe('docs')
      expect(resolve({ selector: '#absent' })).toBeNull()
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })

  it('captures a JPEG screenshot and clips a full-page capture', async () => {
    const { native, page } = createPage()
    await page.open()

    await expect(page.screenshot()).resolves.toEqual({ data: 'ZmFrZS1qcGVn', mediaType: 'image/jpeg' })
    expect(native.params('tab-1', 'Page.captureScreenshot').at(-1))
      .toEqual({ format: 'jpeg', quality: 70, fromSurface: true })

    await expect(page.screenshot({ fullPage: true, quality: 40 })).resolves
      .toEqual({ data: 'ZmFrZS1qcGVn', mediaType: 'image/jpeg' })
    expect(native.params('tab-1', 'Page.captureScreenshot').at(-1)).toEqual({
      format: 'jpeg',
      quality: 40,
      clip: { x: 0, y: 0, width: 2000, height: 3000, scale: 1 },
      fromSurface: true,
    })

    native.answers.set('Page.captureScreenshot', { data: '' })
    await expect(page.screenshot()).rejects.toThrow('BROWSER_SCREENSHOT_FAILED')
  })

  it('reports guest events, console output, visits, and a navigation failure', async () => {
    const { native, page, events } = createPage()
    await page.open()

    native.emit({ type: 'title', id: 'tab-1', title: 'Example Domain' })
    expect(page.state.title).toBe('Example Domain')
    native.emit({ type: 'loading', id: 'tab-1', loading: true })
    expect(page.state.loading).toBe(true)
    native.emit({ type: 'loading', id: 'tab-1', loading: false })
    expect(page.state.loading).toBe(false)

    native.emit({ type: 'cdp', id: 'tab-1', method: 'Runtime.consoleAPICalled', params: { type: 'warning', args: [{ value: 'careful' }] } })
    native.emit({
      type: 'cdp',
      id: 'tab-1',
      method: 'Runtime.exceptionThrown',
      params: { exceptionDetails: { exception: { description: 'TypeError: boom\n    at <anonymous>:1:1' } } },
    })
    expect(page.console).toEqual([
      { level: 'warning', text: 'careful', seq: 1 },
      { level: 'error', text: 'TypeError: boom', seq: 2 },
    ])
    expect(events).toContainEqual({ type: 'console', message: 'careful' })

    native.emit({ type: 'window-open', id: 'tab-1', url: 'https://example.com/popup' })
    expect(events).toContainEqual({ type: 'window-open', url: 'https://example.com/popup' })

    native.emit({ type: 'navigated', id: 'tab-1', url: 'https://example.com/' })
    expect(page.state.url).toBe('https://example.com/')
    expect(page.visits.map(visit => visit.url)).toEqual(['https://example.com/'])

    native.emit({ type: 'failed', id: 'tab-1', url: 'https://nope.example/', error: '-105: ERR_NAME_NOT_RESOLVED' })
    expect(page.lastFailure).toBe('-105: ERR_NAME_NOT_RESOLVED')
    expect(page.console.at(-1)).toMatchObject({ level: 'error', text: 'navigation failed: https://nope.example/ -105: ERR_NAME_NOT_RESOLVED' })
    expect(events).toContainEqual({ type: 'failed', message: 'https://nope.example/ -105: ERR_NAME_NOT_RESOLVED' })

    native.emit({ type: 'navigated', id: 'other-view', url: 'https://elsewhere.example/' })
    expect(page.state.url).toBe('https://example.com/')
  })

  it('contains a failing page listener', async () => {
    const { native, page, report } = createPage()
    await page.open()
    page.onEvent(() => { throw new Error('listener failed') })

    native.emit({ type: 'window-open', id: 'tab-1', url: 'https://example.com/popup' })

    expect(report).toHaveBeenCalledWith(expect.stringContaining('browser page listener failed: listener failed'))
  })

  it('stops delivering events and rejects further work after close', async () => {
    const { native, page, events } = createPage()
    await page.open()
    expect(native.subscriptions).toBe(1)

    await page.close()
    expect(page.isClosed).toBe(true)
    expect(native.views.get('tab-1')?.closed).toBe(1)
    expect(native.subscriptions).toBe(0)

    await page.close()
    expect(native.views.get('tab-1')?.closed).toBe(1)

    native.emit({ type: 'title', id: 'tab-1', title: 'After close' })
    expect(page.state.title).toBe('')
    native.emit({ type: 'window-open', id: 'tab-1', url: 'https://example.com/late' })
    expect(events).toEqual([])
    await page.place({ x: 0, y: 0, width: 10, height: 10 }, 1, true)
    await page.focus()
    expect(native.views.get('tab-1')?.bounds).toEqual([])
    expect(native.views.get('tab-1')?.focused).toBe(0)

    await expect(page.command('Page.enable')).rejects.toThrow('BROWSER_TAB_CLOSED')
    await expect(page.evaluate('1 + 1')).rejects.toThrow('BROWSER_TAB_CLOSED')
    await expect(page.snapshot()).rejects.toThrow('BROWSER_TAB_CLOSED')
  })

  it('marks the page closed when the shell reports the view gone', async () => {
    const { native, page, events } = createPage()
    await page.open()

    native.emit({ type: 'closed', id: 'tab-1', reason: 'crashed' })

    expect(page.isClosed).toBe(true)
    expect(events).toContainEqual({ type: 'closed' })
    expect(native.views.get('tab-1')?.closed).toBe(0)
  })

  it('resolves a navigation that never loads at the documented deadline', async () => {
    const { native, page } = createPage()
    await page.open()
    native.navigateHook = () => {}

    vi.useFakeTimers()
    try {
      const pending = page.goto('https://slow.example/')
      await vi.advanceTimersByTimeAsync(BROWSER_NAVIGATION_TIMEOUT)
      await expect(pending).resolves.toMatchObject({ url: 'about:blank' })
    } finally {
      vi.useRealTimers()
    }

    expect(native.views.get('tab-1')?.navigations).toEqual(['about:blank', 'https://slow.example/'])
    expect(page.lastFailure).toBeUndefined()
  })

  it('issues only CDP commands the native view allows', async () => {
    const { native, page } = createPage()
    await page.open()
    await page.snapshot()
    await page.evaluate('1 + 1')
    await page.click(5, 6)
    await page.move(7, 8)
    await page.insertText('text')
    await page.fill('#name', 'Ada')
    await page.press('Enter')
    await page.scroll(100)
    await page.screenshot()
    await page.command('Page.getLayoutMetrics')

    const methods = [...native.views.values()].flatMap(view => view.commands.map(command => command.method))
    expect(methods.length).toBeGreaterThan(10)
    expect(methods.filter(method => !isAllowedBrowserViewCdpMethod(method))).toEqual([])
  })
})
