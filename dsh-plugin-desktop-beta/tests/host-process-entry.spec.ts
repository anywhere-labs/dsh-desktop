import type { Serializable } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DESKTOP_PACKAGE_NAME } from '../src/product-identity.ts'

const entryProcess = process as typeof process & { noAsar?: boolean }
const processEvents: EventEmitter = process
type EntryEvent = 'unhandledRejection' | 'uncaughtException' | 'disconnect' | 'message'
const entryEvents: EntryEvent[] = ['unhandledRejection', 'uncaughtException', 'disconnect', 'message']
let preexisting = new Map<EntryEvent, Set<(...args: unknown[]) => void>>()
let originalSend: PropertyDescriptor | undefined
let originalConnected: PropertyDescriptor | undefined

function installedListeners(event: EntryEvent): Array<(...args: unknown[]) => void> {
  const before = preexisting.get(event) ?? new Set()
  return (processEvents.listeners(event) as Array<(...args: unknown[]) => void>).filter(listener => !before.has(listener))
}

function fakeParentIpc() {
  const outgoing: Serializable[] = []
  const send = vi.fn((message: Serializable, callback?: (error: Error | null) => void) => {
    outgoing.push(message)
    callback?.(null)
    return true
  })
  Object.defineProperty(process, 'send', { configurable: true, writable: true, value: send })
  Object.defineProperty(process, 'connected', { configurable: true, writable: true, value: true })
  return { send, outgoing, receive: (message: unknown) => processEvents.emit('message', message) }
}

beforeEach(() => {
  preexisting = new Map(entryEvents.map(event => [event, new Set(processEvents.listeners(event) as Array<(...args: unknown[]) => void>)]))
  originalSend = Object.getOwnPropertyDescriptor(process, 'send')
  originalConnected = Object.getOwnPropertyDescriptor(process, 'connected')
})

afterEach(() => {
  for (const event of entryEvents) for (const listener of installedListeners(event)) processEvents.off(event, listener)
  if (originalSend) Object.defineProperty(process, 'send', originalSend)
  else Reflect.deleteProperty(process, 'send')
  if (originalConnected) Object.defineProperty(process, 'connected', originalConnected)
  else Reflect.deleteProperty(process, 'connected')
  vi.restoreAllMocks()
  Reflect.deleteProperty(entryProcess, 'noAsar')
  vi.resetModules()
})

it('reads user workspaces physically once the Node-mode Host starts', async () => {
  const ipc = fakeParentIpc()
  Reflect.deleteProperty(entryProcess, 'noAsar')
  await import('../src/host-process-entry.ts')
  expect(entryProcess.noAsar).toBe(true)
  ipc.receive({ kind: 'call', id: 1, method: 'status', args: [] })
  await vi.waitFor(() => { expect(ipc.send).toHaveBeenCalledWith({ kind: 'result', id: 1,
    value: { pid: process.pid, services: { aaRuntime: false, aaOnboarding: false } } }, expect.any(Function)) })
})

it('fails loud on an unhandled rejection instead of serving on in a broken state', async () => {
  const ipc = fakeParentIpc()
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  await import('../src/host-process-entry.ts')
  const [onRejection, ...others] = installedListeners('unhandledRejection')
  expect(others).toHaveLength(0)
  onRejection?.(new Error('host boom'), Promise.resolve())
  await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(1) })
  expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join(''))
    .toContain(`${DESKTOP_PACKAGE_NAME}: fatal load failure: `)
  ipc.receive({ kind: 'call', id: 2, method: 'boot', args: [{ launchEnvironmentLayers: [] }, {}, 'token'] })
  await vi.waitFor(() => {
    expect(ipc.send).toHaveBeenCalledWith({ kind: 'result', id: 2,
      error: 'DSH Host generation already started or stopped' }, expect.any(Function))
  })
})

it('releases the Host and exits when its parent disconnects', async () => {
  fakeParentIpc()
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  await import('../src/host-process-entry.ts')
  processEvents.emit('disconnect')
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
})
