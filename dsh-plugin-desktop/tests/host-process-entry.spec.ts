import { afterEach, expect, it, vi } from 'vitest'

type EntryProcess = { parentPort?: unknown, noAsar?: boolean }
const entryProcess = process as unknown as EntryProcess

afterEach(() => {
  delete entryProcess.parentPort
  delete entryProcess.noAsar
  vi.resetModules()
})

it('reads user workspaces physically once the Host utility process starts', async () => {
  const parentPort = { postMessage: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
  entryProcess.parentPort = parentPort
  delete entryProcess.noAsar

  await import('../src/host-process-entry.ts')

  expect(entryProcess.noAsar).toBe(true)
  expect(parentPort.on).toHaveBeenCalledWith('message', expect.any(Function))
})
