import { afterEach, expect, it, vi } from 'vitest'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Minimal React scheduler: refs persist by call order; effects re-run only when their deps change. */
const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: (() => void) | void }[],
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
  desktopDirectoryPicker, registerDesktopDirectoryPicker, type NativeDirectoryFlowInjected,
} from '../src/client/directory-picker.ts'

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
