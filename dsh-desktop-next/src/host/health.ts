/**
 * Host event-loop stalls for the standard log. One unreferenced timer samples the loop every second, and every
 * 250 ms while a turn or plugin operation runs; nothing is logged per sample. A sample that fires late by the
 * interval's threshold counts as a stall only when the loop was busy for most of that lateness: a late timer on an
 * idle loop means the process was suspended or its timers were coalesced, not that the Host was blocked.
 *
 * The existing 30-second memory push reads the window. The first window with a stall records `stall.started`;
 * the first window without one records `stall.recovered` with the worst delay of the incident. A delay is the
 * lateness of one sample, so the block lasted at least that long and at most one sampling interval longer.
 */
import { performance } from 'node:perf_hooks'
import type { LogInput } from '../log-record.ts'

export const IDLE_SAMPLE_MS = 1000
export const ACTIVE_SAMPLE_MS = 250
/** Lateness that counts as a stall: blocks from 1.5 s while idle and from 650 ms during activity are always seen. */
const STALL_MS = { idle: 500, active: 400 } as const
/** Share of the lateness the loop must have spent busy for the lateness to count as a block. */
const BUSY_SHARE = 0.9

/** The clocks the sampler reads; tests replace them. */
export interface HealthClock {
  /** Monotonic milliseconds. */
  now(): number
  /** Milliseconds the event loop has spent outside its idle wait since it started. */
  busy(): number
}

const PROCESS_CLOCK: HealthClock = { now: () => performance.now(), busy: () => performance.eventLoopUtilization().active }

interface Reading { readonly at: number; readonly busy: number }
interface Stall { delayMs: number; sampleMs: number }

export class HostHealth {
  private readonly activities = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private interval = IDLE_SAMPLE_MS
  private tick: Reading
  private window: Reading
  /** The worst stall of the current window. */
  private worst: Stall | undefined
  private incident: (Stall & { windows: number }) | undefined

  constructor(private readonly record: (input: LogInput) => void, private readonly clock: HealthClock = PROCESS_CLOCK) {
    this.tick = this.window = this.read()
  }

  /** Start sampling; the Host's logging plugin calls this when it mounts. */
  start(): void {
    if (this.timer !== undefined) return
    this.interval = this.activities.size > 0 ? ACTIVE_SAMPLE_MS : IDLE_SAMPLE_MS
    this.tick = this.read()
    this.schedule()
  }

  /**
   * Sample faster while any activity runs.
   * @param key - The activity, such as `session:<id>` or `operation:<id>`.
   * @param active - Whether it started or ended.
   */
  activity(key: string, active: boolean): void {
    if (active) this.activities.add(key); else this.activities.delete(key)
    const interval = this.activities.size > 0 ? ACTIVE_SAMPLE_MS : IDLE_SAMPLE_MS
    if (interval === this.interval) return
    if (this.timer === undefined) { this.interval = interval; return }
    // The pending sample may already be overdue when the activity ends: count it before switching.
    const now = this.read()
    this.observe(now, this.interval)
    clearTimeout(this.timer)
    this.tick = now
    this.interval = interval
    this.schedule()
  }

  /**
   * Close the current window; the existing 30-second memory push calls this.
   * @returns The window's event-loop utilization, which the push carries to the Desktop.
   */
  sample(): number {
    const now = this.read()
    const elapsed = now.at - this.window.at
    const utilization = elapsed > 0 ? Math.round(Math.min(1, Math.max(0, (now.busy - this.window.busy) / elapsed)) * 10_000) / 10_000 : 0
    this.window = now
    const worst = this.worst
    this.worst = undefined
    if (worst !== undefined && this.incident === undefined) {
      this.incident = { ...worst, windows: 1 }
      this.record({ source: 'host.health', event: 'stall.started', level: 'warn', message: 'Host event loop stalled',
        fields: { delayMs: Math.round(worst.delayMs), sampleMs: worst.sampleMs, utilization } })
    } else if (worst !== undefined && this.incident !== undefined) {
      this.incident.windows++
      if (worst.delayMs > this.incident.delayMs) Object.assign(this.incident, worst)
    } else if (this.incident !== undefined) {
      const { delayMs, sampleMs, windows } = this.incident
      this.incident = undefined
      this.record({ source: 'host.health', event: 'stall.recovered', message: 'Host event loop recovered',
        fields: { worstDelayMs: Math.round(delayMs), sampleMs, windows, utilization } })
    }
    return utilization
  }

  /** Stop sampling, on shutdown or when the logging plugin unmounts. */
  stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.activities.clear()
  }

  private read(): Reading { return { at: this.clock.now(), busy: this.clock.busy() } }

  private observe(now: Reading, interval: number): void {
    const delayMs = now.at - this.tick.at - interval
    const threshold = interval === ACTIVE_SAMPLE_MS ? STALL_MS.active : STALL_MS.idle
    if (delayMs < threshold || now.busy - this.tick.busy < delayMs * BUSY_SHARE) return
    if (this.worst === undefined || delayMs > this.worst.delayMs) this.worst = { delayMs, sampleMs: interval }
  }

  private schedule(): void {
    const interval = this.interval
    this.timer = setTimeout(() => {
      const now = this.read()
      this.observe(now, interval)
      this.tick = now
      this.schedule()
    }, interval)
    this.timer.unref()
  }
}
