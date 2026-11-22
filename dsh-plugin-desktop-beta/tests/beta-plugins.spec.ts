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
  Button: 'button', PluginArtworkDefault: 'svg', Switch: 'input', StateDot: 'span',
  Toast: 'aside', Modal: 'dialog', IconSettingsOutlineRegular: 'svg', IconWarningOutlineRegular: 'svg', Tag: 'span',
}))
import { BETA_PLUGIN_BUNDLES, BETA_PLUGINS_GROUP, registerPluginControls } from '../src/client/plugin-controls.tsx'
import { OFFICIAL_CONNECTORS, OFFICIAL_OAR_SUBAGENTS } from '../src/upstream-family-labels.ts'

afterEach(() => { hooks.states = []; hooks.cursor = 0; vi.unstubAllGlobals() })

type Node = { type: string | ((props: any) => Node); props: Record<string, any> }
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'type' in value && 'props' in value
    ? [value as Node, ...nodes((value as Node).props.children)] : []
const named = (tree: unknown, name: string): Node[] => nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === name)
const BASE_BUNDLES = ['dsh-community-market', 'dshmarket', '@agents-anywhere/dsh-bridge-next']

/** Register the Plugins overview against a Host whose official manager lists these bundles. */
function overview(packages: { name: string; enabled: boolean }[]) {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const hidden: string[] = []
  const groups: { options: Record<string, any>; view: (props: any) => Node }[] = []
  const locale = { language: 'zh' }
  let View: ((props: any) => Node) | undefined
  const ctx: any = {
    get: (key: string) => key === 'slots' ? ctx.slots : undefined,
    on: () => () => {},
    inject: (_services: unknown, callback: (context: unknown) => void) => { callback(ctx) },
    locale: { bind: () => (key: string) => key === 'language' ? locale.language : key },
    remote: {
      $on: () => () => {},
      pluginManager: { listBundles: vi.fn(async () => ({ ok: true as const, value: packages })), setBundleEnabled: vi.fn() },
    },
    slots: {
      // The official page's snapshot seeds the first render, as on a Host that already listed its bundles.
      _core: { entries: (name: string) => name === 'main' ? [{ options: { key: 'plugins' },
        inject: () => ({ hooks: { pluginManager: { getSnapshot: () => ({ status: 'ready', packages }) } } }) }] : [] },
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: Record<string, any>, view: (props: any) => Node) => {
        if (options.name === 'plugins.overview') View = view
        if (options.name === 'plugins.bundle.hidden') hidden.push(options.key)
        if (options.name === 'plugins.group') groups.push({ options, view })
        return () => {}
      },
    },
  }
  registerPluginControls(ctx as Context)
  const props = { context: ctx, t: (key: string) => key === 'language' ? 'zh' : key, onOpenBundle: vi.fn(), onOpenItem: vi.fn() }
  return { hidden, groups, locale, tree: () => { hooks.cursor = 0; return View!(props) } }
}

it.runIf(OFFICIAL_CONNECTORS !== undefined)('groups OAR subagents and the official connectors as Beta plugins, in that order', () => {
  expect(BETA_PLUGIN_BUNDLES).toEqual([OFFICIAL_OAR_SUBAGENTS.bundle, ...OFFICIAL_CONNECTORS!])
  const page = overview(BASE_BUNDLES.map(name => ({ name, enabled: false })))
  // The members leave the official lists through their group; only Desktop's own controls are hidden.
  expect(page.hidden).toEqual(BASE_BUNDLES)
  expect(page.groups).toHaveLength(1)
  const { options } = page.groups[0]!
  expect([options.id, options.order, options.locale]).toEqual([BETA_PLUGINS_GROUP, 0, 'desktop-next'])
  expect(options.inject()).toEqual({ bundles: BETA_PLUGIN_BUNDLES })
  expect(options.label()).toBe('Beta 插件')
  page.locale.language = 'en'
  expect(options.label()).toBe('Beta plugins')
})

it('keeps Remote Control and Computer Use (Next) as the only cards above the official groups', () => {
  const page = overview([...BASE_BUNDLES, OFFICIAL_OAR_SUBAGENTS.bundle].map(name => ({ name, enabled: false })))
  expect(named(page.tree(), 'PluginCard').map(node => node.props.title)).toEqual(['远程控制', 'Computer Use（Next）'])
})

it.runIf(OFFICIAL_CONNECTORS !== undefined)('says on the Beta plugins page that the official plugins are optional and may be incomplete', () => {
  const Notice = overview(BASE_BUNDLES.map(name => ({ name, enabled: false }))).groups[0]!.view
  const zh = Notice({ t: (key: string) => key === 'language' ? 'zh' : key, group: BETA_PLUGINS_GROUP, bundles: BETA_PLUGIN_BUNDLES })
  expect(zh.props.className).toBe('dshNextBetaPluginsNotice')
  // A Chinese notice of one sentence ends without 。, as the official pages write them.
  expect(zh.props.children).toBe('这些插件由官方提供，请按需下载、配置和开启，目前可能还不完善')
  const en = Notice({ t: (key: string) => key === 'language' ? 'en' : key, group: BETA_PLUGINS_GROUP, bundles: BETA_PLUGIN_BUNDLES })
  expect(en.props.children).toBe('These plugins come from the official DeepSeek Harness releases. Download, configure and enable them as you need them; they may still be incomplete.')
})
