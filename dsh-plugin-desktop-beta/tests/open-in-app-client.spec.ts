/** Run the installed official Open In browser bundle against a fake Host, without a browser. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

type Shortcut = { id: string; resolve: () => { status: string; run?: () => void } }
type Plugin = { apply: (ctx: unknown) => void }

/** A snapshot store without persistence or subscribers. */
function store(state: unknown) {
  let current = state
  return { getSnapshot: () => current, set: (next: unknown) => { current = next }, subscribe: () => () => {} }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** Apply the bundle beside a Host that offers `apps`; record its dictionaries, shortcuts and Host requests. */
async function client(apps: string[]) {
  const requests: { url: string; method: string; body?: string }[] = []
  const fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    requests.push({ url, method: init.method ?? 'GET', ...init.body === undefined ? {} : { body: init.body } })
    return { ok: true, json: async () => ({ apps }) }
  }
  // React and most primitives matter only once a component renders.
  const modules: Record<string, unknown> = {
    '@deepseek-ai/dsh-client-store': { createSnapshotStore: store },
    '@deepseek-ai/dsh-client-ui-primitives': { isMobileDevice: () => false },
  }
  let plugin: Plugin
  const source = readFileSync(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-ui-open-in-app/client'), 'utf8')
  runInNewContext(source, { fetch, console, window: { __ModuleLoader__: {
    load: (entry: { factory: (require: (id: string) => unknown) => Plugin }) => { plugin = entry.factory(id => modules[id] ?? {}) },
  } } })
  let dictionaries: Record<string, Record<string, string>> = {}
  const shortcuts: Shortcut[] = []
  plugin!.apply({
    effect: (register: () => unknown) => register(),
    locale: { register: (_namespace: string, value: typeof dictionaries) => { dictionaries = value }, bind: () => (key: string) => key },
    shortcuts: { register: (shortcut: Shortcut) => { shortcuts.push(shortcut) }, catalog: store({}) },
    slots: { inject: () => {}, register: () => {} },
    // dsh 0.2.2 also offers its workspace actions through the context menu service.
    contextMenus: { register: () => () => {} },
    layout: { panelInfo: store({ activePanelId: null }) },
    sessions: { list: store({ byId: { session: { cwd: '/workspace', retainedBy: { mainView: 1 } } } }) },
    remote: {},
  })
  await settle()
  return { dictionaries, requests, shortcut: shortcuts.find(shortcut => shortcut.id === 'workspace.openLocal') }
}

it.each([['ptyxis', 'Ptyxis'], ['gnomeconsole', 'GNOME Console']])('offers the Host\'s %s under its product name', async (app, name) => {
  const { dictionaries, requests, shortcut } = await client([app])
  expect(Object.keys(dictionaries).length).toBeGreaterThan(1)
  for (const dictionary of Object.values(dictionaries)) expect(dictionary[`app.${app}`]).toBe(name)
  // The browser drops Host ids it has no name for; then the workspace shortcut has nothing to open.
  const resolved = shortcut?.resolve()
  expect(resolved?.status).toBe('handled')
  resolved?.run?.()
  await settle()
  expect(requests.at(-1)).toEqual({ url: 'open-in-app/open', method: 'POST', body: JSON.stringify({ app, path: '/workspace' }) })
})
