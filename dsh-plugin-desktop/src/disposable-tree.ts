/** Cleanup for caller-owned disposable trees; never traverse junction targets. */
import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const CLEANUP_RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'])

function removeDisposableEntry(path: string): void {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      unlinkSync(path)
      return
    }
    for (const name of readdirSync(path)) removeDisposableEntry(join(path, name))
    rmdirSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}

/** Remove an owned temporary root, including a root junction, with bounded retries. */
export function cleanupDisposableTree(rootDir: string): boolean {
  try {
    lstatSync(rootDir)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
  for (let attempt = 0; ; attempt++) {
    try {
      removeDisposableEntry(rootDir)
      return true
    } catch (cause) {
      if (attempt >= 3 || !CLEANUP_RETRY_CODES.has((cause as NodeJS.ErrnoException).code ?? '')) throw cause
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1))
    }
  }
}
