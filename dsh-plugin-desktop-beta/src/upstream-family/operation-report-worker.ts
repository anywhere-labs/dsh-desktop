/**
 * Isolated auxiliary-report I/O; the shell owns termination and observes worker exit. Follows upstream
 * Desktop's `apps/desktop/src/operation-report-worker.ts` (added in dsh 0.2.2).
 */
import { parentPort, workerData } from 'node:worker_threads'
import type { OperationJournalStatus } from './operation-journal.ts'
import { appendOperationReport } from './operation-report.ts'
import type { OperationReportJobInput } from './operation-report-job.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError('Invalid operation report budget')
  return value as number
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError('Invalid operation journal counter')
  return value as number
}

function journalStatus(value: unknown): OperationJournalStatus | null {
  if (value === null) return null
  if (!isObject(value) || typeof value.disabled !== 'boolean') throw new TypeError('Invalid operation journal status')
  return { dropped: count(value.dropped), failed: count(value.failed), repairedSegments: count(value.repairedSegments),
    queuedBytes: count(value.queuedBytes), disabled: value.disabled }
}

function parseInput(value: unknown): OperationReportJobInput {
  if (!isObject(value) || typeof value.reportPath !== 'string' || typeof value.directory !== 'string' || !isObject(value.limits)) {
    throw new TypeError('Invalid operation report input')
  }
  const { limits } = value
  return { reportPath: value.reportPath, directory: value.directory, journal: journalStatus(value.journal),
    limits: { bytes: positive(limits.bytes), recordBytes: positive(limits.recordBytes), records: positive(limits.records), outputBytes: positive(limits.outputBytes) } }
}

const input = parseInput(workerData)
const cancellation = new AbortController()
const cancel = (message: unknown): void => {
  if (message === 'cancel') cancellation.abort()
}
parentPort?.on('message', cancel)
try {
  const appended = await appendOperationReport(input.reportPath, input.directory, input.limits, cancellation.signal, input.journal)
  parentPort?.postMessage(appended)
} finally {
  parentPort?.off('message', cancel)
  parentPort?.close()
}
