/**
 * Plain-text failure reports: what opened the recovery assistant, saved in the logs directory as it
 * opens so that one file can be attached to a support request. Every failure text and the log tail
 * are masked like the readable log; the diagnostics export remains the complete package.
 */
import { appendFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspect } from 'node:util'
import type { DesktopFailureStage } from '../../dsh-plugin-desktop/src/recovery-copy.ts'
import { startupEntriesSection, type DesktopStartupTimeoutFailure } from './host-startup-limit.ts'
import { maskSecrets } from './mask-secrets.ts'
import { privateDirectory } from './private-files.ts'
import type { RendererDiagnostics, RendererDiagnosticsSnapshot, RendererEvidence } from './renderer-diagnostics.ts'

/** Reports kept after each write; older ones are removed by file name order. */
export const FAILURE_REPORTS_RETAINED = 10
/** Characters of the readable log a report repeats. */
const LOG_TAIL_CHARS = 64 * 1024
/** Upper bound of the inspected error section. */
const ERROR_DETAIL_CHARS = 64 * 1024
/** The exact generated name syntax; pruning touches only files that match it. */
const REPORT_NAME = /^dsh-desktop-next-failure-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z]+(?:-[a-z]+)*\.log$/u

/** What one report records. */
export interface FailureReportInput {
  readonly time: Date
  readonly stage: DesktopFailureStage
  /** The failure text the recovery assistant shows. */
  readonly failure: string
  /** The Host's own diagnostic, when it reported the failure over IPC before exiting. */
  readonly hostDiagnostic?: string | undefined
  /** An error raised by the shell, whose stack, properties and cause chain the report adds. */
  readonly error?: Error | undefined
  /** The limit a Host start exceeded and every entry it was still loading. */
  readonly startup?: DesktopStartupTimeoutFailure | undefined
  /** Launch and session facts for the header, in order. */
  readonly facts: readonly (readonly [name: string, value: string])[]
  /** The readable log when the failure was reported. */
  readonly log: string
  /** What the report says about auxiliary diagnostics appended after it, when any will be. */
  readonly auxiliary?: readonly string[] | undefined
}

/**
 * @param time - When the failure was reported.
 * @param stage - Where it stopped the Desktop.
 * @returns `dsh-desktop-next-failure-<ISO time with ':' and '.' as '-'>-<stage>.log`, which sorts by time.
 */
export function failureReportFileName(time: Date, stage: DesktopFailureStage): string {
  return `dsh-desktop-next-failure-${time.toISOString().replaceAll(/[:.]/gu, '-')}-${stage}.log`
}

function bounded(text: string, limit: number, label: string): string {
  return text.length <= limit ? text : `${text.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, '')}\n… (${label} cut at ${String(limit)} characters)`
}

function logTail(log: string): string {
  if (log.length <= LOG_TAIL_CHARS) return log
  const tail = log.slice(-LOG_TAIL_CHARS)
  const line = tail.indexOf('\n')
  return `… (earlier log lines omitted)\n${line === -1 ? tail : tail.slice(line + 1)}`
}

/**
 * Render one report: header facts, the failure as shown, the Host's own diagnostic or the shell
 * error's details, the end of the readable log, and the note about any auxiliary diagnostics.
 * @param input - The failure and its context.
 * @returns The complete file content, with secret-shaped text masked.
 */
export function renderFailureReport(input: FailureReportInput): string {
  const lines = [
    'DSH NEXT failure report',
    'Review it before sharing: it can contain local paths and plugin output.',
    '',
    `time: ${input.time.toISOString()}`,
    `stage: ${input.stage}`,
    ...input.facts.map(([name, value]) => `${name}: ${value}`),
    '',
    '--- failure (as shown in the recovery assistant) ---',
    maskSecrets(input.failure),
  ]
  if (input.startup !== undefined) lines.push('', ...startupEntriesSection(input.startup).map(line => maskSecrets(line)))
  if (input.hostDiagnostic !== undefined) {
    lines.push('', '--- Host diagnostic (as reported by the Host process) ---', maskSecrets(input.hostDiagnostic))
  }
  if (input.error !== undefined) {
    const details = inspect(input.error, { depth: 6, maxArrayLength: 50, maxStringLength: 16 * 1024, breakLength: 120 })
    lines.push('', '--- error details ---', maskSecrets(bounded(details, ERROR_DETAIL_CHARS, 'error details')))
  }
  lines.push('', '--- recent log (oldest first) ---', input.log === '' ? '(no log lines were recorded)' : maskSecrets(logTail(input.log)), '')
  if (input.auxiliary !== undefined) lines.push('--- auxiliary diagnostics ---', ...input.auxiliary, '')
  return lines.join('\n')
}

/**
 * Render the renderer evidence appended to a failure report.
 * @param renderer - the sample taken while the report was written.
 * @param lastKnown - the last sample that answered earlier, used when the page cannot be sampled now.
 * @returns the section, ending in a blank line, or '' when there is nothing to report.
 */
export function rendererFailureSection(renderer: RendererDiagnostics, lastKnown?: RendererEvidence): string {
  // Nothing was ever sampled and there is no window now: startup failures stay as they were.
  if (!renderer.available && renderer.reason === 'no-window' && lastKnown === undefined) return ''
  const lines = ['--- renderer at failure ---', ...rendererStatus(renderer)]
  if (lastKnown !== undefined) {
    lines.push('', `last known: ${ageText(lastKnown.ageMs)} before the failure`, ...rendererLines(lastKnown.sample))
  }
  return `${lines.join('\n')}\n`
}

function rendererStatus(renderer: RendererDiagnostics): string[] {
  if (!renderer.available) return [`unavailable: ${renderer.reason}${renderer.detail === undefined ? '' : ` (${renderer.detail.replace(/\s+/gu, ' ')})`}`]
  return rendererLines(renderer)
}

function rendererLines(renderer: RendererDiagnosticsSnapshot): string[] {
  return [
    `sampled: ${String(renderer.sampleMs)} ms, ${String(renderer.frameLoop.frames)} frames (${String(renderer.frameLoop.framesPerSecond)}/s, ${renderer.frameLoop.sampledBy})`,
    `window: ${renderer.view.visibility}, ${renderer.view.focused === true ? 'focused' : renderer.view.focused === false ? 'unfocused' : 'focus unknown'}${renderer.view.reducedMotion === true ? ', reduced motion' : ''}, ${size(renderer.view.width, renderer.view.height)}@${String(renderer.view.devicePixelRatio ?? '?')}x`,
    `dom: ${String(renderer.dom.elements ?? '?')} elements`,
    `long tasks: ${renderer.longTasks === null ? 'unmeasured' : `${String(renderer.longTasks.count)} in ${String(renderer.longTasks.totalMs)} ms`}`,
    `animations: ${String(renderer.animations.length)} running of ${String(renderer.animationsTotal)}`,
    ...renderer.animations.map(animation => `  ${animation.name} on ${animation.target}${animation.pseudo ?? ''}${animation.infinite ? ' (infinite)' : ''}${animation.currentTime === null ? '' : ` at ${String(animation.currentTime)} ms`}`),
    `body layers: ${String(renderer.layers.length)}`,
    ...renderer.layers.map(layer => `  ${layer.tag}${layer.id === null ? '' : `#${layer.id}`}${layer.className === null ? '' : `.${layer.className.trim().split(/\s+/u).slice(0, 3).join('.')}`} ${layer.position}, ${String(layer.children)} children`),
  ]
}

function size(width: number | null, height: number | null): string {
  return `${String(width ?? '?')}x${String(height ?? '?')}`
}

function ageText(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000))
  return seconds < 90 ? `${String(seconds)} s` : `${String(Math.round(seconds / 60))} min`
}

/**
 * Append evidence collected after the basic report was written, without rewriting that report.
 * Appended text is masked exactly like the report itself.
 * @param file - the report file.
 * @param text - the section to append.
 */
export async function appendFailureReport(file: string, text: string): Promise<void> {
  await appendFile(file, `\n${maskSecrets(text)}`, { mode: 0o600 })
}

/**
 * Delete the oldest reports beyond `retained`, judged by file name, and leave every other file alone.
 * @param directory - The Desktop logs directory.
 * @param retained - Reports to keep.
 */
export async function pruneFailureReports(directory: string, retained = FAILURE_REPORTS_RETAINED): Promise<void> {
  const reports = (await readdir(directory)).filter(name => REPORT_NAME.test(name)).sort()
  for (const name of reports.slice(0, Math.max(0, reports.length - retained))) {
    // A report that cannot be removed now is removed after a later failure.
    await unlink(join(directory, name)).catch(() => {})
  }
}

/**
 * Write one private report, then keep the newest {@link FAILURE_REPORTS_RETAINED}.
 * @param directory - The Desktop logs directory; created privately when absent.
 * @param input - The failure and its context.
 * @returns The written file; rejects when the report could not be written, not when pruning fails.
 */
export async function writeFailureReport(directory: string, input: FailureReportInput): Promise<string> {
  privateDirectory(directory)
  const file = join(directory, failureReportFileName(input.time, input.stage))
  await writeFile(file, renderFailureReport(input), { mode: 0o600, flag: 'wx' })
  // Retention is housekeeping; the report already exists.
  await pruneFailureReports(directory).catch(() => {})
  return file
}
