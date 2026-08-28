/**
 * Healthy-start configuration checkpoints for Desktop recovery.
 *
 * Exactly three rotating slots are retained. Restoring a slot never launches
 * pnpm and never copies node_modules; it only restores the fixed declarative
 * Profile and Harness-home files listed below. The first healthy startup after
 * a restore intentionally consumes a skip marker instead of replacing a
 * checkpoint.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  chmodSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const BIN_NAME = 'dsh-plugin-desktop'
const MANIFEST_VERSION = 3
const LEGACY_MANIFEST_VERSION = 2
const SKIP_MARKER_VERSION = 1
const SNAPSHOT_ROOT = 'health-snapshots'
const MANIFEST_FILENAME = 'manifest.json'
const SKIP_MARKER_FILENAME = 'skip-next-healthy.json'
const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700
const CHECK_POSIX_MODE = process.platform !== 'win32'
const HASH_PATTERN = /^[0-9a-f]{64}$/u
const ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,256}$/u

export const DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3'] as const
export type DesktopProfileCheckpointSlotId = typeof DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS[number]

const LEGACY_PROFILE_CHECKPOINT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cordis.patch.yml',
  '.dsh-market/state.json',
] as const

/** Files covered by unified startup recovery. Optional files retain absence. */
export const DESKTOP_PROFILE_CHECKPOINT_FILES = [
  ...LEGACY_PROFILE_CHECKPOINT_FILES,
  'home/settings.yaml',
  'home/cordis.patch.yml',
] as const

export type DesktopProfileCheckpointFilename = typeof DESKTOP_PROFILE_CHECKPOINT_FILES[number]
type LegacyProfileCheckpointFilename = typeof LEGACY_PROFILE_CHECKPOINT_FILES[number]

const FILE_LIMITS: Record<DesktopProfileCheckpointFilename, number> = {
  'package.json': 1 * 1024 * 1024,
  'pnpm-lock.yaml': 32 * 1024 * 1024,
  'pnpm-workspace.yaml': 1 * 1024 * 1024,
  'cordis.patch.yml': 1 * 1024 * 1024,
  '.dsh-market/state.json': 1 * 1024 * 1024,
  'home/settings.yaml': 4 * 1024 * 1024,
  'home/cordis.patch.yml': 1 * 1024 * 1024,
}

export interface ProfileCheckpointOptions {
  readonly userDataDir?: string
  readonly userData?: string
  readonly profileDir?: string
  readonly profilePath?: string
  readonly homeDir?: string
  readonly profileIdentity?: string
  readonly profileName?: string
  readonly provider?: string
  /** Desktop product version displayed by Recovery when browsing checkpoints. */
  readonly appVersion?: string
  readonly maxFileBytes?: Partial<Record<DesktopProfileCheckpointFilename, number>>
  readonly now?: () => number
}

export interface ProfileCheckpointFileRecord {
  readonly name: DesktopProfileCheckpointFilename
  readonly present: boolean
  readonly sha256?: string
  readonly size?: number
  readonly mode?: number
}

interface ProfileCheckpointManifestMetadata {
  readonly snapshotId: string
  readonly capturedAt: string
  readonly profileIdentity: string
  readonly profileName: string
  readonly provider: string
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly reason: 'healthy-startup'
  readonly appVersion: string
}

export interface ProfileCheckpointManifestV2 extends ProfileCheckpointManifestMetadata {
  readonly version: 2
  readonly files: readonly (ProfileCheckpointFileRecord & { readonly name: LegacyProfileCheckpointFilename })[]
}

export interface ProfileCheckpointManifestV3 extends ProfileCheckpointManifestMetadata {
  readonly version: 3
  readonly files: readonly ProfileCheckpointFileRecord[]
}

export type ProfileCheckpointManifest = ProfileCheckpointManifestV2 | ProfileCheckpointManifestV3

export interface ProfileCheckpointSlot {
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly snapshotExists: boolean
  readonly snapshotDirectory: string
  readonly manifest?: ProfileCheckpointManifest
  /** Count derived from the snapshotted dsh.profile.bundles list. */
  readonly pluginCount?: number
  /** Total bytes of the declarative files present in this checkpoint. */
  readonly totalBytes?: number
}

export type CaptureHealthyResult =
  | {
      readonly status: 'captured'
      readonly slotId: DesktopProfileCheckpointSlotId
      readonly snapshotDirectory: string
      readonly manifest: ProfileCheckpointManifest
    }
  | {
      readonly status: 'skipped-after-restore'
      readonly restoredSlotId: DesktopProfileCheckpointSlotId
    }

export interface RestoreInspection {
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly snapshotExists: boolean
  readonly currentDiffers: boolean
  readonly changedFiles: readonly DesktopProfileCheckpointFilename[]
  readonly manifest?: ProfileCheckpointManifest
}

export interface RestoreResult {
  readonly status: 'restored'
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly changedFiles: readonly DesktopProfileCheckpointFilename[]
  /** Remains true across retries until packaged pnpm has reconciled the restored dependency files. */
  readonly dependencyMaterializationRequired: boolean
  readonly snapshotDirectory: string
}

interface SkipHealthyMarker {
  readonly version: 1
  readonly restoredSlotId: DesktopProfileCheckpointSlotId
  readonly restoredAt: string
  readonly dependencyMaterializationPending: boolean
}

interface FileImage {
  readonly present: boolean
  readonly sha256?: string
  readonly size?: number
  readonly mode?: number
}

interface LoadedSnapshot {
  readonly directory: string
  readonly manifest: ProfileCheckpointManifest
}

function fail(message: string): never {
  throw new Error(`${BIN_NAME}: ${message}`)
}

function assertAbsolute(label: string, value: string): string {
  if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value) || value.includes('\0')) {
    fail(`${label} must be an absolute path without NUL`)
  }
  return resolve(value)
}

function assertIdentifier(label: string, value: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || value.includes('\\')) fail(`invalid ${label}`)
  return value
}

function assertProfileName(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255
    || value.includes('/') || value.includes('\\') || /[\0\r\n]/u.test(value)) fail('invalid profile name')
  return value
}

function assertAppVersion(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\0\r\n]/u.test(value)) {
    fail('invalid Desktop version')
  }
  return value
}

function assertSlotId(value: string): DesktopProfileCheckpointSlotId {
  if (!(DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS as readonly string[]).includes(value)) fail('invalid checkpoint slot')
  return value as DesktopProfileCheckpointSlotId
}

function hash(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isENOENT(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function realDirectory(label: string, path: string): string {
  const absolute = assertAbsolute(label, path)
  let item
  try { item = lstatSync(absolute) } catch (cause) {
    fail(`${label} is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!item.isDirectory() || item.isSymbolicLink()) fail(`${label} must be a real directory`)
  realpathSync(absolute)
  return absolute
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE })
  const item = lstatSync(path)
  if (!item.isDirectory() || item.isSymbolicLink()) fail(`checkpoint directory is not a real directory: ${path}`)
  if (CHECK_POSIX_MODE && (item.mode & 0o777) !== DIRECTORY_MODE) chmodSync(path, DIRECTORY_MODE)
}

function writeDurable(path: string, bytes: Uint8Array, mode = FILE_MODE): void {
  ensureDirectory(dirname(path))
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', mode)
    writeSync(fd, bytes)
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

function readJson(path: string): unknown {
  const item = lstatSync(path)
  if (!item.isFile() || item.isSymbolicLink() || (CHECK_POSIX_MODE && (item.mode & 0o777) !== FILE_MODE)) {
    fail(`checkpoint file has unsafe type or mode: ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function checkpointPluginCount(directory: string): number | undefined {
  try {
    const value = readJson(filePath(directory, 'package.json'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const dsh = (value as Record<string, unknown>).dsh
    if (dsh === null || typeof dsh !== 'object' || Array.isArray(dsh)) return undefined
    const profile = (dsh as Record<string, unknown>).profile
    if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) return undefined
    const bundles = (profile as Record<string, unknown>).bundles
    if (!Array.isArray(bundles) || bundles.some(bundle => typeof bundle !== 'string')) return undefined
    return bundles.length
  } catch {
    // Browseable checkpoint metadata must not make a restorable slot disappear.
    return undefined
  }
}

function fileEqual(left: FileImage, right: FileImage): boolean {
  return left.present === right.present && (!left.present
    || left.sha256 === right.sha256 && left.size === right.size && left.mode === right.mode)
}

function filePath(root: string, name: DesktopProfileCheckpointFilename): string {
  const path = join(root, ...name.split('/'))
  const expected = resolve(root, ...name.split('/'))
  if (path !== expected || relative(root, path).startsWith('..')) fail('checkpoint filename escaped its root')
  return path
}

function checkpointFiles(version: unknown): readonly DesktopProfileCheckpointFilename[] {
  if (version === LEGACY_MANIFEST_VERSION) return LEGACY_PROFILE_CHECKPOINT_FILES
  if (version === MANIFEST_VERSION) return DESKTOP_PROFILE_CHECKPOINT_FILES
  fail('checkpoint manifest is invalid')
}

function targetPath(
  profileDir: string,
  homeDir: string,
  name: DesktopProfileCheckpointFilename,
): string {
  if (name === 'home/settings.yaml') return join(homeDir, 'settings.yaml')
  if (name === 'home/cordis.patch.yml') return join(homeDir, 'cordis.patch.yml')
  return filePath(profileDir, name)
}

function assertTargetParent(
  profileDir: string,
  homeDir: string,
  name: DesktopProfileCheckpointFilename,
): void {
  const parent = dirname(targetPath(profileDir, homeDir, name))
  try {
    const item = lstatSync(parent)
    if (item.isSymbolicLink() || !item.isDirectory()) fail(`checkpoint target parent must be a real directory: ${name}`)
    realpathSync(parent)
  } catch (cause) {
    if (!isENOENT(cause)) throw cause
  }
}

/** Three-slot Profile checkpoint manager. */
export class DesktopProfileCheckpoint {
  readonly userDataDir: string
  readonly profileDir: string
  readonly homeDir: string
  readonly profileIdentity: string
  readonly profileName: string
  readonly provider: string
  readonly appVersion: string
  readonly profileRoot: string

  private readonly limits: Record<DesktopProfileCheckpointFilename, number>
  private readonly now: () => number

  constructor(options: ProfileCheckpointOptions) {
    const userData = options.userDataDir ?? options.userData
    const profile = options.profileDir ?? options.profilePath
    if (userData === undefined || profile === undefined) fail('userDataDir and profileDir are required')
    this.userDataDir = realDirectory('userDataDir', userData)
    this.profileDir = realDirectory('profileDir', profile)
    this.homeDir = realDirectory('homeDir', options.homeDir ?? resolve(this.profileDir, '..', '..'))
    this.profileIdentity = assertIdentifier('profile identity', options.profileIdentity ?? hash(this.profileDir))
    this.profileName = assertProfileName(options.profileName ?? 'desktop')
    this.provider = assertIdentifier('provider', options.provider ?? 'unknown')
    this.appVersion = assertAppVersion(options.appVersion ?? 'unknown')
    this.now = options.now ?? Date.now
    this.limits = { ...FILE_LIMITS, ...(options.maxFileBytes ?? {}) }
    for (const name of DESKTOP_PROFILE_CHECKPOINT_FILES) {
      if (!Number.isSafeInteger(this.limits[name]) || this.limits[name] < 0) fail(`invalid size limit for ${name}`)
    }
    const root = join(this.userDataDir, SNAPSHOT_ROOT)
    ensureDirectory(root)
    this.profileRoot = join(root, hash(this.profileIdentity))
    ensureDirectory(this.profileRoot)
  }

  /** Return all three stable slots, including empty slots. */
  listSlots(): readonly ProfileCheckpointSlot[] {
    this.recoverOrphanedSlots()
    return DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS.map(slotId => {
      const directory = this.slotDirectory(slotId)
      const snapshot = this.readSnapshot(directory, false)
      return snapshot === undefined
        ? { slotId, snapshotExists: false, snapshotDirectory: directory }
        : (() => {
            const pluginCount = checkpointPluginCount(snapshot.directory)
            return {
              slotId,
              snapshotExists: true,
              snapshotDirectory: directory,
              manifest: snapshot.manifest,
              ...(pluginCount === undefined ? {} : { pluginCount }),
              totalBytes: snapshot.manifest.files.reduce(
                (total, file) => total + (file.present ? (file.size ?? 0) : 0),
                0,
              ),
            }
          })()
    })
  }

  /** Capture every healthy startup, rotating the oldest of the three slots. */
  captureHealthy(): CaptureHealthyResult {
    this.recoverOrphanedSlots()
    const current = this.readCurrentImages(DESKTOP_PROFILE_CHECKPOINT_FILES, true)
    const skip = this.readSkipMarker()
    if (skip !== undefined) {
      unlinkSync(join(this.profileRoot, SKIP_MARKER_FILENAME))
      return { status: 'skipped-after-restore', restoredSlotId: skip.restoredSlotId }
    }

    const slots = this.listSlots()
    const empty = slots.find(slot => !slot.snapshotExists)
    const target = empty ?? [...slots].sort((left, right) => {
      const leftTime = Date.parse(left.manifest!.capturedAt)
      const rightTime = Date.parse(right.manifest!.capturedAt)
      return leftTime - rightTime || left.slotId.localeCompare(right.slotId)
    })[0]!
    const snapshotId = randomUUID()
    const targetDirectory = target.snapshotDirectory
    const staging = join(this.profileRoot, `.staging-${target.slotId}-${process.pid}-${snapshotId}`)
    ensureDirectory(staging)
    try {
      const records: ProfileCheckpointFileRecord[] = []
      for (let index = 0; index < DESKTOP_PROFILE_CHECKPOINT_FILES.length; index += 1) {
        const name = DESKTOP_PROFILE_CHECKPOINT_FILES[index]!
        const image = current[index]!
        records.push({ name, ...image })
        if (image.present) {
          const destination = filePath(staging, name)
          ensureDirectory(dirname(destination))
          writeDurable(destination, readFileSync(targetPath(this.profileDir, this.homeDir, name)))
        }
      }
      const manifest: ProfileCheckpointManifestV3 = {
        version: MANIFEST_VERSION,
        snapshotId,
        capturedAt: new Date(this.now()).toISOString(),
        profileIdentity: this.profileIdentity,
        profileName: this.profileName,
        provider: this.provider,
        slotId: target.slotId,
        reason: 'healthy-startup',
        appVersion: this.appVersion,
        files: records,
      }
      writeDurable(join(staging, MANIFEST_FILENAME), Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8'))
      this.replaceSlot(targetDirectory, staging)
      return { status: 'captured', slotId: target.slotId, snapshotDirectory: targetDirectory, manifest }
    } catch (cause) {
      rmSync(staging, { recursive: true, force: true })
      throw cause
    }
  }

  inspectSlot(slotId: DesktopProfileCheckpointSlotId): RestoreInspection {
    const resolvedSlot = assertSlotId(slotId)
    this.recoverOrphanedSlot(resolvedSlot)
    const snapshot = this.readSnapshot(this.slotDirectory(resolvedSlot), false)
    if (snapshot === undefined) {
      return { slotId: resolvedSlot, snapshotExists: false, currentDiffers: false, changedFiles: [] }
    }
    const names = checkpointFiles(snapshot.manifest.version)
    const current = this.readCurrentImages(names, false)
    const changedFiles = names.filter(
      (_, index) => !fileEqual(snapshot.manifest.files[index]!, current[index]!),
    )
    return {
      slotId: resolvedSlot,
      snapshotExists: true,
      currentDiffers: changedFiles.length > 0,
      changedFiles,
      manifest: snapshot.manifest,
    }
  }

  /** Restore one user-selected slot and preserve it across the next healthy boot. */
  restoreSlot(slotId: DesktopProfileCheckpointSlotId): RestoreResult {
    const resolvedSlot = assertSlotId(slotId)
    this.recoverOrphanedSlot(resolvedSlot)
    const snapshot = this.readSnapshot(this.slotDirectory(resolvedSlot), true)
    if (snapshot === undefined) fail(`checkpoint ${resolvedSlot} is empty`)
    const names = checkpointFiles(snapshot.manifest.version)
    const current = this.readCurrentImages(names, false)
    const changedFiles = names.filter(
      (_, index) => !fileEqual(snapshot.manifest.files[index]!, current[index]!),
    )
    const previousMarker = this.readSkipMarker()
    const dependencyMaterializationRequired = previousMarker?.dependencyMaterializationPending === true
      || changedFiles.some(name => name === 'package.json'
        || name === 'pnpm-lock.yaml' || name === 'pnpm-workspace.yaml')

    // Persist before mutation. A failed restore must not cause a later healthy
    // startup to overwrite the selected recovery point accidentally. The
    // materialization bit also makes a failed packaged-pnpm pass retryable even
    // after the declarative files already match the selected checkpoint.
    writeDurable(join(this.profileRoot, SKIP_MARKER_FILENAME), Buffer.from(`${JSON.stringify({
      version: SKIP_MARKER_VERSION,
      restoredSlotId: resolvedSlot,
      restoredAt: new Date(this.now()).toISOString(),
      dependencyMaterializationPending: dependencyMaterializationRequired,
    } satisfies SkipHealthyMarker)}\n`, 'utf8'))

    for (const name of names) assertTargetParent(this.profileDir, this.homeDir, name)

    for (let index = 0; index < names.length; index += 1) {
      const name = names[index]!
      const record = snapshot.manifest.files[index]!
      const target = targetPath(this.profileDir, this.homeDir, name)
      if (record.present) {
        const bytes = readFileSync(filePath(snapshot.directory, name))
        if (hash(bytes) !== record.sha256 || bytes.byteLength !== record.size) fail(`checkpoint changed during restore: ${name}`)
        writeDurable(target, bytes, record.mode)
      } else {
        try {
          const item = lstatSync(target)
          if (item.isSymbolicLink() || !item.isFile()) fail(`cannot remove unsafe profile entry: ${name}`)
          unlinkSync(target)
        } catch (cause) {
          if (!isENOENT(cause)) throw cause
        }
      }
    }
    return {
      status: 'restored',
      slotId: resolvedSlot,
      changedFiles,
      dependencyMaterializationRequired,
      snapshotDirectory: snapshot.directory,
    }
  }

  /** Keep the checkpoint-preservation marker but clear its derived dependency work. */
  completeDependencyMaterialization(slotId: DesktopProfileCheckpointSlotId): void {
    const resolvedSlot = assertSlotId(slotId)
    const marker = this.readSkipMarker()
    if (marker === undefined || marker.restoredSlotId !== resolvedSlot) {
      fail('checkpoint materialization completion does not match the active restore')
    }
    if (!marker.dependencyMaterializationPending) return
    writeDurable(join(this.profileRoot, SKIP_MARKER_FILENAME), Buffer.from(`${JSON.stringify({
      ...marker,
      dependencyMaterializationPending: false,
    } satisfies SkipHealthyMarker)}\n`, 'utf8'))
  }

  private slotDirectory(slotId: DesktopProfileCheckpointSlotId): string {
    return join(this.profileRoot, slotId)
  }

  private readCurrentImages(
    names: readonly DesktopProfileCheckpointFilename[],
    requirePackage: boolean,
  ): FileImage[] {
    return names.map(name => {
      assertTargetParent(this.profileDir, this.homeDir, name)
      const path = targetPath(this.profileDir, this.homeDir, name)
      let item
      try { item = lstatSync(path) } catch (cause) {
        if (isENOENT(cause)) {
          if (requirePackage && name === 'package.json') fail('healthy profile package.json is unavailable')
          return { present: false }
        }
        throw cause
      }
      if (item.isSymbolicLink() || !item.isFile()) fail(`checkpoint entry must be a regular file: ${name}`)
      if (item.size > this.limits[name]) fail(`profile checkpoint file is too large: ${name}`)
      const bytes = readFileSync(path)
      return { present: true, sha256: hash(bytes), size: bytes.byteLength, mode: item.mode & 0o777 }
    })
  }

  private replaceSlot(target: string, staging: string): void {
    if (!existsSync(target)) {
      renameSync(staging, target)
      return
    }
    const old = `${target}.old-${randomUUID()}`
    renameSync(target, old)
    try { renameSync(staging, target) } catch (cause) {
      renameSync(old, target)
      throw cause
    }
    rmSync(old, { recursive: true, force: true })
  }

  private recoverOrphanedSlots(): void {
    for (const slotId of DESKTOP_PROFILE_CHECKPOINT_SLOT_IDS) this.recoverOrphanedSlot(slotId)
  }

  private recoverOrphanedSlot(slotId: DesktopProfileCheckpointSlotId): void {
    const target = this.slotDirectory(slotId)
    if (existsSync(target)) return
    let candidates: string[]
    try {
      candidates = readdirSync(this.profileRoot).filter(name => name.startsWith(`${slotId}.old-`)).sort().reverse()
    } catch (cause) {
      if (isENOENT(cause)) return
      throw cause
    }
    for (const name of candidates) {
      const candidate = join(this.profileRoot, name)
      try {
        const item = lstatSync(candidate)
        if (!item.isDirectory() || item.isSymbolicLink()
          || (CHECK_POSIX_MODE && (item.mode & 0o777) !== DIRECTORY_MODE)) continue
        renameSync(candidate, target)
        return
      } catch (cause) {
        if (!isENOENT(cause)) throw cause
      }
    }
  }

  private readSkipMarker(): SkipHealthyMarker | undefined {
    const path = join(this.profileRoot, SKIP_MARKER_FILENAME)
    try {
      const value = readJson(path)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('skip healthy marker is invalid')
      const marker = value as Record<string, unknown>
      if (marker.version !== SKIP_MARKER_VERSION || typeof marker.restoredSlotId !== 'string'
        || typeof marker.restoredAt !== 'string' || !Number.isFinite(Date.parse(marker.restoredAt))
        || (marker.dependencyMaterializationPending !== undefined
          && typeof marker.dependencyMaterializationPending !== 'boolean')) {
        fail('skip healthy marker is invalid')
      }
      return {
        version: SKIP_MARKER_VERSION,
        restoredSlotId: assertSlotId(marker.restoredSlotId),
        restoredAt: marker.restoredAt,
        // Version-1 markers written before retryable materialization did not
        // carry this optional field and are already safe to treat as complete.
        dependencyMaterializationPending: marker.dependencyMaterializationPending === true,
      }
    } catch (cause) {
      if (isENOENT(cause)) return undefined
      throw cause
    }
  }

  private readSnapshot(directory: string, requireComplete: boolean): LoadedSnapshot | undefined {
    try {
      const expectedSlotId = assertSlotId(basename(directory))
      const directoryItem = lstatSync(directory)
      if (!directoryItem.isDirectory() || directoryItem.isSymbolicLink()
        || (CHECK_POSIX_MODE && (directoryItem.mode & 0o777) !== DIRECTORY_MODE)) {
        fail('checkpoint directory has unsafe type or mode')
      }
      const value = readJson(join(directory, MANIFEST_FILENAME))
      if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('checkpoint manifest is invalid')
      const object = value as Record<string, unknown>
      const files = object.files
      const expectedFiles = checkpointFiles(object.version)
      if (typeof object.snapshotId !== 'string' || !ID_PATTERN.test(object.snapshotId)
        || typeof object.capturedAt !== 'string' || !Number.isFinite(Date.parse(object.capturedAt))
        || object.profileIdentity !== this.profileIdentity || object.profileName !== this.profileName
        || typeof object.provider !== 'string' || assertIdentifier('checkpoint provider', object.provider) !== object.provider
        || !Array.isArray(files)
        || files.length !== expectedFiles.length) fail('checkpoint manifest is invalid')
      if (object.slotId !== expectedSlotId || object.reason !== 'healthy-startup'
        || typeof object.appVersion !== 'string' || assertAppVersion(object.appVersion) !== object.appVersion) {
        fail('checkpoint metadata is invalid')
      }
      for (let index = 0; index < expectedFiles.length; index += 1) {
        const record = files[index]
        const expected = expectedFiles[index]!
        if (record === null || typeof record !== 'object' || Array.isArray(record)) fail('checkpoint manifest is invalid')
        const item = record as Record<string, unknown>
        if (item.name !== expected || typeof item.present !== 'boolean') fail('checkpoint manifest is invalid')
        if (item.present && (typeof item.sha256 !== 'string' || !HASH_PATTERN.test(item.sha256)
          || !Number.isSafeInteger(item.size) || (item.size as number) < 0 || (item.size as number) > this.limits[expected]
          || !Number.isSafeInteger(item.mode) || (item.mode as number) < 0 || (item.mode as number) > 0o777)) {
          fail('checkpoint manifest is invalid')
        }
        const backup = filePath(directory, expected)
        if (item.present) {
          const backupItem = lstatSync(backup)
          if (!backupItem.isFile() || backupItem.isSymbolicLink()
            || (CHECK_POSIX_MODE && (backupItem.mode & 0o777) !== FILE_MODE)) fail(`checkpoint backup is unsafe: ${expected}`)
          const bytes = readFileSync(backup)
          if (bytes.byteLength !== item.size || hash(bytes) !== item.sha256) fail(`checkpoint backup is incomplete: ${expected}`)
        } else if (existsSync(backup)) fail(`checkpoint contains an unexpected backup: ${expected}`)
      }
      if (requireComplete && !files.some((record: Record<string, unknown>) => record.present === true)) {
        fail('checkpoint contains no restorable files')
      }
      return { directory, manifest: value as unknown as ProfileCheckpointManifest }
    } catch (cause) {
      if (isENOENT(cause)) {
        try { lstatSync(directory) } catch (directoryCause) {
          if (isENOENT(directoryCause)) return undefined
        }
      }
      throw cause
    }
  }
}

export function createDesktopProfileCheckpoint(options: ProfileCheckpointOptions): DesktopProfileCheckpoint {
  return new DesktopProfileCheckpoint(options)
}

/** Remove all three slots and the skip marker for one deleted Profile. */
export function clearDesktopProfileCheckpoint(userDataDir: string, profileDir: string): void {
  const userData = realDirectory('userDataDir', userDataDir)
  const profile = assertAbsolute('profileDir', profileDir)
  const profileRoot = join(userData, SNAPSHOT_ROOT, hash(hash(profile)))
  let item
  try { item = lstatSync(profileRoot) } catch (cause) {
    if (isENOENT(cause)) return
    throw cause
  }
  if (item.isSymbolicLink() || !item.isDirectory()) fail('profile checkpoint directory has unsafe type')
  rmSync(profileRoot, { recursive: true, force: false })
}

export { DesktopProfileCheckpoint as HealthProfileCheckpoint, DesktopProfileCheckpoint as ProfileHealthCheckpoint }
