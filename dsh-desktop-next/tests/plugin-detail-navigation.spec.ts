import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[], states: [] as unknown[], cursor: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect) },
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
    return [hooks.states[index], (next: unknown) => {
      hooks.states[index] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(hooks.states[index]) : next
    }]
  },
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: 'button', PluginArtworkDefault: 'svg', PluginArtworkSubagent: 'svg', Switch: 'input', StateDot: 'span',
  Toast: 'aside', Modal: 'dialog', IconSettingsOutlineRegular: 'svg',
  IconWarningOutlineRegular: 'svg', Tag: 'span',
}))
import { registerPluginControls } from '../src/client/plugin-controls.tsx'
import { ComputerUseSettings } from '../src/client/computer-use.tsx'

afterEach(() => { hooks.effects = []; hooks.states = []; hooks.cursor = 0; vi.unstubAllGlobals() })

type Node = { type: string | ((props: any) => Node); props: Record<string, any> }
const jsx = (type: Node['type'], props: Node['props']): Node => ({ type, props })
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'type' in value && 'props' in value
    ? [value as Node, ...nodes((value as Node).props.children)] : []
const component = (tree: Node, name: string): Node | undefined => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === name)
const render = (node: Node): Node => (node.type as (props: Node['props']) => Node)(node.props)
/** The switch an EnableSwitch renders; dsh 0.2.2 wraps it with its progress announcement. */
const switchOf = (enable: Node): Node => nodes(render(enable)).find(node => typeof node.props.onChange === 'function')!
/** Group ids on the list page; dsh 0.2.1-alpha.2 splits official cards into basic and extensions. */
const groups = (tree: Node): string[] => nodes(tree).filter(node => node.props['data-plugin-group']).map(node => node.props['data-plugin-group'])
/** Cards on the list page; the official count badge is gone since 0.2.1-alpha.2. */
const cardCount = (tree: Node): number => nodes(tree).filter(node => typeof node.type === 'function' && ['PackageCard', 'ItemCard'].includes(node.type.name)).length

/** Execute the installed official page, replacing only its external services and React hook scheduler. */
function fixture() {
  const hookState: unknown[] = []
  let cursor = 0
  // Layout effects run after each render, before the next one; the page's scroll memory runs there.
  const layoutEffects: (() => void)[] = []
  let Page: (props: Record<string, unknown>) => Node
  let navigation: any
  let apply: (context: unknown) => void
  const source = readFileSync(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-ui-plugin-manager/client'), 'utf8')
  const require = (id: string) => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
    if (id === 'react') return {
      useState(initial: unknown) {
        const index = cursor++
        if (!(index in hookState)) hookState[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
        return [hookState[index], (value: unknown) => { hookState[index] = value }]
      },
      useEffect() {}, useId: () => 'description', useRef: () => ({ current: null }),
      useLayoutEffect(effect: () => void) { layoutEffects.push(effect) },
    }
    if (id === 'react-dom') return {}
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({}, { get: (_, name) => (props: Node['props']) => jsx(String(name), props) })
    if (id === '@deepseek-ai/dsh-client-ui-slots') return { resolveSlotLabel: (label: unknown) => label }
    if (id === '@deepseek-ai/dsh-client-store') return {
      createSnapshotStore: (state: unknown) => {
        let current = state
        return { getSnapshot: () => current, set: (next: unknown) => { current = next }, subscribe: () => () => {} }
      },
      defineStore: ({ init, actions }: any) => ({ create: () => {
        const state = init()
        return { getSnapshot: () => state, actions: Object.fromEntries(Object.entries(actions).map(([name, action]) =>
          [name, (...args: unknown[]) => (action as any)(state, ...args)])) }
      } }),
    }
    throw new Error(`Unexpected browser dependency: ${id}`)
  }
  runInNewContext(source, { window: { __ModuleLoader__: { load: (entry: { factory: (require: unknown) => { apply: typeof apply } }) => { apply = entry.factory(require).apply } } } })
  const noop = () => () => {}
  apply!({ effect: (effect: () => void) => effect(), on: noop, provide: noop,
    locale: { register: noop, bind: () => (key: string) => key, resolveText: (text: string) => text }, remote: { $on: noop },
    // The page mounts only while the Peer may list bundles; this fixture always may.
    remoteAccess: { whenAccess: (_method: string, body: () => Iterable<unknown>) => { [...body()] } },
    layout: { panelInfo: { subscribe: noop }, selectPanel: vi.fn() }, reflect: { provide: noop },
    configForms: { describe: () => ({ getSnapshot: () => ({}), subscribe: noop }), get: () => undefined },
    slots: { inject: (_name: string, register: () => unknown) => {
      const result = register()
      if (result && typeof result === 'object' && Symbol.iterator in result) [...result as Iterable<unknown>]
    }, register: (options: { name: string; store?: any }, view: typeof Page) => {
      if (options.name === 'main') { Page = view; navigation = options.store.create() }
      return () => {}
    } },
  })
  const remote = { name: '@agents-anywhere/dsh-bridge-next', enabled: true, installed: false, optional: true, official: true,
    version: '0.1.0', description: 'Remote connection', rows: [{ entryId: undefined as string | undefined, rowId: 'bridge', moduleName: 'bridge', enabled: true, phase: 'active' }] }
  const official = { ...remote, name: 'official-team', rows: [] }
  const state = { status: 'ready', packages: [official, remote], busy: [] as string[], notice: null, highlight: null, confirm: null,
    install: { open: false }, versions: {}, update: null }
  const item = { id: 'desktop-next-computer-use', label: 'Computer Use (Next)' }
  // dsh 0.2.3 also lists settings sections the Plugins page shows on bundle rows; Desktop adds its bundle groups.
  const ledger = { items: [item], bundles: new Set([remote.name]), rows: new Set(), sections: [],
    groups: [] as { id: string; label: string; bundles: string[] }[],
    hiddenBundles: new Set([remote.name]), hiddenItems: new Set([item.id]) }
  let overview: { onOpenBundle(name: string): void; onOpenItem(id: string): void }
  let tab: { openPackage(name: string): void }
  // Tabs other plugins contribute through `plugins.tab`.
  const tabs: { id: string; label: string }[] = []
  const setEnabled = vi.fn()
  const setRowEnabled = vi.fn()
  const props = {
    useStore: (select: (state: unknown) => unknown) => select(navigation.getSnapshot()), actions: navigation.actions,
    t: (key: string) => key, ensure: vi.fn(), resolveText: (text: string) => text,
    useConfigurations: () => [], usePluginManager: () => state, useConfigLedger: () => ledger, usePluginTabs: () => tabs, setEnabled, setRowEnabled,
    // dsh 0.2.3 reports the page's own plugin synchronization.
    useClientSync: (select: (sync: { syncing: boolean; failures: unknown[] }) => unknown) => select({ syncing: false, failures: [] }), retryClient: vi.fn(),
    useBundleDetails: (select: (details: unknown) => unknown) => select({}), useLocale: (select: (locale: { active: string }) => unknown) => select({ active: 'en' }),
    createHeaderRef: () => () => {}, ensureVersions: vi.fn(), loadDetail: vi.fn(),
    renderSlot: (name: string, owner: Record<string, unknown>, options?: unknown) => {
      if (name === 'plugins.overview') overview = owner as typeof overview
      if (name === 'plugins.tab') tab = owner as typeof tab
      return jsx('slot', { name, owner, options })
    },
  }
  return { state, remote, item, ledger, tabs, actions: navigation.actions, setEnabled, setRowEnabled,
    page: () => {
      cursor = 0
      const tree = Page!(props)
      for (const effect of layoutEffects.splice(0)) effect()
      return tree
    },
    overview: () => overview!, tab: () => tab!,
  }
}

it('opens an overview-owned bundle through the official detail with native header actions, switch, settings and component rows', () => {
  const app = fixture()
  const list = app.page()
  expect(groups(list)).toEqual(['extensions'])
  expect(cardCount(list)).toBe(1)
  app.overview().onOpenBundle(app.remote.name)
  const page = app.page()
  expect(nodes(page).some(node => node.props['data-plugin-group'])).toBe(false)
  const detail = component(page, 'PackageDetail')!
  expect(detail.props.pkg.name).toBe(app.remote.name)
  const body = render(detail)
  const top = component(body, 'DetailTop')!
  const header = render(top)
  expect(nodes(header).some(node => Array.isArray(node.props.children) && node.props.children.includes(top.props.actions))).toBe(true)
  expect(nodes(top.props.actions).some(node => node.props.name === 'plugins.detail.actions')).toBe(true)
  const toggle = switchOf(component(top.props.actions, 'EnableSwitch')!)
  toggle.props.onChange(false)
  expect(app.setEnabled).toHaveBeenCalledWith(app.remote.name, false)
  expect(nodes(body).some(node => node.props.name === 'plugins.bundle.config')).toBe(true)
  expect(component(body, 'RowsSection')?.props.rows).toEqual(app.remote.rows)
  top.props.onBack()
  expect(nodes(app.page()).some(node => node.props.name === 'plugins.overview')).toBe(true)
})

it('uses the official item detail without adding Computer Use to the basic group or changing the card count', () => {
  const app = fixture()
  app.page()
  app.overview().onOpenItem(app.item.id)
  const detail = component(app.page(), 'ItemDetail')!
  const body = render(detail)
  const top = component(body, 'DetailTop')!
  const action = nodes(top.props.actions).find(node => node.props.name === 'plugins.detail.actions')!
  expect(action.props.owner.subject).toEqual({ kind: 'item', id: app.item.id })
  expect(nodes(body).some(node => node.props.name === 'plugins.item' && node.props.owner.view === 'page')).toBe(true)
  top.props.onBack()
  expect(groups(app.page())).toEqual(['extensions'])
  expect(cardCount(app.page())).toBe(1)
  app.overview().onOpenItem('missing')
  expect(component(app.page(), 'ItemDetail')).toBeUndefined()
  app.overview().onOpenBundle('missing')
  expect(component(app.page(), 'PackageDetail')).toBeUndefined()
})

it('labels the Computer Use (Next) item in the active language', () => {
  let language = 'zh'
  const items: { name: string; label?: () => string }[] = []
  const ctx = {
    inject: (_services: unknown, callback: (context: unknown) => void) => { callback(ctx) },
    locale: { bind: () => (key: string) => key === 'language' ? language : key },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: { name: string; label?: () => string }) => { items.push(options); return () => {} },
    },
  }
  registerPluginControls(ctx as unknown as Context)
  const item = items.find(options => options.name === 'plugins.item')!
  expect(item.label?.()).toBe('Computer Use（Next）')
  language = 'en'
  expect(item.label?.()).toBe('Computer Use (Next)')
})

it('preserves ordinary official cards and their navigation when no overview entries are hidden', () => {
  const app = fixture()
  app.ledger.hiddenBundles.clear()
  app.ledger.hiddenItems.clear()
  const list = app.page()
  expect(groups(list)).toEqual(['basic', 'extensions'])
  expect(cardCount(list)).toBe(3)
  const card = nodes(list).find(node => typeof node.type === 'function' && node.type.name === 'PackageCard' && node.props.pkg.name === 'official-team')!
  card.props.onOpen()
  expect(component(app.page(), 'PackageDetail')?.props.pkg.name).toBe('official-team')
})

it('keeps an official optional bundle in the extensions group with its artwork, badge, native switches and component details under Next composition', () => {
  const app = fixture()
  const ctx = {
    inject: (_services: unknown, callback: (context: unknown) => void) => { callback(ctx) },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: { name: string; key?: string }) => {
        if (options.name === 'plugins.bundle.hidden') app.ledger.hiddenBundles.add(options.key!)
        return () => {}
      },
    },
  }
  registerPluginControls(ctx as unknown as Context)
  // Every followed upstream release keeps this optional bundle on the main list.
  const name = '@deepseek-ai/dsh-experimental-voice-input-bundle'
  const { meta } = JSON.parse(readFileSync(createRequire(import.meta.url).resolve(`${name}/locale/zh.json`), 'utf8'))
  const voiceInput = { ...app.remote, name, enabled: false, meta: { ...meta, icon: '/voice-input/icon.svg' },
    rows: [{ rowId: 'voice-input', moduleName: '@deepseek-ai/dsh-experimental-client-ui-voice-input', entryId: 'include:voice-input', enabled: false, phase: 'disabled' }] }
  app.state.packages.push(voiceInput)
  const findCard = () => nodes(app.page()).find(node => typeof node.type === 'function' && node.type.name === 'PackageCard' && node.props.pkg.name === name)!
  const card = findCard()
  expect(card).toBeDefined()
  expect(groups(app.page())).toEqual(['extensions'])
  expect(cardCount(app.page())).toBe(2)
  const head = component(render(card), 'CardHead')!
  expect(head.props.title).toBe('语音输入')
  expect(head.props.description).toBe(meta.description)
  expect(head.props.icon.props.src).toBe('/voice-input/icon.svg')
  expect(nodes(head.props.tags).some(node => node.props.children === 'statusBeta')).toBe(true)
  const toggle = switchOf(component(head.props.end, 'EnableSwitch')!)
  expect(toggle.props.checked).toBe(false)
  toggle.props.onChange(true)
  expect(app.setEnabled).toHaveBeenCalledExactlyOnceWith(name, true)
  voiceInput.enabled = true
  const activeHead = component(render(findCard()), 'CardHead')!
  expect(switchOf(component(activeHead.props.end, 'EnableSwitch')!).props.checked).toBe(true)
  card.props.onOpen()
  const detail = render(component(app.page(), 'PackageDetail')!)
  expect(component(detail, 'RowsSection')?.props.rows).toEqual(voiceInput.rows)
  const top = component(detail, 'DetailTop')!
  switchOf(component(top.props.actions, 'EnableSwitch')!).props.onChange(false)
  expect(app.setEnabled).toHaveBeenLastCalledWith(name, false)
})

it('draws a Desktop bundle group like the official experimental group, with its own More page, notice and member pages', () => {
  const app = fixture()
  const shipped = { ...app.remote, name: 'shipped-member', enabled: false, rows: [] }
  const onDemand = { ...app.remote, name: 'on-demand-member', enabled: false, installed: false, availability: 'missing', rows: [] }
  app.state.packages.push(shipped, onDemand)
  app.ledger.groups.push({ id: 'beta', label: 'Beta plugins', bundles: [shipped.name, onDemand.name] })
  const packageCards = (tree: unknown): Node[] => nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === 'PackageCard')
  const section = (tree: unknown): Node => nodes(tree).find(node => node.props['data-plugin-group'] === 'desktop-beta')!
  // The members leave the official experimental group; the group's section comes first, with its title and More.
  const list = app.page()
  expect(groups(list)).toEqual(['desktop-beta', 'extensions'])
  expect(nodes(section(list)).some(node => node.type === 'h3' && node.props.children === 'Beta plugins')).toBe(true)
  expect(packageCards(section(list))).toEqual([])
  expect(packageCards(list).map(card => card.props.pkg.name)).toEqual(['official-team'])
  nodes(section(list)).find(node => typeof node.props.onClick === 'function')!.props.onClick()
  // Its More page is the official one, with the group's title, its notice and its members in group order.
  const more = app.page()
  expect(nodes(more).some(node => node.type === 'h1' && node.props.children === 'Beta plugins')).toBe(true)
  const notice = nodes(more).find(node => node.props.name === 'plugins.group')!
  expect([notice.props.owner, notice.props.options]).toEqual([{ group: 'beta' }, { only: 'beta' }])
  expect(packageCards(more).map(card => card.props.pkg.name)).toEqual([shipped.name, onDemand.name])
  // A member's page names the group in its breadcrumb and returns to the group's More page.
  packageCards(more)[0]!.props.onOpen()
  const detail = component(app.page(), 'PackageDetail')!
  expect([detail.props.inMore, detail.props.moreLabel]).toEqual([true, 'Beta plugins'])
  const top = component(render(detail), 'DetailTop')!
  expect(top.props.crumbText).toBe('Beta plugins')
  top.props.onBack()
  expect(packageCards(app.page()).map(card => card.props.pkg.name)).toEqual([shipped.name, onDemand.name])
  // A member the profile enabled joins the group's section on the main list, as an enabled experimental bundle does.
  shipped.enabled = true
  nodes(app.page()).find(node => node.props['aria-label'] === 'backToList')!.props.onClick()
  expect(packageCards(section(app.page())).map(card => card.props.pkg.name)).toEqual([shipped.name])
  // Without a group the official More page keeps its own title and list.
  app.ledger.groups.length = 0
  nodes(app.page()).find(node => typeof node.props.onClick === 'function' && node.props.children?.[0] === 'moreAction')!.props.onClick()
  const official = app.page()
  expect(nodes(official).some(node => node.type === 'h1' && node.props.children === 'moreTitle')).toBe(true)
  expect(nodes(official).some(node => node.props.name === 'plugins.group')).toBe(false)
})

it('returns from item, plugin and row pages, a More list and a contributed tab to the scroll position each was left at', () => {
  const app = fixture()
  app.ledger.hiddenBundles.clear()
  app.ledger.hiddenItems.clear()
  // One body scrolls every view of the page. The browser moves it when one view's content replaces another's; the
  // official page leaves that position as it is.
  const listeners = new Set<() => void>()
  const body = {
    scrollTop: 0,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener) },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener) },
  }
  const scroll = (top: number) => { body.scrollTop = top; for (const listener of listeners) listener() }
  const card = (tree: Node, name: string): Node => nodes(tree).find(node => typeof node.type === 'function'
    && node.type.name === 'PackageCard' && node.props.pkg.name === name)!
  const back = (tree: Node, name: string): void => { component(render(component(tree, name)!), 'DetailTop')!.props.onBack() }
  nodes(app.page()).find(node => node.props['data-plugin-body'])!.props.ref(body)
  // A list left at its top, before it was ever scrolled, comes back at its top.
  app.overview().onOpenItem(app.item.id)
  const item = app.page()
  scroll(700)
  back(item, 'ItemDetail')
  app.page()
  expect(body.scrollTop).toBe(0)
  // The main list, a plugin's page opened from it, and back; opening a page leaves the position to the browser.
  scroll(480)
  card(app.page(), 'official-team').props.onOpen()
  const official = app.page()
  expect(body.scrollTop).toBe(480)
  scroll(0)
  scroll(260)
  back(official, 'PackageDetail')
  app.page()
  expect(body.scrollTop).toBe(480)
  // The More list, a plugin's page opened from it, and a component row's page opened from that.
  nodes(app.page()).find(node => typeof node.props.onClick === 'function' && node.props.children?.[0] === 'moreAction')!.props.onClick()
  const more = app.page()
  scroll(0)
  scroll(150)
  card(more, app.remote.name).props.onOpen()
  const remote = app.page()
  scroll(0)
  scroll(90)
  component(remote, 'PackageDetail')!.props.configure.open(app.remote.rows[0])
  const row = app.page()
  expect(component(row, 'RowDetail')?.props.row.rowId).toBe('bridge')
  scroll(0)
  back(row, 'RowDetail')
  const remoteAgain = app.page()
  expect(body.scrollTop).toBe(90)
  back(remoteAgain, 'PackageDetail')
  expect(groups(app.page())).toEqual(['more'])
  expect(body.scrollTop).toBe(150)
  nodes(app.page()).find(node => node.props['aria-label'] === 'backToList')!.props.onClick()
  app.page()
  expect(body.scrollTop).toBe(480)
  // A plugin's page opened from a contributed tab returns to the tab, where it was left.
  app.tabs.push({ id: 'discover', label: 'Discover' })
  app.actions.setTab('discover')
  app.page()
  scroll(333)
  app.tab().openPackage('official-team')
  const fromTab = app.page()
  expect(component(fromTab, 'PackageDetail')?.props.pkg.name).toBe('official-team')
  scroll(0)
  back(fromTab, 'PackageDetail')
  expect(nodes(app.page()).some(node => node.props.name === 'plugins.tab' && node.props.options.only === 'discover')).toBe(true)
  expect(body.scrollTop).toBe(333)
})


it('seeds PluginControls, RemoteControlSettings, and ComputerUseSettings from the official snapshot and first-mount cache without disabling switches on remount', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const packages = [
    { name: 'dsh-community-market', enabled: true },
    { name: 'dshmarket', enabled: false },
    { name: '@agents-anywhere/dsh-bridge-next', enabled: true },
  ]
  const cuaRow = {
    entryId: 'include:cua',
    moduleName: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
    enabled: true,
    fiberPhase: 'active',
  }
  const listBundles = vi.fn(async () => ({ ok: true as const, value: packages }))
  const listPlugins = vi.fn(async () => ({ ok: true as const, value: [cuaRow] }))
  let OverviewView: ((props: any) => Node) | undefined
  const ctx: any = {
    get: (key: string) => key === 'slots' ? ctx.slots : undefined,
    on: () => () => {},
    inject: (_services: unknown, callback: (context: unknown) => void) => { callback(ctx) },
    remote: {
      $on: () => () => {},
      pluginManager: { listBundles, listPlugins, setBundleEnabled: vi.fn(), setPluginEnabled: vi.fn() },
      pluginMarket: { listIndexes: vi.fn(async () => ({ ok: true as const, value: [] })) },
    },
    slots: {
      _core: {
        entries: (name: string) => name === 'main' ? [{
          options: { key: 'plugins' },
          inject: () => ({
            hooks: {
              pluginManager: {
                getSnapshot: () => ({ status: 'ready', packages }),
              },
            },
          }),
        }] : [],
      },
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: { name: string }, view: (props: any) => Node) => {
        if (options.name === 'plugins.overview') OverviewView = view
        return () => {}
      },
    },
  }
  registerPluginControls(ctx as Context)
  // Registration must not reach the Host: both listings block its event loop
  // and would delay the first window's account and onboarding state.
  await Promise.resolve()
  expect(listBundles).not.toHaveBeenCalled()
  expect(listPlugins).not.toHaveBeenCalled()

  // The first mount loads the listings and fills the per-context cache.
  const props = {
    context: ctx,
    t: (key: string) => key === 'language' ? 'zh' : key,
    onOpenBundle: vi.fn(),
    onOpenItem: vi.fn(),
  }
  render(component(OverviewView!(props), 'ComputerUseSettings')!)
  for (const effect of hooks.effects.splice(0)) effect()
  await vi.waitFor(() => {
    expect(listBundles).toHaveBeenCalledTimes(1)
    expect(listPlugins).toHaveBeenCalledTimes(1)
  })
  await Promise.all([listBundles.mock.results[0]!.value, listPlugins.mock.results[0]!.value])
  await new Promise(resolve => setTimeout(resolve, 0))

  // Simulate remounting the Installed Plugins page while background refresh RPCs are still in flight
  listBundles.mockReturnValue(new Promise(() => {}))
  listPlugins.mockReturnValue(new Promise(() => {}))
  hooks.states = []
  hooks.cursor = 0
  hooks.effects = []

  const tree = OverviewView!(props)
  const marketSwitch = nodes(tree).find(node => node.type === 'input' && node.props.label === '启用插件市场')!
  expect(marketSwitch.props.checked).toBe(true)
  expect(marketSwitch.props.disabled).toBe(false)

  const remoteNode = render(component(tree, 'RemoteControlSettings')!)
  const remoteSwitch = nodes(remoteNode).find(node => node.type === 'input' && node.props.label === '启用远程控制')!
  expect(remoteSwitch.props.checked).toBe(true)
  expect(remoteSwitch.props.disabled).toBe(false)

  const cuaCard = nodes(tree).find(
    node => typeof node.type === 'function' && node.type.name === 'PluginCard' && node.props.title === 'Computer Use（Next）',
  )!
  expect(typeof cuaCard.props.icon.type === 'function' && cuaCard.props.icon.type.name).toBe('ComputerUsePluginArtwork')
  const cuaNode = render(component(tree, 'ComputerUseSettings')!)
  const cuaSwitch = nodes(cuaNode).find(node => node.type === 'input' && node.props.label === '启用 Computer Use（Next）')!
  expect(cuaSwitch.props.checked).toBe(true)
  expect(cuaSwitch.props.disabled).toBe(false)
})

it('renders the on-demand /computer-use command sub-switch on the Computer Use detail page (default on) and updates it via the Host route', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  let savedCommandMode = true
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { commandMode?: boolean }
      savedCommandMode = Boolean(body.commandMode)
    }
    return {
      ok: true,
      json: async () => ({ commandMode: savedCommandMode }),
    }
  })
  vi.stubGlobal('fetch', fetchMock)

  const cuaRow = {
    entryId: 'include:cua',
    moduleName: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
    enabled: true,
    fiberPhase: 'active',
  }
  const ctx: any = {
    on: () => () => {},
    remote: {
      $on: () => () => {},
      pluginManager: {
        listBundles: vi.fn(async () => ({ ok: true as const, value: [] })),
        listPlugins: vi.fn(async () => ({ ok: true as const, value: [cuaRow] })),
        setPluginEnabled: vi.fn(),
      },
    },
  }

  hooks.cursor = 0
  let pageTree = ComputerUseSettings({ context: ctx as Context, zh: true, mode: 'page' }) as unknown as Node
  for (const effect of hooks.effects.splice(0)) effect()
  await new Promise(resolve => setTimeout(resolve, 0))

  hooks.cursor = 0
  pageTree = ComputerUseSettings({ context: ctx as Context, zh: true, mode: 'page' }) as unknown as Node
  const sectionCount = nodes(pageTree).find(node => node.props.className === 'dshNextComponentSectionCount')!
  expect(sectionCount.props.children).toBe('共 1 个 · 1 运行中')
  const rowNode = nodes(pageTree).find(node => node.props['data-plugin-row'] === 'computer-use-command')!
  expect(rowNode.props['data-state']).toBeUndefined()
  const rowIcon = nodes(rowNode).find(
    node => typeof node.type === 'function' && node.type.name === 'ComputerUsePluginArtwork',
  )!
  expect(rowIcon).toBeDefined()
  expect(rowIcon.props.size).toBe(30)
  const commandSwitch = nodes(pageTree).find(
    node => node.type === 'input' && node.props.label === '按需命令加载（/computer-use）',
  )!
  expect(commandSwitch).toBeDefined()
  expect(commandSwitch.props.checked).toBe(true)
  expect(commandSwitch.props.disabled).toBe(false)

  commandSwitch.props.onChange(false)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/desktop-next/computer-use',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ commandMode: false }),
    }),
  )

  hooks.cursor = 0
  pageTree = ComputerUseSettings({ context: ctx as Context, zh: true, mode: 'page' }) as unknown as Node
  const updatedSwitch = nodes(pageTree).find(
    node => node.type === 'input' && node.props.label === '按需命令加载（/computer-use）',
  )!
  expect(updatedSwitch.props.checked).toBe(false)
  const offRow = nodes(pageTree).find(node => node.props['data-plugin-row'] === 'computer-use-command')!
  expect(offRow.props['data-state']).toBe('off')

  // When the parent Computer Use plugin is disabled, the component row hides its switch and displays "已关闭"
  hooks.states = []
  hooks.effects = []
  hooks.cursor = 0
  cuaRow.enabled = false
  savedCommandMode = true
  const disabledCtx: any = {
    on: () => () => {},
    remote: {
      $on: () => () => {},
      pluginManager: {
        listBundles: vi.fn(async () => ({ ok: true as const, value: [] })),
        listPlugins: vi.fn(async () => ({ ok: true as const, value: [cuaRow] })),
        setPluginEnabled: vi.fn(),
      },
    },
  }
  pageTree = ComputerUseSettings({ context: disabledCtx as Context, zh: true, mode: 'page' }) as unknown as Node
  for (const effect of hooks.effects.splice(0)) effect()
  await new Promise(resolve => setTimeout(resolve, 0))

  hooks.cursor = 0
  pageTree = ComputerUseSettings({ context: disabledCtx as Context, zh: true, mode: 'page' }) as unknown as Node
  const disabledRow = nodes(pageTree).find(node => node.props['data-plugin-row'] === 'computer-use-command')!
  expect(disabledRow.props['data-state']).toBe('off')
  const disabledState = nodes(pageTree).find(node => node.props.className === 'dshNextComponentRowState')!
  expect(disabledState.props.children).toContain('已关闭')
  const hiddenSwitch = nodes(pageTree).find(
    node => node.type === 'input' && node.props.label === '按需命令加载（/computer-use）',
  )
  expect(hiddenSwitch).toBeUndefined()
})

it('reads the dshmarket download region from its status route, so quick configuration selects the Global index', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  // dshmarket reports its region only on its status route; a path it does not serve answers 404.
  const fetchMock = vi.fn(async (url: string) => url === '/dsh-market/status'
    ? { ok: true, json: async () => ({ region: 'global', regions: ['global', 'china'] }) }
    : { ok: false, status: 404, json: async () => ({ error: 'not found' }) })
  vi.stubGlobal('fetch', fetchMock)
  const packages = [
    { name: 'dsh-community-market', enabled: false },
    { name: 'dshmarket', enabled: true },
    { name: '@deepseek-ai/dsh-experimental-plugin-market-bundle', enabled: true },
  ]
  const custom = 'https://custom.example.com/index.json'
  const listIndexes = vi.fn(async () => ({ ok: true as const, value: [{ url: custom }] }))
  const setIndexes = vi.fn(async (_urls: string[]) => ({ ok: true as const, value: undefined }))
  let OverviewView: ((props: any) => Node) | undefined
  const ctx: any = {
    get: (key: string) => key === 'slots' ? ctx.slots : undefined,
    on: () => () => {},
    inject: (_services: unknown, callback: (context: unknown) => void) => { callback(ctx) },
    remote: {
      $on: () => () => {},
      pluginManager: { listBundles: vi.fn(async () => ({ ok: true as const, value: packages })), setBundleEnabled: vi.fn() },
      pluginMarket: { listIndexes, setIndexes, search: vi.fn(async () => ({ ok: true as const, value: {} })) },
    },
    slots: {
      _core: {
        entries: (name: string) => name === 'main' ? [{
          options: { key: 'plugins' },
          inject: () => ({ hooks: { pluginManager: { getSnapshot: () => ({ status: 'ready', packages }) } } }),
        }] : [],
      },
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: { name: string }, view: (props: any) => Node) => {
        if (options.name === 'plugins.overview') OverviewView = view
        return () => {}
      },
    },
  }
  registerPluginControls(ctx as Context)
  const props = { context: ctx, t: (key: string) => key === 'language' ? 'zh' : key, onOpenBundle: vi.fn(), onOpenItem: vi.fn() }
  const closed = component(render(component(OverviewView!(props), 'MarketSourcesButton')!), 'MarketSourcesDialog')!
  const Dialog = closed.type as (props: Node['props']) => Node
  // The overview's own state setters would write into the dialog's hook slots below.
  const dialogProps = { ...closed.props, open: true, onClose: vi.fn(), onChanged: vi.fn() }

  // Open the source configuration on hook slots of its own and run its mount effects.
  hooks.states = []
  hooks.effects = []
  hooks.cursor = 0
  Dialog(dialogProps)
  for (const effect of hooks.effects.splice(0)) effect()
  await vi.waitFor(() => { expect(listIndexes).toHaveBeenCalledTimes(1) })
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/dsh-market/status', expect.objectContaining({ cache: 'no-store' }))

  hooks.cursor = 0
  const quick = nodes(Dialog(dialogProps)).find(node => node.type === 'button' && node.props.children === '快速配置')!
  quick.props.onClick()
  await vi.waitFor(() => { expect(setIndexes).toHaveBeenCalledTimes(2) })
  const global = 'https://realguan.github.io/dsh-plugin-market/dsh-index.json'
  // The selected index is saved alone first, then the full list with it in front.
  expect(setIndexes).toHaveBeenNthCalledWith(1, [global])
  expect(setIndexes).toHaveBeenNthCalledWith(2, [global, 'https://api.dshfind.com/market/dsh-index.json', custom])
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(dialogProps.onChanged).toHaveBeenCalledTimes(1)
  hooks.cursor = 0
  expect(nodes(Dialog(dialogProps)).filter(node => node.props.role === 'alert')).toEqual([])
})
