import {
  existsSync,
  lstatSync,
  renameSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'

const BIN_NAME = 'dsh-plugin-desktop'

export const SESSION_PROJCACHE_MAX_BYTES = 128 * 1024 * 1024
export const SESSION_PROJCACHE_RELATIVE_PATH = ['storages', 'session_projcache.json'] as const

export interface SessionProjectionCacheRecoveryOptions {
  readonly maxBytes?: number
  readonly now?: () => Date
}

export type SessionProjectionCacheRecoveryResult =
  | {
      readonly status: 'missing' | 'within-limit' | 'non-file'
      readonly cachePath: string
    }
  | {
      readonly status: 'quarantined'
      readonly cachePath: string
      readonly backupPath: string
      readonly sizeBytes: number
    }

function assertAbsoluteHome(homeDir: string): void {
  if (!isAbsolute(homeDir) || homeDir.includes('\0')) {
    throw new Error(`${BIN_NAME}: session projection cache recovery requires an absolute DSH home path`)
  }
}

function assertPositiveFinite(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${BIN_NAME}: session projection cache recovery ${label} must be positive`)
  }
}

function compactTimestamp(date: Date): string {
  const y = String(date.getUTCFullYear())
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0')
  return `${y}${m}${d}T${hh}${mm}${ss}${ms}Z`
}

function uniqueBackupPath(cachePath: string, stamp: string): string {
  const dir = dirname(cachePath)
  const extension = extname(cachePath)
  const stem = basename(cachePath, extension)
  const prefix = join(dir, `${stem}.oversized-${stamp}`)
  const first = `${prefix}${extension}`
  if (!existsSync(first)) return first
  for (let attempt = 1; attempt < Number.MAX_SAFE_INTEGER; attempt += 1) {
    const candidate = `${prefix}.${String(attempt)}${extension}`
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(`${BIN_NAME}: could not allocate a unique oversized session projection cache backup path`)
}

export function recoverOversizedSessionProjectionCache(
  homeDir: string,
  options: SessionProjectionCacheRecoveryOptions = {},
): SessionProjectionCacheRecoveryResult {
  assertAbsoluteHome(homeDir)
  const maxBytes = options.maxBytes ?? SESSION_PROJCACHE_MAX_BYTES
  assertPositiveFinite('size limit', maxBytes)
  const cachePath = join(homeDir, ...SESSION_PROJCACHE_RELATIVE_PATH)
  let stat
  try {
    stat = lstatSync(cachePath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing', cachePath }
    }
    throw cause
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return { status: 'non-file', cachePath }
  if (stat.size <= maxBytes) return { status: 'within-limit', cachePath }
  const stamp = compactTimestamp((options.now ?? (() => new Date()))())
  const backupPath = uniqueBackupPath(cachePath, stamp)
  renameSync(cachePath, backupPath)
  return {
    status: 'quarantined',
    cachePath,
    backupPath,
    sizeBytes: stat.size,
  }
}
