/** Cross-process exclusion for DSH data mutations owned by Desktop. */

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { desktopDataDirectoryStatePath, DesktopDataDirectoryError } from './desktop-data-directory.ts'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const MAX_LOCK_BYTES = 8 * 1024
const LOCK_FILENAME = 'operation.lock'

interface LockRecord {
  readonly id: string
  readonly pid: number
  readonly operation: string
  readonly createdAt: string
}

export interface DesktopDataOperationLease {
  readonly id: string
  readonly operation: string
  release(): void
}

export function desktopDataOperationLockPath(userDataDir: string): string {
  return join(dirname(desktopDataDirectoryStatePath(userDataDir)), LOCK_FILENAME)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function readRecord(path: string): LockRecord {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_LOCK_BYTES) {
    throw new DesktopDataDirectoryError('busy', 'Desktop data operation lock is unsafe')
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    throw new DesktopDataDirectoryError('busy', 'Desktop data operation lock is invalid')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DesktopDataDirectoryError('busy', 'Desktop data operation lock is invalid')
  }
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'createdAt,id,operation,pid'
    || typeof row.id !== 'string' || typeof row.operation !== 'string'
    || !Number.isSafeInteger(row.pid) || (row.pid as number) <= 0
    || typeof row.createdAt !== 'string') {
    throw new DesktopDataDirectoryError('busy', 'Desktop data operation lock is invalid')
  }
  return {
    id: row.id,
    pid: row.pid as number,
    operation: row.operation,
    createdAt: row.createdAt,
  }
}

function prepareDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new DesktopDataDirectoryError('busy', 'Desktop data operation lock directory is unsafe')
  }
  if (process.platform !== 'win32') chmodSync(path, DIRECTORY_MODE)
}

/** Acquire one owner-record lock, recovering a record whose process no longer exists. */
export function acquireDesktopDataOperationLock(
  userDataDir: string,
  operation: string,
): DesktopDataOperationLease {
  if (operation.length === 0 || operation.length > 128 || operation.includes('\0')) {
    throw new DesktopDataDirectoryError('busy', 'Desktop data operation name is invalid')
  }
  const path = desktopDataOperationLockPath(userDataDir)
  prepareDirectory(dirname(path))
  const id = randomUUID()
  const record: LockRecord = {
    id,
    pid: process.pid,
    operation,
    createdAt: new Date().toISOString(),
  }
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor: number
    try {
      descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, FILE_MODE)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
      const owner = readRecord(path)
      if (attempt === 0 && !processExists(owner.pid)) {
        unlinkSync(path)
        continue
      }
      throw new DesktopDataDirectoryError('busy', `Desktop data is busy with ${owner.operation}`)
    }
    try {
      const info = fstatSync(descriptor)
      if (!info.isFile()) throw new DesktopDataDirectoryError('busy', 'Desktop data operation lock is unsafe')
      writeSync(descriptor, bytes)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    let released = false
    return Object.freeze({
      id,
      operation,
      release: () => {
        if (released) return
        released = true
        const current = readRecord(path)
        if (current.id !== id || current.pid !== process.pid) {
          throw new DesktopDataDirectoryError('busy', 'Desktop data operation lock ownership changed')
        }
        unlinkSync(path)
      },
    })
  }
  throw new DesktopDataDirectoryError('busy', 'Desktop data is busy')
}

/** Verify that a managed child belongs to the currently held outer operation. */
export function assertDesktopDataOperationLockOwner(userDataDir: string, id: string): void {
  if (id.length === 0 || id.includes('\0')) {
    throw new DesktopDataDirectoryError('busy', 'Desktop data operation token is invalid')
  }
  const owner = readRecord(desktopDataOperationLockPath(userDataDir))
  if (owner.id !== id || !processExists(owner.pid)) {
    throw new DesktopDataDirectoryError('busy', 'Desktop data operation token is stale')
  }
}
