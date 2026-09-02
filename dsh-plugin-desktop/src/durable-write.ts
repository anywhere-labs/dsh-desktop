/** Synchronous durable file writes shared by profile-owned configuration paths. */

import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Atomic durable file write: create a fresh temporary with `wx`, fsync, then
 * rename over the target. The rename replaces the directory entry instead of
 * following a pre-existing symlink at the target path, and a failure never
 * leaves a truncated file behind. Callers own directory creation and
 * permissions.
 */
export function writeDurableFile(path: string, bytes: Uint8Array, mode = 0o600): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', mode)
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
