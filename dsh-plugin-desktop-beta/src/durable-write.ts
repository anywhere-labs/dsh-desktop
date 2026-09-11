/** Synchronous durable file writes shared by profile-owned configuration paths. */

import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Atomic durable file write: create a fresh temporary with `wx`, fsync, then
 * rename over the target. The rename replaces the directory entry instead of
 * following a pre-existing symlink at the target path, and a failure never
 * leaves a truncated file behind. Callers own directory creation and
 * permissions. When the target already exists as a regular file, its own
 * permission bits are inherited: an atomic replacement must not widen an
 * administrator- or user-tightened mode (for example a 0o600 config replaced
 * through the default 0o666 mode under umask 022).
 */
export function writeDurableFile(path: string, bytes: Uint8Array, mode = 0o600): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    // lstat does not follow symlinks: a symlinked target is replaced, not
    // measured, and the caller-supplied mode applies unchanged.
    const existing = lstatSync(path, { throwIfNoEntry: false })
    const effectiveMode = existing !== undefined && existing.isFile()
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
    renameSync(temporary, path)
    try {
      const directoryFd = openSync(dirname(path), 'r')
      try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
    } catch { /* directory fsync is not supported everywhere */ }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temporary) } catch { /* already renamed */ }
  }
}
