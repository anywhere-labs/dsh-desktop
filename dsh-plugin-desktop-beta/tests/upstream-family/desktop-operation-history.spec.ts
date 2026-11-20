import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { DesktopOperationHistory, OPERATION_HISTORY_NOTE } from '../../src/upstream-family/desktop-operation-history.ts'
import { runOperationReportJob } from '../../src/upstream-family/operation-report-job.ts'

vi.mock('../../src/upstream-family/operation-report-job.ts', () => ({ runOperationReportJob: vi.fn() }))
afterEach(() => { vi.mocked(runOperationReportJob).mockReset() })

const runId = 'c254ab28-97c9-4382-95e6-2db9c66f98c8'
const otherRun = 'c254ab28-97c9-4382-95e6-2db9c66f98c7'
function record(target: string, run = runId) {
  return { runId: run, transportDropped: 0, pluginCommand: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98ca',
    time: '2026-10-19T00:00:01.000Z', action: 'remove', target, phase: 'started' } }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-operation-owner-'))
  onTestFinished(async () => { await rm(directory, { recursive: true, force: true }) })
  return { directory: join(directory, 'plugin-operations'), history: new DesktopOperationHistory(join(directory, 'plugin-operations')) }
}

async function journaled(directory: string): Promise<string[]> {
  return (await readFile(join(directory, 'operations.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
}

it('journals the records of an announced run and leaves other Host messages to the Host events', async () => {
  const { directory, history } = await fixture()
  const accept = history.host()
  expect(accept({ type: 'plugin-operation', record: record('before-announcement') })).toBe(true)
  expect(accept({ type: 'starting', runId })).toBe(true)
  expect(history.runId).toBe(runId)
  expect(accept({ type: 'plugin-operation', record: record('dsh-foo') })).toBe(true)
  expect(accept({ type: 'plugin-operation', record: record('other-run', otherRun) })).toBe(true)
  expect(accept({ type: 'plugin-operation', record: { ...record('malformed'), runId: 1 } })).toBe(true)
  expect(accept({ type: 'ready', url: 'http://127.0.0.1:1/' })).toBe(false)
  expect(accept({ type: 'memory', rss: 1 })).toBe(false)
  expect(accept('starting')).toBe(false)
  await history.close()
  expect((await journaled(directory)).map(line => JSON.parse(line) as unknown)).toEqual([record('dsh-foo')])
})

it('refuses an announcement without a run identity so the Host fails as for any invalid event', async () => {
  const { history } = await fixture()
  const accept = history.host()
  expect(accept({ type: 'starting' })).toBe(false)
  expect(accept({ type: 'starting', runId: 'run-1' })).toBe(false)
  expect(history.runId).toBeUndefined()
})

it('names the newest Host run and still journals a previous Host\'s late records under their own run', async () => {
  const { directory, history } = await fixture()
  const first = history.host()
  first({ type: 'starting', runId: otherRun })
  const second = history.host()
  expect(history.runId).toBeUndefined()
  second({ type: 'starting', runId })
  expect(history.runId).toBe(runId)
  first({ type: 'plugin-operation', record: record('late', otherRun) })
  second({ type: 'plugin-operation', record: record('current') })
  second({ type: 'plugin-operation', record: record('foreign', otherRun) })
  await history.close()
  expect((await journaled(directory)).map(line => (JSON.parse(line) as ReturnType<typeof record>).pluginCommand.target)).toEqual(['late', 'current'])
})

it('appends to one saved report at a time with the current journal status, then stops when closing', async () => {
  const { directory, history } = await fixture()
  const finished = Promise.withResolvers<{ appended: boolean; timedOut: boolean; cancelled: boolean }>()
  vi.mocked(runOperationReportJob).mockReturnValueOnce(finished.promise)
  const accept = history.host()
  accept({ type: 'starting', runId })
  accept({ type: 'plugin-operation', record: record('dsh-foo') })
  expect(history.reportNote).toEqual(OPERATION_HISTORY_NOTE)
  history.append('/logs/first.log')
  history.append('/logs/concurrent.log')
  expect(runOperationReportJob).toHaveBeenCalledOnce()
  const [input, deadlines, signal] = vi.mocked(runOperationReportJob).mock.calls[0]!
  expect(input).toEqual({ reportPath: '/logs/first.log', directory,
    limits: { bytes: 65536, recordBytes: 4096, records: 100, outputBytes: 65536 },
    journal: expect.objectContaining({ dropped: 0, failed: 0, disabled: false }) })
  expect(deadlines).toEqual({ timeoutMs: 500, cancellationGraceMs: 100 })
  expect(signal.aborted).toBe(false)
  finished.resolve({ appended: true, timedOut: false, cancelled: false })
  await new Promise(resolve => setImmediate(resolve))
  vi.mocked(runOperationReportJob).mockResolvedValueOnce({ appended: true, timedOut: false, cancelled: false })
  history.append('/logs/second.log')
  expect(runOperationReportJob).toHaveBeenCalledTimes(2)
  await history.close()
  expect(signal.aborted).toBe(true)
  expect(history.reportNote).toBeUndefined()
  history.append('/logs/after-close.log')
  expect(runOperationReportJob).toHaveBeenCalledTimes(2)
})

it('bounds the wait for a collector that does not stop when the application quits', async () => {
  const { history } = await fixture()
  vi.mocked(runOperationReportJob).mockReturnValueOnce(new Promise(() => {}))
  history.append('/logs/stuck.log')
  vi.useFakeTimers()
  onTestFinished(() => { vi.useRealTimers() })
  let closed = false
  const closing = history.close().then(() => { closed = true })
  await vi.advanceTimersByTimeAsync(499)
  expect(closed).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await closing
  expect(closed).toBe(true)
  expect(history.close()).toBe(history.close())
})

it('writes one standard record per finished operation of the announced run', async () => {
  const { directory } = await fixture()
  const log = vi.fn()
  const history = new DesktopOperationHistory(directory, log)
  const accept = history.host()
  accept({ type: 'starting', runId })
  const command = record('dsh-foo')
  accept({ type: 'plugin-operation', record: command })
  expect(log).not.toHaveBeenCalled()
  accept({ type: 'plugin-operation', record: { ...command, pluginCommand: { ...command.pluginCommand, phase: 'settled', exitCode: 1 } } })
  expect(log).toHaveBeenLastCalledWith({ source: 'host.plugins', event: 'operation.settled', level: 'warn', operationId: command.pluginCommand.id,
    message: 'Plugin command remove dsh-foo: exit 1', fields: expect.objectContaining({ kind: 'command', action: 'remove', target: 'dsh-foo', exitCode: 1, runId }) })
  accept({ type: 'plugin-operation', record: { ...command, runId: otherRun, pluginCommand: { ...command.pluginCommand, phase: 'unknown' } } })
  const manager = { runId, transportDropped: 0, operation: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98cb', time: '2026-10-19T00:00:02.000Z', reason: 'install', target: 'dsh-bar',
    stage: 'install', phase: 'settled', application: 'applied', changed: true } }
  accept({ type: 'plugin-operation', record: manager })
  expect(log).toHaveBeenCalledTimes(2)
  expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'operation.settled', level: 'info', message: 'Plugin install dsh-bar: applied',
    fields: expect.objectContaining({ kind: 'manager', application: 'applied', changed: true }) }))
  await history.close()
  expect(await journaled(directory)).toHaveLength(3)
})
