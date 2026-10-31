import { afterEach, expect, it, vi } from 'vitest'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Minimal React scheduler: refs persist by call order; effects re-run only when their deps change. */
const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[] | undefined; cleanup?: (() => void) | void }[],
  queued: [] as (() => void)[],
  cursor: { ref: 0, effect: 0 },
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const index = hooks.cursor.ref++
    return hooks.refs[index] ??= { current: initial }
  },
  useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const index = hooks.cursor.effect++
    const slot = hooks.effects[index] ??= {}
    const previous = slot.deps
    const changed = previous === undefined || deps === undefined || deps.length !== previous.length
      || deps.some((value, position) => !Object.is(value, previous[position]))
    if (!changed) return
    slot.deps = deps
    hooks.queued.push(() => { slot.cleanup?.(); slot.cleanup = effect() })
  },
}))
import {
  DESKTOP_DIRECTORY_FLOW_PRIORITY, DESKTOP_DIRECTORY_PICKER_GLOBAL, DIRECTORY_FLOW_HOLES, NativeDirectoryFlow,
  desktopDirectoryPicker, registerDesktopDirectoryPicker, createNativeDirectorySelectionQueue, type NativeDirectoryFlowInjected,
} from '../src/client/native-directory-flow.ts'

type FlowProps = DirectoryFlowOwnerProps & NativeDirectoryFlowInjected
const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }

function reset(): void {
  hooks.refs = []
  hooks.effects = []
  hooks.queued = []
  hooks.cursor = { ref: 0, effect: 0 }
}
afterEach(() => { reset(); vi.unstubAllGlobals() })

/** One mounted occupant: render re-runs the component and flushes the effects whose deps changed. */
function mount() {
  return {
    render(props: FlowProps): ReturnType<typeof NativeDirectoryFlow> {
      hooks.cursor = { ref: 0, effect: 0 }
      const output = NativeDirectoryFlow(props)
      for (const run of hooks.queued.splice(0)) run()
      return output
    },
    unmount(): void {
      for (const slot of [...hooks.effects].reverse()) slot.cleanup?.()
      reset()
    },
  }
}

function owner(overrides: Partial<DirectoryFlowOwnerProps> = {}): DirectoryFlowOwnerProps {
  return { open: true, busy: false, onPicked: vi.fn(), onCancel: vi.fn(), onError: vi.fn(), ...overrides }
}

it('reads the Desktop preload bridge only when it exposes a pick call', () => {
  expect(desktopDirectoryPicker({})).toBeUndefined()
  expect(desktopDirectoryPicker({ [DESKTOP_DIRECTORY_PICKER_GLOBAL]: null })).toBeUndefined()
  expect(desktopDirectoryPicker({ [DESKTOP_DIRECTORY_PICKER_GLOBAL]: { pick: '/not-a-function' } })).toBeUndefined()
  expect(desktopDirectoryPicker()).toBeUndefined()
  const bridge = { pick: vi.fn(function (this: unknown) { return Promise.resolve(this === bridge ? '/picked' : '/unbound') }) }
  vi.stubGlobal(DESKTOP_DIRECTORY_PICKER_GLOBAL, bridge)
  const picker = desktopDirectoryPicker()
  expect(picker).toBeDefined()
  // The bridge call keeps its receiver: contextBridge objects are not detachable.
  return expect(picker!.pick()).resolves.toBe('/picked')
})

it('shadows both directory-flow holes below the Host-mounted occupant and withdraws as one effect', async () => {
  const injections: string[] = []
  const registrations: { name: string; priority?: number; inject?: () => unknown; component: unknown }[] = []
  const disposed: string[] = []
  const slots = {
    inject: (name: string, register: () => unknown) => {
      injections.push(name)
      const result = register()
      const disposers: (() => void)[] = []
      if (result && typeof result === 'object' && Symbol.iterator in result) {
        for (const dispose of result as Iterable<() => void>) disposers.push(dispose)
      } else if (typeof result === 'function') disposers.push(result as () => void)
      return () => { for (const dispose of disposers.reverse()) dispose() }
    },
    register: (options: { name: string; priority?: number; inject?: () => unknown }, component: unknown) => {
      registrations.push({ ...options, component })
      return () => { disposed.push(options.name) }
    },
  }
  const picker = { pick: vi.fn(async () => '/Users/me/project') }
  let withdraw!: () => void
  const ctx = { slots: { ...slots, inject: (name: string, register: () => unknown) => {
    const dispose = slots.inject(name, register)
    if (name === DIRECTORY_FLOW_HOLES[0]) withdraw = dispose
    return dispose
  } } }
  registerDesktopDirectoryPicker(ctx as never, picker)
  // The sidebar hole waits inside the hero hole's injection: both declarations must be live.
  expect(injections).toEqual([...DIRECTORY_FLOW_HOLES])
  expect(registrations.map(entry => [entry.name, entry.priority, entry.component])).toEqual(
    DIRECTORY_FLOW_HOLES.map(name => [name, DESKTOP_DIRECTORY_FLOW_PRIORITY, NativeDirectoryFlow]))
  expect(DESKTOP_DIRECTORY_FLOW_PRIORITY).toBeLessThan(0)
  const injected = registrations[0]!.inject!() as NativeDirectoryFlowInjected
  await expect(injected.pick()).resolves.toBe('/Users/me/project')
  expect(picker.pick).toHaveBeenCalledOnce()
  withdraw()
  expect(disposed).toEqual([...DIRECTORY_FLOW_HOLES].reverse())
})

it('runs one dialog per open edge and reports the path to the latest onPicked', async () => {
  let resolve!: (path: string | null) => void
  const pick = vi.fn(() => new Promise<string | null>((settlePick) => { resolve = settlePick }))
  const first = owner()
  const view = mount()
  expect(view.render({ ...first, pick })).toBeNull()
  expect(pick).toHaveBeenCalledOnce()
  // Re-renders while open (busy flips, handler identity changes) must not relaunch the dialog.
  const second = owner()
  view.render({ ...second, busy: true, pick })
  expect(pick).toHaveBeenCalledOnce()
  // A re-created injected face (re-registration re-runs the inject factory) must not either.
  const replacedPick = vi.fn(() => new Promise<string | null>(() => {}))
  view.render({ ...second, busy: true, pick: replacedPick })
  expect(replacedPick).not.toHaveBeenCalled()
  resolve('/tmp/project')
  await settle()
  expect(second.onPicked).toHaveBeenCalledExactlyOnceWith('/tmp/project')
  expect(first.onPicked).not.toHaveBeenCalled()
})

it('reports null as cancellation and re-arms after the owner withdraws open', async () => {
  const pick = vi.fn(async (): Promise<string | null> => null)
  const props = owner()
  const view = mount()
  view.render({ ...props, pick })
  await settle()
  expect(props.onCancel).toHaveBeenCalledOnce()
  expect(props.onPicked).not.toHaveBeenCalled()
  view.render({ ...props, open: false, pick })
  expect(pick).toHaveBeenCalledOnce()
  view.render({ ...props, pick })
  await settle()
  expect(pick).toHaveBeenCalledTimes(2)
  expect(props.onCancel).toHaveBeenCalledTimes(2)
})

it('folds dialog failures into onError messages', async () => {
  const failing = owner()
  mount().render({ ...failing, pick: vi.fn(async () => { throw new Error('dialog unavailable') }) })
  await settle()
  expect(failing.onError).toHaveBeenCalledExactlyOnceWith('dialog unavailable')
  expect(failing.onCancel).not.toHaveBeenCalled()
  reset()
  const nonError = owner()
  mount().render({ ...nonError, pick: vi.fn(async () => { throw 'denied' }) })
  await settle()
  expect(nonError.onError).toHaveBeenCalledExactlyOnceWith('denied')
})

it('discards a settlement that lands after the occupant unmounted', async () => {
  let resolve!: (path: string | null) => void
  const pick = vi.fn(() => new Promise<string | null>((settlePick) => { resolve = settlePick }))
  const props = owner()
  const view = mount()
  view.render({ ...props, pick })
  view.unmount()
  resolve('/tmp/late')
  await settle()
  expect(props.onPicked).not.toHaveBeenCalled()
  expect(props.onCancel).not.toHaveBeenCalled()
  expect(props.onError).not.toHaveBeenCalled()
  let reject!: (reason: unknown) => void
  const failing = vi.fn(() => new Promise<string | null>((_settlePick, rejectPick) => { reject = rejectPick }))
  const late = owner()
  const failingView = mount()
  failingView.render({ ...late, pick: failing })
  failingView.unmount()
  reject(new Error('too late'))
  await settle()
  expect(late.onError).not.toHaveBeenCalled()
})

it('delivers all roots to the latest multi-folder owner using one dialog', async () => {
  let resolve!: (paths: readonly string[]) => void
  const pick = vi.fn(async () => '/unused')
  const pickMany = vi.fn(() => new Promise<readonly string[]>(accept => { resolve = accept }))
  const first = owner({ onPickedDirectories: vi.fn() })
  const latest = owner({ onPickedDirectories: vi.fn() })
  const view = mount()
  view.render({ ...first, pick, pickMany })
  view.render({ ...latest, pick, pickMany })
  resolve(['/frontend', '/backend'])
  await settle()
  expect(pickMany).toHaveBeenCalledOnce()
  expect(pick).not.toHaveBeenCalled()
  expect(latest.onPickedDirectories).toHaveBeenCalledExactlyOnceWith(['/frontend', '/backend'])
  expect(first.onPickedDirectories).not.toHaveBeenCalled()
  expect(latest.onPicked).not.toHaveBeenCalled()
})

it('keeps legacy owners on the single picker and treats empty multi-selection as cancellation', async () => {
  const pick = vi.fn(async () => '/single')
  const pickMany = vi.fn(async () => [])
  const legacy = owner()
  mount().render({ ...legacy, pick, pickMany })
  await settle()
  expect(legacy.onPicked).toHaveBeenCalledExactlyOnceWith('/single')
  expect(pickMany).not.toHaveBeenCalled()
  reset()
  const multiple = owner({ onPickedDirectories: vi.fn() })
  mount().render({ ...multiple, pick, pickMany })
  await settle()
  expect(multiple.onCancel).toHaveBeenCalledOnce()
  expect(multiple.onPickedDirectories).not.toHaveBeenCalled()
})

it('does not deliver a dismissed request into a newer open edge', async () => {
  const resolvers: ((paths: readonly string[]) => void)[] = []
  const pick = vi.fn(async () => null)
  const pickMany = vi.fn(() => new Promise<readonly string[]>(resolve => { resolvers.push(resolve) }))
  const props = owner({ onPickedDirectories: vi.fn() })
  const view = mount()
  view.render({ ...props, pick, pickMany })
  view.render({ ...props, open: false, pick, pickMany })
  view.render({ ...props, pick, pickMany })
  resolvers[0]!(['/stale'])
  await settle()
  expect(props.onPickedDirectories).not.toHaveBeenCalled()
  resolvers[1]!(['/fresh', '/second'])
  await settle()
  expect(props.onPickedDirectories).toHaveBeenCalledExactlyOnceWith(['/fresh', '/second'])
})


it('waits out a withdrawn native promise before reopening a coalesced picker', async () => {
  let active: Promise<readonly string[]> | undefined
  const settleNative: ((roots: readonly string[]) => void)[] = []
  const pickMany = vi.fn(() => {
    active ??= new Promise<readonly string[]>(resolve => { settleNative.push(resolve) }).finally(() => { active = undefined })
    return active
  })
  const pick = vi.fn(async () => null)
  const props = owner({ onPickedDirectories: vi.fn() })
  const view = mount()
  view.render({ ...props, pick, pickMany })
  view.render({ ...props, open: false, pick, pickMany })
  view.render({ ...props, pick, pickMany })
  expect(pickMany).toHaveBeenCalledOnce()
  settleNative[0]!(['/withdrawn'])
  await settle()
  expect(props.onPickedDirectories).not.toHaveBeenCalled()
  expect(pickMany).toHaveBeenCalledTimes(2)
  settleNative[1]!(['/new-primary', '/new-secondary'])
  await settle()
  expect(props.onPickedDirectories).toHaveBeenCalledExactlyOnceWith(['/new-primary', '/new-secondary'])
})


it("keeps a remounted occupant from adopting an unmounted occupant's coalesced dialog", async () => {
  let active: Promise<readonly string[]> | undefined
  const settleNative: ((roots: readonly string[]) => void)[] = []
  const pickMany = vi.fn(() => {
    active ??= new Promise<readonly string[]>(resolve => { settleNative.push(resolve) }).finally(() => { active = undefined })
    return active
  })
  const schedule = createNativeDirectorySelectionQueue()
  const pick = vi.fn(async () => null)
  const old = owner({ onPickedDirectories: vi.fn() })
  const first = mount()
  first.render({ ...old, pick, pickMany, schedule })
  first.unmount()
  const fresh = owner({ onPickedDirectories: vi.fn() })
  const second = mount()
  second.render({ ...fresh, pick, pickMany, schedule })
  expect(pickMany).toHaveBeenCalledOnce()
  settleNative[0]!(['/old'])
  await settle()
  expect(old.onPickedDirectories).not.toHaveBeenCalled()
  expect(fresh.onPickedDirectories).not.toHaveBeenCalled()
  expect(pickMany).toHaveBeenCalledTimes(2)
  settleNative[1]!(['/new-primary', '/new-secondary'])
  await settle()
  expect(fresh.onPickedDirectories).toHaveBeenCalledExactlyOnceWith(['/new-primary', '/new-secondary'])
})

it('does not open a queued native dialog after its occupant also unmounts', async () => {
  let finish!: (roots: readonly string[]) => void
  const firstPick = vi.fn(() => new Promise<readonly string[]>(resolve => { finish = resolve }))
  const queuedPick = vi.fn(async () => ['/should-not-open'])
  const schedule = createNativeDirectorySelectionQueue()
  const pick = vi.fn(async () => null)
  const first = mount()
  first.render({ ...owner({ onPickedDirectories: vi.fn() }), pick, pickMany: firstPick, schedule })
  first.unmount()
  const second = mount()
  second.render({ ...owner({ onPickedDirectories: vi.fn() }), pick, pickMany: queuedPick, schedule })
  second.unmount()
  finish(['/old'])
  await settle()
  expect(queuedPick).not.toHaveBeenCalled()
})
