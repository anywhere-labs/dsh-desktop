/** Opt-in whole-app recovery; it never submits a prompt or resumes a tool call. */
import { atomicJson, readPrivateFile } from './private-files.ts'
import type { DesktopFailureStage } from '../../dsh-plugin-desktop/src/recovery-copy.ts'

export const HOST_RECOVERY_ENV = 'DSH_DESKTOP_AUTO_RECOVER_HOST'
const WINDOW_MS = 15 * 60_000
const DELAYS_MS = [1000, 2000, 4000] as const

interface HostRecoveryOptions {
  enabled: boolean
  file: string
  /** False during quit, repair, profile changes, updates and safe/recovery mode. */
  available(): boolean
  /** Request the existing whole-app shutdown/relaunch, not a second Host. */
  relaunch(): void
  fallback(): void
  record(event: string, fields: Record<string, string | number>): void
}

/** One recovery per process, with the crash-loop budget retained across relaunches. */
export class DesktopHostRecovery {
  private timer: ReturnType<typeof setTimeout> | undefined
  private claimed = false
  private stopped = false

  constructor(private readonly options: HostRecoveryOptions) {}

  /** Return true only when this runtime failure is owned by automatic recovery. */
  handle(stage: DesktopFailureStage | undefined): boolean {
    if (!this.options.enabled || this.stopped || stage !== 'host-runtime' || !this.options.available()) return false
    if (this.claimed) return true
    let attempt: number
    try {
      const text = readPrivateFile(this.options.file, 4096)
      const saved: unknown = text === undefined ? { version: 1, attempts: [] } : JSON.parse(text)
      if (typeof saved !== 'object' || saved === null || !('version' in saved) || saved.version !== 1
        || !('attempts' in saved) || !Array.isArray(saved.attempts) || saved.attempts.length > DELAYS_MS.length
        || !saved.attempts.every((time: unknown) => typeof time === 'number' && Number.isSafeInteger(time) && time >= 0)) {
        throw new Error('Invalid Host recovery budget')
      }
      const now = Date.now()
      // Keep future entries too: moving the system clock backwards must not buy new retries.
      const attempts = (saved.attempts as number[]).filter(time => time > now - WINDOW_MS)
      if (attempts.length >= DELAYS_MS.length) {
        this.record('host.recovery.blocked', { reason: 'budget-exhausted' })
        return false
      }
      attempt = attempts.length + 1
      // Reserve before scheduling. Failed writes and corrupt state must never reset the budget.
      atomicJson(this.options.file, { version: 1, attempts: [...attempts, now] })
    } catch {
      this.record('host.recovery.blocked', { reason: 'state-unavailable' })
      return false
    }
    this.claimed = true
    const delayMs = DELAYS_MS[attempt - 1]!
    this.record('host.recovery.scheduled', { attempt, delayMs })
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.stopped) return
      if (!this.options.available()) {
        this.record('host.recovery.cancelled', { reason: 'unavailable' })
        this.options.fallback()
        return
      }
      this.record('host.recovery.relaunch', { attempt })
      try { this.options.relaunch() } catch {
        this.record('host.recovery.blocked', { reason: 'relaunch-failed' })
        this.options.fallback()
      }
    }, delayMs)
    this.timer.unref()
    return true
  }

  /** Normal shutdown or a manual recovery action wins over a pending restart. */
  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
      this.record('host.recovery.cancelled', { reason: 'stopped' })
    }
  }

  private record(event: string, fields: Record<string, string | number>): void {
    try { this.options.record(event, fields) } catch { /* Evidence must not interrupt recovery. */ }
  }
}
