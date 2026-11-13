import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NextDesktopRuntime } from '../src/desktop-runtime.ts'
import { DesktopHostExitError, DesktopHostFatalError, DesktopHostProcess, type DesktopHostObserver } from '../src/host-process.ts'
import { historyFiles } from '../src/log-history.ts'

vi.mock('../src/web-document.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/web-document.ts')>(),
  authenticateWebHost: vi.fn(async () => 'dsh-session=fixture'),
}))

const runtimes: NextDesktopRuntime[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function fixture(options: Partial<ConstructorParameters<typeof NextDesktopRuntime>[0]> = {}, prepare?: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'next-failure-stage-'))
  directories.push(home)
  await prepare?.(home)
  const onFailure = vi.fn()
  const runtime = new NextDesktopRuntime({
    home, root: home, executable: process.execPath, addresses: () => ['127.0.0.1'],
    certificate: async () => { throw new Error('No LAN certificate in this test') },
    onFailure, onChange() {}, onRestart() {}, onTerminal() {}, onNotification() {},
    memoryProbe: { appMetrics: () => [{ type: 'Browser', pid: 1, cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 1024 } }] },
    ...options,
  })
  runtimes.push(runtime)
  const history = () => historyFiles(join(home, 'logs')).flatMap(file => readFileSync(file.file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { event: string; fields?: Record<string, unknown> }))
  return { runtime, onFailure, history }
}

it('reports a Host that dies after readiness as a running Plugin Host failure, after its memory snapshot is on disk', async () => {
  let host: DesktopHostProcess | undefined
  vi.spyOn(DesktopHostProcess.prototype, 'stop').mockResolvedValue()
  vi.spyOn(DesktopHostProcess.prototype, 'start').mockImplementation(function (this: DesktopHostProcess) {
    host = this
    return Promise.resolve({ url: 'http://127.0.0.1:43120/?token=fixture', injections: [] })
  })
  const { runtime, onFailure, history } = await fixture()
  await runtime.start()
  expect(runtime.backend.state.phase).toBe('ready')
  let snapshotOnDisk = false
  onFailure.mockImplementation(() => { snapshotOnDisk = history().some(record => record.event === 'memory.snapshot') })
  // What the child's close handler does: observe the exit, then report the failure to the backend.
  const internals = host as unknown as { observer: DesktopHostObserver; onFailure(error: Error): void }
  internals.observer.exited!({ code: 3221225477, signal: null, expected: false }, 4242)
  internals.onFailure(new DesktopHostExitError(3221225477, null, 'dsh-plugin-desktop-beta: outbound proxy = none'))
  expect(onFailure).toHaveBeenCalledOnce()
  expect(snapshotOnDisk).toBe(true)
  const state = runtime.state()
  expect(state).toMatchObject({ failureStage: 'host-runtime', failureExit: { code: 3221225477, signal: null, output: 'dsh-plugin-desktop-beta: outbound proxy = none' } })
  expect(state.failure).toContain('exited with 0xC0000005 (3221225477, STATUS_ACCESS_VIOLATION)')
  expect(history().find(record => record.event === 'runtime.failed')?.fields).toEqual({ stage: 'host-runtime' })
  expect(history().find(record => record.event === 'memory.snapshot')?.fields).toMatchObject({ triggers: 'host unexpected 0xC0000005', samples: 1 })
})

it('reports a Host that ends during startup as Plugin Host startup and clears the failure on the next start', async () => {
  vi.spyOn(DesktopHostProcess.prototype, 'stop').mockResolvedValue()
  const start = vi.spyOn(DesktopHostProcess.prototype, 'start').mockRejectedValueOnce(new DesktopHostExitError(3221225477, null, ''))
  const { runtime, onFailure } = await fixture()
  await expect(runtime.start()).rejects.toThrow('0xC0000005')
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
  expect(runtime.state()).toMatchObject({ failureStage: 'host-boot', failureExit: { code: 3221225477, signal: null, output: '' } })
  start.mockResolvedValueOnce({ url: 'http://127.0.0.1:43120/?token=fixture', injections: [] })
  await runtime.start()
  expect(runtime.state()).not.toHaveProperty('failureStage')
  expect(runtime.state()).not.toHaveProperty('failureExit')
  expect(runtime.state()).not.toHaveProperty('failureReport')
  expect(runtime.state()).not.toHaveProperty('failureContext')
})

it('names preparation and Desktop action failures without inventing a Host exit', async () => {
  const { runtime, onFailure } = await fixture({ prepareEnvironment: async () => { throw new Error('login shell timed out') } })
  await expect(runtime.start()).rejects.toThrow('login shell timed out')
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
  expect(runtime.state()).toMatchObject({ failureStage: 'shell-environment', failure: 'login shell timed out' })
  expect(runtime.state()).not.toHaveProperty('failureExit')
  const { runtime: actions } = await fixture()
  actions.report(new Error('Profile is unavailable for Desktop Next'))
  expect(actions.state()).toMatchObject({ failureStage: 'desktop-runtime', failure: 'Profile is unavailable for Desktop Next' })
})

it('keeps the failure that opened recovery and reports a later failed action beside it', async () => {
  const { runtime, onFailure, history } = await fixture({ prepareEnvironment: async () => { throw new Error('login shell timed out', { cause: new Error('initial activation failed; token=abcdef') }) } })
  await expect(runtime.start()).rejects.toThrow('login shell timed out')
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
  const report = await runtime.failureReportFile()
  expect(report).toMatch(/-shell-environment\.log$/u)
  const context = runtime.state().failureContext!
  expect(context).toContain('initial activation failed; token=****')
  expect(context).not.toContain('abcdef')
  runtime.diagnostics.append('later recovery action')
  runtime.report(new Error('Diagnostics export failed: token=abcdef'))
  expect(runtime.state()).toMatchObject({ failureStage: 'shell-environment', failure: 'login shell timed out', actionFailure: 'Diagnostics export failed: token=****' })
  runtime.report(new Error('Renderer recovery exhausted'), 'renderer-runtime')
  expect(runtime.state()).toMatchObject({ failureStage: 'shell-environment', failure: 'login shell timed out' })
  expect(onFailure).toHaveBeenCalledOnce()
  expect(await runtime.failureReportFile()).toBe(report)
  expect(runtime.state().failureContext).toBe(context)
  expect(context).not.toContain('later recovery action')
  expect(history().filter(record => record.event === 'runtime.failed').map(record => record.fields)).toEqual([
    { stage: 'shell-environment' },
    { stage: 'desktop-runtime', recoveryReason: 'shell-environment' },
    { stage: 'renderer-runtime', recoveryReason: 'shell-environment' },
  ])
})

it('lets a failure of the Desktop itself replace a failed action as the reason', async () => {
  const { runtime, onFailure } = await fixture()
  runtime.report(new Error('Could not open the terminal'))
  runtime.report(new Error('Diagnostics export failed'))
  expect(runtime.state()).toMatchObject({ failureStage: 'desktop-runtime', failure: 'Could not open the terminal', actionFailure: 'Diagnostics export failed' })
  runtime.report(new DesktopHostExitError(1, null, ''), 'host-runtime')
  expect(runtime.state()).toMatchObject({ failureStage: 'host-runtime', failureExit: { code: 1, signal: null, output: '' } })
  expect(runtime.state()).not.toHaveProperty('actionFailure')
  expect(onFailure).toHaveBeenCalledTimes(2)
})

it('passes the fatal line a Host exit carries to recovery, masked like its stderr (#1574)', async () => {
  const { runtime } = await fixture()
  runtime.report(new DesktopHostExitError(1, null, 'plugin teardown', 'dsh: fatal load failure: Error: Authorization: Bearer abcdef'), 'host-runtime')
  expect(runtime.state().failureExit).toEqual({ code: 1, signal: null, output: 'plugin teardown', fatal: 'dsh: fatal load failure: Error: Authorization: Bearer ****' })
  const { runtime: crashed } = await fixture()
  crashed.report(new DesktopHostExitError(3221225477, null, ''), 'host-runtime')
  expect(crashed.state().failureExit).toStrictEqual({ code: 3221225477, signal: null, output: '' })
})

it('saves a masked report of the failure that opened recovery, with the Host diagnostic', async () => {
  vi.spyOn(DesktopHostProcess.prototype, 'stop').mockResolvedValue()
  vi.spyOn(DesktopHostProcess.prototype, 'start').mockRejectedValueOnce(new DesktopHostFatalError('dsh-plugin-desktop-beta: startup failed',
    'StartupError: dsh-plugin-desktop-beta: startup failed\nConfiguration file: /profiles/desktop/cordis.yml\nAuthorization: Bearer abcdef'))
  const { runtime, onFailure } = await fixture()
  runtime.diagnostics.begin({ version: '2.0.21-beta.1', platform: 'darwin' })
  await expect(runtime.start()).rejects.toThrow('startup failed')
  await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
  const file = await runtime.failureReportFile()
  expect(file).toMatch(/[\\/]logs[\\/]dsh-plugin-desktop-beta-failure-[^\\/]+-host-boot\.log$/u)
  expect(runtime.state().failureReport).toEqual({ status: 'saved', file })
  const text = readFileSync(file!, 'utf8')
  expect(text).toContain(`stage: host-boot\nrun: ${runtime.diagnostics.runId}\nversion: 2.0.21-beta.1\nplatform: darwin\narch: ${process.arch}\nprofile: desktop\n`)
  expect(text).toContain('--- failure (as shown in the recovery assistant) ---\ndsh-plugin-desktop-beta: startup failed\n')
  expect(text).toContain('Configuration file: /profiles/desktop/cordis.yml\nAuthorization: Bearer ****\n')
  expect(text).not.toContain('--- error details ---')
})

it.skipIf(process.platform === 'win32')('keeps recovery usable when the report cannot be saved', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'next-failure-outside-'))
  directories.push(outside)
  const { runtime, onFailure } = await fixture({}, home => symlink(outside, join(home, 'logs')))
  runtime.report(new Error('Invalid Next Profile manifest'), 'profile-composition')
  expect(onFailure).toHaveBeenCalledOnce()
  expect(await runtime.failureReportFile()).toBeUndefined()
  expect(runtime.state().failureContext).toContain('Invalid Next Profile manifest')
  expect(runtime.state()).toMatchObject({ failureStage: 'profile-composition', failure: 'Invalid Next Profile manifest', failureReport: { status: 'failed' } })
})

it('appends what the renderer was drawing to the failure report it writes', async () => {
  const executeJavaScript = vi.fn(async () => ({
    view: { visibility: 'visible', focused: false, reducedMotion: false, width: 1280, height: 840, devicePixelRatio: 2 },
    dom: { elements: 99 },
    animations: [{ name: 'dsh-state-dot-spin', target: 'svg', pseudo: '::before', iterations: null, infinite: true, currentTime: 12 }],
    animationsTotal: 1,
    layers: [],
    frameLoop: { frames: 30, elapsedMs: 750, framesPerSecond: 40, sampledBy: 'raf' },
    longTasks: null,
  }))
  const { runtime, history } = await fixture({ renderer: () => ({ isDestroyed: () => false, executeJavaScript }) })
  runtime.report(new Error('the interface failed'))
  const file = await runtime.failureReportFile()
  if (file === undefined) throw new Error('expected a saved failure report')
  await vi.waitFor(() => { expect(readFileSync(file, 'utf8')).toContain('--- renderer at failure ---') })
  expect(readFileSync(file, 'utf8')).toContain('dsh-state-dot-spin on svg::before (infinite)')
  expect(executeJavaScript).toHaveBeenCalledOnce()
  await vi.waitFor(() => { expect(history().some(record => record.event === 'failure.snapshot' && record.fields?.available === true)).toBe(true) })
})

it('writes a report without renderer evidence when no window exists to ask', async () => {
  const { runtime, history } = await fixture()
  runtime.report(new Error('startup failed'), 'runtime-bootstrap')
  const file = await runtime.failureReportFile()
  if (file === undefined) throw new Error('expected a saved failure report')
  await vi.waitFor(() => { expect(history().some(record => record.event === 'failure.snapshot' && record.fields?.reason === 'no-window')).toBe(true) })
  expect(readFileSync(file, 'utf8')).not.toContain('--- renderer at failure ---')
})
