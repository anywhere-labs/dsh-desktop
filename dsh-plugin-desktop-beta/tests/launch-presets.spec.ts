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
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: 'button', Tag: 'span' }))
import { LAUNCH_PRESETS_ROUTE, matchLaunchPreset, type LaunchPresetBundle } from '../src/launch-presets.ts'
import { installLaunchPresets } from '../src/host/launch-presets.ts'
import { registerLaunchPresets } from '../src/client/launch-presets.tsx'

afterEach(() => { hooks.effects = []; hooks.states = []; hooks.cursor = 0; vi.unstubAllGlobals() })

type Node = { type: string | ((props: any) => Node); props: Record<string, any>; ref?: { current: unknown } | null }
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' && 'type' in value && 'props' in value
    ? [value as Node, ...nodes((value as Node).props.children)] : []
const named = (tree: unknown, name: string): Node[] => nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === name)
const render = (node: Node): Node => (node.type as (props: Node['props']) => Node)(node.props)

const text = (value: string) => ({ zh: value, en: value })
const preset = (id: string, extra: object = {}) => ({ id, title: text(id), description: text(`${id} choice`), launchArgs: ['--mode', id], ...extra })
const BUNDLE: LaunchPresetBundle = {
  bundle: '@example/agents',
  rows: [
    { id: 'agent-a', tag: 'Agent A', title: text('Agent A'), presets: [preset('locked'), preset('open', { shipped: true }), preset('free', { unrestricted: true })] },
    { id: 'agent-b', tag: 'Agent B', title: text('Agent B'), presets: [preset('locked')] },
  ],
}
const A = ['locked', 'open', 'free']
const B = ['locked']

/** A Host whose configuration editor runs the given rows, keyed by row id. */
function host(configs: Record<string, Record<string, unknown> | undefined>, failure?: Error) {
  const entries = Object.entries(configs).map(([id, config]) => ({ options: { id, name: 'example', config }, fiber: config === undefined ? undefined : {} }))
  const edit = vi.fn(async (entry: { options: { config: Record<string, unknown> } }, change: (current: Record<string, unknown>) => Record<string, unknown>) => {
    if (failure !== undefined) throw failure
    entry.options.config = change(entry.options.config)
  })
  let route: { path: string; methods: string[]; fetch(request: Request): Promise<Response> } | undefined
  const inner = {
    get: (name: string) => name === 'configEditor' ? { entries: () => entries, edit } : undefined,
    connection: { fetch: { register: (registration: typeof route) => { route = registration } } },
  }
  const root: any = { inject: (_names: string[], apply: (context: unknown) => void) => { apply(inner) } }
  installLaunchPresets(root as Context, BUNDLE)
  const call = async (body?: unknown) => {
    const response = await route!.fetch(new Request(`http://127.0.0.1${LAUNCH_PRESETS_ROUTE}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() as Record<string, any> }
  }
  return { route: () => route!, call, edit, entries }
}

it('matches a row only to the choice with exactly its launch arguments', () => {
  const row = BUNDLE.rows[0]!
  expect(matchLaunchPreset(row, ['--mode', 'open'])?.id).toBe('open')
  expect(matchLaunchPreset(row, ['--mode', 'open', '--verbose'])).toBeUndefined()
  expect(matchLaunchPreset(row, ['--mode'])).toBeUndefined()
  expect(matchLaunchPreset(row, undefined)).toBeUndefined()
})

it('reports which choice each running row uses and leaves rows that do not run unchangeable', async () => {
  const fixture = host({ 'agent-a': { runtime: 'a', launchArgs: ['--mode', 'open'] }, 'agent-b': undefined })
  expect(fixture.route().path).toBe(LAUNCH_PRESETS_ROUTE)
  expect(fixture.route().methods).toEqual(['GET', 'POST'])
  expect(await fixture.call()).toEqual({ status: 200, body: { rows: [
    { row: 'agent-a', active: true, preset: 'open', choices: A },
    { row: 'agent-b', active: false, preset: null, choices: B },
  ] } })
  const inactive = await fixture.call({ row: 'agent-b', preset: 'locked' })
  expect(inactive.status).toBe(409)
  expect(inactive.body.error).toBe('inactive')
  expect(fixture.edit).not.toHaveBeenCalled()
})

it('applies a declared choice through the configuration editor, replacing only the launch arguments', async () => {
  const fixture = host({ 'agent-a': { runtime: 'a', model: 'm', launchArgs: ['--custom'] } })
  expect((await fixture.call()).body.rows[0]).toEqual({ row: 'agent-a', active: true, preset: null, choices: A })
  const applied = await fixture.call({ row: 'agent-a', preset: 'free' })
  expect(applied).toEqual({ status: 200, body: { rows: [
    { row: 'agent-a', active: true, preset: 'free', choices: A },
    { row: 'agent-b', active: false, preset: null, choices: B },
  ] } })
  expect(fixture.edit).toHaveBeenCalledTimes(1)
  expect(fixture.entries[0]!.options.config).toEqual({ runtime: 'a', model: 'm', launchArgs: ['--mode', 'free'] })
})

it('refuses arguments that are not a declared choice and reports editor failures', async () => {
  const fixture = host({ 'agent-a': { launchArgs: ['--mode', 'open'] } })
  for (const body of [{ row: 'agent-a', preset: 'missing' }, { row: 'agent-c', preset: 'open' }, { row: 'agent-a', launchArgs: ['--anything'] }]) {
    expect((await fixture.call(body)).status, JSON.stringify(body)).toBe(400)
  }
  expect(fixture.edit).not.toHaveBeenCalled()
  const failing = host({ 'agent-a': { launchArgs: ['--mode', 'open'] } }, new Error('overridden by a home patch'))
  expect(await failing.call({ row: 'agent-a', preset: 'locked' })).toEqual({ status: 409, body: {
    error: 'overridden by a home patch', rows: [{ row: 'agent-a', active: true, preset: 'open', choices: A }, { row: 'agent-b', active: false, preset: null, choices: B }],
  } })
})

/** Register the pages and render one row's page against a stubbed Host route. */
async function page(rowId: string, rows: object[], post?: (body: unknown) => { status: number; body: object }) {
  const requests: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      requests.push(JSON.parse(String(init.body)))
      const reply = post!(JSON.parse(String(init.body)))
      return { ok: reply.status === 200, status: reply.status, json: async () => reply.body }
    }
    return { ok: true, status: 200, json: async () => ({ rows }) }
  }))
  const registrations: { name: string; key?: string; id?: string; view: (props: any) => unknown; props: Record<string, unknown> }[] = []
  const ctx: any = {
    on: () => () => {}, remote: { $on: () => () => {} },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (options: { name: string; key?: string; id?: string; inject: () => Record<string, unknown> }, view: (props: any) => unknown) => {
        registrations.push({ name: options.name, key: options.key, id: options.id, view, props: options.inject() })
        return () => {}
      },
    },
  }
  registerLaunchPresets(ctx as Context, BUNDLE)
  const registration = registrations.find(item => item.key === `${BUNDLE.bundle}#${rowId}`)!
  const props = { ...registration.props, t: (key: string) => key === 'language' ? 'zh' : key, view: 'page' }
  const tree = () => { hooks.cursor = 0; return render(registration.view(props) as Node) }
  tree()
  const cleanups = hooks.effects.splice(0).map(effect => effect())
  await new Promise(resolve => setTimeout(resolve, 0))
  /** Leave the row's page, as its back control does. */
  const close = (): void => { for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup() }
  return { registrations, registration, tree, requests, close }
}

it('gives every row a configuration page on its bundle page that summarizes it by its title', async () => {
  const { registrations, registration } = await page('agent-a', [])
  expect(registrations.map(item => [item.name, item.key ?? item.id])).toEqual([
    ['plugins.row.config', '@example/agents#agent-a'], ['plugins.row.config', '@example/agents#agent-b'],
    ['plugins.detail.badge', 'desktop-next-launch-presets'], ['plugins.detail.section', 'desktop-next-launch-presets']])
  expect(registration.view({ ...registration.props, t: () => 'zh', view: 'summary' })).toBe('Agent A')
})

it('tags each row page with what the row runs, as the official status tags look', async () => {
  const { registrations } = await page('agent-a', [])
  const badge = registrations.find(item => item.name === 'plugins.detail.badge')!
  const pkg = { name: BUNDLE.bundle }
  const tag = badge.view({ ...badge.props, subject: { kind: 'row', pkg, row: { rowId: 'agent-b' } } }) as Node
  expect([tag.type, tag.props.className, tag.props.tone, tag.props.children]).toEqual(['span', 'dshNextPluginStatusTag', 'info', 'Agent B'])
  expect(badge.view({ ...badge.props, subject: { kind: 'bundle', pkg } })).toBeNull()
  expect(badge.view({ ...badge.props, subject: { kind: 'row', pkg: { name: '@example/other' }, row: { rowId: 'agent-b' } } })).toBeNull()
  expect(badge.view({ ...badge.props, subject: { kind: 'row', pkg, row: { rowId: 'tool' } } })).toBeNull()
})

it('tags the rows in their bundle page component list beside each title control, only while that page shows', async () => {
  const { registrations } = await page('agent-a', [])
  const section = registrations.find(item => item.name === 'plugins.detail.section')!
  const sheet = nodes(section.view({ ...section.props, subject: { kind: 'bundle', pkg: { name: BUNDLE.bundle } } }))
    .find(node => node.type === 'style')!.props.children as string
  const selector = (row: string) => `[data-plugin-detail="@example/agents"] [data-plugin-row$="${row}"] button:first-child:not([role="switch"])::after`
  expect(sheet).toContain(`${selector('agent-a')}, ${selector('agent-b')} { display: inline-flex;`)
  expect(sheet).toContain('background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);')
  expect(sheet).toContain(`${selector('agent-a')} { content: "Agent A"; }`)
  expect(sheet).toContain(`${selector('agent-b')} { content: "Agent B"; }`)
  expect(section.view({ ...section.props, subject: { kind: 'row', pkg: { name: BUNDLE.bundle }, row: { rowId: 'agent-a' } } })).toBeNull()
})

it('returns from a row page to where its bundle page was scrolled, and opens the bundle page afresh otherwise', async () => {
  const frames: (() => void)[] = []
  const rowPage = await page('agent-a', [{ row: 'agent-a', active: true, preset: 'open', choices: A }])
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const section = rowPage.registrations.find(item => item.name === 'plugins.detail.section')!
  let onScroll: (() => void) | undefined
  const body = { scrollTop: 0, addEventListener: (_type: string, listener: () => void) => { onScroll = listener }, removeEventListener: () => {} }
  /** Open a detail page: render the section, attach its anchor and run its effect. */
  const open = (subject: object) => {
    hooks.effects = []
    const tree = section.view({ ...section.props, subject })
    const anchor = nodes(tree).find(node => node.type === 'span')
    // React 18 keeps an element's ref beside its props.
    if (anchor !== undefined) anchor.ref!.current = { closest: (selector: string) => selector === '[data-plugin-body]' ? body : null }
    const cleanups = hooks.effects.splice(0).map(effect => effect())
    return () => { for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup() }
  }
  const bundlePage = { kind: 'bundle', pkg: { name: BUNDLE.bundle } }
  expect(section.view({ ...section.props, subject: { kind: 'bundle', pkg: { name: '@example/other' } } })).toBeNull()
  let leave = open(bundlePage)
  body.scrollTop = 640
  onScroll!()
  leave()
  // The short row page clamps the shared scroll container before the person returns.
  body.scrollTop = 0
  rowPage.close()
  leave = open(bundlePage)
  for (const frame of frames.splice(0)) frame()
  expect(body.scrollTop).toBe(640)
  leave()
  // Opened again from the list, not from a row page: the page keeps the position it opens at.
  body.scrollTop = 0
  open(bundlePage)
  expect(frames).toHaveLength(0)
  expect(body.scrollTop).toBe(0)
})

it('selects the running choice, marks the shipped and unrestricted ones, and saves a staged change', async () => {
  const { tree, requests } = await page('agent-a', [{ row: 'agent-a', active: true, preset: 'open', choices: A }],
    () => ({ status: 200, body: { rows: [{ row: 'agent-a', active: true, preset: 'free', choices: A }] } }))
  const choices = named(tree(), 'Choice')
  expect(choices.map(choice => [choice.props.title, choice.props.selected, choice.props.disabled, choice.props.badge]))
    .toEqual([['locked', false, false, undefined], ['open', true, false, '默认'], ['free', false, false, '不受限制']])
  const save = () => nodes(tree()).find(node => node.type === 'button')!
  expect(save().props.disabled).toBe(true)
  choices[2]!.props.action()
  expect(save().props.disabled).toBe(false)
  save().props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(requests).toEqual([{ row: 'agent-a', preset: 'free' }])
  const saved = tree()
  expect(named(saved, 'Choice')[2]!.props.selected).toBe(true)
  expect(nodes(saved).find(node => node.props.role === 'status')?.props.children).toBe('已保存，之后委派的任务按新设置启动。')
  expect(nodes(saved).find(node => node.type === 'button')!.props.disabled).toBe(true)
})

it('locks the choices of a row that does not run and explains a custom configuration', async () => {
  const stopped = await page('agent-a', [{ row: 'agent-a', active: false, preset: null }])
  expect(named(stopped.tree(), 'Choice').every(choice => choice.props.disabled)).toBe(true)
  expect(nodes(stopped.tree()).find(node => node.type === 'button')!.props.disabled).toBe(true)
  hooks.states = []
  const custom = await page('agent-a', [{ row: 'agent-a', active: true, preset: null, choices: A }])
  expect(named(custom.tree(), 'Choice').some(choice => choice.props.selected)).toBe(false)
  expect(nodes(custom.tree()).some(node => node.props.children === '这一行正在使用自定义启动参数，选择下面任一项会替换它们。')).toBe(true)
})
