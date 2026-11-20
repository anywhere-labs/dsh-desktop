import { afterEach, expect, it, vi } from 'vitest'
import { ACTIVE_SAMPLE_MS, HostHealth, IDLE_SAMPLE_MS } from '../src/host/health.ts'
import { TurnDiagnostics } from '../src/host/default-diagnostics.ts'
import { DesktopMemoryMonitor } from '../src/memory-monitor.ts'

afterEach(() => { vi.useRealTimers() })

/** A sampler on fake timers, with clocks the test moves: `block` keeps the loop busy, `pause` leaves it idle. */
function sampler() {
  vi.useFakeTimers()
  const clock = { at: 0, busy: 0 }
  const record = vi.fn()
  const health = new HostHealth(record, { now: () => clock.at, busy: () => clock.busy })
  const wait = (ms: number) => { for (let step = 0; step < ms; step += 10) { clock.at += 10; vi.advanceTimersByTime(10) } }
  /** The loop is busy for `ms`, so the next sample fires that much late. */
  const block = (ms: number) => { clock.at += ms; clock.busy += ms }
  /** The process is suspended or its timer coalesced: time passes, the loop does nothing. */
  const pause = (ms: number) => { clock.at += ms }
  return { health, record, clock, wait, block, pause, events: () => record.mock.calls.map(([input]) => input.event) }
}

it('reports one incident across stalled windows, with its worst delay, and samples slowly when idle', () => {
  const { health, record, wait, block, events } = sampler()
  health.start()
  wait(400); block(1200); wait(600)
  health.sample()
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'host.health', event: 'stall.started', level: 'warn',
    fields: expect.objectContaining({ delayMs: 1200, sampleMs: IDLE_SAMPLE_MS }) }))
  wait(1000); block(3000); wait(1000)
  health.sample()
  expect(events()).toEqual(['stall.started'])
  wait(5000)
  health.sample()
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'stall.recovered', fields: expect.objectContaining({ worstDelayMs: 3000, windows: 2 }) }))
  health.stop()
  expect(vi.getTimerCount()).toBe(0)
})

it('ignores short delays, and late samples of an idle loop such as a suspended process', () => {
  const { health, wait, block, pause, events } = sampler()
  health.start()
  wait(500); block(450); wait(500)
  wait(500); pause(60_000); wait(500)
  health.sample()
  expect(events()).toEqual([])
  health.stop()
})

it('samples every 250 ms during overlapping activities and counts a sample that was due when they end', () => {
  const { health, record, wait, block, events } = sampler()
  health.start()
  health.activity('session:a', true); health.activity('operation:1', true); health.activity('session:a', false)
  wait(100); block(450); wait(150)
  health.sample()
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'stall.started', fields: expect.objectContaining({ delayMs: 450, sampleMs: ACTIVE_SAMPLE_MS }) }))
  wait(1000); health.sample()
  // The operation ends after a block, before the overdue sample ran.
  wait(100); block(600)
  health.activity('operation:1', false)
  health.sample()
  expect(events()).toEqual(['stall.started', 'stall.recovered', 'stall.started'])
  // Back to one sample a second: 450 ms late is under the idle threshold.
  wait(1000); health.sample()
  wait(500); block(450); wait(500); health.sample()
  expect(events()).toEqual(['stall.started', 'stall.recovered', 'stall.started', 'stall.recovered'])
  health.stop()
})

it('reports the window utilization the memory push carries', () => {
  const { health, wait, block } = sampler()
  wait(10_000); block(5000); wait(5000)
  expect(health.sample()).toBe(0.25)
  expect(health.sample()).toBe(0)
})

it('summarizes failed model requests per turn, the final failure, and leaves cancellations and clean turns out', () => {
  const record = vi.fn(); const health = new HostHealth(record)
  const activity = vi.spyOn(health, 'activity')
  const turns = new TurnDiagnostics(record, health)
  turns.start('a', 1); turns.start('b', 1)
  for (let i = 0; i < 100; i++) turns.failure('a', 1, 'RATE_LIMITED')
  turns.failure('b', 1, 'NETWORK')
  turns.end('a', 1, 'error', { code: 'RATE_LIMITED', status: 429 })
  expect(record).toHaveBeenCalledOnce()
  expect(record).toHaveBeenLastCalledWith({ source: 'host.health', event: 'turn.summary', level: 'error', message: 'Turn failed: RATE_LIMITED',
    fields: { sessionId: 'a', turn: 1, outcome: 'error', modelFailures: 100, failureCode: 'RATE_LIMITED', failureStatus: 429 } })
  turns.end('b', 1, 'completed')
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'warn', fields: expect.objectContaining({ outcome: 'completed', modelFailures: 1, failureCode: 'NETWORK' }) }))
  turns.start('a', 2); turns.end('a', 2, 'aborted')
  turns.start('a', 3); turns.end('a', 2, 'completed')
  expect(turns.active('a')).toBe(true)
  expect(record).toHaveBeenCalledTimes(2)
  turns.start('c', 1); turns.remove('c')
  expect(activity).toHaveBeenLastCalledWith('session:c', false)
  turns.clear()
  expect(turns.active('a')).toBe(false)
})

it('detects missing heartbeats once, recovers once, and clears the old Host on expected exit', () => {
  vi.useFakeTimers()
  const record = vi.fn()
  const monitor = new DesktopMemoryMonitor({ record, flush() {} })
  monitor.start(); monitor.hostStarted(1)
  vi.advanceTimersByTime(120_000)
  expect(record.mock.calls.filter(([input]) => input.event === 'heartbeat.missing')).toEqual([[expect.objectContaining({ source: 'host.process', level: 'warn', pid: 1 })]])
  monitor.hostMemory({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0, eventLoopUtilization: 0.5 }, 1)
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'host.process', event: 'heartbeat.recovered', pid: 1, fields: { silenceMs: 120_000 } }))
  monitor.hostExited({ expected: true, code: 0, signal: null }, 1)
  vi.advanceTimersByTime(120_000)
  expect(record.mock.calls.filter(([input]) => input.event === 'heartbeat.missing')).toHaveLength(1)
  monitor.stop()
})

it('does not blame the Host for a sleeping main process or for the previous process after restart', () => {
  vi.useFakeTimers()
  const record = vi.fn()
  const monitor = new DesktopMemoryMonitor({ record, flush() {} })
  monitor.start(); monitor.hostStarted(1)
  vi.setSystemTime(Date.now() + 3_600_000)
  vi.advanceTimersByTime(30_000)
  expect(record.mock.calls.some(([input]) => input.event === 'heartbeat.missing')).toBe(false)
  monitor.hostStarted(2)
  monitor.hostMemory({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 }, 1)
  monitor.hostExited({ expected: true, code: 0, signal: null }, 1)
  vi.advanceTimersByTime(90_000)
  expect(record.mock.calls.filter(([input]) => input.event === 'heartbeat.missing')).toEqual([[expect.objectContaining({ pid: 2 })]])
  monitor.stop()
})
