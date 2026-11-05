import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DESKTOP_PACKAGE_NAME } from '../src/product-identity.ts'

type EntryProcess = { parentPort?: unknown, noAsar?: boolean }
const entryProcess = process as unknown as EntryProcess
const processEvents: EventEmitter = process
type FatalEvent = 'unhandledRejection' | 'uncaughtException'
const fatalEvents: FatalEvent[] = ['unhandledRejection', 'uncaughtException']
let preexisting = new Map<FatalEvent, Set<(...args: unknown[]) => void>>()

/** Listeners the entry installed on this test worker's own process; they must not outlive the test. */
function installedListeners(event: FatalEvent): Array<(...args: unknown[]) => void> {
  const before = preexisting.get(event) ?? new Set()
  return (processEvents.listeners(event) as Array<(...args: unknown[]) => void>).filter(listener => !before.has(listener))
}

function fakeParentPort() {
  let receive: ((event: { data: unknown }) => void) | undefined
  const parentPort = {
    postMessage: vi.fn(),
    on: vi.fn((_event: string, listener: (event: { data: unknown }) => void) => { receive = listener }),
    removeListener: vi.fn(),
  }
  return { parentPort, send: (data: unknown) => { receive?.({ data }) } }
}

beforeEach(() => {
  preexisting = new Map(fatalEvents.map(event => [event, new Set(processEvents.listeners(event) as Array<(...args: unknown[]) => void>)]))
})

afterEach(() => {
  for (const event of fatalEvents) for (const listener of installedListeners(event)) processEvents.off(event, listener)
  vi.restoreAllMocks()
  delete entryProcess.parentPort
  delete entryProcess.noAsar
  vi.resetModules()
})

it('reads user workspaces physically once the Host utility process starts', async () => {
  const { parentPort } = fakeParentPort()
  entryProcess.parentPort = parentPort
  delete entryProcess.noAsar

  await import('../src/host-process-entry.ts')

  expect(entryProcess.noAsar).toBe(true)
  expect(parentPort.on).toHaveBeenCalledWith('message', expect.any(Function))
})

it('fails loud on an unhandled rejection instead of serving on in a broken state', async () => {
  // A utility process only prints a warning for an unhandled rejection and keeps running.
  const { parentPort, send } = fakeParentPort()
  entryProcess.parentPort = parentPort
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  await import('../src/host-process-entry.ts')
  const [onRejection, ...others] = installedListeners('unhandledRejection')
  expect(others).toHaveLength(0)
  onRejection?.(new Error('host boom'), Promise.resolve())

  await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(1) })
  const written = stderr.mock.calls.map(([chunk]) => String(chunk)).join('')
  expect(written).toContain(`${DESKTOP_PACKAGE_NAME}: fatal load failure: `)
  expect(written).toContain('host boom')
  // The generation was released before exit, so it refuses to boot again.
  send({ kind: 'call', id: 1, method: 'boot', args: [{ launchEnvironmentLayers: [] }, {}, 'token'] })
  await vi.waitFor(() => {
    expect(parentPort.postMessage).toHaveBeenCalledWith({ kind: 'result', id: 1, error: 'DSH Host generation already started or stopped' })
  })
})
