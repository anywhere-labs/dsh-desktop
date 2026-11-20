/**
 * Bounds what plugin-controlled sources (Host process output and plugin loggers) can write. A line that
 * repeats one of the source's recent lines (same level, event, message and string fields, digits aside)
 * is counted instead of written. The count is written as a
 * `<event>.repeated` record one minute after the line first appeared, five minutes after that and then
 * every fifteen minutes while it keeps repeating; a line quiet for its current interval is forgotten, so
 * its next occurrence is written in full. Each source also spends from a token bucket; lines beyond it
 * are counted and reported as `<event>.dropped`. The first occurrence of every distinct line is written
 * while tokens remain.
 */
import type { LogInput } from './log-record.ts'

export interface LogLimiterOptions {
  /** Lines a source may write at once. */
  readonly burst: number
  /** Lines per second a source regains. */
  readonly perSecond: number
  /** Distinct recent lines remembered per source for folding. */
  readonly recentLines: number
  /** Successive intervals after which a repeat count is written; the last one keeps repeating. */
  readonly repeatIntervalsMs: readonly number[]
  /** How long a source stays over its budget before the dropped count is written anyway. */
  readonly droppedReportMs: number
}

export const DEFAULT_LOG_LIMITS: LogLimiterOptions = {
  burst: 200, perSecond: 20, recentLines: 16, repeatIntervalsMs: [60_000, 300_000, 900_000], droppedReportMs: 10_000,
}

interface Repeat {
  readonly input: LogInput
  /** Repeats since the last count was written. */
  count: number
  since: number
  last: number
  interval: number
}

interface Source {
  tokens: number
  refilled: number
  dropped: number
  /** Error-level lines among `dropped`. */
  droppedErrors: number
  droppedSince: number
  droppedEvent: string
  readonly recent: Map<string, Repeat>
}

const MESSAGE_KEY_CHARS = 512
const FIELD_KEY_CHARS = 256

/** Text fields name what a structured line is about (a plugin, server or session); numbers are measurements. */
function identity(input: LogInput): Record<string, string> {
  return Object.fromEntries(Object.entries(input.fields ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** Digits vary between otherwise identical lines (counters, ports, timestamps), so they do not make a line new. */
function lineKey(input: LogInput): string {
  const text = [(input.message ?? '').slice(0, MESSAGE_KEY_CHARS),
    ...Object.entries(identity(input)).map(([key, value]) => `${key}=${value.slice(0, FIELD_KEY_CHARS)}`)].join('\u0000')
  return `${input.level ?? 'info'}\u0000${input.event}\u0000${text.replace(/\d+/gu, '#')}`
}

function iso(time: number): string { return new Date(time).toISOString() }

export class LogLimiter {
  private readonly sources = new Map<string, Source>()
  constructor(private readonly options: LogLimiterOptions = DEFAULT_LOG_LIMITS) {}

  /**
   * Decide what to write for one line.
   * @param input - The line, already accepted by the level and developer filters.
   * @param now - The current time in milliseconds.
   * @returns Counts that became due for this source, then `input` unless it was folded or dropped.
   */
  admit(input: LogInput, now = Date.now()): LogInput[] {
    const source = this.source(input.source, now)
    const out = this.due(input.source, source, now, false)
    const key = lineKey(input)
    const repeat = source.recent.get(key)
    if (repeat !== undefined) {
      repeat.count++; repeat.last = now
      // Refresh the line's place among the recent lines it is remembered with.
      source.recent.delete(key); source.recent.set(key, repeat)
      return out
    }
    if (source.tokens < 1) {
      if (source.dropped === 0) { source.droppedSince = now; source.droppedEvent = input.event }
      source.dropped++
      if (input.level === 'error') source.droppedErrors++
      return out
    }
    source.tokens--
    if (source.dropped > 0) out.push(this.droppedRecord(input.source, source, now))
    source.recent.set(key, { input, count: 0, since: now, last: now, interval: this.options.repeatIntervalsMs[0]! })
    if (source.recent.size > this.options.recentLines) {
      const [oldest, evicted] = source.recent.entries().next().value!
      source.recent.delete(oldest)
      if (evicted.count > 0) out.push(this.repeatRecord(evicted, now))
    }
    out.push(input)
    return out
  }

  /**
   * Counts owed by every source: due ones, or all of them when the run ends, a failure report is written
   * or the log is opened.
   * @param now - The current time in milliseconds.
   * @param all - Write every pending count now.
   * @returns The count records to write.
   */
  drain(now = Date.now(), all = false): LogInput[] {
    const out: LogInput[] = []
    for (const [name, source] of this.sources) out.push(...this.due(name, source, now, all))
    return out
  }

  /**
   * When the next pending count falls due, so the caller can write it on time even if no further line arrives.
   * @returns The earliest due time in milliseconds, or undefined when no count is pending.
   */
  nextDue(): number | undefined {
    let earliest: number | undefined
    const consider = (time: number): void => { if (earliest === undefined || time < earliest) earliest = time }
    for (const source of this.sources.values()) {
      for (const repeat of source.recent.values()) if (repeat.count > 0) consider(repeat.since + repeat.interval)
      if (source.dropped > 0) consider(source.droppedSince + this.options.droppedReportMs)
    }
    return earliest
  }

  private source(name: string, now: number): Source {
    let source = this.sources.get(name)
    if (source === undefined) {
      source = { tokens: this.options.burst, refilled: now, dropped: 0, droppedErrors: 0, droppedSince: now, droppedEvent: 'output', recent: new Map() }
      this.sources.set(name, source)
    } else {
      source.tokens = Math.min(this.options.burst, source.tokens + (now - source.refilled) / 1000 * this.options.perSecond)
      source.refilled = now
    }
    return source
  }

  private due(name: string, source: Source, now: number, all: boolean): LogInput[] {
    const out: LogInput[] = []
    for (const [key, repeat] of source.recent) {
      const quiet = now - repeat.last >= repeat.interval
      if (repeat.count > 0 && (all || quiet || now - repeat.since >= repeat.interval)) {
        out.push(this.repeatRecord(repeat, now))
        const intervals = this.options.repeatIntervalsMs
        repeat.interval = intervals[Math.min(intervals.indexOf(repeat.interval) + 1, intervals.length - 1)]!
      }
      // A line that went quiet is forgotten; if it comes back it is written again.
      if (quiet) source.recent.delete(key)
    }
    if (source.dropped > 0 && (all || now - source.droppedSince >= this.options.droppedReportMs)) out.push(this.droppedRecord(name, source, now))
    return out
  }

  private repeatRecord(repeat: Repeat, now: number): LogInput {
    const record: LogInput = {
      source: repeat.input.source, event: `${repeat.input.event}.repeated`, level: repeat.input.level ?? 'info',
      ...(repeat.input.message === undefined ? {} : { message: repeat.input.message }),
      ...(repeat.input.pid === undefined ? {} : { pid: repeat.input.pid }),
      fields: { ...identity(repeat.input), repeats: repeat.count, from: iso(repeat.since), to: iso(repeat.last) },
    }
    repeat.count = 0; repeat.since = now
    return record
  }

  private droppedRecord(name: string, source: Source, now: number): LogInput {
    const record: LogInput = { source: name, event: `${source.droppedEvent}.dropped`, level: 'warn',
      fields: { dropped: source.dropped, errors: source.droppedErrors, from: iso(source.droppedSince), to: iso(now) } }
    source.dropped = 0; source.droppedErrors = 0; source.droppedSince = now
    return record
  }
}
