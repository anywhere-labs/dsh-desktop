import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NextDesktopRuntime } from '../src/desktop-runtime.ts'
import { DesktopHostProcess, type DesktopHostReady } from '../src/host-process.ts'
import type { DesktopStartupEntry } from '../src/host-startup-limit.ts'
import { historyFiles } from '../src/log-history.ts'

vi.mock('../src/web-document.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/web-document.ts')>(),
  authenticateWebHost: vi.fn(async () => 'dsh-session=fixture'),
}))

const mcp: DesktopStartupEntry = { id: 'magpie-mcp-deepwiki', name: '@deepseek-ai/dsh-mcp-client', phase: 'starting', waitedMs: 46_700 }
const READY = { url: 'http://127.0.0.1:43120/?token=fixture', injections: [] }
const runtimes: NextDesktopRuntime[] = []
const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

const extraFile = (home: string): string => join(home, 'desktop-preferences-extra.json')

async function fixture(options: Partial<ConstructorParameters<typeof NextDesktopRuntime>[0]> = {}, prepare?: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'next-startup-limit-'))
  directories.push(home)
  await prepare?.(home)
  const onFailure = vi.fn()
  const runtime = new NextDesktopRuntime({
    home, root: home, executable: process.execPath, addresses: () => ['127.0.0.1'],
    certificate: async () => { throw new Error('No LAN certificate in this test') },
    onFailure, onChange() {}, onRestart() {}, onTerminal() {}, onNotification() {},
    ...options,
  })
  runtimes.push(runtime)
  const history = () => {
    runtime.diagnostics.flush()
    return historyFiles(join(home, 'logs')).flatMap(file => readFileSync(file.file, 'utf8').trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as { event: string; level: string; message: string; fields?: Record<string, unknown>; data?: unknown; error?: unknown }))
  }
  return { runtime, home, onFailure, history }
}

function hostStarts(): { ready(value: DesktopHostReady): void } {
  let ready!: (value: DesktopHostReady) => void
  vi.spyOn(DesktopHostProcess.prototype, 'start').mockReturnValue(new Promise(resolve => { ready = resolve }))
  vi.spyOn(DesktopHostProcess.prototype, 'stop').mockResolvedValue()
  return { ready: value => { ready(value) } }
}

it('fails a start at its saved limit after one notice, naming what the Host still loads (#1569, #1617)', async () => {
  vi.useFakeTimers()
  hostStarts()
  const entries = vi.spyOn(DesktopHostProcess.prototype, 'startupEntries').mockResolvedValue([mcp])
  const withdraw = vi.fn()
  const onStartupSlow = vi.fn(() => withdraw)
  const { runtime, onFailure, history } = await fixture({ onStartupSlow }, home => writeFile(extraFile(home), JSON.stringify({ hostStartupTimeout: 120 })))
  runtime.initialize()
  const failed = expect(runtime.start()).rejects.toThrow('Host startup exceeded 120 seconds\nStill loading: magpie-mcp-deepwiki (@deepseek-ai/dsh-mcp-client, starting, 47 s).')
  await vi.advanceTimersByTimeAsync(59_999)
  expect(onStartupSlow).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(onStartupSlow).toHaveBeenCalledExactlyOnceWith({ limit: 120, pending: [mcp] })
  expect(withdraw).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60_000)
  await failed
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
  expect(withdraw).toHaveBeenCalledOnce()
  expect(entries).toHaveBeenCalledTimes(2)
  expect(runtime.state()).toMatchObject({ failureStage: 'host-boot', failureTimeout: { seconds: 120, pending: [mcp] }, hostStartupTimeout: 120 })
  const report = readFileSync((await runtime.failureReportFile())!, 'utf8')
  expect(report).toContain('--- plugins still loading at the 120-second startup limit ---\nmagpie-mcp-deepwiki (@deepseek-ai/dsh-mcp-client): starting, 47 s since the Host created it\n')
  expect(report).not.toContain('--- error details ---')
  const records = history()
  expect(records.find(record => record.event === 'host.start.start')?.fields).toMatchObject({ limit: 120 })
  expect(records.find(record => record.event === 'host.start.slow')).toMatchObject({ level: 'warn', fields: { limit: 120, pending: 1 }, data: { entries: [mcp] } })
  expect(records.find(record => record.event === 'host.start.pending')).toMatchObject({ level: 'error', fields: { limit: 120, pending: 1 }, data: { entries: [mcp] } })
  expect(records.find(record => record.event === 'host.start.failed')?.error).toMatchObject({ message: expect.stringContaining('magpie-mcp-deepwiki') })
})

it('waits for the Host without a limit like upstream Desktop, and withdraws the notice once it is ready', async () => {
  vi.useFakeTimers()
  const host = hostStarts()
  vi.spyOn(DesktopHostProcess.prototype, 'startupEntries').mockResolvedValue([])
  const withdraw = vi.fn()
  const onStartupSlow = vi.fn(() => withdraw)
  const { runtime, onFailure } = await fixture({ onStartupSlow }, home => writeFile(extraFile(home), JSON.stringify({ hostStartupTimeout: 'none' })))
  runtime.initialize()
  const starting = runtime.start()
  await vi.advanceTimersByTimeAsync(60 * 60_000)
  expect(onStartupSlow).toHaveBeenCalledExactlyOnceWith({ limit: 'none', pending: [] })
  expect(runtime.backend.state.phase).toBe('starting')
  host.ready(READY)
  await starting
  expect(runtime.backend.state.phase).toBe('ready')
  expect(withdraw).toHaveBeenCalledOnce()
  expect(onFailure).not.toHaveBeenCalled()
})

it('keeps the 60-second limit by default and in Safe Mode, without a notice', async () => {
  vi.useFakeTimers()
  hostStarts()
  vi.spyOn(DesktopHostProcess.prototype, 'startupEntries').mockRejectedValue(new Error('Startup entry query timed out'))
  for (const safeMode of [false, true]) {
    const onStartupSlow = vi.fn(() => () => {})
    const { runtime, history } = await fixture({ onStartupSlow }, safeMode ? home => writeFile(extraFile(home), JSON.stringify({ hostStartupTimeout: 'none' })) : undefined)
    runtime.safeMode = safeMode
    runtime.initialize()
    const failed = expect(runtime.start()).rejects.toThrow('Host startup exceeded 60 seconds\nThe Host did not say which plugins were still loading (Startup entry query timed out).')
    await vi.advanceTimersByTimeAsync(60_000)
    await failed
    expect(onStartupSlow).not.toHaveBeenCalled()
    // Safe Mode applies its own fixed limit; recovery still shows the original environment's.
    expect(runtime.state()).toMatchObject({ failureTimeout: { seconds: 60, unanswered: 'Startup entry query timed out' }, hostStartupTimeout: safeMode ? 'none' : 60 })
    expect(runtime.state().failureTimeout).not.toHaveProperty('pending')
    expect(history().find(record => record.event === 'host.start.pending')).toMatchObject({ level: 'error',
      message: 'The Host did not say which plugins were still loading (Startup entry query timed out).', fields: { limit: 60, pending: null } })
  }
})

it('lets a Host that becomes ready while it is being asked finish starting', async () => {
  vi.useFakeTimers()
  const host = hostStarts()
  let answer!: (entries: DesktopStartupEntry[]) => void
  vi.spyOn(DesktopHostProcess.prototype, 'startupEntries').mockReturnValue(new Promise(resolve => { answer = resolve }))
  const { runtime, onFailure, history } = await fixture()
  runtime.initialize()
  const starting = runtime.start()
  await vi.advanceTimersByTimeAsync(60_000)
  host.ready(READY)
  await starting
  answer([mcp])
  await vi.advanceTimersByTimeAsync(0)
  expect(runtime.backend.state.phase).toBe('ready')
  expect(onFailure).not.toHaveBeenCalled()
  expect(history().some(record => record.event === 'host.start.pending')).toBe(false)
})

it('saves the original limit from recovery and Safe Mode without replacing a broken preference file', async () => {
  const { runtime, home } = await fixture({}, async home => {
    await writeFile(join(home, 'desktop-preferences.json'), '{broken')
    await writeFile(extraFile(home), JSON.stringify({ hostStartupTimeout: 300, laterPreference: true }))
  })
  runtime.initialize()
  expect(runtime.state()).toMatchObject({ failureStage: 'runtime-bootstrap', hostStartupTimeout: 300 })
  runtime.saveStartupTimeout('none')
  expect(readFileSync(join(home, 'desktop-preferences.json'), 'utf8')).toBe('{broken')
  expect(JSON.parse(readFileSync(extraFile(home), 'utf8'))).toEqual({ hostStartupTimeout: 'none', laterPreference: true })
  expect(runtime.state().hostStartupTimeout).toBe('none')
  expect(() => runtime.saveStartupTimeout(30)).toThrow('Invalid Host startup limit')

  const { runtime: safe, home: original } = await fixture({}, home => writeFile(extraFile(home), JSON.stringify({ hostStartupTimeout: 180 })))
  safe.safeMode = true
  safe.initialize()
  expect(safe.preferences.hostStartupTimeout).toBe(60)
  expect(safe.state().hostStartupTimeout).toBe(180)
  safe.saveStartupTimeout(600)
  expect(safe.preferences.hostStartupTimeout).toBe(60)
  expect(safe.state().hostStartupTimeout).toBe(600)
  expect(JSON.parse(readFileSync(extraFile(original), 'utf8'))).toEqual({ hostStartupTimeout: 600 })

  const { runtime: normal, home: settings } = await fixture()
  normal.initialize()
  normal.writePreferences({ ...normal.preferences, hostStartupTimeout: 120 })
  expect(normal.state().hostStartupTimeout).toBe(120)
  expect(JSON.parse(readFileSync(extraFile(settings), 'utf8'))).toEqual({ hostStartupTimeout: 120 })
  expect(JSON.parse(readFileSync(join(settings, 'desktop-preferences.json'), 'utf8'))).not.toHaveProperty('hostStartupTimeout')
})
