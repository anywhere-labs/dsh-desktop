/**
 * Rolling last-known renderer sample for failure reports.
 *
 * A renderer can die or stop answering before a report is written. The on-demand sample then has
 * nothing to ask, which is exactly the crash a report must explain, so the most recent sample of
 * the live page is kept in memory and refreshed slowly. When the page is gone the report still
 * shows what the interface was drawing shortly before, next to the reason it cannot be sampled now.
 *
 * The refresh is deliberately cheap: a short frame window once a minute while a window exists, and
 * never two samples in flight at once, so a page that ignores one request cannot queue more.
 */
import {
  collectRendererDiagnostics,
  RENDERER_ROLLING_SAMPLE_MS,
  RENDERER_ROLLING_TIMEOUT_MS,
  type RendererDiagnosticsSnapshot,
  type RendererDiagnosticsTarget,
  type RendererEvidence,
} from './renderer-diagnostics.ts'

/** How often the last-known sample is refreshed while a window exists. */
export const RENDERER_ROLLING_INTERVAL_MS = 60_000

export class RollingRendererEvidence {
  private timer: ReturnType<typeof setInterval> | undefined
  private inFlight = false
  private stopped = false
  private latest: { snapshot: RendererDiagnosticsSnapshot; takenAt: number } | undefined

  constructor(
    private readonly target: () => RendererDiagnosticsTarget | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Refresh once now, and again every interval. Idempotent, and the timer cannot hold the process open. */
  start(): void {
    if (this.timer !== undefined || this.stopped) return
    this.timer = setInterval(() => { void this.refresh() }, RENDERER_ROLLING_INTERVAL_MS)
    this.timer.unref?.()
  }

  /**
   * Take one sample now. Overlapping refreshes are skipped, and an unavailable page keeps the last
   * sample that answered rather than replacing it with nothing.
   */
  async refresh(): Promise<void> {
    if (this.stopped || this.inFlight) return
    this.inFlight = true
    try {
      const renderer = await collectRendererDiagnostics(this.target(), { sampleMs: RENDERER_ROLLING_SAMPLE_MS, timeoutMs: RENDERER_ROLLING_TIMEOUT_MS })
      if (renderer.available) this.latest = { snapshot: renderer, takenAt: this.now() }
    } finally {
      this.inFlight = false
    }
  }

  /** The most recent sample and its age, or undefined before one succeeded. */
  last(): RendererEvidence | undefined {
    const latest = this.latest
    if (latest === undefined) return undefined
    return { sample: latest.snapshot, ageMs: Math.max(0, this.now() - latest.takenAt) }
  }

  /** Stop refreshing; samples already taken stay available. */
  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
}
