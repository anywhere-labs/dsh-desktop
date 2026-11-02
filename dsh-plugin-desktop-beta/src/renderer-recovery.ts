/** Bounded renderer repair; the Host remains owned by the runtime throughout retries. */
export type DesktopRendererStatus = 'healthy'

/**
 * Who started a main-window document: the Desktop opening the window, automatic recovery, an explicit
 * reload (the reload command, or a Host restart that replaces the document), or the page itself.
 */
export type DesktopNavigationCause = 'open' | 'recovery' | 'reload' | 'page'

interface RendererRecoveryOptions {
  available(): boolean
  reload(): Promise<void>
  exhausted(detail: string): void
  /** A document has loaded and its interface has mounted. */
  healthy(): void
  record(event: string, fields: Record<string, string | number>): void
}

const RETRY_DELAYS_MS = [0, 1000, 3000] as const
const HEALTH_TIMEOUT_MS = 30_000
const STABLE_PERIOD_MS = 60_000

export class NextRendererRecovery {
  private phase: 'idle' | 'waiting' | 'scheduled' | 'exhausted' | 'stopped' = 'idle'
  private attempts = 0
  private documentLoaded = false
  private clientHealthy = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private stableTimer: ReturnType<typeof setTimeout> | undefined
  private navigation = 0
  private bootExpected = false
  private cause: DesktopNavigationCause = 'open'

  constructor(private readonly options: RendererRecoveryOptions) {}

  /**
   * Invalidate both page readiness and pending completions from an older navigation.
   * @param cause - Who started the new document; its mount counts as a recovery only when recovery started it.
   */
  navigating(cause: DesktopNavigationCause): void {
    if (!this.available()) return
    this.navigation++
    this.cause = cause
    this.documentLoaded = false
    this.clientHealthy = false
    this.bootExpected = false
    this.clearStableTimer()
  }

  /** Start the readiness deadline only after the Host has supplied this document's boot data. */
  booted(): void {
    if (this.bootExpected) return
    this.bootExpected = true
    this.waitForHealth()
  }

  loaded(): void {
    if (!this.available()) return
    this.documentLoaded = true
    this.acceptHealth()
  }

  report(_status: DesktopRendererStatus): void {
    if (!this.available()) return
    this.clientHealthy = true
    this.acceptHealth()
  }

  fail(detail: string): void {
    if (!this.available() || this.phase === 'scheduled') return
    this.clearTimer()
    this.clearStableTimer()
    this.clientHealthy = false
    const delay = RETRY_DELAYS_MS[this.attempts]
    if (delay === undefined) {
      this.phase = 'exhausted'
      this.options.record('renderer.recovery.exhausted', { attempt: this.attempts, detail })
      this.options.exhausted(detail)
      return
    }
    this.phase = 'scheduled'
    this.options.record('renderer.recovery.scheduled', { attempt: this.attempts + 1, delayMs: delay, detail })
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (!this.available()) return
      this.phase = 'waiting'
      this.documentLoaded = false
      this.attempts++
      this.options.record('renderer.recovery.reload', { attempt: this.attempts })
      this.armDeadline()
      // loadURL starts navigation synchronously; navigating() fences this promise
      // when a later reload or a native reload supersedes it.
      const loading = this.options.reload()
      const navigation = this.navigation
      void loading.catch(error => {
        if (navigation === this.navigation) this.fail(error instanceof Error ? error.message : String(error))
      })
    }, delay)
    this.timer.unref()
  }

  stop(): void {
    this.phase = 'stopped'
    this.navigation++
    this.clearTimer()
    this.clearStableTimer()
  }

  private available(): boolean {
    return this.phase !== 'stopped' && this.phase !== 'exhausted' && this.options.available()
  }

  private waitForHealth(): void {
    if (!this.available() || this.phase === 'scheduled' || this.phase === 'waiting') return
    this.phase = 'waiting'
    this.armDeadline()
  }

  private armDeadline(): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.fail('Renderer recovery timed out waiting for page load and UI mount')
    }, HEALTH_TIMEOUT_MS)
    this.timer.unref()
  }

  private acceptHealth(): void {
    if (!this.documentLoaded || !this.clientHealthy || this.phase === 'scheduled') return
    if (this.phase === 'idle' && this.stableTimer !== undefined) return
    this.clearTimer()
    this.phase = 'idle'
    if (this.cause === 'recovery') this.options.record('renderer.recovery.healthy', { attempt: this.attempts })
    else this.options.record('renderer.ready', { cause: this.cause })
    this.options.healthy()
    this.clearStableTimer()
    this.stableTimer = setTimeout(() => {
      this.stableTimer = undefined
      if (this.available()) this.attempts = 0
    }, STABLE_PERIOD_MS)
    this.stableTimer.unref()
  }

  private clearTimer(): void { clearTimeout(this.timer); this.timer = undefined }
  private clearStableTimer(): void { clearTimeout(this.stableTimer); this.stableTimer = undefined }
}

export function isDesktopRendererStatus(value: unknown): value is DesktopRendererStatus {
  return value === 'healthy'
}
