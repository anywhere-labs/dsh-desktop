/** Run the installed official sidebar bundle with the official store and a window storage that outlives each load. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

const KEY = 'dsh-desktop.sidebar.panel-pins'
afterEach(() => { vi.unstubAllGlobals() })

type Storage = ReturnType<typeof windowStorage>
type Pins = { setPinned: (id: string, pinned: boolean) => void; hooks: { entryPins: { getSnapshot: () => readonly string[] } } }

/** The window's local storage; the Desktop keeps it in its data directory across launches. */
function windowStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

/** Load the installed sidebar as one launch of the Web client does, beside two registered panels. */
function launch(storage: Storage | undefined): Pins {
  // The official store reads storage from its own global; the bundle reads the window's.
  vi.unstubAllGlobals()
  if (storage !== undefined) vi.stubGlobal('localStorage', storage)
  const modules: Record<string, unknown> = {
    '@deepseek-ai/dsh-client-store': { createSnapshotStore },
    '@deepseek-ai/dsh-client-ui-slots': { resolveSlotLabel: (label: unknown) => label },
  }
  let plugin: { apply: (ctx: unknown) => void }
  const source = readFileSync(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-ui-sidebar/client'), 'utf8')
  runInNewContext(source, { console, ...storage === undefined ? {} : { localStorage: storage }, window: { __ModuleLoader__: {
    load: (entry: { factory: (require: (id: string) => unknown) => typeof plugin }) => { plugin = entry.factory(id => modules[id] ?? {}) },
  } } })
  let sidebar: Pins | undefined
  const noop = () => () => {}
  const panels = [{ options: { id: 'schedules', order: 10, label: 'Automations' } }, { options: { id: 'forge-review', order: 20, label: 'Code review' } }]
  plugin!.apply({
    get: () => undefined,
    effect: (register: () => unknown) => register(),
    locale: { register: noop, subscribe: noop },
    shortcuts: { catalog: {} },
    slots: {
      entriesOfSlot: (name: string) => name === 'sidebar.panellist' ? panels : [],
      subscribe: noop,
      registerFactory: noop,
      inject: (_name: string, register: () => unknown) => {
        const result = register()
        if (result !== null && typeof result === 'object' && Symbol.iterator in result) [...result as Iterable<unknown>]
      },
      register: (options: { name: string; inject?: () => Pins }) => {
        if (options.name === 'sidebar') sidebar = options.inject!()
        return () => {}
      },
    },
  })
  return sidebar!
}

it('keeps the sidebar pin choices across launches in window storage under a Desktop key', () => {
  const storage = windowStorage()
  const first = launch(storage)
  expect(first.hooks.entryPins.getSnapshot()).toEqual([])
  first.setPinned('schedules', false)
  first.setPinned('forge-review', false)
  // Pinning Code review back from More leaves only Automations in More; Plugins never leaves the sidebar.
  first.setPinned('forge-review', true)
  first.setPinned('plugins', false)
  expect(first.hooks.entryPins.getSnapshot()).toEqual(['schedules'])
  expect(JSON.parse(storage.values.get(KEY)!)).toEqual({ unpinned: ['schedules'] })
  const second = launch(storage)
  expect(second.hooks.entryPins.getSnapshot()).toEqual(['schedules'])
  second.setPinned('schedules', true)
  expect(launch(storage).hooks.entryPins.getSnapshot()).toEqual([])
  // The official key from before upstream stopped persisting pins stays ignored.
  const legacy = windowStorage({ 'dsh.slot.manual-order.sidebar.panellist.v1': '{"unpinned":["schedules"]}' })
  expect(launch(legacy).hooks.entryPins.getSnapshot()).toEqual([])
})

it.each(['{"unpinned":"schedules"}', '{"unpinned":[1]}', '{}', 'null', '"schedules"', '{'])('drops the stored value %s and shows every entry', (stored) => {
  const storage = windowStorage({ [KEY]: stored })
  const pins = launch(storage)
  expect(pins.hooks.entryPins.getSnapshot()).toEqual([])
  expect(storage.values.has(KEY)).toBe(false)
  pins.setPinned('schedules', false)
  expect(JSON.parse(storage.values.get(KEY)!)).toEqual({ unpinned: ['schedules'] })
})

it('keeps the choices in memory where the page has no window storage', () => {
  const pins = launch(undefined)
  pins.setPinned('schedules', false)
  expect(pins.hooks.entryPins.getSnapshot()).toEqual(['schedules'])
  expect(launch(undefined).hooks.entryPins.getSnapshot()).toEqual([])
})
