/** Bounded non-secret desktop-state migration into the Aera Code user-data identity. */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600

/** Only launcher-owned, non-secret state crosses the native product rename. */
export const AERA_CODE_MIGRATABLE_STATE = Object.freeze([
  'profile-selection/state.json',
  'plugin-management/state.json',
  'desktop-market/state.json',
] as const)

export interface AeraCodeStateMigrationResult {
  readonly status: 'not-needed' | 'migrated' | 'source-unavailable'
  readonly migrated: readonly string[]
}

function assertOwnedRelativePath(path: string): void {
  if (path.length === 0 || path.startsWith(sep) || path.includes('\0') || path.split(/[\\/]/u).includes('..')) {
    throw new Error(`aera-code-state-migration: unsafe relative path ${JSON.stringify(path)}`)
  }
}

function assertRegularUnlinkedFile(path: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`aera-code-state-migration: refusing non-regular state file ${path}`)
  }
}

/**
 * Copy only explicitly allowed launcher state. Chromium state, cookies, logs,
 * caches, sessions, credentials, and crash evidence are deliberately excluded.
 */
export function migrateAeraCodeUserData(
  legacyUserDataDir: string,
  aeraCodeUserDataDir: string,
): AeraCodeStateMigrationResult {
  const legacy = resolve(legacyUserDataDir)
  const target = resolve(aeraCodeUserDataDir)
  if (legacy === target) return { status: 'not-needed', migrated: [] }
  if (!existsSync(legacy)) return { status: 'source-unavailable', migrated: [] }

  mkdirSync(target, { recursive: true, mode: DIRECTORY_MODE })
  chmodSync(target, DIRECTORY_MODE)
  const migrated: string[] = []
  for (const entry of AERA_CODE_MIGRATABLE_STATE) {
    assertOwnedRelativePath(entry)
    const source = join(legacy, entry)
    const destination = join(target, entry)
    if (relative(legacy, source).startsWith('..') || relative(target, destination).startsWith('..')) {
      throw new Error('aera-code-state-migration: path escaped its product data root')
    }
    if (!existsSync(source) || existsSync(destination)) continue
    assertRegularUnlinkedFile(source)
    mkdirSync(dirname(destination), { recursive: true, mode: DIRECTORY_MODE })
    chmodSync(dirname(destination), DIRECTORY_MODE)
    const staging = `${destination}.migrating-${process.pid}-${randomUUID()}`
    try {
      copyFileSync(source, staging)
      chmodSync(staging, FILE_MODE)
      const fd = openSync(staging, 'r')
      closeSync(fd)
      renameSync(staging, destination)
      migrated.push(entry)
    } finally {
      rmSync(staging, { force: true })
    }
  }
  return { status: migrated.length === 0 ? 'not-needed' : 'migrated', migrated }
}
