/** Disposable, launcher-owned DSH environment used by Desktop Safe Mode. */

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { createDesktopWebProfile, selectDesktopProfile } from './profile-manager.ts'
import type { DesktopMarketProvider } from './desktop-market.ts'
import type { DesktopSetupWizardSettings } from './setup-wizard-settings.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const SAFE_MODE_DIRECTORY = 'safe-mode'
const SAFE_MODE_MARKER = 'environment.json'
const SAFE_MODE_VERSION = 1
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const MAX_MARKER_BYTES = 4 * 1024
const CLEANUP_RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'])

/** Visible Profile identity used throughout the temporary DSH environment. */
export const DESKTOP_SAFE_MODE_PROFILE_NAME = 'desktop-safe-mode'

/** Fixed, disposable preferences used without showing first-run Setup. */
export const DESKTOP_SAFE_MODE_DEFAULTS: Readonly<{
  market: DesktopMarketProvider
  settings: DesktopSetupWizardSettings
}> = Object.freeze({
  market: 'disabled',
  settings: Object.freeze({
    mode: 'compatibility',
    macosMaterial: 'off',
    windowsMaterial: 'off',
    openBrowser: false,
    networkExposure: 'loopback',
    notifications: Object.freeze({
      enabled: false,
      notifyOnTurnCompletion: false,
      notifyOnTurnFailure: false,
      notifyOnJobCompletion: false,
      notifyOnJobFailure: false,
    }),
  }),
})

export interface DesktopSafeModePaths {
  /** Root removed during Safe Mode shutdown and retried on the next normal launch. */
  readonly rootDir: string
  /** Isolated Harness home; Safe Mode never reads the normal `~/.dsh`. */
  readonly homeDir: string
  /** Isolated Desktop state for selection, setup, checkpoints, and preferences. */
  readonly userDataDir: string
}

interface DesktopSafeModeMarkerV1 {
  readonly version: 1
  readonly createdAt: string
}

function absoluteUserDataDir(userDataDir: string): string {
  if (typeof userDataDir !== 'string' || userDataDir.length === 0
    || userDataDir.includes('\0') || !isAbsolute(userDataDir)) {
    throw new TypeError(`${BIN_NAME}: Safe Mode userData must be an absolute path without NUL`)
  }
  return resolve(userDataDir)
}

/** Resolve fixed paths without touching the filesystem. */
export function desktopSafeModePaths(userDataDir: string): DesktopSafeModePaths {
  const rootDir = join(absoluteUserDataDir(userDataDir), SAFE_MODE_DIRECTORY)
  return Object.freeze({
    rootDir,
    homeDir: join(rootDir, 'dsh-home'),
    userDataDir: join(rootDir, 'desktop-state'),
  })
}

function markerPath(paths: DesktopSafeModePaths): string {
  return join(paths.rootDir, SAFE_MODE_MARKER)
}

function isRealDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function validMarker(paths: DesktopSafeModePaths): boolean {
  try {
    const path = markerPath(paths)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MARKER_BYTES) return false
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (value === null || typeof value !== 'object') return false
    const marker = value as Partial<DesktopSafeModeMarkerV1>
    return marker.version === SAFE_MODE_VERSION
      && typeof marker.createdAt === 'string'
      && Number.isFinite(Date.parse(marker.createdAt))
  } catch {
    return false
  }
}

function removeSafeModeEntry(path: string): void {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      unlinkSync(path)
      return
    }
    for (const name of readdirSync(path)) removeSafeModeEntry(join(path, name))
    rmdirSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}

/** Remove only the disposable tree, unlinking junctions without visiting their targets. */
export function cleanupDesktopSafeModeEnvironment(userDataDir: string): boolean {
  const paths = desktopSafeModePaths(userDataDir)
  try {
    lstatSync(paths.rootDir)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
  for (let attempt = 0; ; attempt++) {
    try {
      removeSafeModeEntry(paths.rootDir)
      return true
    } catch (cause) {
      if (attempt >= 3 || !CLEANUP_RETRY_CODES.has((cause as NodeJS.ErrnoException).code ?? '')) throw cause
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1))
    }
  }
}

/** Create a fresh environment and mark it ready only after directory preparation succeeds. */
export function resetDesktopSafeModeEnvironment(
  userDataDir: string,
  now: () => Date = () => new Date(),
): DesktopSafeModePaths {
  const paths = desktopSafeModePaths(userDataDir)
  cleanupDesktopSafeModeEnvironment(userDataDir)
  try {
    mkdirSync(paths.homeDir, { recursive: true, mode: DIRECTORY_MODE })
    mkdirSync(paths.userDataDir, { recursive: true, mode: DIRECTORY_MODE })
    chmodSync(paths.rootDir, DIRECTORY_MODE)
    chmodSync(paths.homeDir, DIRECTORY_MODE)
    chmodSync(paths.userDataDir, DIRECTORY_MODE)
    writeFileSync(markerPath(paths), `${JSON.stringify({
      version: SAFE_MODE_VERSION,
      createdAt: now().toISOString(),
    } satisfies DesktopSafeModeMarkerV1, null, 2)}\n`, {
      flag: 'wx',
      mode: FILE_MODE,
    })
    return paths
  } catch (cause) {
    cleanupDesktopSafeModeEnvironment(userDataDir)
    throw cause
  }
}

/** Adopt the generation prepared for the next Safe Mode launch, or repair it with a fresh one. */
export function ensureDesktopSafeModeEnvironment(userDataDir: string): DesktopSafeModePaths {
  const paths = desktopSafeModePaths(userDataDir)
  if (isRealDirectory(paths.rootDir) && validMarker(paths)
    && isRealDirectory(paths.homeDir) && isRealDirectory(paths.userDataDir)) {
    return paths
  }
  return resetDesktopSafeModeEnvironment(userDataDir)
}

export function prepareDesktopSafeModeEnvironment(userDataDir: string): DesktopSafeModePaths {
  const paths = resetDesktopSafeModeEnvironment(userDataDir)
  try {
    createDesktopWebProfile(paths.homeDir, DESKTOP_SAFE_MODE_PROFILE_NAME)
    selectDesktopProfile(
      join(paths.userDataDir, 'profile-selection', 'state.json'),
      paths.homeDir,
      DESKTOP_SAFE_MODE_PROFILE_NAME,
    )
    return paths
  } catch (cause) {
    cleanupDesktopSafeModeEnvironment(userDataDir)
    throw cause
  }
}
