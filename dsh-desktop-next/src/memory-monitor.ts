/** Memory trend samples and incident snapshots for renderer, child-process and Host failures (#1511). */
import { freemem, totalmem } from 'node:os'
import { OOM_EXCEPTION_CODE, exitCodeHex } from './exit-code.ts'
import type { LogInput } from './log-record.ts'

/** The main process samples on this period, and the Host pushes its own reading on the same period. */
export const MEMORY_SAMPLE_INTERVAL_MS = 30_000
/** Ring length: about 20 minutes at the sample period, with a fixed memory cost. */
export const MEMORY_SAMPLE_CAPACITY = 40
/** Failures this close together are one incident: one snapshot names every trigger. */
export const MEMORY_INCIDENT_WINDOW_MS = 5_000
/** Far below the 100 array items `sanitize` keeps, so a snapshot is never silently truncated. */
const MAX_PROCESSES = 48
const MAX_TRIGGERS = 16
const MAX_LABEL = 32

/** The `process.memoryUsage()` figures a Host pushes over IPC, in bytes. */
export interface HostMemoryUsage {
  readonly rss: number
  readonly heapTotal: number
  readonly heapUsed: number
  readonly external: number
  readonly arrayBuffers: number
}

const HOST_MEMORY_FIELDS = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'] as const

/**
 * @param usage - `process.memoryUsage()` in the Host.
 * @returns Only the numeric fields the Desktop records.
 */
export function hostMemoryUsage(usage: HostMemoryUsage): HostMemoryUsage {
  return { rss: usage.rss, heapTotal: usage.heapTotal, heapUsed: usage.heapUsed, external: usage.external, arrayBuffers: usage.arrayBuffers }
}

/**
 * @param value - An IPC payload from the Host.
 * @returns Whether every recorded field is a non-negative byte count.
 */
export function isHostMemoryUsage(value: Readonly<Record<string, unknown>>): boolean {
  return HOST_MEMORY_FIELDS.every(field => Number.isSafeInteger(value[field]) && (value[field] as number) >= 0)
}

/** The fields of Electron's `ProcessMetric` the monitor reads; memory is in kilobytes. */
export interface MemoryProcessMetric {
  readonly type: string
  readonly pid: number
  readonly cpu: { readonly percentCPUUsage: number }
  readonly memory: { readonly workingSetSize: number; readonly privateBytes?: number | undefined }
}

/** System memory in bytes. Windows also reports its commit limit and available commit. */
export interface MemorySystemReading {
  readonly total: number
  readonly free: number
  readonly commitLimit?: number | undefined
  readonly commitFree?: number | undefined
}

/** Electron readings supplied by the main process, so the monitor itself stays headless. */
export interface DesktopMemoryProbe {
  appMetrics(): readonly MemoryProcessMetric[]
  /** Defaults to `os.totalmem()` and `os.freemem()`. */
  system?(): MemorySystemReading
}

/** The failure that makes the ring worth keeping. */
export type MemoryIncidentTrigger =
  | { readonly process: 'renderer'; readonly reason: string; readonly exitCode: number }
  | { readonly process: 'child'; readonly type: string; readonly reason: string; readonly exitCode: number }
  | { readonly process: 'host'; readonly pid?: number | undefined; readonly exitCode: number | null; readonly signal: string | null; readonly expected: boolean }

/** How a Host process ended, as the main process observed it. */
export interface MemoryHostExit {
  readonly code: number | null
  readonly signal: string | null
  /** Whether the Desktop had asked the Host to stop. */
  readonly expected: boolean
}

/**
 * Column names for each process row. Rows are arrays rather than objects so a sample costs about
 * half the bytes; every record that carries rows also carries these names, so it reads on its own.
 * `privateMB` is `null` outside Windows.
 */
export const MEMORY_PROCESS_COLUMNS = ['type', 'pid', 'workingSetMB', 'privateMB', 'cpu'] as const

type ProcessRow = readonly [type: string, pid: number, workingSetMB: number, privateMB: number | null, cpu: number]

interface MemorySample {
  readonly time: number
  readonly totalMB: number
  readonly freeMB: number
  readonly commitLimitMB?: number
  readonly commitFreeMB?: number
  /** One row per process, in `MEMORY_PROCESS_COLUMNS` order. */
  readonly processes: readonly ProcessRow[]
  readonly host?: {
    readonly pid?: number
    readonly time: number
    readonly rssMB: number
    readonly heapUsedMB: number
    readonly heapTotalMB: number
    readonly externalMB: number
    readonly arrayBuffersMB: number
  }
}

type TriggerRecord = Readonly<Record<string, string | number | boolean>>

interface Incident {
  readonly triggers: TriggerRecord[]
  dropped: number
  readonly timer: ReturnType<typeof setTimeout>
}

interface MonitorOptions {
  readonly probe?: DesktopMemoryProbe | undefined
  /** The Desktop diagnostics sink, whose sanitizer and history every record passes through. */
  record(input: LogInput): void
  flush(): void
}

const round = (value: number): number => Math.round(value * 10) / 10
const megabytes = (bytes: number): number => round(bytes / 1_048_576)
const kilobytesToMegabytes = (kilobytes: number): number => round(kilobytes / 1024)
const label = (value: unknown): string => String(value).slice(0, MAX_LABEL)

/**
 * Read-only memory evidence held by the main process. Every 30 seconds it samples Chromium processes,
 * system memory and the Host's latest push into a fixed ring, and logs the sample when developer
 * logging is on. A renderer, child-process or Host failure writes the ring once as an error-level
 * `memory.snapshot`, so the trend before the failure survives even with developer logging off.
 *
 * A failed reading drops only that sample. Nothing here throws into its caller or reports a runtime
 * failure, and every timer is unreferenced.
 */
export class DesktopMemoryMonitor {
  private readonly ring: { readonly sequence: number; readonly sample: MemorySample }[] = []
  private sequence = 0
  /** Highest ring sequence a snapshot has written; no sample is written twice. */
  private written = 0
  private host: { readonly pid: number | undefined; readonly time: number; readonly usage: HostMemoryUsage } | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private open: Incident | undefined
  private stopped = false

  constructor(private readonly options: MonitorOptions) {}

  /** Begin periodic sampling; call once Electron can report process metrics. */
  start(): void {
    if (this.timer !== undefined || this.stopped) return
    this.timer = setInterval(() => { this.sample(true) }, MEMORY_SAMPLE_INTERVAL_MS)
    this.timer.unref()
  }

  /** Stop sampling and write a pending incident; incidents after this are written at once. */
  stop(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.timer = undefined
    this.settle()
  }

  /**
   * Keep the Host's latest push; the next sample carries it with its own time.
   * @param usage - The Host's `process.memoryUsage()` figures.
   * @param pid - The Host process id.
   */
  hostMemory(usage: HostMemoryUsage, pid?: number): void {
    this.host = { pid, time: Date.now(), usage: hostMemoryUsage(usage) }
  }

  /**
   * A Host exit is an incident when nobody asked it to stop, and also when it ends with Chromium's
   * OOM code during a requested stop: in #1511 the Host died of OOM after a renderer OOM while the
   * recovery flow was stopping it.
   * @param exit - How the Host ended.
   * @param pid - The Host process id.
   */
  hostExited(exit: MemoryHostExit, pid?: number): void {
    if (exit.expected && (exit.code === null || exit.code >>> 0 !== OOM_EXCEPTION_CODE)) return
    this.incident({ process: 'host', pid, exitCode: exit.code, signal: exit.signal, expected: exit.expected })
  }

  /**
   * Take a fresh sample and add the trigger to the open incident. The snapshot is written when the
   * incident window ends, or earlier through `settle()`.
   * @param trigger - The failed process and its reported reason.
   */
  incident(trigger: MemoryIncidentTrigger): void {
    try {
      if (this.open === undefined) {
        const timer = setTimeout(() => { this.settle(); this.close() }, MEMORY_INCIDENT_WINDOW_MS)
        timer.unref()
        this.open = { triggers: [], dropped: 0, timer }
      }
      if (this.open.triggers.length < MAX_TRIGGERS) this.open.triggers.push(triggerRecord(trigger))
      else this.open.dropped++
      this.sample(false)
      if (this.stopped) { this.settle(); this.close() }
    } catch { /* Evidence must never interfere with failure handling. */ }
  }

  /**
   * Write the open incident now, before recovery mode or exit. Triggers that still arrive within its
   * window are written later with only the samples taken since.
   */
  settle(): void {
    const open = this.open
    if (open === undefined || (open.triggers.length === 0 && open.dropped === 0)) return
    try {
      const samples = this.ring.filter(entry => entry.sequence > this.written).map(entry => entry.sample)
      const triggers = open.triggers.splice(0)
      const dropped = open.dropped
      open.dropped = 0
      this.written = this.sequence
      this.options.record({ source: 'desktop.memory', event: 'memory.snapshot', level: 'error',
        fields: { triggers: triggers.map(triggerSummary).join('; '), samples: samples.length, ...(dropped === 0 ? {} : { droppedTriggers: dropped }) },
        data: { triggers, ...(dropped === 0 ? {} : { droppedTriggers: dropped }), processColumns: MEMORY_PROCESS_COLUMNS, samples } })
      this.options.flush()
    } catch { /* Evidence must never interfere with failure handling. */ }
  }

  private close(): void {
    clearTimeout(this.open?.timer)
    this.open = undefined
  }

  private sample(log: boolean): void {
    let sample: MemorySample
    try { sample = this.read() } catch { return }
    this.ring.push({ sequence: ++this.sequence, sample })
    if (this.ring.length > MEMORY_SAMPLE_CAPACITY) this.ring.splice(0, this.ring.length - MEMORY_SAMPLE_CAPACITY)
    if (!log) return
    // History only: the readable log keeps failures, and a quiet sampler must not rewrite it every 30 seconds.
    try { this.options.record({ source: 'desktop.memory', event: 'memory.sample', developer: true, historyOnly: true, data: { processColumns: MEMORY_PROCESS_COLUMNS, ...sample } }) }
    catch { /* A sample that cannot be logged stays in the ring. */ }
  }

  private read(): MemorySample {
    const system = this.options.probe?.system?.() ?? { total: totalmem(), free: freemem() }
    const metrics = this.options.probe?.appMetrics() ?? []
    const processes = metrics.slice(0, MAX_PROCESSES).map((metric): ProcessRow => [
      label(metric.type), metric.pid, kilobytesToMegabytes(metric.memory.workingSetSize),
      metric.memory.privateBytes === undefined ? null : kilobytesToMegabytes(metric.memory.privateBytes),
      round(metric.cpu.percentCPUUsage),
    ])
    // Each Host push belongs to one sample only; a Host that stopped pushing leaves a visible gap.
    const host = this.host
    this.host = undefined
    return {
      time: Date.now(), totalMB: megabytes(system.total), freeMB: megabytes(system.free),
      ...(system.commitLimit === undefined ? {} : { commitLimitMB: megabytes(system.commitLimit) }),
      ...(system.commitFree === undefined ? {} : { commitFreeMB: megabytes(system.commitFree) }),
      processes,
      ...(host === undefined ? {} : { host: {
        ...(host.pid === undefined ? {} : { pid: host.pid }), time: host.time,
        rssMB: megabytes(host.usage.rss), heapUsedMB: megabytes(host.usage.heapUsed), heapTotalMB: megabytes(host.usage.heapTotal),
        externalMB: megabytes(host.usage.external), arrayBuffersMB: megabytes(host.usage.arrayBuffers),
      } }),
    }
  }
}

function triggerRecord(trigger: MemoryIncidentTrigger): TriggerRecord {
  const time = Date.now()
  if (trigger.process === 'host') {
    return { time, process: 'host', ...(trigger.pid === undefined ? {} : { pid: trigger.pid }), reason: trigger.expected ? 'stopping' : 'unexpected',
      ...(trigger.exitCode === null ? {} : { exitCode: exitCodeHex(trigger.exitCode) }), ...(trigger.signal === null ? {} : { signal: label(trigger.signal) }) }
  }
  return { time, process: trigger.process, ...(trigger.process === 'child' ? { type: label(trigger.type) } : {}),
    reason: label(trigger.reason), exitCode: exitCodeHex(trigger.exitCode) }
}

function triggerSummary(trigger: TriggerRecord): string {
  return [trigger.process, trigger.type, trigger.reason, trigger.exitCode ?? trigger.signal].filter(part => part !== undefined).join(' ')
}
