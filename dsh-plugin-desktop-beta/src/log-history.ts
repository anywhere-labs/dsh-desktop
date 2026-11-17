/** Private JSONL history, bounded by size and age; only owned regular files are touched. */
import { appendFileSync, closeSync, lstatSync, openSync, readdirSync, readSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { privateDirectory } from './private-files.ts'

export const HISTORY_NAME = /^desktop-next-\d{4}-\d{2}-\d{2}\.\d+\.jsonl$/u
export interface LogHistoryOptions { maxFileBytes: number; maxDirectoryBytes: number; retentionDays: number }
export const DEFAULT_LOG_HISTORY: LogHistoryOptions = { maxFileBytes: 10 * 1024 * 1024, maxDirectoryBytes: 200 * 1024 * 1024, retentionDays: 7 }
export function historyFiles(directory: string) {
  return readdirSync(directory).filter(name => HISTORY_NAME.test(name)).flatMap(name => {
    const file = join(directory, name)
    const stat = lstatSync(file, { throwIfNoEntry: false })
    return stat?.isFile() && !stat.isSymbolicLink() ? [{ name, file, bytes: stat.size, modified: stat.mtimeMs }] : []
  }).sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** The file appends go to, with the size this writer left it at; `created` is false until its first record. */
interface Segment { readonly date: string; readonly index: number; readonly file: string; bytes: number; created: boolean }

export class LogHistory {
  private segment: Segment | undefined
  constructor(readonly directory: string, readonly options: LogHistoryOptions = DEFAULT_LOG_HISTORY) {
    if (options.maxFileBytes < 1024 || options.maxDirectoryBytes < options.maxFileBytes || options.retentionDays < 1) throw new Error('Invalid log history limits')
    privateDirectory(directory)
    this.prune()
  }
  /**
   * Append complete records with one write per segment. The segment stays open between calls while it is
   * still today's, still an owned regular file and still the size this writer left; otherwise it is found
   * again. The directory is listed and pruned only when a segment opens.
   * @param lines - JSON records without their newline; a record larger than a segment is dropped.
   */
  append(lines: readonly string[]): void {
    privateDirectory(this.directory)
    const date = new Date().toISOString().slice(0, 10)
    let opened = false
    let segment = this.reusable(date)
    if (segment === undefined) { segment = this.open(date); opened = true }
    let batch: string[] = []
    let bytes = segment.bytes
    for (const line of lines) {
      const size = Buffer.byteLength(line) + 1
      if (size > this.options.maxFileBytes) continue
      if (bytes + size > this.options.maxFileBytes) {
        this.write(segment, batch, bytes)
        segment = this.open(date, segment.index + 1); opened = true
        batch = []; bytes = segment.bytes
      }
      batch.push(line); bytes += size
    }
    this.write(segment, batch, bytes)
    if (opened) this.prune()
  }
  private write(segment: Segment, batch: readonly string[], bytes: number): void {
    if (batch.length === 0) return
    if (!segment.created) { writeFileSync(segment.file, '', { flag: 'wx', mode: 0o600 }); segment.created = true }
    appendFileSync(segment.file, `${batch.join('\n')}\n`)
    segment.bytes = bytes
  }
  private reusable(date: string): Segment | undefined {
    const segment = this.segment
    if (segment?.date !== date) return undefined
    const stat = lstatSync(segment.file, { throwIfNoEntry: false })
    if (!segment.created) return stat === undefined ? segment : undefined
    return stat?.isFile() && !stat.isSymbolicLink() && stat.size === segment.bytes ? segment : undefined
  }
  /**
   * Find today's segment: the newest existing one, skipping unowned links, or the first absent index from
   * `from` when rotating. An existing segment gets its torn last record finished by an abrupt exit.
   */
  private open(date: string, from?: number): Segment {
    const name = (index: number): string => join(this.directory, `desktop-next-${date}.${index}.jsonl`)
    let index = from ?? historyFiles(this.directory).filter(file => file.name.startsWith(`desktop-next-${date}.`))
      .reduce((maximum, entry) => Math.max(maximum, Number(entry.name.split('.').at(-2))), 0)
    let stat = lstatSync(name(index), { throwIfNoEntry: false })
    while (stat && (from !== undefined || !stat.isFile() || stat.isSymbolicLink())) stat = lstatSync(name(++index), { throwIfNoEntry: false })
    const file = name(index)
    let bytes = stat?.size ?? 0
    if (bytes && bytes <= this.options.maxFileBytes) {
      const descriptor = openSync(file, 'r')
      const tail = Buffer.alloc(1)
      try { readSync(descriptor, tail, 0, 1, bytes - 1) } finally { closeSync(descriptor) }
      if (tail[0] !== 10) { appendFileSync(file, '\n'); bytes++ }
    }
    this.segment = { date, index, file, bytes, created: stat !== undefined }
    return this.segment
  }
  private prune(): void {
    const files = historyFiles(this.directory)
    let total = files.reduce((sum, file) => sum + file.bytes, 0)
    const cutoff = Date.now() - this.options.retentionDays * 86_400_000
    for (const file of files) {
      if (file.modified >= cutoff && total <= this.options.maxDirectoryBytes) continue
      try { unlinkSync(file.file); total -= file.bytes } catch { /* Locked files are retried when the next segment opens. */ }
    }
  }
}
