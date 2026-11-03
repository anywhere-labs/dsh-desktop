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
  Toast: 'aside', Modal: 'dialog', IconSettingsOutlineRegular: 'svg', IconWarningOutlineRegular: 'svg', Tag: 'span',
}))
import { registerPluginControls } from '../src/client/plugin-controls.tsx'

afterEach(() => { hooks.effects = []; hooks.states = []; hooks.cursor = 0; vi.unstubAllGlobals() })

type Node = { type: string | ((props: any) => Node); props: Record<string, any> }
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'type' in value && 'props' in value
    ? [value as Node, ...nodes((value as Node).props.children)] : []
const named = (tree: unknown, name: string): Node[] => nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === name)
const render = (node: Node): Node => (node.type as (props: Node['props']) => Node)(node.props)
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** The row Next's own Profile layer declares for the plugin, as the official manager lists it. */
const ROW = { entryId: 'include:tokens-anywhere', patchId: 'tokens-anywhere', moduleName: 'tokens-anywhere', enabled: true, fiberPhase: 'active' }

/** Register the Plugins overview against a Host whose official manager lists these plugin rows. */
function overview(rows: Record<string, unknown>[]) {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const listPlugins = vi.fn(async () => ({ ok: true as const, value: rows }))
  const setPluginEnabled = vi.fn(async (_id: string, _enabled: boolean) => ({ ok: true as const, value: { application: 'applied' } }))
  const selectPanel = vi.fn()
  let View: ((props: any) => Node) | undefined
  let face: Record<string, unknown> = {}
  const ctx: any = {
    get: () => undefined,
    on: () => () => {},
    inject: (_services: unknown, callback: (context: unknown) => void) => { callback(ctx) },
    layout: { selectPanel },
    remote: {
      $on: () => () => {},
      pluginManager: { listBundles: vi.fn(async () => ({ ok: true as const, value: [] })), listPlugins, setPluginEnabled },
    },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: { name: string; inject?: () => Record<string, unknown> }, view: (props: any) => Node) => {
        if (options.name === 'plugins.overview') { View = view; face = options.inject!() }
        return () => {}
      },
    },
  }
  registerPluginControls(ctx as Context)
  const props = { ...face, t: (key: string) => key === 'language' ? 'zh' : key, onOpenBundle: vi.fn(), onOpenItem: vi.fn() }
  const tree = (): Node => { hooks.cursor = 0; return View!(props) }
  return {
    listPlugins, setPluginEnabled, selectPanel, tree,
    card: (): Node => named(tree(), 'PluginCard')[1]!,
    actions: (): Node[] => nodes(render(named(tree(), 'TokensAnywhereActions')[0]!)),
    /** Mount the page: run the effects of one render, as React would after it, and let the listings answer. */
    mount: async (): Promise<void> => {
      hooks.effects = []
      tree()
      for (const effect of hooks.effects.splice(0)) effect()
      await vi.waitFor(() => { expect(listPlugins).toHaveBeenCalledOnce() })
      await settle()
    },
  }
}

it('puts Tokens Anywhere between Remote Control and Computer Use (Next), with its artwork and the Beta tag of its account page', () => {
  const page = overview([ROW])
  const cards = named(page.tree(), 'PluginCard')
  expect(cards.slice(0, 3).map(node => node.props.title)).toEqual(['远程控制', 'Tokens Anywhere', 'Computer Use（Next）'])
  const card = cards[1]!
  expect(card.props.description).toBe('登录 Tokens Anywhere 账户，自动配置模型，查看余额和用量。')
  expect(typeof card.props.icon.type === 'function' && card.props.icon.type.name).toBe('TokensAnywhereArtwork')
  // The official Beta tag: the info tone, as on the Plugins page's own cards.
  expect([card.props.tags.type, card.props.tags.props.tone, card.props.tags.props.children]).toEqual(['span', 'info', 'Beta'])
})

it('lists the row on mount, not at registration, and switches it through the official manager', async () => {
  const page = overview([{ entryId: 'include:other', moduleName: 'other-plugin', enabled: true, fiberPhase: 'active' }, ROW])
  await Promise.resolve()
  expect(page.listPlugins).not.toHaveBeenCalled()
  const waiting = page.actions().find(node => node.type === 'input')!
  expect([waiting.props.checked, waiting.props.disabled]).toEqual([false, true])
  expect(page.card().props.onOpen).toBeUndefined()
  await page.mount()
  const toggle = page.actions().find(node => node.type === 'input')!
  expect([toggle.props.label, toggle.props.checked, toggle.props.disabled]).toEqual(['启用 Tokens Anywhere', true, false])
  expect(page.actions().find(node => node.type === 'button')!.props.disabled).toBe(false)
  expect(page.card().props.onOpen).toBeTypeOf('function')
  toggle.props.onChange(false)
  await vi.waitFor(() => { expect(page.setPluginEnabled).toHaveBeenCalledExactlyOnceWith('include:tokens-anywhere', false) })
  await settle()
  const off = page.actions()
  expect(off.find(node => node.type === 'input')!.props.checked).toBe(false)
  expect(off.find(node => node.type === 'button')!.props.disabled).toBe(true)
  expect(page.card().props.onOpen).toBeUndefined()
})

it('keeps the switch locked in a Profile without the row', async () => {
  const page = overview([])
  await page.mount()
  const actions = page.actions()
  expect(actions.find(node => node.type === 'input')!.props.disabled).toBe(true)
  expect(actions.find(node => node.type === 'button')!.props.disabled).toBe(true)
  expect(page.card().props.onOpen).toBeUndefined()
})

it('leaves the card and its button inert while the plugin is off, without an error', async () => {
  const page = overview([{ ...ROW, enabled: false, fiberPhase: null }])
  await page.mount()
  const card = page.card()
  expect(card.props.onOpen).toBeUndefined()
  // Nothing to open: the title is plain text and the card is marked for no hover.
  const drawn = nodes(render(card))
  expect(drawn[0]!.props['data-static']).toBe('')
  expect(drawn.some(node => node.type === 'button')).toBe(false)
  expect(drawn.find(node => node.props.className === 'dshNextPluginCardName')?.props.children).toBe('Tokens Anywhere')
  const actions = page.actions()
  expect(actions.find(node => node.type === 'button')!.props.disabled).toBe(true)
  expect(actions.find(node => node.props.role === 'alert')).toBeUndefined()
})

it('opens the account page from the card and from its button', async () => {
  const page = overview([ROW])
  await page.mount()
  const drawn = nodes(render(page.card()))
  expect(drawn[0]!.props['data-static']).toBeUndefined()
  expect(drawn.find(node => node.type === 'button')!.props.className).toBe('dshNextPluginCardOpen')
  page.card().props.onOpen()
  expect(page.selectPanel).toHaveBeenCalledExactlyOnceWith('tokens-anywhere')
  page.actions().find(node => node.type === 'button')!.props.onClick()
  expect(page.selectPanel).toHaveBeenCalledTimes(2)
  expect(page.actions().find(node => node.props.role === 'alert')).toBeUndefined()
})

it.each<[string, Record<string, unknown>, string]>([
  ['the plugin failed to load', { ...ROW, fiberPhase: 'failed' }, 'Tokens Anywhere 加载失败。'],
  ['the plugin has not registered its page yet', ROW, 'Tokens Anywhere 尚未就绪，请稍后重试。'],
])('says why the account page cannot open when %s', async (_case, row, message) => {
  const page = overview([row])
  await page.mount()
  // Selecting a main panel nobody registered throws, as the official layout does.
  page.selectPanel.mockImplementation(() => { throw new Error('unregistered main panel') })
  page.card().props.onOpen()
  expect(page.actions().find(node => node.props.role === 'alert')?.props.children).toBe(message)
})
