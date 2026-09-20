/** Synchronous durable file writes shared by profile-owned configuration paths. */

import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Rename-over a destination that another process holds open without
 * FILE_SHARE_DELETE (antivirus, the Windows search indexer, the Host itself)
 * fails with EPERM/EBUSY/EACCES on Windows. A short backoff retry absorbs the
 * holder letting go; other errors surface immediately.
 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160, 320]

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function renameDurableSync(from: string, to: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to)
      return
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException | null)?.code
      if (code === undefined || !RENAME_RETRY_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw cause
      sleepSync(RENAME_RETRY_DELAYS_MS[attempt]!)
    }
  }
}

/**
 * Atomic durable file write: create a fresh temporary with `wx`, fsync, then
 * rename over the target. The rename replaces the directory entry instead of
 * following a pre-existing symlink at the target path, and a failure never
 * leaves a truncated file behind. Callers own directory creation.
 *
 * `mode` is the creation default: it applies when the target does not exist
 * yet. On paths where the mode is an explicit instruction rather than a
 * default — checkpoint restore replays the mode captured at snapshot time —
 * leave `inheritExistingMode` off so a pre-existing file's current bits never
 * override the instruction. Configuration call sites opt in: an atomic
 * replacement must not widen an administrator- or user-tightened mode (for
 * example a 0o600 config replaced through the default 0o666 mode under umask
 * 022).
 */
export function writeDurableFile(
  path: string,
  bytes: Uint8Array,
  mode = 0o600,
  options: { readonly inheritExistingMode?: boolean } = {},
): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    // lstat does not follow symlinks: a symlinked target is replaced, not
    // measured, and the caller-supplied mode applies unchanged.
    const existing = lstatSync(path, { throwIfNoEntry: false })
    const effectiveMode = options.inheritExistingMode === true && existing !== undefined && existing.isFile()
      ? (existing.mode & 0o777)
      : mode
    fd = openSync(temporary, 'wx', effectiveMode)
    // writeSync may write fewer bytes than requested (interrupted by a
    // signal, filesystem quirks); loop until the buffer is fully consumed
    // so fsync and rename never promote a short write to "complete".
    let written = 0
    while (written < bytes.byteLength) {
      const progress = writeSync(fd, bytes, written)
      if (progress <= 0) throw new Error('durable write made no progress')
      written += progress
    }
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameDurableSync(temporary, path)
    try {
      const directoryFd = openSync(dirname(path), 'r')
      try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
    } catch { /* directory fsync is not supported everywhere */ }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temporary) } catch { /* already renamed */ }
  }
}
