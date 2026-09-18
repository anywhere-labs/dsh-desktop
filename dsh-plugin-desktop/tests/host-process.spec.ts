import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type { DesktopStartupGenerationHost } from '../src/startup-generation.ts'
const state = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: state.fork } }))
import { startIsolatedDesktopHost, type IsolatedHostOptions } from '../src/host-process.ts'

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    postMessage: vi.fn((message: { kind: string; id: number; method?: string }) => {
      if (message.kind === 'call') queueMicrotask(() => child.emit('message', { kind: 'result', id: message.id, value: { pid: 123 } }))
    }),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true }),
  })
  state.fork.mockReturnValue(child)
  let host!: DesktopStartupGenerationHost
  const onFailure = vi.fn()
  const options = {
    host: { desktopLaunchEnvironment: createLaunchEnvironmentSnapshot([]) },
    runtime: { platform: 'win32', locale: 'en', updates: { currentVersion: '2.0.7-beta.1' } },
    rendererToken: 'fixture', prepareCertificate: async () => ({ failureCode: 'fixture' }),
    bindHost: (value: DesktopStartupGenerationHost) => { host = value }, requestQuit() {}, onFailure,
  } as unknown as IsolatedHostOptions
  return { child, options, onFailure, host: () => host }
}
it('binds the child before startup and makes repeated teardown idempotent', async () => {
  const f = fixture()
  await startIsolatedDesktopHost(f.options)
  await Promise.all([f.host().fiber.dispose(), f.host().fiber.dispose()])
  expect(f.child.kill).toHaveBeenCalledOnce()
  expect(f.onFailure).not.toHaveBeenCalled()
  expect(f.child.postMessage.mock.calls.filter(([m]) => m.method === 'stop')).toHaveLength(1)
})
it('reports unexpected Host exit without automatically relaunching or replaying work', async () => {
  const f = fixture()
  await startIsolatedDesktopHost(f.options)
  f.child.emit('exit', 9)
  expect(f.onFailure).toHaveBeenCalledOnce()
  await f.host().fiber.dispose()
  expect(f.child.kill).not.toHaveBeenCalled()
})
