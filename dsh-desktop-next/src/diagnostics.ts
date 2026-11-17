/** Recent readable diagnostics plus private structured history. */
import { randomUUID } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import { Worker } from 'node:worker_threads'
import { crashDumpInventory } from './crash-reporting.ts'
import { atomicJson, atomicText, readPrivateFile } from './private-files.ts'
import { maskSecrets } from './mask-secrets.ts'
import { LogHistory, type LogHistoryOptions } from './log-history.ts'
import { LogLimiter } from './log-limiter.ts'
import { HOST_LOG_PREFIX, LOG_LEVELS, isLogInput, sanitize, type LogInput, type LogRecord } from './log-record.ts'
import type { DesktopPreferences, DesktopState } from './desktop-contract.ts'
import type { RendererDiagnostics } from './renderer-diagnostics.ts'

const LIMIT = 128 * 1024
const MAX_PENDING = 1024 * 1024
/** Pending records reach the history within this delay; an error-level record is written at once. */
const FLUSH_DELAY_MS = 200
/** The readable copy is rewritten at most this often, and at once when the run ends or the log directory is opened. */
export const READABLE_INTERVAL_MS = 5_000
/** Lines that plugins control: Host process output, plugin loggers and client reports. Repeats fold and each source is rate-limited. */
const LIMITED_SOURCE = /^(?:host\.(?:stdout|stderr|kernel\.)|renderer\.client$)/u

/** Readable lines of the current run, oldest first, within a character budget; a single longer line is kept whole. */
class TextTail {
  private lines: string[] = []
  private head = 0
  chars = 0
  constructor(private readonly limit: number) {}
  push(line: string): void {
    this.lines.push(line); this.chars += line.length
    while (this.chars > this.limit && this.lines.length - this.head > 1) this.chars -= this.lines[this.head++]!.length
    // Release dropped lines in batches instead of shifting the array for every line.
    if (this.head >= 1024 && this.head * 2 >= this.lines.length) { this.lines = this.lines.slice(this.head); this.head = 0 }
  }
  text(): string { return (this.head === 0 ? this.lines : this.lines.slice(this.head)).join('') }
}

export class DesktopDiagnostics {
  readonly file: string
  readonly runId = randomUUID()
  private readonly marker: string
  private history: LogHistory | undefined
  /** Readable text that earlier runs left; it gives way as the current run fills the window. */
  private previous = ''
  private readonly current = new TextTail(LIMIT)
  private readonly limiter = new LogLimiter()
  /** Bumped whenever the readable text or a partial process line changes; the file is rewritten only then. */
  private textRevision = 0
  private writtenRevision = -1
  private readableWrittenAt = 0
  private partial = new Map<string, { text: string; dropping: boolean; pid?: number }>()
  private pending: string[] = []
  private pendingBytes = 0
  private sequence = 0
  private storageError: string | undefined
  private droppedRecords = 0
  private active = new Map<string, { source: string; event: string; started: number }>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private readableTimer: ReturnType<typeof setTimeout> | undefined
  /** Fires when the next repeat or dropped count falls due; `countDue` is the time it was set for. */
  private countTimer: ReturnType<typeof setTimeout> | undefined
  private countDue: number | undefined
  level: DesktopPreferences['logLevel'] = 'info'
  developer = false
  /** Electron's Crashpad directory; exports describe its minidumps without including them. */
  crashDumps: string | undefined
  /** The launch facts `begin()` recorded, repeated in failure reports. */
  launch: LogInput['fields']
  constructor(home: string, options?: LogHistoryOptions) {
    const directory = join(home, 'logs')
    this.file = join(directory, 'desktop-next.log')
    this.marker = join(directory, 'active-run.json')
    try { this.previous = readPrivateFile(this.file, LIMIT * 4)?.slice(-LIMIT) ?? '' } catch { /* Logging cannot prevent recovery. */ }
    try { this.history = new LogHistory(directory, options) } catch { /* Retain the recent log when history is unavailable. */ }
  }
  /** Called only by the single-instance owner, after preferences are loaded. */
  begin(fields: LogInput['fields']): void {
    this.launch = fields
    try {
      const previous = readPrivateFile(this.marker)
      if (previous) {
        const run = JSON.parse(previous) as { runId?: unknown; clean?: unknown; started?: unknown }
        if (run.clean !== true) this.record({ source: 'electron', event: 'run.previous-unclean', level: 'warn',
          fields: { previousRunId: typeof run.runId === 'string' ? run.runId : 'unknown', previousStarted: typeof run.started === 'string' ? run.started : 'unknown' } })
      }
      atomicJson(this.marker, { runId: this.runId, pid: process.pid, started: new Date().toISOString(), clean: false })
    } catch (error) { this.record({ source: 'logging', event: 'run.marker-failed', level: 'warn', error }) }
    this.record({ source: 'electron', event: 'run.start', fields })
    this.flush()
  }
  end(clean: boolean): void {
    this.record({ source: 'electron', event: clean ? 'run.end' : 'run.forced-exit', level: clean ? 'info' : 'error', fields: { pendingOperations: this.active.size } })
    this.flush(true)
    try { atomicJson(this.marker, { runId: this.runId, pid: process.pid, ended: new Date().toISOString(), clean }) } catch { /* Best effort. */ }
  }
  record(input: LogInput): void {
    const level = input.level ?? 'info'
    // Basic lifecycle evidence is never disabled by a verbosity setting.
    if (input.developer && (!this.developer || LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(this.level))) return
    let urgent = false
    if (LIMITED_SOURCE.test(input.source)) { for (const admitted of this.limiter.admit(input)) urgent = this.enqueue(admitted) || urgent }
    else urgent = this.enqueue(input)
    if (urgent || this.pendingBytes >= MAX_PENDING) this.flush()
    else { this.timer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS); this.timer.unref() }
  }
  /** Add one accepted record to the pending history and the readable text; true when it must be written at once. */
  private enqueue(input: LogInput): boolean {
    const level = input.level ?? 'info'
    if (input.operationId) {
      if (input.event.endsWith('.start')) this.active.set(input.operationId, { source: input.source, event: input.event.slice(0, -6), started: Date.now() })
      else if (/\.(complete|failed)$/u.test(input.event)) this.active.delete(input.operationId)
    }
    if (this.active.size > 4096) { this.active.delete(this.active.keys().next().value!); this.droppedRecords++ }
    const record = sanitize({ time: new Date().toISOString(), runId: this.runId, sequence: ++this.sequence,
      pid: input.pid ?? process.pid, source: input.source, event: input.event, level,
      message: input.message ?? '', developer: input.developer ?? false, operationId: input.operationId,
      fields: input.fields, data: input.data, error: input.error }) as LogRecord
    const line = JSON.stringify(record)
    this.pending.push(line); this.pendingBytes += Buffer.byteLength(line) + 1
    if (!input.historyOnly) {
      const detail = record.error === undefined ? '' : ` ${JSON.stringify(record.error)}`
      this.current.push(`${record.time} [${level}] ${record.message ? record.message + ' ' : ''}[${record.source}] ${record.event}${record.operationId ? ` (${record.operationId})` : ''}${record.fields ? ` ${JSON.stringify(record.fields)}` : ''}${detail}\n`)
      if (this.current.chars >= LIMIT) this.previous = ''
      this.textRevision++
    }
    return level === 'error'
  }
  append(message: string, level: DesktopPreferences['logLevel'] = 'info'): void {
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(this.level)) return
    this.record({ source: 'desktop', event: 'message', message, level, developer: level === 'debug' })
  }
  operation(source: string, event: string, fields?: LogInput['fields'], developer = false): (error?: unknown) => void {
    const operationId = randomUUID()
    const started = Date.now()
    this.active.set(operationId, { source, event, started })
    this.record({ source, event: `${event}.start`, fields, operationId, developer })
    let finished = false
    return (error?: unknown) => {
      if (finished) return
      finished = true; this.active.delete(operationId)
      this.record({ source, event: `${event}.${error === undefined ? 'complete' : 'failed'}`, operationId,
        fields: { ...fields, durationMs: Date.now() - started }, developer: error === undefined && developer,
        level: error === undefined ? 'info' : 'error', error })
    }
  }
  pendingOperations(): LogInput['fields'][] {
    return [...this.active].map(([operationId, operation]) => ({ operationId, source: operation.source, event: operation.event, durationMs: Date.now() - operation.started }))
  }
  /** Independent buffers prevent stdout/stderr fragments from being joined together. */
  hostChunk(chunk: string, stream = 'stdout', pid?: number): void {
    const key = `${pid ?? 0}:${stream}`
    const buffer = this.partial.get(key) ?? { text: '', dropping: false, pid }
    for (const part of chunk.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
      const complete = part.endsWith('\n')
      if (!buffer.dropping) {
        if (buffer.text.length + part.length > LIMIT) {
          buffer.text = ''; buffer.dropping = true
          this.record({ source: `host.${stream}`, event: 'line.omitted', level: 'warn', pid, message: 'Oversized process output line omitted' })
        } else buffer.text += part
      }
      if (complete) {
        if (!buffer.dropping) this.hostLine(buffer.text.replace(/\r?\n$/u, ''), stream, pid)
        buffer.text = ''; buffer.dropping = false
      }
    }
    this.partial.set(key, buffer)
    // The readable snapshot shows unfinished lines too.
    this.textRevision++
  }
  hostClosed(pid?: number): void {
    for (const [key, buffer] of this.partial) {
      if (buffer.pid !== pid) continue
      if (buffer.text) this.hostLine(buffer.text, key.slice(key.indexOf(':') + 1), pid)
      this.partial.delete(key)
      this.textRevision++
    }
    this.flush()
  }
  private hostLine(line: string, stream: string, pid?: number): void {
    if (line.startsWith(HOST_LOG_PREFIX)) {
      try {
        const input: unknown = JSON.parse(line.slice(HOST_LOG_PREFIX.length))
        if (isLogInput(input)) { this.record({ ...input, pid }); return }
      } catch { /* Malformed framing remains a plain process-output diagnostic. */ }
    }
    const level = /\b(error|fatal)\b/iu.test(line) ? 'error' : /\bwarn/iu.test(line) ? 'warn' : /\bdebug\b/iu.test(line) ? 'debug' : 'info'
    if (LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(this.level)) this.record({ source: `host.${stream}`, event: 'output', level, message: line, pid, developer: level === 'debug' })
  }
  snapshot(currentRun = false): string {
    const text = (currentRun ? this.current.text() : this.previous + this.current.text()).slice(-LIMIT)
    return maskSecrets(text + [...this.partial.values()].filter(buffer => buffer.text).map(buffer => `\n${buffer.text}`).join('')).slice(-LIMIT)
  }
  /**
   * Write pending records to the history now. The readable copy follows at most every
   * {@link READABLE_INTERVAL_MS}: history-only records and quiet periods leave it alone, and rewriting
   * its 128 KiB on every flush would cost a busy session a 128 KiB write every 200 ms.
   * @param readable - Also rewrite the readable copy and write every pending repeat count now, as when
   *   the run ends, a failure report is written or the user opens the log directory.
   */
  flush(readable = false): void {
    clearTimeout(this.timer); this.timer = undefined
    for (const count of this.limiter.drain(Date.now(), readable)) this.enqueue(count)
    this.scheduleCounts()
    try {
      if (this.pending.length) {
        this.history ??= new LogHistory(join(this.file, '..'))
        this.history.append(this.pending)
        this.pending = []; this.pendingBytes = 0
      }
      this.writeReadable(readable)
      this.storageError = undefined
    } catch (error) {
      this.storageError = maskSecrets(String(error)).slice(0, 2048)
      // Bound memory even when disk remains full; never recurse through console logging.
      while (this.pendingBytes > MAX_PENDING && this.pending.length) { this.pendingBytes -= Buffer.byteLength(this.pending.shift()!) + 1; this.droppedRecords++ }
    }
  }
  /** Wake up when the next repeat or dropped count falls due, even if nothing else is logged until then. */
  private scheduleCounts(): void {
    const due = this.limiter.nextDue()
    if (due === this.countDue) return
    clearTimeout(this.countTimer); this.countTimer = undefined; this.countDue = due
    if (due === undefined) return
    this.countTimer = setTimeout(() => { this.countTimer = undefined; this.countDue = undefined; this.flush() }, Math.max(0, due - Date.now()))
    this.countTimer.unref()
  }
  private writeReadable(now: boolean): void {
    if (this.writtenRevision === this.textRevision) { clearTimeout(this.readableTimer); this.readableTimer = undefined; return }
    const wait = this.readableWrittenAt + READABLE_INTERVAL_MS - Date.now()
    if (!now && wait > 0) {
      this.readableTimer ??= setTimeout(() => { this.readableTimer = undefined; this.flush() }, wait)
      this.readableTimer.unref()
      return
    }
    clearTimeout(this.readableTimer); this.readableTimer = undefined
    const revision = this.textRevision
    atomicText(this.file, this.snapshot())
    this.writtenRevision = revision; this.readableWrittenAt = Date.now()
  }
  /**
   * Build the readable summary of an export.
   * @param state - the Desktop state shown in the summary.
   * @param renderer - the page sample taken at export time; null when it is unavailable.
   */
  export(state: DesktopState, renderer?: RendererDiagnostics): string {
    return JSON.stringify({ format: 'dsh-desktop-next-diagnostics', version: 3, created: new Date().toISOString(), runId: this.runId,
      application: { version: state.version, platform: state.platform, versions: process.versions },
      runtime: sanitize({ profile: state.selected, profiles: state.profiles, phase: state.phase, safeMode: state.safeMode,
        failure: state.failure, features: state.features, preferences: state.preferences,
        trayAvailable: state.trayAvailable, browserUrl: state.browserUrl, lan: state.lan }),
      renderer: sanitize(renderer ?? null),
      logging: { storageError: this.storageError ?? null, droppedRecords: this.droppedRecords }, pendingOperations: this.pendingOperations(),
      crashDumps: this.crashDumps === undefined ? null : { location: relative(join(this.file, '..', '..'), this.crashDumps).split(sep).join('/'), ...crashDumpInventory(this.crashDumps) },
      log: this.snapshot() }, null, 2) + '\n'
  }
  /** Export history off the Electron main thread; terminate stalled workers. */
  exportTo(file: string, state: DesktopState, renderer?: RendererDiagnostics): Promise<void> {
    this.flush()
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
    const worker = new Worker(new URL(`./diagnostics-export.${extension}`, import.meta.url), {
      workerData: { kind: 'dsh-next-diagnostics-export', directory: join(this.file, '..'), file, summary: this.export(state, renderer) },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    })
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true; clearTimeout(timer)
        void worker.terminate().catch(() => {})
        if (error === undefined) resolve(); else reject(error)
      }
      const timer = setTimeout(() => finish(new Error('Diagnostic export exceeded 60 seconds')), 60_000)
      worker.once('message', result => finish(result.ok ? undefined : new Error(result.error)))
      worker.once('error', finish)
      worker.once('exit', code => finish(new Error(`Diagnostic export worker exited before completion (${code})`)))
    })
  }
}
