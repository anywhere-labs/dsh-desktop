import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DesktopDiagnostics } from '../src/diagnostics.ts'
import { historyFiles } from '../src/log-history.ts'
import type { LogInput } from '../src/log-record.ts'
import { DesktopMemoryMonitor, MEMORY_INCIDENT_WINDOW_MS, MEMORY_SAMPLE_CAPACITY, MEMORY_SAMPLE_INTERVAL_MS, type MemoryProcessMetric } from '../src/memory-monitor.ts'

const MB = 1024 * 1024
const START = Date.parse('2026-10-28T08:00:00Z')
const homes: string[] = []
beforeEach(() => { vi.useFakeTimers({ now: START }) })
afterEach(() => { vi.useRealTimers(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

function metric(pid: number, workingSetKB: number, privateKB?: number, type = 'Tab'): MemoryProcessMetric {
  return { type, pid, cpu: { percentCPUUsage: 12.345 }, memory: { workingSetSize: workingSetKB, ...(privateKB === undefined ? {} : { privateBytes: privateKB }) } }
}

function monitor(metrics: () => readonly MemoryProcessMetric[] = () => [metric(10, 512 * 1024, 498 * 1024), metric(11, 2048, undefined, 'GPU')]) {
  const records: LogInput[] = []
  const record = vi.fn((input: LogInput) => { records.push(input) })
  const flush = vi.fn()
  const instance = new DesktopMemoryMonitor({
    probe: { appMetrics: metrics, system: () => ({ total: 16_384 * MB, free: 1_024 * MB, commitLimit: 24_576 * MB, commitFree: 256 * MB }) },
    record, flush,
  })
  return { instance, records, record, flush, snapshots: () => records.filter(input => input.event === 'memory.snapshot') }
}

const samplesOf = (input: LogInput | undefined) => (input!.data as { samples: { time: number; host?: unknown }[] }).samples

it('samples Chromium processes, system memory and Windows commit every 30 seconds as compact, history-only developer records', async () => {
  const { instance, records } = monitor()
  instance.start()
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS - 1)
  expect(records).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(records).toEqual([{
    source: 'desktop.memory', event: 'memory.sample', developer: true, historyOnly: true,
    data: { processColumns: ['type', 'pid', 'workingSetMB', 'privateMB', 'cpu'],
      time: START + MEMORY_SAMPLE_INTERVAL_MS, totalMB: 16_384, freeMB: 1024, commitLimitMB: 24_576, commitFreeMB: 256, processes: [
        ['Tab', 10, 512, 498, 12.3],
        ['GPU', 11, 2, null, 12.3],
      ] },
  }])
  instance.stop()
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS * 3)
  expect(records).toHaveLength(1)
})

it('attaches each Host push to exactly one sample, leaving a gap when the Host stops pushing', async () => {
  const { instance, records } = monitor()
  instance.start()
  instance.hostMemory({ rss: 900 * MB, heapTotal: 700 * MB, heapUsed: 650 * MB, external: 20 * MB, arrayBuffers: 10 * MB }, 4242)
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS * 2)
  const [first, second] = records as [LogInput, LogInput]
  expect((first.data as { host: unknown }).host).toEqual({ pid: 4242, time: START, rssMB: 900, heapUsedMB: 650, heapTotalMB: 700, externalMB: 20, arrayBuffersMB: 10 })
  expect(second.data).not.toHaveProperty('host')
  instance.stop()
})

it('drops only a failed reading and never throws into the caller', async () => {
  let failing = true
  const { instance, records } = monitor(() => { if (failing) throw new Error('metrics unavailable'); return [metric(10, 1024)] })
  instance.start()
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS)
  expect(records).toEqual([])
  expect(() => { instance.incident({ process: 'renderer', reason: 'oom', exitCode: -536870904 }) }).not.toThrow()
  failing = false
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS)
  expect(records.map(input => input.event)).toEqual(['memory.snapshot', 'memory.sample'])
  expect(samplesOf(records[0])).toEqual([])
  const broken = new DesktopMemoryMonitor({ probe: { appMetrics: () => [metric(10, 1024)] },
    record: () => { throw new Error('disk full') }, flush: () => { throw new Error('disk full') } })
  broken.start()
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS)
  expect(() => { broken.incident({ process: 'renderer', reason: 'oom', exitCode: 1 }); broken.settle(); broken.stop() }).not.toThrow()
  instance.stop()
})

it('writes one error snapshot naming every trigger of an incident, with a fresh sample per trigger, then flushes', async () => {
  const { instance, records, record, flush, snapshots } = monitor()
  instance.start()
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS * 3)
  instance.incident({ process: 'renderer', reason: 'oom', exitCode: -536870904 })
  await vi.advanceTimersByTimeAsync(500)
  instance.hostExited({ code: 3758096392, signal: null, expected: true }, 4242)
  expect(snapshots()).toEqual([])
  await vi.advanceTimersByTimeAsync(MEMORY_INCIDENT_WINDOW_MS)
  expect(snapshots()).toHaveLength(1)
  const [snapshot] = snapshots() as [LogInput]
  expect(snapshot).toMatchObject({ source: 'desktop.memory', level: 'error', fields: { triggers: 'renderer oom 0xE0000008; host stopping 0xE0000008', samples: 5 } })
  expect(snapshot.developer).toBeUndefined()
  expect((snapshot.data as { triggers: unknown }).triggers).toEqual([
    { time: START + MEMORY_SAMPLE_INTERVAL_MS * 3, process: 'renderer', reason: 'oom', exitCode: '0xE0000008' },
    { time: START + MEMORY_SAMPLE_INTERVAL_MS * 3 + 500, process: 'host', pid: 4242, reason: 'stopping', exitCode: '0xE0000008' },
  ])
  expect(records.at(-1)).toBe(snapshot)
  expect(flush.mock.invocationCallOrder.at(-1)).toBeGreaterThan(record.mock.invocationCallOrder.at(-1)!)
  instance.stop()
})

it('settles before recovery and writes each sample at most once across incidents', async () => {
  const { instance, snapshots } = monitor()
  instance.start()
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS * 2)
  instance.incident({ process: 'renderer', reason: 'crashed', exitCode: -1073741819 })
  instance.settle()
  expect(snapshots()).toHaveLength(1)
  expect(samplesOf(snapshots()[0])).toHaveLength(3)
  // A trigger still inside the window carries only the samples taken since.
  instance.hostExited({ code: 0, signal: null, expected: false }, 4242)
  await vi.advanceTimersByTimeAsync(MEMORY_INCIDENT_WINDOW_MS)
  expect(snapshots()).toHaveLength(2)
  expect(snapshots()[1]).toMatchObject({ fields: { triggers: 'host unexpected 0x00000000', samples: 1 } })
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS * 2)
  instance.incident({ process: 'child', type: 'GPU', reason: 'crashed', exitCode: 34 })
  await vi.advanceTimersByTimeAsync(MEMORY_INCIDENT_WINDOW_MS)
  expect(snapshots()).toHaveLength(3)
  expect(snapshots()[2]).toMatchObject({ fields: { triggers: 'child GPU crashed 0x00000022', samples: 3 } })
  instance.stop()
})

it('keeps a fixed ring of 40 samples, about 20 minutes', async () => {
  const { instance, snapshots } = monitor()
  instance.start()
  await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS * (MEMORY_SAMPLE_CAPACITY + 10))
  instance.incident({ process: 'renderer', reason: 'oom', exitCode: -536870904 })
  instance.settle()
  const samples = samplesOf(snapshots()[0])
  expect(samples).toHaveLength(MEMORY_SAMPLE_CAPACITY)
  expect(samples.at(-1)!.time - samples[0]!.time).toBeLessThanOrEqual(20 * 60_000)
  instance.stop()
})

it('ignores requested Host stops unless they end with Chromium OOM, and writes at once after stop', async () => {
  const { instance, snapshots } = monitor()
  instance.hostExited({ code: 0, signal: null, expected: true })
  instance.hostExited({ code: null, signal: 'SIGTERM', expected: true })
  instance.hostExited({ code: 1, signal: null, expected: true })
  await vi.advanceTimersByTimeAsync(MEMORY_INCIDENT_WINDOW_MS)
  expect(snapshots()).toEqual([])
  instance.stop()
  instance.hostExited({ code: 3758096392, signal: null, expected: true }, 7)
  expect(snapshots()).toHaveLength(1)
  expect(snapshots()[0]).toMatchObject({ fields: { triggers: 'host stopping 0xE0000008', samples: 1 } })
})

it('unreferences its timers so sampling never keeps the process alive', () => {
  vi.useRealTimers()
  const interval = vi.spyOn(globalThis, 'setInterval')
  const timeout = vi.spyOn(globalThis, 'setTimeout')
  try {
    const { instance } = monitor()
    instance.start()
    instance.incident({ process: 'renderer', reason: 'oom', exitCode: 1 })
    expect((interval.mock.results[0]!.value as NodeJS.Timeout).hasRef()).toBe(false)
    expect((timeout.mock.results.at(-1)!.value as NodeJS.Timeout).hasRef()).toBe(false)
    instance.stop()
  } finally { interval.mockRestore(); timeout.mockRestore() }
})

it('passes a full snapshot through sanitize, the JSONL history and the readable log without truncation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-memory-snapshot-')); homes.push(home)
  const diagnostics = new DesktopDiagnostics(home)
  const processes = Array.from({ length: 64 }, (_, index) => metric(20_000 + index, 300_000 + index, 280_000 + index, index % 2 ? 'Tab' : 'Utility'))
  const instance = new DesktopMemoryMonitor({ probe: { appMetrics: () => processes, system: () => ({ total: 16_384 * MB, free: 64 * MB, commitLimit: 24_576 * MB, commitFree: 8 * MB }) },
    record: input => { diagnostics.record(input) }, flush: () => { diagnostics.flush() } })
  instance.start()
  for (let index = 0; index < MEMORY_SAMPLE_CAPACITY; index++) {
    instance.hostMemory({ rss: 3_000 * MB, heapTotal: 2_000 * MB, heapUsed: 1_900 * MB, external: 50 * MB, arrayBuffers: 40 * MB }, 4242)
    await vi.advanceTimersByTimeAsync(MEMORY_SAMPLE_INTERVAL_MS)
  }
  for (let index = 0; index < 20; index++) instance.incident({ process: 'child', type: 'Utility', reason: 'killed', exitCode: index })
  instance.settle()
  const lines = historyFiles(join(home, 'logs')).flatMap(file => readFileSync(file.file, 'utf8').trim().split('\n'))
  const line = lines.find(text => text.includes('"memory.snapshot"'))!
  const record = JSON.parse(line) as { level: string; fields: Record<string, unknown>; data: { triggers: unknown[]; droppedTriggers: number; processColumns: string[]; samples: { processes: unknown[][]; host?: unknown }[] } }
  expect(record.level).toBe('error')
  expect(line).not.toContain('[truncated]')
  expect(record.data.processColumns).toEqual(['type', 'pid', 'workingSetMB', 'privateMB', 'cpu'])
  expect(record.data.samples).toHaveLength(MEMORY_SAMPLE_CAPACITY)
  // Capped below the 100 items sanitize keeps per array, so the cap is explicit rather than silent.
  expect(record.data.samples.every(sample => sample.processes.length === 48)).toBe(true)
  expect(record.data.samples[0]!.processes[1]).toEqual(['Tab', 20_001, 293, 273.4, 12.3])
  expect(record.data.samples.slice(0, -20).every(sample => sample.host !== undefined)).toBe(true)
  expect(record.data.triggers).toHaveLength(16)
  expect(record.data.droppedTriggers).toBe(4)
  expect(record.fields).toMatchObject({ samples: MEMORY_SAMPLE_CAPACITY, droppedTriggers: 4 })
  // About 80 KB at this worst case (48 process rows in every sample), far inside the 10 MiB history line limit.
  expect(Buffer.byteLength(line)).toBeLessThan(128 * 1024)
  // The readable log and the recovery page keep a one-line summary instead of the samples.
  const readable = diagnostics.snapshot().split('\n').find(text => text.includes('memory.snapshot'))!
  expect(readable).not.toContain('workingSetMB')
  expect(readable.length).toBeLessThan(2048)
  instance.stop()
  diagnostics.flush()
})
