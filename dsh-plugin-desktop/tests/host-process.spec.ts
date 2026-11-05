import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type { DesktopStartupGenerationHost } from '../src/startup-generation.ts'
const state = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal(), fork: state.fork }))
import {
  formatUnexpectedHostExit, HOST_STDERR_TAIL_CHARS, startIsolatedDesktopHost,
  type IsolatedHostExit, type IsolatedHostOptions,
} from '../src/host-process.ts'

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: 233_197,
    stdout: Object.assign(new EventEmitter(), { destroy: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { destroy: vi.fn() }),
    connected: true,
    send: vi.fn((message: { kind: string; id: number; method?: string }) => {
      if (message.kind === 'call') queueMicrotask(() => child.emit('message', { kind: 'result', id: message.id, value: { pid: 123 } }))
      return true
    }),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0, null)); return true }),
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
  expect(f.child.send.mock.calls.filter(([m]) => m.method === 'stop')).toHaveLength(1)
})
it('reports unexpected Host exit without automatically relaunching or replaying work', async () => {
  const f = fixture()
  await startIsolatedDesktopHost(f.options)
  f.child.emit('exit', 9)
  expect(f.onFailure).toHaveBeenCalledOnce()
  await f.host().fiber.dispose()
  expect(f.child.kill).not.toHaveBeenCalled()
})
it('carries the exit code and how long the Host lived, so a code 0 is not read as a clean exit', async () => {
  const f = fixture()
  await startIsolatedDesktopHost(f.options)
  f.child.emit('exit', 0)
  const [error, exit] = f.onFailure.mock.calls[0] as [Error, { exitCode: number; hostPid?: number; uptimeMs: number }]
  expect(error.message).toContain('DSH Host exited (0)')
  expect(exit.exitCode).toBe(0)
  expect(exit.hostPid).toBe(233_197)
  expect(exit.uptimeMs).toBeGreaterThanOrEqual(0)
  expect(Number.isFinite(exit.uptimeMs)).toBe(true)
})
it('leaves a Desktop-requested teardown off the unexpected-exit record', async () => {
  const f = fixture()
  await startIsolatedDesktopHost(f.options)
  await f.host().fiber.dispose()
  expect(f.onFailure).not.toHaveBeenCalled()
})
it('keeps what a fatal Host said last, since its stderr is otherwise never persisted', async () => {
  const f = fixture()
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  try {
    await startIsolatedDesktopHost(f.options)
    f.child.stderr.emit('data', Buffer.from('x'.repeat(HOST_STDERR_TAIL_CHARS)))
    // A multibyte character split across two chunks must not turn into replacement characters.
    const euro = Buffer.from('€')
    f.child.stderr.emit('data', Buffer.concat([Buffer.from('dsh: fatal load failure: boom '), euro.subarray(0, 1)]))
    f.child.stderr.emit('data', euro.subarray(1))
    f.child.emit('exit', 1)
  } finally { vi.restoreAllMocks() }
  const [error, exit] = f.onFailure.mock.calls[0] as [Error, IsolatedHostExit]
  expect(exit.stderrTail).toHaveLength(HOST_STDERR_TAIL_CHARS)
  expect(exit.stderrTail.endsWith('dsh: fatal load failure: boom €')).toBe(true)
  expect(formatUnexpectedHostExit(error, exit))
    .toBe(`DSH Host exited (1) (pid 233197); restart the application to reconnect\nLast DSH Host stderr:\n${exit.stderrTail}`)
})
it('launches an isolated Electron Node child with portable IPC and no inspector arguments', async () => {
  const f = fixture()
  await startIsolatedDesktopHost(f.options)
  const [entry, args, options] = state.fork.mock.calls.at(-1)! as [string, string[], {
    execPath: string; execArgv: string[]; env: NodeJS.ProcessEnv; serialization: string; stdio: string[]
  }]
  expect(entry).toMatch(/host-process-entry\.js$/u)
  expect(args).toEqual([])
  expect(options).toMatchObject({ execPath: process.execPath, execArgv: [], serialization: 'json',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1')
  await f.host().fiber.dispose()
})
it('reports signaled termination and rejects a disconnected Host without replay', async () => {
  const f = fixture()
  await startIsolatedDesktopHost(f.options)
  f.child.emit('disconnect')
  f.child.emit('exit', null, 'SIGTRAP')
  expect(f.onFailure).toHaveBeenCalledOnce()
  const [error, exit] = f.onFailure.mock.calls[0] as [Error, IsolatedHostExit]
  expect(error.message).toContain('DSH Host exited (133)')
  expect(exit.exitCode).toBe(133)
  await f.host().fiber.dispose()
})
it('rejects startup promptly if the Node child cannot spawn or report exit', async () => {
  const f = fixture()
  f.child.send.mockImplementation(() => true)
  const startup = startIsolatedDesktopHost(f.options)
  f.child.emit('error', new Error('spawn denied'))
  f.child.emit('close', null, null)
  await expect(startup).rejects.toThrow('DSH Host spawn failed: spawn denied')
  expect(f.child.stdout.destroy).toHaveBeenCalledOnce()
  expect(f.onFailure).not.toHaveBeenCalled()
})
it('logs only the exit reason when the Host wrote nothing', () => {
  const error = new Error('DSH Host exited (0); restart the application to reconnect')
  expect(formatUnexpectedHostExit(error, { exitCode: 0, uptimeMs: 1, stderrTail: '\n' })).toBe(error.message)
})
