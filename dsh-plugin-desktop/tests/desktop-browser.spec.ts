/**
 * Behaviour tests for the Desktop browser Host plugin.
 *
 * The Host context is a fake built in the same shape the other plugin specs
 * use: `get`/`provide`/`effect`/`on`/`inject`/`logger`/`tools` are doubles, and
 * the native guest-view service is scripted. That covers registration, the
 * panel channel, the Agent tool, and the Session policy wiring without an
 * Electron Host.
 */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopNativeBrowser,
  DesktopNativeBrowserEvent,
  DesktopNativeBrowserViewOptions,
} from '../src/browser-view-service.ts'
import type { DesktopBrowserRect } from '../src/desktop-browser-page.ts'
import type { DesktopBrowserState } from '../src/desktop-browser-session.ts'
import {
  apply,
  DESKTOP_BROWSER_PATH,
  type DesktopBrowserEvent,
  type DesktopBrowserService,
} from '../src/desktop-browser.ts'

/** Guest view id the store registers for one Session-local tab id. */
function viewId(sessionId: string, tabId: string): string {
  return `desktop-browser:${sessionId}:${tabId}`
}

/** One CDP command the plugin issued against a guest view. */
interface NativeCommand {
  readonly method: string
  readonly params: unknown
}

/** Everything the double remembers about one guest view. */
interface GuestView {
  readonly id: string
  readonly owner: string
  readonly allowOrigins: readonly string[] | undefined
  readonly bounds: DesktopBrowserRect[]
  readonly zooms: number[]
  readonly shown: boolean[]
  readonly navigations: string[]
  readonly commands: NativeCommand[]
  readonly entries: Array<{ id: number; url: string; title: string }>
  index: number
  focused: number
  closed: number
  released: boolean
}

/** Scripted stand-in for the shell's native guest-view service. */
class ScriptedNativeBrowser implements DesktopNativeBrowser {
  readonly version = 1 as const
  readonly views = new Map<string, GuestView>()
  readonly created: DesktopNativeBrowserViewOptions[] = []
  readonly closedOwners: string[] = []
  private readonly listeners = new Set<(event: DesktopNativeBrowserEvent) => void>()

  /** @inheritdoc */
  async createView(options: DesktopNativeBrowserViewOptions): Promise<{ id: string }> {
    this.created.push(options)
    this.views.set(options.id, {
      id: options.id,
      owner: options.owner,
      allowOrigins: options.allowOrigins,
      bounds: [],
      zooms: [],
      shown: [],
      navigations: [],
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
    this.view(id).bounds.push(bounds)
  }

  /** @inheritdoc */
  async setZoom(id: string, factor: number): Promise<void> {
    this.view(id).zooms.push(factor)
  }

  /** @inheritdoc */
  async setVisible(id: string, visible: boolean): Promise<void> {
    this.view(id).shown.push(visible)
  }

  /** @inheritdoc */
  async focus(id: string): Promise<void> {
    this.view(id).focused += 1
  }

  /** @inheritdoc */
  async navigate(id: string, url: string): Promise<void> {
    const view = this.view(id)
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
    if (view === undefined || view.released) return
    view.released = true
    view.closed += 1
    this.emit({ type: 'closed', id, reason: 'closed' })
  }

  /** @inheritdoc */
  async closeOwner(owner: string): Promise<void> {
    this.closedOwners.push(owner)
    for (const view of [...this.views.values()]) {
      if (view.owner === owner && !view.released) await this.close(view.id)
    }
  }

  /** @inheritdoc */
  async command(id: string, method: string, params?: unknown): Promise<unknown> {
    const view = this.view(id)
    view.commands.push({ method, params })
    if (method === 'Page.getNavigationHistory') {
      return { currentIndex: view.index, entries: view.entries.map(entry => ({ ...entry })) }
    }
    if (method === 'Page.captureScreenshot') return { data: 'ZmFrZS1qcGVn' }
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

  /** Require a live view, so a released view cannot be driven silently. */
  private view(id: string): GuestView {
    const view = this.views.get(id)
    if (view === undefined) throw new Error(`BROWSER_VIEW_UNKNOWN: ${id}`)
    return view
  }
}

/** One `connection.fetch.register` payload. */
interface RegisteredRoute {
  readonly path: string
  readonly methods?: readonly string[]
  readonly requestBody?: string
  fetch(request: Request): Promise<Response>
}

/** One Agent tool as `ctx.tools.register` received it. */
interface RegisteredTool {
  readonly name: string
  readonly description: string
  readonly parameters: {
    readonly properties: Record<string, { readonly enum?: readonly string[] }>
    readonly required?: readonly string[]
  }
  execute(args: Record<string, unknown>, exec: unknown): Promise<unknown>
}

interface HarnessOptions {
  /** Install the native capability before `apply`, as the shell row does. */
  readonly native?: boolean
  /** Register the Host connection service; `false` mimics a Host without one. */
  readonly connection?: boolean
  /** Register the Host session and sandbox-policy services. */
  readonly policy?: boolean
  /** Session ids the fake Host does not know, so a refusal can be scripted. */
  readonly unknownSessions?: readonly string[]
  /** Make `ctx.tools.register` reject, as a duplicate tool name does. */
  readonly toolNameTaken?: boolean
  /** Register the Host attachment service, so screenshots take the image path. */
  readonly attachments?: boolean
}

interface PluginHarness {
  readonly ctx: Context
  readonly native: ScriptedNativeBrowser
  readonly logger: Record<'info' | 'warn' | 'error', ReturnType<typeof vi.fn>>
  readonly provide: ReturnType<typeof vi.fn>
  readonly injections: Array<readonly string[]>
  readonly effects: Array<() => void>
  readonly tools: Map<string, RegisteredTool>
  readonly routes: RegisteredRoute[]
  readonly register: ReturnType<typeof vi.fn>
  readonly registerReceivers: unknown[]
  readonly sessions: { readonly get: ReturnType<typeof vi.fn> }
  readonly sandboxPolicy: { readonly resolve: ReturnType<typeof vi.fn> }
  /** The attachment service's image sink, when the harness provides one. */
  readonly saveImage: ReturnType<typeof vi.fn>
  /** The service `apply` provided, or a failure when it provided none. */
  service(): DesktopBrowserService
  /** The panel route `apply` registered. */
  route(): RegisteredRoute
  /** Deliver one service later, as a shell row mounting after the plugin does. */
  mount(name: string, value: unknown): void
  /** Run one Host event handler registered through `ctx.on`. */
  hostEvent(name: string, payload: unknown): void
  /** Change the sandbox mode the policy resolves for the next call. */
  setSandboxMode(mode: string | undefined): void
  /** An Agent execution scope for one Session. */
  exec(sessionId: string): unknown
  /** Run every effect disposer, as Host teardown does. */
  teardown(): void
}

/** A fake Host context in the shape the plugin consumes. */
function createHarness(options: HarnessOptions = {}): PluginHarness {
  const native = new ScriptedNativeBrowser()
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const provided = new Map<string, unknown>()
  const services = new Map<string, unknown>()
  const injections: Array<readonly string[]> = []
  const injectionCallbacks: Array<(ctx: Context) => void> = []
  const handlers = new Map<string, (payload: unknown) => void>()
  const effects: Array<() => void> = []
  const tools = new Map<string, RegisteredTool>()
  const routes: RegisteredRoute[] = []
  const registerReceivers: unknown[] = []
  let sandboxMode: string | undefined

  const unknown = new Set(options.unknownSessions ?? [])
  const sessions = { get: vi.fn((id: string) => (unknown.has(id) ? undefined : { id, header: { id } })) }
  const sandboxPolicy = {
    resolve: vi.fn((_input: { session?: unknown }) => (sandboxMode === undefined ? undefined : { mode: sandboxMode })),
  }
  const fetchService = { register: undefined as unknown }
  const register = vi.fn(function (this: unknown, route: RegisteredRoute) {
    registerReceivers.push(this)
    routes.push(route)
    return async () => {}
  })
  fetchService.register = register

  const saveImage = vi.fn(async (_input: { data: Uint8Array; mediaType: string; name: string }) => ({ attachmentId: 'sha256:test' }))
  if (options.native === true) services.set('desktopNativeBrowser', native)
  if (options.attachments === true) services.set('attachments', { saveImage })
  if (options.connection !== false) services.set('connection', { fetch: fetchService })
  if (options.policy !== false) {
    services.set('sessions', sessions)
    services.set('sandboxPolicy', sandboxPolicy)
  }

  const provide = vi.fn((name: string, value: unknown) => { provided.set(name, value) })

  const ctx = {
    get: (name: string) => (provided.has(name) ? provided.get(name) : services.get(name)),
    provide,
    logger,
    effect: vi.fn((effect: () => unknown) => {
      const dispose = effect()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
      return dispose
    }),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler)
      return () => { handlers.delete(event) }
    }),
    inject: vi.fn((names: readonly string[], callback: (ctx: Context) => void) => {
      injections.push([...names])
      injectionCallbacks.push(callback)
    }),
    tools: {
      register: vi.fn((tool: RegisteredTool) => {
        if (options.toolNameTaken === true) throw new Error('a tool named "desktop_browser" is already registered')
        tools.set(tool.name, tool)
        return () => { tools.delete(tool.name) }
      }),
    },
  } as unknown as Context

  return {
    ctx,
    native,
    logger,
    provide,
    injections,
    effects,
    tools,
    routes,
    register,
    registerReceivers,
    sessions,
    sandboxPolicy,
    saveImage,
    service() {
      const api = provided.get('desktopBrowser')
      if (api === undefined) throw new Error('the plugin did not provide desktopBrowser')
      return api as DesktopBrowserService
    },
    route() {
      const route = routes[0]
      if (route === undefined) throw new Error('the plugin did not register a panel route')
      return route
    },
    mount(name, value) {
      services.set(name, value)
      for (const [index, callback] of injectionCallbacks.entries()) {
        const names = injections[index] ?? []
        if (names.every(service => ctx.get(service) !== undefined)) callback(ctx)
      }
    },
    hostEvent(name, payload) {
      handlers.get(name)?.(payload)
    },
    setSandboxMode(mode) {
      sandboxMode = mode
    },
    exec(sessionId) {
      return { agent: { session: { header: { id: sessionId } } } }
    },
    teardown() {
      for (const dispose of [...effects].reverse()) dispose()
    },
  }
}

/** The empty state a Session without tabs answers with. */
function emptyState(): DesktopBrowserState {
  return {
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
  }
}

/** Drain queued microtasks and one macrotask turn, for fire-and-forget work. */
async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

/** One panel request against the registered route. */
function panelRequest(query = '', init?: RequestInit): Request {
  return new Request(`http://127.0.0.1:43189${DESKTOP_BROWSER_PATH}${query}`, init)
}

describe('Desktop browser Host plugin', () => {
  it('registers nothing when the shell provides no native browser', () => {
    const harness = createHarness()

    expect(() => { apply(harness.ctx) }).not.toThrow()

    expect(harness.provide).not.toHaveBeenCalled()
    expect(harness.ctx.get('desktopBrowser')).toBeUndefined()
    expect(harness.injections).toEqual([['desktopNativeBrowser']])
    expect(harness.logger.info).toHaveBeenCalledWith(expect.stringContaining('DSH Desktop shell'))
    expect(harness.logger.error).not.toHaveBeenCalled()
    expect(harness.routes).toEqual([])
  })

  it('installs the surface when the shell capability arrives later', async () => {
    const harness = createHarness()
    apply(harness.ctx)

    harness.mount('desktopNativeBrowser', harness.native)

    expect(harness.provide).toHaveBeenCalledWith('desktopBrowser', expect.objectContaining({
      version: 1,
      available: true,
    }))
    await expect(harness.service().openTab('session-a', 'https://example.com/')).resolves.toBe('tab-1')
  })

  it('provides a versioned service over the Session store', async () => {
    const harness = createHarness({ native: true })
    apply(harness.ctx, { allowedOrigins: ['https://allowed.example'] })
    const api = harness.service()

    expect(api.version).toBe(1)
    expect(api.available).toBe(true)
    expect(api.open()).toEqual([])
    expect(api.existing('session-a')).toBeUndefined()
    await expect(api.state('session-a')).resolves.toEqual(emptyState())
    // Reading a state creates nothing.
    expect(api.open()).toEqual([])

    const store = api.store('session-a')
    expect(api.existing('session-a')).toBe(store)
    expect(api.open()).toEqual(['session-a'])

    await expect(api.openTab('session-a', 'https://allowed.example/page')).resolves.toBe('tab-1')
    expect(harness.native.created[0]?.allowOrigins).toEqual(['https://allowed.example'])
    await expect(api.state('session-a')).resolves.toMatchObject({
      activeId: 'tab-1',
      tabs: [{ id: 'tab-1', url: 'https://allowed.example/page', active: true }],
    })
    await expect(api.openTab('session-a', 'https://blocked.example/')).rejects.toThrow('BROWSER_ORIGIN_DENIED')

    const acted = await api.act('session-a', { action: 'tabs', op: 'list' })
    expect(acted.state.tabs).toHaveLength(1)
    // Closing the active tab by position has to empty the Session. It does not:
    // the rejected open above rolls its tab out of the list but leaves the
    // store's `active` on that removed entry, so this call closes nothing and
    // re-points at tab-1. Kept as the contract the store owes its callers.
    await api.closeTab('session-a')
    await expect(api.state('session-a')).resolves.toMatchObject({ tabs: [], activeId: null })
    await expect(api.closeTab('unknown-session')).resolves.toBeUndefined()
  })

  it('reports panel directives and state events to subscribers', async () => {
    const harness = createHarness({ native: true })
    apply(harness.ctx)
    const api = harness.service()
    expect(api.directive('session-a')).toEqual({ visible: false, epoch: 0 })

    const seen: DesktopBrowserEvent[] = []
    const unsubscribe = api.subscribe(event => { seen.push(event) })
    api.panel('session-a', true)
    expect(api.directive('session-a')).toEqual({ visible: true, epoch: 1 })
    api.panel('session-a', false)
    expect(api.directive('session-a')).toEqual({ visible: false, epoch: 2 })

    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({
      type: 'state',
      sessionId: 'session-a',
      panel: { visible: true, epoch: 1 },
      state: { tabs: [] },
    })

    await api.openTab('session-a', 'https://example.com/')
    expect(seen.at(-1)).toMatchObject({
      type: 'state',
      sessionId: 'session-a',
      panel: { visible: false, epoch: 2 },
      state: { activeId: 'tab-1', tabs: [{ id: 'tab-1', url: 'https://example.com/' }] },
    })

    unsubscribe()
    unsubscribe()
    const delivered = seen.length
    api.panel('session-a', true)
    expect(seen).toHaveLength(delivered)
    expect(api.directive('session-a')).toEqual({ visible: true, epoch: 3 })
  })

  it('honours the Session sandbox policy for read-only Sessions', async () => {
    const harness = createHarness({ native: true, policy: true })
    harness.setSandboxMode('read-only')
    apply(harness.ctx)
    const api = harness.service()
    await api.openTab('session-a')

    await expect(api.act('session-a', { action: 'navigate', url: 'https://example.com/' }))
      .rejects.toThrow('BROWSER_READ_ONLY')
    expect(harness.sessions.get).toHaveBeenCalledWith('session-a')
    expect(harness.sandboxPolicy.resolve).toHaveBeenCalledWith({ session: { id: 'session-a', header: { id: 'session-a' } } })
    expect(harness.native.views.get(viewId('session-a', 'tab-1'))?.navigations).toEqual(['about:blank'])
    await expect(api.act('session-a', { action: 'state' })).resolves.toBeDefined()

    harness.setSandboxMode('danger-full-access')
    await expect(api.act('session-a', { action: 'navigate', url: 'https://example.com/' })).resolves.toBeDefined()
  })

  it('disposes one Session when the Host reports it disposed', async () => {
    const harness = createHarness({ native: true })
    apply(harness.ctx)
    const api = harness.service()
    await api.openTab('session-a')
    await api.openTab('session-a')

    harness.hostEvent('session/disposed', { id: 'session-a' })
    await settle()

    expect(api.open()).toEqual([])
    expect(harness.native.views.get(viewId('session-a', 'tab-1'))?.closed).toBe(1)
    expect(harness.native.views.get(viewId('session-a', 'tab-2'))?.closed).toBe(1)
    expect(harness.native.closedOwners).toEqual(['desktop-browser:session-a'])
    await expect(api.state('session-a')).resolves.toEqual(emptyState())

    harness.hostEvent('session/disposed', {})
    await settle()
    expect(api.open()).toEqual([])
  })

  it('disposes every Session view when the plugin effect is torn down', async () => {
    const harness = createHarness({ native: true })
    apply(harness.ctx)
    await harness.service().openTab('session-a', 'https://example.com/')

    harness.teardown()
    await settle()

    expect(harness.native.views.get(viewId('session-a', 'tab-1'))?.closed).toBe(1)
    expect(harness.native.closedOwners).toEqual(['desktop-browser:session-a'])
    expect(harness.service().open()).toEqual([])
    expect(harness.effects.length).toBeGreaterThan(0)
  })

  it('registers the panel channel at the documented path', () => {
    const harness = createHarness({ native: true })
    apply(harness.ctx)

    expect(DESKTOP_BROWSER_PATH).toBe('/api/dsh-desktop-browser')
    expect(harness.register).toHaveBeenCalledOnce()
    expect(harness.route()).toMatchObject({
      path: DESKTOP_BROWSER_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
    })
    expect(harness.registerReceivers[0]).toBe((harness.ctx.get('connection') as { fetch: unknown }).fetch)
  })

  it('warns instead of failing when the Host has no connection service', () => {
    const harness = createHarness({ native: true, connection: false })

    expect(() => { apply(harness.ctx) }).not.toThrow()

    expect(harness.logger.warn).toHaveBeenCalledWith(expect.stringContaining('needs the Host connection service'))
    expect(harness.routes).toEqual([])
    expect(harness.service().available).toBe(true)
  })

  it('answers a panel GET with the Session state and rejects a request without one', async () => {
    const harness = createHarness({ native: true })
    apply(harness.ctx)
    const route = harness.route()

    const missing = await route.fetch(panelRequest())
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(await missing.json()).toEqual({ error: 'BROWSER_SESSION_REQUIRED' })

    const idle = await route.fetch(panelRequest('?sessionId=session-a'))
    expect(idle.status).toBe(200)
    expect(await idle.json()).toEqual({ ok: true, state: emptyState(), panel: { visible: false, epoch: 0 } })

    await harness.service().openTab('session-a', 'https://example.com/')
    const live = await route.fetch(panelRequest('?sessionId=session-a'))
    expect(await live.json()).toMatchObject({
      ok: true,
      state: { activeId: 'tab-1', tabs: [{ id: 'tab-1', url: 'https://example.com/' }] },
      panel: { visible: false, epoch: 0 },
    })
  })

  it('refuses an action for a Session that does not exist', async () => {
    const harness = createHarness({ native: true, unknownSessions: ['session-ghost'] })
    apply(harness.ctx)
    const route = harness.route()

    const answer = await route.fetch(panelRequest('?sessionId=session-ghost', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'tabs', op: 'new' }),
    }))

    expect(answer.status).toBe(404)
    expect(await answer.json()).toEqual({ error: 'BROWSER_UNKNOWN_SESSION', detail: 'BROWSER_UNKNOWN_SESSION' })
    expect(harness.native.created).toHaveLength(0)
    expect(harness.service().open()).toEqual([])
  })

  it('runs panel POST actions and reports failures as stable codes', async () => {
    const harness = createHarness({ native: true })
    apply(harness.ctx)
    const route = harness.route()
    const post = (body: string): Promise<Response> => route.fetch(panelRequest('?sessionId=session-a', {
      method: 'POST',
      body,
    }))

    const created = await post(JSON.stringify({ action: 'tabs', op: 'new', url: 'https://example.com/' }))
    expect(created.status).toBe(200)
    expect(await created.json()).toMatchObject({
      ok: true,
      state: { activeId: 'tab-1', tabs: [{ id: 'tab-1', url: 'https://example.com/' }] },
      panel: { visible: false, epoch: 0 },
    })

    const panel = await post(JSON.stringify({ action: 'panel', visible: true }))
    expect(panel.status).toBe(200)
    expect(await panel.json()).toEqual({ ok: true })
    expect(harness.service().directive('session-a')).toEqual({ visible: true, epoch: 1 })

    const bad = await post(JSON.stringify({ action: 'launch' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'BROWSER_INVALID_ACTION' })

    const malformed = await post('not json')
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: 'BROWSER_INVALID_ACTION' })

    const oversized = await post('x'.repeat(20_001))
    expect(oversized.status).toBe(400)
    expect(await oversized.json()).toMatchObject({ error: 'BROWSER_INPUT_TOO_LARGE' })
  })

  it('registers the Agent desktop_browser tool and answers a navigate action', async () => {
    const harness = createHarness({ native: true })
    apply(harness.ctx)
    const tool = harness.tools.get('desktop_browser')

    expect(tool?.name).toBe('desktop_browser')
    expect(tool?.description).toContain('DSH Desktop browser')
    expect(tool?.parameters.required).toEqual(['action'])
    expect(tool?.parameters.properties.action?.enum).toContain('navigate')

    const answer = await tool!.execute({ action: 'navigate', url: 'https://example.com/' }, harness.exec('session-a')) as {
      url: string
      state: DesktopBrowserState
    }
    expect(answer.url).toBe('https://example.com/')
    expect(answer.state).toMatchObject({ activeId: 'tab-1', tabs: [{ url: 'https://example.com/' }] })
    expect(harness.native.views.get(viewId('session-a', 'tab-1'))?.navigations).toEqual(['about:blank', 'https://example.com/'])

    const listed = await tool!.execute({ action: 'tabs', op: 'list' }, harness.exec('session-a')) as { state: DesktopBrowserState }
    expect(listed.state.tabs).toHaveLength(1)

    // A Session the caller names explicitly gets its own first tab.
    const idle = await tool!.execute({ action: 'tabs', op: 'list', session: 'session-b' }, harness.exec('session-a')) as {
      state: DesktopBrowserState
    }
    expect(idle.state).toMatchObject({ activeId: 'tab-1', tabs: [{ url: 'about:blank' }] })
  })

  it('hands a screenshot to the attachment service as image bytes', async () => {
    const harness = createHarness({ native: true, attachments: true })
    apply(harness.ctx)
    const tool = harness.tools.get('desktop_browser')!

    const answer = await tool.execute({ action: 'screenshot' }, harness.exec('session-a')) as { url: string; attachment: unknown }

    // The service reads encoded bytes with the same decoder that admits user
    // uploads, so base64 text would reach it as an unreadable blob.
    expect(harness.saveImage).toHaveBeenCalledTimes(1)
    const input = harness.saveImage.mock.calls[0]![0]
    expect(input.mediaType).toBe('image/jpeg')
    expect(input.data).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(input.data).toString('utf8')).toBe('fake-jpeg')
    expect(answer.attachment).toEqual({ attachmentId: 'sha256:test' })
  })

  it('falls back to the base64 capture when the Host has no attachment service', async () => {
    const harness = createHarness({ native: true, attachments: false })
    apply(harness.ctx)
    const tool = harness.tools.get('desktop_browser')!

    const answer = await tool.execute({ action: 'screenshot' }, harness.exec('session-a')) as { data: string; mediaType: string }

    expect(answer).toMatchObject({ data: 'ZmFrZS1qcGVn', mediaType: 'image/jpeg' })
  })

  it('keeps the Host alive when another plugin owns the browser tool name', async () => {
    const harness = createHarness({ native: true, toolNameTaken: true })

    expect(() => { apply(harness.ctx) }).not.toThrow()

    expect(harness.tools.size).toBe(0)
    expect(harness.logger.error).toHaveBeenCalledWith(expect.stringContaining('another plugin already provides'))
    expect(harness.service()).toMatchObject({ version: 1, available: true })
    await expect(harness.service().openTab('session-a')).resolves.toBe('tab-1')
  })
})
