/**
 * The shell's plugin operation history for failure reports, kept as upstream Desktop keeps it from
 * dsh 0.2.2: each Host run announces an identity, the run's records are journaled, and recent records
 * are appended to a saved failure report by a bounded Worker. Each finished operation is also one
 * record in the standard log.
 */
import type { LogInput } from '../log-record.ts'
import { OperationJournal } from './operation-journal.ts'
import { runOperationReportJob, type OperationReportJobResult } from './operation-report-job.ts'
import { isOperationEvidence, parseOperationRecord, type OperationRecord } from './operation-record.ts'

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

  /**
   * @param directory - The journal directory; created privately with the first record.
   * @param record - Writes the standard-log record of each finished operation.
   */
  constructor(private readonly directory: string, private readonly record?: (input: LogInput) => void) {}

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
        try {
          const summary = operationSummary(record)
          if (summary !== undefined) this.record?.(summary)
        } catch (_error) { /* The journal keeps the record. */ }
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
 * @param record - Writes the standard-log record of each finished operation.
 * @returns The shell's plugin operation history.
 */
export function createOperationHistory(directory: string, record?: (input: LogInput) => void): DesktopOperationHistory {
  return new DesktopOperationHistory(directory, record)
}

/**
 * The standard-log record of one finished plugin manager operation or plugin command.
 * @param record - A journaled record of the current Host run.
 * @returns Undefined while the operation is still running.
 */
export function operationSummary(record: OperationRecord): LogInput | undefined {
  const facts = { runId: record.runId, transportDropped: record.transportDropped }
  if ('operation' in record) {
    const { id, ...operation } = record.operation
    if (operation.phase === 'started') return undefined
    const target = operation.target ?? 'plugins'
    const failed = operation.phase === 'unknown' || operation.application === 'failed' || operation.errorCode !== undefined
    const outcome = operation.phase === 'unknown' ? 'outcome unknown' : `${operation.application}${operation.errorCode === undefined ? '' : ` (${operation.errorCode})`}`
    return { source: 'host.plugins', event: `operation.${operation.phase}`, level: failed ? 'warn' : 'info', operationId: id,
      message: `Plugin ${operation.stage} ${target}: ${outcome}`, fields: { kind: 'manager', ...operation, ...facts } }
  }
  const { id, ...command } = record.pluginCommand
  if (command.phase === 'started') return undefined
  const target = command.target ?? 'plugins'
  const outcome = command.phase === 'unknown' ? 'outcome unknown' : command.exitCode === null ? `ended by ${command.signal ?? 'a signal'}` : `exit ${command.exitCode}`
  return { source: 'host.plugins', event: `operation.${command.phase}`, operationId: id,
    level: command.phase === 'unknown' || command.exitCode !== 0 ? 'warn' : 'info',
    message: `Plugin command ${command.action} ${target}: ${outcome}`, fields: { kind: 'command', ...command, ...facts } }
}
