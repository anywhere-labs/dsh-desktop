import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NextDesktopRuntime } from '../../src/desktop-runtime.ts'
import { DesktopHostExitError, DesktopHostProcess, type DesktopHostObserver } from '../../src/host-process.ts'

vi.mock('../../src/web-document.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/web-document.ts')>(),
  authenticateWebHost: vi.fn(async () => 'dsh-session=fixture'),
}))
// The collector Worker is built into lib/; here the same collection runs in this process.
vi.mock('../../src/upstream-family/operation-report-job.ts', async () => {
  const { appendOperationReport } = await import('../../src/upstream-family/operation-report.ts')
  return { runOperationReportJob: vi.fn(async (input: { reportPath: string; directory: string; limits: Parameters<typeof appendOperationReport>[2]; journal: Parameters<typeof appendOperationReport>[4] }, _options: unknown, signal: AbortSignal) => ({
    appended: await appendOperationReport(input.reportPath, input.directory, input.limits, signal, input.journal), timedOut: false, cancelled: signal.aborted,
  })) }
})

const runtimes: NextDesktopRuntime[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

const runId = 'c254ab28-97c9-4382-95e6-2db9c66f98c8'
const record = { runId, transportDropped: 0, pluginCommand: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98ca',
  time: '2026-10-19T00:00:01.000Z', action: 'remove', target: 'dsh-foo', phase: 'settled', exitCode: 0 } }

async function fixture(options: Partial<ConstructorParameters<typeof NextDesktopRuntime>[0]> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'beta-operation-history-'))
  directories.push(home)
  const runtime = new NextDesktopRuntime({
    home, root: home, executable: process.execPath, addresses: () => ['127.0.0.1'],
    certificate: async () => { throw new Error('No LAN certificate in this test') },
    onFailure() {}, onChange() {}, onRestart() {}, onTerminal() {}, onNotification() {},
    memoryProbe: { appMetrics: () => [{ type: 'Browser', pid: 1, cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 1024 } }] },
    ...options,
  })
  runtimes.push(runtime)
  return { runtime, home }
}

async function completeReport(runtime: NextDesktopRuntime): Promise<string> {
  const file = await runtime.failureReportFile()
  expect(file).toBeDefined()
  await vi.waitFor(async () => { expect(await readFile(file!, 'utf8')).toContain('operation history collection complete') })
  return readFile(file!, 'utf8')
}

it('names the failed Host run and appends its recorded plugin operations to the failure report', async () => {
  let host: DesktopHostProcess | undefined
  vi.spyOn(DesktopHostProcess.prototype, 'stop').mockResolvedValue()
  vi.spyOn(DesktopHostProcess.prototype, 'start').mockImplementation(function (this: DesktopHostProcess) {
    host = this
    return Promise.resolve({ url: 'http://127.0.0.1:43120/?token=fixture', injections: [] })
  })
  const { runtime, home } = await fixture()
  await runtime.start()
  const internals = host as unknown as { observer: DesktopHostObserver; onFailure(error: Error): void }
  expect(internals.observer.operation?.({ type: 'starting', runId })).toBe(true)
  expect(internals.observer.operation?.({ type: 'plugin-operation', record })).toBe(true)
  // The journal writes in the background, so a failure right after an operation can precede its record on disk.
  await vi.waitFor(async () => {
    expect(await readFile(join(home, 'logs', 'plugin-operations', 'operations.jsonl'), 'utf8')).toContain('dsh-foo')
  })
  internals.onFailure(new DesktopHostExitError(1, null, ''))
  const report = await completeReport(runtime)
  expect(report).toContain(`host run: ${runId}`)
  expect(report).toContain('--- auxiliary diagnostics ---\nOperation history is best effort.')
  const summary = JSON.parse(report.split('\n').find(line => line.startsWith('{"journal"'))!) as { journal: unknown; records: unknown[] }
  expect(summary.records).toEqual([record])
  expect(summary.journal).toMatchObject({ dropped: 0, failed: 0, disabled: false })
})

it('names no Host run for a failure before the Host starts and still appends the history section', async () => {
  const { runtime } = await fixture({ prepareEnvironment: async () => { throw new Error('login shell environment unavailable') } })
  await runtime.start().catch(() => {})
  expect(runtime.state()).toMatchObject({ failureStage: 'shell-environment' })
  const report = await completeReport(runtime)
  expect(report).not.toContain('host run:')
  expect(report).toContain('"records":[]')
})
