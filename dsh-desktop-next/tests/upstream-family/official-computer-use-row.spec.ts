/** The official Computer Use row on the Computer Use (Next) page, titled after the platform whose provider the bundle loads. */
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
  IconWarningOutlineRegular: 'svg', IconChevronRightOutlineRegular: 'svg', Tag: 'span',
}))
import { ComputerUseSettings } from '../../src/client/computer-use.tsx'

afterEach(() => { hooks.effects = []; hooks.states = []; hooks.cursor = 0; vi.unstubAllGlobals() })

type Node = { type: string | ((props: any) => Node); props: Record<string, any> }
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'type' in value && 'props' in value
    ? [value as Node, ...nodes((value as Node).props.children)] : []
const component = (tree: Node, name: string): Node | undefined => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === name)
const render = (node: Node): Node => (node.type as (props: Node['props']) => Node)(node.props)

/** What the Host route reports about the official Computer Use. */
interface OfficialHost { officialSupported: boolean; officialPlatform?: 'macos' | 'windows' }
const MACOS: OfficialHost = { officialSupported: true, officialPlatform: 'macos' }
const WINDOWS: OfficialHost = { officialSupported: true, officialPlatform: 'windows' }

/** Where the Computer Use component renders: the Plugins list's card, the page's header actions, or the page. */
type Mode = 'overview' | 'actions' | 'page'

/**
 * Mount the Computer Use component in `mode` against a Host that reports `host` and lists `bundle`, beside an official
 * Plugins panel whose store last listed `listed`.
 */
async function mountOfficialComputerUse(host: OfficialHost, bundle: Record<string, unknown>,
  { mode = 'page', listed }: { mode?: Mode; listed?: readonly Record<string, unknown>[] } = {}) {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ commandMode: true, ...host }) })))
  const cuaRow = {
    entryId: 'include:cua',
    moduleName: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
    enabled: true,
    fiberPhase: 'active',
  }
  const plugins: Record<string, unknown>[] = [cuaRow]
  // An installation finishes when the test resolves it, so its in-flight state can be read.
  const installed = Promise.withResolvers<void>()
  const pluginManager = {
    // Each read answers with a snapshot, as the remote plugin manager does.
    listBundles: vi.fn(async () => ({ ok: true as const, value: [{ ...bundle }] })),
    listPlugins: vi.fn(async () => ({ ok: true as const, value: plugins })),
    setPluginEnabled: vi.fn(),
    setBundleEnabled: vi.fn(async (_name: string, enabled: boolean) => {
      bundle.enabled = enabled
      return { ok: true as const, value: { changed: true, application: 'applied', stage: 'enable', target: bundle.name, enabled } }
    }),
    installBundle: vi.fn(async (spec: string, _options: { enabled?: boolean; saveExact?: boolean }) => {
      await installed.promise
      Object.assign(bundle, { availability: 'profile', installed: true, enabled: true })
      return { ok: true as const, value: { changed: true, application: 'applied', stage: 'enable', target: spec, bundle: bundle.name, enabled: true } }
    }),
  }
  const navigation = { openBundle: vi.fn(), openList: vi.fn() }
  const ctx: any = {
    on: () => () => {},
    get: (name: string) => name === 'pluginNavigation' ? navigation : name === 'slots' && listed !== undefined ? {
      _core: {
        entries: (key: string) => key === 'main' ? [{
          options: { key: 'plugins' },
          inject: () => ({ hooks: { pluginManager: { getSnapshot: () => ({ status: 'ready', packages: listed }) } } }),
        }] : [],
      },
    } : undefined,
    remote: { $on: () => () => {}, pluginManager },
  }
  const page = (as: Mode = 'page') => {
    hooks.cursor = 0
    return ComputerUseSettings({ context: ctx as Context, zh: true, mode: as }) as unknown as Node
  }
  const settle = async (as: Mode = 'page') => {
    page(as)
    for (const effect of hooks.effects.splice(0)) effect()
    await new Promise(resolve => setTimeout(resolve, 0))
    hooks.effects = []
  }
  await settle(mode)
  const view = () => {
    const tree = page()
    hooks.effects = []
    const row = component(tree, 'OfficialComputerUseRow')
    const body = row === undefined ? undefined : render(row)
    return {
      count: nodes(tree).find(node => node.props.className === 'dshNextComponentSectionCount')!.props.children as string,
      row: body,
      title: body === undefined ? undefined : nodes(body).find(node => node.props.className === 'dshNextComponentRowId')!.props.children as string,
      toggle: body === undefined ? undefined : nodes(body).find(node => node.type === 'input' && String(node.props.label).startsWith('启用 ')),
      open: body === undefined ? undefined : nodes(body).find(node => node.type === 'button' && node.props.className === 'dshNextComponentRowOpen'),
      state: body === undefined ? undefined : nodes(body).find(node => node.props.className === 'dshNextComponentRowState')!.props.children as unknown[],
      description: body === undefined ? undefined : nodes(body).find(node => node.props.className === 'dshNextComponentRowModule' && typeof node.props.children === 'string')!.props.children as string,
    }
  }
  return { pluginManager, plugins, navigation, installed, settle, view }
}

/** The bundle once the current Profile installed it. */
const OFFICIAL_BUNDLE_ROW = {
  name: '@deepseek-ai/dsh-cua-bundle', official: true, availability: 'profile', enabled: false, installed: true,
  optional: false, removable: true, updatable: false, rows: [], overrides: [],
}

/** The bundle as the official catalog offers it before the current Profile installs it. */
const OFFERED_BUNDLE_ROW = {
  name: '@deepseek-ai/dsh-cua-bundle', official: true, availability: 'missing', enabled: false, installed: false,
  optional: false, removable: false, updatable: false, rows: [], overrides: [], listedByDefault: true,
  installTarget: { spec: '@deepseek-ai/dsh-cua-bundle@0.2.2-rc.1', version: '0.2.2-rc.1' },
}

it('switches the official Computer Use bundle on the Computer Use (Next) page on macOS 14 and later', async () => {
  const app = await mountOfficialComputerUse(MACOS, { ...OFFICIAL_BUNDLE_ROW })
  let view = app.view()
  expect(view.row!.props['data-plugin-row']).toBe('official-computer-use')
  expect(view.title).toBe('macOS Computer Use')
  expect(view.row!.props['data-state']).toBe('off')
  expect(view.description).toBe('官方 Computer Use，需要 macOS 14 及以上。开启后所有会话都改用它，不再加载 Computer Use（Next）。访问每个应用前会先请你授权，系统权限在插件详情中设置。')
  expect(view.toggle!.props.label).toBe('启用 macOS Computer Use')
  expect(view.toggle!.props.checked).toBe(false)
  expect(view.toggle!.props.disabled).toBe(false)
  expect(view.toggle!.props.title).toBeUndefined()
  expect(view.state).toContain('已关闭')
  expect(view.count).toBe('共 2 个 · 1 运行中 · 1 已停用')
  expect(view.open).toBeUndefined()
  expect(view.row!.props['data-opens']).toBeUndefined()

  view.toggle!.props.onChange(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(app.pluginManager.setBundleEnabled).toHaveBeenCalledWith('@deepseek-ai/dsh-cua-bundle', true)
  expect(app.navigation.openBundle).not.toHaveBeenCalled()
  view = app.view()
  expect(view.toggle!.props.checked).toBe(true)
  expect(view.state).toContain('等待加载')

  // Once on, the row opens the official bundle's page in the Plugins panel.
  expect(view.row!.props['data-opens']).toBeDefined()
  expect(view.open!.props['aria-label']).toBe('查看 macOS Computer Use 的插件详情')
  view.open!.props.onClick()
  expect(app.navigation.openBundle).toHaveBeenCalledExactlyOnceWith('@deepseek-ai/dsh-cua-bundle')

  // The bundle's macOS provider comes up after the plugin manager reloads the Profile.
  app.plugins.push({ entryId: 'include:cua-macos', moduleName: '@deepseek-ai/dsh-cua-macos', enabled: true, fiberPhase: 'active' })
  await app.settle()
  view = app.view()
  expect(view.row!.props['data-state']).toBeUndefined()
  expect(view.state).toContain('运行中')
  expect(view.count).toBe('共 2 个 · 2 运行中')

  view.toggle!.props.onChange(false)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(app.pluginManager.setBundleEnabled).toHaveBeenLastCalledWith('@deepseek-ai/dsh-cua-bundle', false)
  view = app.view()
  expect(view.toggle!.props.checked).toBe(false)
  expect(view.open).toBeUndefined()
  expect(app.navigation.openBundle).toHaveBeenCalledOnce()
})

it('switches the Windows Computer Use where the package carries its helper', async () => {
  const app = await mountOfficialComputerUse(WINDOWS, { ...OFFICIAL_BUNDLE_ROW })
  let view = app.view()
  expect(view.title).toBe('Windows Computer Use')
  expect(view.toggle!.props.label).toBe('启用 Windows Computer Use')
  expect(view.description).toBe('官方 Computer Use 的 Windows 实验版。开启后所有会话都改用它，不再加载 Computer Use（Next）。访问每个应用前会先请你授权；点击、滚动和拖拽会移动系统鼠标，部分输入需要目标窗口在前台。')
  expect(view.toggle!.props.disabled).toBe(false)
  view.toggle!.props.onChange(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(app.pluginManager.setBundleEnabled).toHaveBeenCalledWith('@deepseek-ai/dsh-cua-bundle', true)
  // Only the Windows provider tells whether it runs here.
  app.plugins.push({ entryId: 'include:cua-macos', moduleName: '@deepseek-ai/dsh-cua-macos', enabled: true, fiberPhase: 'active' })
  await app.settle()
  view = app.view()
  expect(view.state).toContain('等待加载')
  app.plugins.push({ entryId: 'include:cua-windows', moduleName: '@deepseek-ai/dsh-cua-windows', enabled: true, fiberPhase: 'active' })
  await app.settle()
  view = app.view()
  expect(view.state).toContain('运行中')
  expect(view.open!.props['aria-label']).toBe('查看 Windows Computer Use 的插件详情')
  expect(view.count).toBe('共 2 个 · 2 运行中')
})

it('greys out the official Computer Use switch, off and locked, in a Windows build without its helper', async () => {
  // A Profile that already selected the bundle still shows the switch off.
  const app = await mountOfficialComputerUse({ officialSupported: false, officialPlatform: 'windows' }, { ...OFFICIAL_BUNDLE_ROW, enabled: true })
  const view = app.view()
  expect(view.title).toBe('Windows Computer Use')
  expect(view.row!.props['data-state']).toBe('off')
  expect(view.toggle!.props.checked).toBe(false)
  expect(view.toggle!.props.disabled).toBe(true)
  expect(view.toggle!.props.title).toBe('当前安装包没有带 Windows Computer Use 的辅助程序')
  expect(view.state).toContain('当前安装包不支持')
  expect(view.count).toBe('共 2 个 · 1 运行中 · 1 已停用')
  expect(view.open).toBeUndefined()
  expect(view.row!.props['data-opens']).toBeUndefined()
})

it('keeps the official Computer Use switch locked before macOS 14, where the plugin manager still lists the bundle', async () => {
  const app = await mountOfficialComputerUse({ officialSupported: false, officialPlatform: 'macos' }, { ...OFFICIAL_BUNDLE_ROW })
  const view = app.view()
  expect(view.toggle!.props.checked).toBe(false)
  expect(view.toggle!.props.disabled).toBe(true)
  expect(view.toggle!.props.title).toBe('macOS Computer Use 需要 macOS 14 及以上')
  expect(view.state).toContain('当前系统不支持')
})

it('shows the official row at once when the page opens again', async () => {
  const app = await mountOfficialComputerUse(MACOS, { ...OFFICIAL_BUNDLE_ROW })
  expect(app.view().title).toBe('macOS Computer Use')
  app.view().toggle!.props.onChange(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  // A page that opens again starts from what the client last read, before its own reads answer.
  hooks.states = []
  const view = app.view()
  expect(view.title).toBe('macOS Computer Use')
  expect(view.toggle!.props.checked).toBe(true)
  expect(view.count).toBe('共 2 个 · 1 运行中 · 1 已停用')
})

it('opens the page with the official row from the Plugins panel listing and the platform the card asked for', async () => {
  // The official panel lists the bundle on, with its Windows provider running.
  const listed = [{ ...OFFICIAL_BUNDLE_ROW, enabled: true,
    rows: [{ rowId: 'cua-windows', moduleName: '@deepseek-ai/dsh-cua-windows', enabled: true, phase: 'active' }] }]
  const app = await mountOfficialComputerUse(WINDOWS, { ...OFFICIAL_BUNDLE_ROW }, { mode: 'overview', listed })
  await app.settle('actions')
  // The card and the header actions ask the Host route once and list no bundles: listings hold up the Host.
  expect(app.pluginManager.listBundles).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledOnce()
  hooks.states = []
  const view = app.view()
  expect(view.title).toBe('Windows Computer Use')
  expect(view.state).toContain('运行中')
  expect(view.count).toBe('共 2 个 · 2 运行中')
  // The page then reads for itself, and its answer replaces the listing.
  await app.settle()
  expect(app.pluginManager.listBundles).toHaveBeenCalledOnce()
  expect(app.view().state).toContain('已关闭')
})

it('leaves the official Computer Use out where the bundle has no provider, as on Linux', async () => {
  const app = await mountOfficialComputerUse({ officialSupported: false }, { ...OFFERED_BUNDLE_ROW, error: { code: 'unsupported-platform' } })
  const view = app.view()
  expect(view.row).toBeUndefined()
  expect(view.count).toBe('共 1 个 · 1 运行中')
})

it('installs the official Computer Use when switched on while the current Profile lacks it', async () => {
  const app = await mountOfficialComputerUse(MACOS, { ...OFFERED_BUNDLE_ROW })
  let view = app.view()
  expect(view.title).toBe('macOS Computer Use')
  expect(view.state).toContain('未安装')
  expect(view.toggle!.props.checked).toBe(false)
  expect(view.toggle!.props.disabled).toBe(false)
  expect(view.open).toBeUndefined()
  expect(view.count).toBe('共 2 个 · 1 运行中 · 1 已停用')

  view.toggle!.props.onChange(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(app.pluginManager.installBundle).toHaveBeenCalledExactlyOnceWith('@deepseek-ai/dsh-cua-bundle@0.2.2-rc.1', { enabled: true, saveExact: true })
  expect(app.pluginManager.setBundleEnabled).not.toHaveBeenCalled()
  view = app.view()
  expect(view.state).toContain('正在下载并安装')
  expect(view.toggle!.props.checked).toBe(true)

  app.installed.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  view = app.view()
  expect(view.state).toContain('等待加载')
  expect(view.toggle!.props.checked).toBe(true)
  expect(view.open).toBeDefined()
})
