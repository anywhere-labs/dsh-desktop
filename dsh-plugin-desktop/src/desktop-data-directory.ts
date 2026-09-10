/** Desktop-owned DSH Home selection that never copies or mutates the previous Home. */

import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
} from 'node:fs'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { listDesktopProfiles } from './profile-manager.ts'
import { DESKTOP_PACKAGE_NAME } from './product-identity.ts'

const STATE_VERSION = 1
const STATE_ROOT_DIRECTORY = 'data-directory'
const STATE_FILENAME = 'state.json'
const STATE_DIRECTORY_MODE = 0o700
const STATE_FILE_MODE = 0o600
const MAX_STATE_BYTES = 64 * 1024
const MAX_PATH_BYTES = 32 * 1024
const CHECK_POSIX_MODE = process.platform !== 'win32'

export type DesktopDataDirectorySource = 'default' | 'environment' | 'desktop'

export type DesktopDataDirectoryErrorCode =
  | 'busy'
  | 'invalid-path'
  | 'path-conflict'
  | 'source-unavailable'
  | 'target-invalid'
  | 'target-unavailable'

export class DesktopDataDirectoryError extends Error {
  constructor(
    readonly code: DesktopDataDirectoryErrorCode,
    message: string,
  ) {
    super(`${DESKTOP_PACKAGE_NAME}: ${message}`)
    this.name = 'DesktopDataDirectoryError'
  }
}

export interface DesktopDataDirectoryStateV1 {
  readonly version: 1
  readonly activeHome: string
  readonly previousHome: string | null
  readonly generation: number
  readonly updatedAt: string
}

export interface DesktopDataDirectoryLocation {
  readonly homeDir: string
  readonly previousHome: string | null
  readonly generation: number
  readonly source: DesktopDataDirectorySource
}

export interface DesktopDataDirectoryTarget {
  readonly targetHome: string
  /** Empty targets become a fresh environment on restart; existing targets are loaded as-is. */
  readonly kind: 'empty' | 'existing'
}

export interface DesktopDataDirectorySelectionOptions {
  readonly signal?: AbortSignal
  readonly now?: () => number
  /** Create the exact target as an empty private directory when it does not exist. */
  readonly createIfMissing?: boolean
}

export interface DesktopDataDirectorySelectionResult {
  readonly location: DesktopDataDirectoryLocation
  readonly target: DesktopDataDirectoryTarget
}

const STATE_KEYS = Object.freeze(['activeHome', 'generation', 'previousHome', 'updatedAt', 'version'] as const)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalidState(`${label} must be a string`)
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw invalidState(`${label} must be a canonical ISO timestamp`)
  }
  return value
}

function canonicalPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !isAbsolute(value)
    || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) {
    throw new DesktopDataDirectoryError('invalid-path', `${label} must be a bounded absolute path without NUL`)
  }
  return resolve(value)
}

function invalidState(message: string): DesktopDataDirectoryError {
  return new DesktopDataDirectoryError('invalid-path', `invalid Desktop data-directory state: ${message}`)
}

function stateRoot(userDataDir: string): string {
  return join(canonicalPath(userDataDir, 'Desktop user-data directory'), STATE_ROOT_DIRECTORY)
}

export function desktopDataDirectoryStatePath(userDataDir: string): string {
  return join(stateRoot(userDataDir), STATE_FILENAME)
}

function existingInfo(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalidState(`state directory is unsafe: ${path}`)
  if (CHECK_POSIX_MODE && (info.mode & 0o777) !== STATE_DIRECTORY_MODE) chmodSync(path, STATE_DIRECTORY_MODE)
}

function assertPrivateStateFile(path: string): Stats | undefined {
  const info = existingInfo(path)
  if (info === undefined) return undefined
  if (!info.isFile() || info.isSymbolicLink()) throw invalidState(`state is not a regular file: ${path}`)
  if (info.size > MAX_STATE_BYTES) throw invalidState(`state exceeds ${String(MAX_STATE_BYTES)} bytes`)
  if (CHECK_POSIX_MODE && (info.mode & 0o777) !== STATE_FILE_MODE) {
    throw invalidState(`state permissions must be ${STATE_FILE_MODE.toString(8)}`)
  }
  return info
}

function readPrivateState(path: string): string | undefined {
  const pathInfo = assertPrivateStateFile(path)
  if (pathInfo === undefined) return undefined
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const descriptorInfo = fstatSync(descriptor)
    if (!descriptorInfo.isFile() || descriptorInfo.size > MAX_STATE_BYTES
      || descriptorInfo.dev !== pathInfo.dev || descriptorInfo.ino !== pathInfo.ino) {
      throw invalidState('state changed while it was being opened')
    }
    const bytes = Buffer.alloc(MAX_STATE_BYTES + 1)
    let offset = 0
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null)
      if (count === 0) break
      offset += count
    }
    if (offset > MAX_STATE_BYTES) throw invalidState(`state exceeds ${String(MAX_STATE_BYTES)} bytes`)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))
    } catch {
      throw invalidState('state must contain valid UTF-8')
    }
  } finally {
    closeSync(descriptor)
  }
}

async function writePrivateState(path: string, value: object): Promise<void> {
  ensurePrivateDirectory(dirname(path))
  assertPrivateStateFile(path)
  await writeFileAtomic(path, `${JSON.stringify(value, undefined, 2)}\n`, {
    mode: STATE_FILE_MODE,
    dirMode: STATE_DIRECTORY_MODE,
  })
  if (CHECK_POSIX_MODE) chmodSync(path, STATE_FILE_MODE)
}

function parseLocationState(text: string): DesktopDataDirectoryStateV1 {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw invalidState('locator must contain valid JSON')
  }
  if (!isRecord(value) || !hasExactKeys(value, STATE_KEYS) || value.version !== STATE_VERSION
    || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1
    || (value.previousHome !== null && typeof value.previousHome !== 'string')) {
    throw invalidState('locator must contain exactly the supported version-one fields')
  }
  return Object.freeze({
    version: STATE_VERSION,
    activeHome: canonicalPath(value.activeHome, 'active DSH home'),
    previousHome: value.previousHome === null ? null : canonicalPath(value.previousHome, 'previous DSH home'),
    generation: value.generation as number,
    updatedAt: canonicalTimestamp(value.updatedAt, 'updatedAt'),
  })
}

export function readDesktopDataDirectoryState(userDataDir: string): DesktopDataDirectoryStateV1 | undefined {
  const text = readPrivateState(desktopDataDirectoryStatePath(userDataDir))
  return text === undefined ? undefined : parseLocationState(text)
}

function assertRealDirectory(path: string, code: DesktopDataDirectoryErrorCode, label: string): void {
  let info: Stats
  try {
    info = lstatSync(path)
  } catch (cause) {
    throw new DesktopDataDirectoryError(
      code,
      `${label} is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new DesktopDataDirectoryError(code, `${label} must be a real directory: ${path}`)
  }
}

export function resolveDesktopDataDirectory(
  userDataDir: string,
  fallbackHome: string,
  fallbackSource: Exclude<DesktopDataDirectorySource, 'desktop'>,
): DesktopDataDirectoryLocation {
  const state = readDesktopDataDirectoryState(userDataDir)
  if (state === undefined) {
    return Object.freeze({
      homeDir: canonicalPath(fallbackHome, 'fallback DSH home'),
      previousHome: null,
      generation: 0,
      source: fallbackSource,
    })
  }
  assertRealDirectory(state.activeHome, 'source-unavailable', 'configured DSH home')
  return Object.freeze({
    homeDir: state.activeHome,
    previousHome: state.previousHome,
    generation: state.generation,
    source: 'desktop',
  })
}

function normalizedForComparison(path: string, platform: NodeJS.Platform): string {
  const normalized = resolve(path)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function contains(parent: string, child: string, platform: NodeJS.Platform): boolean {
  const suffix = relative(
    normalizedForComparison(parent, platform),
    normalizedForComparison(child, platform),
  )
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}

function validDesktopProfileExists(homeDir: string): boolean {
  const profilesDir = join(homeDir, 'profiles')
  const profilesInfo = existingInfo(profilesDir)
  if (profilesInfo === undefined || !profilesInfo.isDirectory() || profilesInfo.isSymbolicLink()) return false
  return listDesktopProfiles(homeDir).some(profile => profile.webCapable && profile.problem === undefined)
}

function resolvedTargetPaths(
  currentHome: string,
  targetDirectory: string,
  platform: NodeJS.Platform = process.platform,
): { readonly source: string; readonly target: string } {
  const source = canonicalPath(currentHome, 'current DSH home')
  const target = canonicalPath(targetDirectory, 'target DSH home')
  const root = parse(target).root
  if (normalizedForComparison(target, platform) === normalizedForComparison(root, platform)
    || contains(source, target, platform) || contains(target, source, platform)) {
    throw new DesktopDataDirectoryError(
      'path-conflict',
      'the new data directory must be separate from the current data directory and filesystem root',
    )
  }
  return { source, target }
}

/** Validate a target without reading, copying, writing, renaming, or deleting the current DSH Home. */
export function inspectDesktopDataDirectoryTarget(
  currentHome: string,
  targetDirectory: string,
  signal?: AbortSignal,
  platform: NodeJS.Platform = process.platform,
): DesktopDataDirectoryTarget {
  signal?.throwIfAborted()
  const { target } = resolvedTargetPaths(currentHome, targetDirectory, platform)
  assertRealDirectory(target, 'target-unavailable', 'target DSH home')
  signal?.throwIfAborted()
  const entries = readdirSync(target)
  if (entries.length === 0) return Object.freeze({ targetHome: target, kind: 'empty' })
  if (!validDesktopProfileExists(target)) {
    throw new DesktopDataDirectoryError(
      'target-invalid',
      'a non-empty target must be an existing DSH data directory with a Desktop-compatible Profile',
    )
  }
  return Object.freeze({ targetHome: target, kind: 'existing' })
}

function assertCurrentLocation(
  userDataDir: string,
  expected: DesktopDataDirectoryLocation,
): void {
  const state = readDesktopDataDirectoryState(userDataDir)
  if (expected.generation === 0 && state === undefined) return
  if (state !== undefined && state.generation === expected.generation
    && normalizedForComparison(state.activeHome, process.platform)
      === normalizedForComparison(expected.homeDir, process.platform)) return
  throw new DesktopDataDirectoryError('busy', 'the active DSH data directory changed while Recovery Assistant was open')
}

/** Select a validated target atomically; no content is copied from or changed in the old directory. */
export async function selectDesktopDataDirectory(
  userDataDir: string,
  current: DesktopDataDirectoryLocation,
  targetDirectory: string,
  options: DesktopDataDirectorySelectionOptions = {},
): Promise<DesktopDataDirectorySelectionResult> {
  options.signal?.throwIfAborted()
  // Do not create a missing target for a Recovery window whose locator is already stale.
  assertCurrentLocation(userDataDir, current)
  if (options.createIfMissing === true) {
    const { target } = resolvedTargetPaths(current.homeDir, targetDirectory)
    if (existingInfo(target) === undefined) {
      mkdirSync(target, { mode: STATE_DIRECTORY_MODE })
      if (CHECK_POSIX_MODE) chmodSync(target, STATE_DIRECTORY_MODE)
    }
  }
  const target = inspectDesktopDataDirectoryTarget(
    current.homeDir,
    targetDirectory,
    options.signal,
  )
  assertCurrentLocation(userDataDir, current)
  options.signal?.throwIfAborted()
  const generation = current.generation + 1
  if (!Number.isSafeInteger(generation)) throw invalidState('locator generation overflowed')
  const state: DesktopDataDirectoryStateV1 = Object.freeze({
    version: STATE_VERSION,
    activeHome: target.targetHome,
    previousHome: current.homeDir,
    generation,
    updatedAt: new Date((options.now ?? Date.now)()).toISOString(),
  })
  await writePrivateState(desktopDataDirectoryStatePath(userDataDir), state)
  return Object.freeze({
    location: Object.freeze({
      homeDir: state.activeHome,
      previousHome: state.previousHome,
      generation: state.generation,
      source: 'desktop' as const,
    }),
    target,
  })
}

/** Reject a managed command from a stale terminal after the selected Home changes. */
export function assertDesktopDataDirectoryCommandGeneration(
  userDataDir: string,
  expectedHome: string,
  expectedGeneration: number,
): void {
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) {
    throw invalidState('managed terminal generation is invalid')
  }
  const state = readDesktopDataDirectoryState(userDataDir)
  if (state === undefined) {
    if (expectedGeneration === 0) return
  } else if (state.generation === expectedGeneration
    && normalizedForComparison(state.activeHome, process.platform)
      === normalizedForComparison(expectedHome, process.platform)) {
    return
  }
  throw new DesktopDataDirectoryError(
    'busy',
    'this managed terminal belongs to an older DSH data directory; reopen it from DSH Desktop',
  )
}

export const desktopDataDirectoryConstants = Object.freeze({
  stateDirectory: STATE_ROOT_DIRECTORY,
  stateFilename: STATE_FILENAME,
  stateVersion: STATE_VERSION,
})
