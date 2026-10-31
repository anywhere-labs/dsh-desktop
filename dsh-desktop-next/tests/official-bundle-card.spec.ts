import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => {},
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
  Button: 'button', PluginArtworkDefault: 'svg', PluginArtworkSubagent: 'subagent-artwork', Switch: 'input', StateDot: 'span',
  Toast: 'aside', Modal: 'dialog', IconSettingsOutlineRegular: 'svg', IconWarningOutlineRegular: 'svg', Tag: 'span',
}))
import { registerPluginControls, type OfficialBundleCard } from '../src/client/plugin-controls.tsx'
import { OFFICIAL_OAR_SUBAGENTS } from '../src/upstream-family-labels.ts'

afterEach(() => { hooks.states = []; hooks.cursor = 0; vi.unstubAllGlobals() })

type Node = { type: string | ((props: any) => Node); props: Record<string, any> }
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'type' in value && 'props' in value
    ? [value as Node, ...nodes((value as Node).props.children)] : []
const named = (tree: unknown, name: string): Node[] => nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === name)
const render = (node: Node): Node => (node.type as (props: Node['props']) => Node)(node.props)
const oarSubagents: OfficialBundleCard | undefined = OFFICIAL_OAR_SUBAGENTS
const BASE_BUNDLES = ['dsh-community-market', 'dshmarket', '@agents-anywhere/dsh-bridge-next']

/** Register the Plugins overview against a Host whose official manager lists these bundles. */
function overview(packages: { name: string; enabled: boolean; readOnlyReason?: string }[]) {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const hidden: string[] = []
  const setBundleEnabled = vi.fn(async (_name: string, _enabled: boolean) => ({ ok: true as const, value: { application: 'applied' } }))
  let View: ((props: any) => Node) | undefined
  const ctx: any = {
    get: (key: string) => key === 'slots' ? ctx.slots : undefined,
    on: () => () => {},
    inject: (_services: unknown, callback: (context: unknown) => void) => { callback(ctx) },
    remote: {
      $on: () => () => {},
      pluginManager: { listBundles: vi.fn(async () => ({ ok: true as const, value: packages })), setBundleEnabled },
    },
    slots: {
      // The official page's snapshot seeds the first render, as on a Host that already listed its bundles.
      _core: { entries: (name: string) => name === 'main' ? [{ options: { key: 'plugins' },
        inject: () => ({ hooks: { pluginManager: { getSnapshot: () => ({ status: 'ready', packages }) } } }) }] : [] },
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: { name: string; key?: string }, view: (props: any) => Node) => {
        if (options.name === 'plugins.overview') View = view
        if (options.name === 'plugins.bundle.hidden') hidden.push(options.key!)
        return () => {}
      },
    },
  }
  registerPluginControls(ctx as Context)
  const props = { context: ctx, t: (key: string) => key === 'language' ? 'zh' : key, onOpenBundle: vi.fn(), onOpenItem: vi.fn() }
  return { hidden, props, setBundleEnabled, tree: () => { hooks.cursor = 0; return View!(props) } }
}

it.runIf(oarSubagents !== undefined)('shows OAR subagents with a card of its own after Computer Use and keeps it off the official lists', () => {
  const card = oarSubagents!
  const page = overview([...BASE_BUNDLES.map(name => ({ name, enabled: false })), { name: card.bundle, enabled: false }])
  expect(page.hidden).toEqual([...BASE_BUNDLES, card.bundle])
  const cards = named(page.tree(), 'PluginCard')
  expect(cards.map(node => node.props.title)).toEqual(['远程控制', 'Computer Use（Next）', card.title.zh])
  const oar = cards[2]!
  expect(oar.props.description).toBe(card.description.zh)
  expect(oar.props.icon.type).toBe('subagent-artwork')
  // The official experimental group's packages carry the official Experimental tag; Desktop's own cards carry none.
  expect([oar.props.tags.type, oar.props.tags.props.tone, oar.props.tags.props.children]).toEqual(['span', 'info', '实验性'])
  expect(cards.slice(0, 2).map(node => node.props.tags)).toEqual([undefined, undefined])
  oar.props.onOpen()
  expect(page.props.onOpenBundle).toHaveBeenCalledExactlyOnceWith(card.bundle)
})

it.runIf(oarSubagents !== undefined)('switches OAR subagents on through the official manager', async () => {
  const card = oarSubagents!
  const page = overview([...BASE_BUNDLES.map(name => ({ name, enabled: false })), { name: card.bundle, enabled: false }])
  const control = named(page.tree(), 'BundleSwitch')[0]!
  const toggle = nodes(render(control)).find(node => node.type === 'input')!
  expect(toggle.props.label).toBe(`启用 ${card.title.zh}`)
  expect(toggle.props.checked).toBe(false)
  expect(toggle.props.disabled).toBe(false)
  toggle.props.onChange(true)
  await vi.waitFor(() => { expect(page.setBundleEnabled).toHaveBeenCalledExactlyOnceWith(card.bundle, true) })
})

it.runIf(oarSubagents !== undefined)('locks the OAR subagents switch while the Host cannot change the bundle', () => {
  const card = oarSubagents!
  const missing = overview(BASE_BUNDLES.map(name => ({ name, enabled: false })))
  const unlisted = nodes(render(named(missing.tree(), 'BundleSwitch')[0]!)).find(node => node.type === 'input')!
  expect(unlisted.props.disabled).toBe(true)
  hooks.states = []
  const locked = overview([...BASE_BUNDLES.map(name => ({ name, enabled: false })),
    { name: card.bundle, enabled: true, readOnlyReason: 'management-required' }])
  const readOnly = nodes(render(named(locked.tree(), 'BundleSwitch')[0]!)).find(node => node.type === 'input')!
  expect(readOnly.props.checked).toBe(true)
  expect(readOnly.props.disabled).toBe(true)
})

it.skipIf(oarSubagents !== undefined)('offers no OAR subagents card on a release without the provider', () => {
  const page = overview(BASE_BUNDLES.map(name => ({ name, enabled: false })))
  expect(page.hidden).toEqual(BASE_BUNDLES)
  expect(named(page.tree(), 'PluginCard').map(node => node.props.title)).toEqual(['远程控制', 'Computer Use（Next）'])
  expect(named(page.tree(), 'BundleSwitch')).toEqual([])
})
