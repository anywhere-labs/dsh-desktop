/**
 * The shell's plugin operation history for failure reports, kept as upstream Desktop keeps it from
 * dsh 0.2.2: each Host run announces an identity, the run's records are journaled, and recent records
 * are appended to a saved failure report by a bounded Worker.
 */
import { OperationJournal } from './operation-journal.ts'
import { runOperationReportJob, type OperationReportJobResult } from './operation-report-job.ts'
import { isOperationEvidence, parseOperationRecord } from './operation-record.ts'

const JOURNAL_LIMITS = { segmentBytes: 256 * 1024, recordBytes: 4096, queuedBytes: 64 * 1024 }
const REPORT_LIMITS = { bytes: 64 * 1024, recordBytes: 4096, records: 100, outputBytes: 64 * 1024 }
const REPORT_DEADLINES = { timeoutMs: 500, cancellationGraceMs: 100 }
/** Longest wait for queued records, and separately for a running collector, when the application quits. */
const SHUTDOWN_WAIT_MS = 500

/** What the basic report says about the operation history appended after it. */
export const OPERATION_HISTORY_NOTE: readonly string[] = [
  'Operation history is best effort. Without its completion marker below, it is unavailable or incomplete.',
  'Recent operations are context only. Missing records do not establish that no changes occurred.',
]

/** Records plugin operations for failure reports; the single application instance owns its directory. */
export class DesktopOperationHistory {
  private journal: OperationJournal | undefined
  private current: { runId: string | undefined } | undefined
  private job: Promise<OperationReportJobResult> | undefined
  private readonly abort = new AbortController()
  private stopping: Promise<void> | undefined

  /** @param directory - The journal directory; created privately with the first record. */
  constructor(private readonly directory: string) {}

  /**
   * Start accepting the announcement and records of one Host process; call once per spawned Host.
   * @returns Whether a Host message was an announcement or a record. A record that is malformed or
   *   belongs to another run is dropped and still counts as handled; an invalid announcement does not.
   */
  host(): (message: unknown) => boolean {
    const run: { runId: string | undefined } = { runId: undefined }
    this.current = run
    return (message) => {
      if (!isOperationEvidence(message)) return false
      if (message.type === 'starting') {
        run.runId = message.runId
        return true
      }
      const record = parseOperationRecord(message.record)
      if (record !== undefined && record.runId === run.runId) {
        try {
          this.journal ??= new OperationJournal(this.directory, JOURNAL_LIMITS)
          this.journal.enqueue(JSON.stringify(record))
        } catch (_error) {
          // Losing a diagnostic record must not invalidate the Host's IPC channel.
        }
      }
      return true
    }
  }

  /** The newest Host's run identity, once it announced one; its records carry the same `runId`. */
  get runId(): string | undefined {
    return this.current?.runId
  }

  /** The note a basic report carries before recent operations are appended; undefined once closing. */
  get reportNote(): readonly string[] | undefined {
    return this.stopping === undefined ? OPERATION_HISTORY_NOTE : undefined
  }

  /**
   * Append recent operations to a saved failure report in the background. One collector runs at a time;
   * a report saved while another is collecting keeps only its basic content.
   * @param report - The saved basic report.
   */
  append(report: string): void {
    if (this.stopping !== undefined || this.job !== undefined) return
    const job = runOperationReportJob({ reportPath: report, directory: this.directory, limits: REPORT_LIMITS,
      journal: this.journal?.status() ?? null }, REPORT_DEADLINES, this.abort.signal)
    this.job = job
    void job.finally(() => { if (this.job === job) this.job = undefined })
  }

  /**
   * Cancel a running collector and wait for queued records, each for at most 500 ms. Records that
   * arrive later are still accepted until the journal's deadline disables it.
   */
  close(): Promise<void> {
    this.stopping ??= (async () => {
      this.abort.abort()
      const job = this.job
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.all([
          job === undefined ? undefined : Promise.race([job, new Promise((resolve) => { timer = setTimeout(resolve, SHUTDOWN_WAIT_MS) })]),
          this.journal?.drain(SHUTDOWN_WAIT_MS),
        ])
      } finally {
        clearTimeout(timer)
      }
    })()
    return this.stopping
  }
}

/**
 * @param directory - The journal directory.
 * @returns The shell's plugin operation history.
 */
export function createOperationHistory(directory: string): DesktopOperationHistory {
  return new DesktopOperationHistory(directory)
}
