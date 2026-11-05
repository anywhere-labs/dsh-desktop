/** The official Computer Use row, titled macOS Computer Use, on the Computer Use (Next) page, for the dsh 0.2.2 bundle. */
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

/** Mount the Computer Use page against a Host that reports `officialSupported` and lists `bundle`. */
async function mountOfficialComputerUse(officialSupported: boolean, bundle: Record<string, unknown>) {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ commandMode: true, officialSupported }) })))
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
    listBundles: vi.fn(async () => ({ ok: true as const, value: [bundle] })),
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
    get: (name: string) => name === 'pluginNavigation' ? navigation : undefined,
    remote: { $on: () => () => {}, pluginManager },
  }
  const page = () => {
    hooks.cursor = 0
    return ComputerUseSettings({ context: ctx as Context, zh: true, mode: 'page' }) as unknown as Node
  }
  const settle = async () => {
    page()
    for (const effect of hooks.effects.splice(0)) effect()
    await new Promise(resolve => setTimeout(resolve, 0))
    hooks.effects = []
  }
  await settle()
  const view = () => {
    const tree = page()
    hooks.effects = []
    const row = component(tree, 'OfficialComputerUseRow')
    const body = row === undefined ? undefined : render(row)
    return {
      count: nodes(tree).find(node => node.props.className === 'dshNextComponentSectionCount')!.props.children as string,
      row: body,
      title: body === undefined ? undefined : nodes(body).find(node => node.props.className === 'dshNextComponentRowId')!.props.children as string,
      toggle: body === undefined ? undefined : nodes(body).find(node => node.type === 'input' && node.props.label === '启用 macOS Computer Use'),
      open: body === undefined ? undefined : nodes(body).find(node => node.type === 'button' && node.props.className === 'dshNextComponentRowOpen'),
      state: body === undefined ? undefined : nodes(body).find(node => node.props.className === 'dshNextComponentRowState')!.props.children as unknown[],
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
  const app = await mountOfficialComputerUse(true, { ...OFFICIAL_BUNDLE_ROW })
  let view = app.view()
  expect(view.row!.props['data-plugin-row']).toBe('official-computer-use')
  expect(view.title).toBe('macOS Computer Use')
  expect(view.row!.props['data-state']).toBe('off')
  expect(nodes(view.row).some(node => typeof node.props.children === 'string' && node.props.children.includes('仅支持 macOS 14 及以上的 PTC 模式'))).toBe(true)
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
  app.plugins.push({ entryId: 'include:cua-macos', moduleName: '@deepseek-ai/dsh-experimental-cua-macos', enabled: true, fiberPhase: 'active' })
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

it('greys out the official Computer Use switch, off and locked, where it cannot run', async () => {
  // Windows lists the offered bundle as unsupported; a Profile that already selected it still shows the switch off.
  const app = await mountOfficialComputerUse(false, { ...OFFERED_BUNDLE_ROW, enabled: true, listedByDefault: false, error: { code: 'unsupported-platform' } })
  const view = app.view()
  expect(view.row!.props['data-state']).toBe('off')
  expect(view.toggle!.props.checked).toBe(false)
  expect(view.toggle!.props.disabled).toBe(true)
  expect(view.toggle!.props.title).toBe('macOS Computer Use 仅支持 macOS 14 及以上')
  expect(view.state).toContain('当前系统不支持')
  expect(view.count).toBe('共 2 个 · 1 运行中 · 1 已停用')
  expect(view.open).toBeUndefined()
  expect(view.row!.props['data-opens']).toBeUndefined()
})

it('keeps the official Computer Use switch locked before macOS 14, where the plugin manager still lists the bundle', async () => {
  const app = await mountOfficialComputerUse(false, { ...OFFICIAL_BUNDLE_ROW })
  const view = app.view()
  expect(view.toggle!.props.checked).toBe(false)
  expect(view.toggle!.props.disabled).toBe(true)
  expect(view.state).toContain('当前系统不支持')
})

it('installs the official Computer Use when switched on while the current Profile lacks it', async () => {
  const app = await mountOfficialComputerUse(true, { ...OFFERED_BUNDLE_ROW })
  let view = app.view()
  expect(view.title).toBe('macOS Computer Use')
  expect(view.state).toContain('未安装')
  expect(view.toggle!.props.checked).toBe(false)
  expect(view.toggle!.props.disabled).toBe(false)
  expect(view.open).toBeUndefined()
  expect(view.count).toBe('共 2 个 · 1 运行中 · 1 已停用')
  expect(nodes(view.row).some(node => typeof node.props.children === 'string' && node.props.children.includes('首次开启时会下载并安装官方插件'))).toBe(true)

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
