/** Shared identities and manifest validation for the Windows NSIS A/B lab. */

import { createHash } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const WINDOWS_NSIS_AB_SCHEMA_VERSION = 2
export const WINDOWS_NSIS_AB_BUILDER_VERSION = '26.15.7'

export type WindowsNsisAbSkipCheckSource =
  | 'none'
  | '--skip-check'
  | 'DSH_PACKAGE_CHECK_ALREADY_RAN'
  | '--skip-check + DSH_PACKAGE_CHECK_ALREADY_RAN'

export interface WindowsNsisAbFileIdentity {
  readonly path: string
  readonly kind: 'file' | 'symlink'
  readonly size: number
  readonly sha256: string
}

export interface WindowsNsisAbTreeIdentity {
  readonly treeSha256: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly files: readonly WindowsNsisAbFileIdentity[]
}

export interface WindowsNsisAbArtifactIdentity {
  /** Path relative to the manifest directory. */
  readonly path: string
  readonly size: number
  readonly sha256: string
}

export interface WindowsNsisAbManifest {
  readonly schemaVersion: 2
  readonly createdAt: string
  readonly appVersion: string
  readonly electronBuilderVersion: string
  readonly provenance: {
    /** Whether this invocation ran check:win-package before producing the shared app. */
    readonly gateRan: boolean
    readonly skipCheck: {
      readonly requested: boolean
      readonly source: WindowsNsisAbSkipCheckSource
    }
    /** Both variants intentionally use the same credential-free unsigned build. */
    readonly signing: {
      readonly state: 'unsigned'
      readonly signExecutable: false
      readonly cscIdentityAutoDiscovery: false
      readonly signingSecretsRemoved: true
    }
  }
  readonly application: {
    /** Path relative to the manifest directory. */
    readonly directory: string
    readonly tree: WindowsNsisAbTreeIdentity
    readonly resources: WindowsNsisAbTreeIdentity
    readonly appAsar: WindowsNsisAbArtifactIdentity
    readonly unpacked: WindowsNsisAbTreeIdentity | null
  }
  readonly variants: {
    readonly direct: {
      readonly extraction: 'patched-direct-extract'
      readonly builder: 'workspace-resolution'
      readonly installer: WindowsNsisAbArtifactIdentity
    }
    readonly staged: {
      readonly extraction: 'electron-builder-default-staged-copy'
      readonly builder: 'isolated-single-hunk-reversal'
      readonly extractTemplateSha256: string
      readonly installer: WindowsNsisAbArtifactIdentity
    }
  }
}

function sha256File(path: string): string {
  const descriptor = openSync(path, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.byteLength, null)
      if (count === 0) break
      hash.update(buffer.subarray(0, count))
    }
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

function portableRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

/** Hash one regular file for an A/B manifest. */
export function identifyWindowsNsisAbFile(
  path: string,
  manifestRoot = dirname(path),
): WindowsNsisAbArtifactIdentity {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`NSIS A/B artifact is not a regular file: ${path}`)
  }
  return {
    path: portableRelativePath(manifestRoot, path),
    size: stat.size,
    sha256: sha256File(path),
  }
}

/**
 * Produce a deterministic, content-addressed directory inventory.
 * File mtimes and enumeration order are deliberately excluded.
 */
export function normalizeWindowsNsisAbRelativePath(path: string): string {
  const portable = path.replaceAll('\\', '/')
  if (portable.length === 0
      || portable.startsWith('/')
      || /^[A-Za-z]:/u.test(portable)
      || portable.includes('\0')) {
    throw new Error(`NSIS A/B path must be a non-empty relative path: ${path}`)
  }
  const segments = portable.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`NSIS A/B path must be normalized: ${path}`)
  }
  return segments.join('/')
}

export function identifyWindowsNsisAbTree(
  root: string,
  ignoreRelativePaths: readonly string[] = [],
): WindowsNsisAbTreeIdentity {
  const absoluteRoot = resolve(root)
  const files: WindowsNsisAbFileIdentity[] = []
  const ignored = new Set(ignoreRelativePaths.map(normalizeWindowsNsisAbRelativePath))

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = portableRelativePath(absoluteRoot, path)
      const stat = lstatSync(path)
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        visit(path)
        continue
      }
      if (ignored.has(relativePath)) continue
      if (stat.isFile() && !stat.isSymbolicLink()) {
        files.push({
          path: relativePath,
          kind: 'file',
          size: stat.size,
          sha256: sha256File(path),
        })
        continue
      }
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(path)
        files.push({
          path: relativePath,
          kind: 'symlink',
          size: Buffer.byteLength(target),
          sha256: createHash('sha256').update(target).digest('hex'),
        })
        continue
      }
      throw new Error(`NSIS A/B input contains an unsupported filesystem entry: ${path}`)
    }
  }

  visit(absoluteRoot)
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const aggregate = createHash('sha256')
  let totalBytes = 0
  for (const file of files) {
    aggregate.update(file.path)
    aggregate.update('\0')
    aggregate.update(file.kind)
    aggregate.update('\0')
    aggregate.update(String(file.size))
    aggregate.update('\0')
    aggregate.update(file.sha256)
    aggregate.update('\n')
    totalBytes += file.size
  }
  return {
    treeSha256: aggregate.digest('hex'),
    fileCount: files.length,
    totalBytes,
    files,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`)
  }
  return value
}

function validateArtifact(value: unknown, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const path = requireString(value, 'path', label)
  if (normalizeWindowsNsisAbRelativePath(path) !== path) {
    throw new Error(`${label}.path must be a normalized manifest-relative path`)
  }
  if (!Number.isSafeInteger(value.size) || Number(value.size) < 0) {
    throw new Error(`${label}.size must be a non-negative safe integer`)
  }
  if (!/^[a-f\d]{64}$/u.test(requireString(value, 'sha256', label))) {
    throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`)
  }
}

function validateTree(value: unknown, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (!/^[a-f\d]{64}$/u.test(requireString(value, 'treeSha256', label))) {
    throw new Error(`${label}.treeSha256 must be a lowercase SHA-256 digest`)
  }
  if (!Number.isSafeInteger(value.fileCount) || Number(value.fileCount) < 0) {
    throw new Error(`${label}.fileCount must be a non-negative safe integer`)
  }
  if (!Number.isSafeInteger(value.totalBytes) || Number(value.totalBytes) < 0) {
    throw new Error(`${label}.totalBytes must be a non-negative safe integer`)
  }
  if (!Array.isArray(value.files) || value.files.length !== value.fileCount) {
    throw new Error(`${label}.files must match fileCount`)
  }
  const aggregate = createHash('sha256')
  let totalBytes = 0
  let previousPath: string | null = null
  for (const [index, entry] of value.files.entries()) {
    const entryLabel = `${label}.files[${index}]`
    if (!isRecord(entry)) throw new Error(`${entryLabel} must be an object`)
    const path = normalizeWindowsNsisAbRelativePath(requireString(entry, 'path', entryLabel))
    if (entry.path !== path) throw new Error(`${entryLabel}.path must use normalized forward slashes`)
    if (entry.kind !== 'file' && entry.kind !== 'symlink') {
      throw new Error(`${entryLabel}.kind must be file or symlink`)
    }
    if (!Number.isSafeInteger(entry.size) || Number(entry.size) < 0) {
      throw new Error(`${entryLabel}.size must be a non-negative safe integer`)
    }
    const digest = requireString(entry, 'sha256', entryLabel)
    if (!/^[a-f\d]{64}$/u.test(digest)) {
      throw new Error(`${entryLabel}.sha256 must be a lowercase SHA-256 digest`)
    }
    if (previousPath !== null && previousPath.localeCompare(path, 'en') >= 0) {
      throw new Error(`${label}.files must be uniquely sorted by path`)
    }
    previousPath = path
    aggregate.update(path)
    aggregate.update('\0')
    aggregate.update(entry.kind)
    aggregate.update('\0')
    aggregate.update(String(entry.size))
    aggregate.update('\0')
    aggregate.update(digest)
    aggregate.update('\n')
    totalBytes += Number(entry.size)
  }
  if (totalBytes !== value.totalBytes) {
    throw new Error(`${label}.totalBytes does not match files`)
  }
  if (aggregate.digest('hex') !== value.treeSha256) {
    throw new Error(`${label}.treeSha256 does not match files`)
  }
}

function validateProvenance(value: unknown): void {
  if (!isRecord(value)) throw new Error('manifest.provenance must be an object')
  if (typeof value.gateRan !== 'boolean') {
    throw new Error('manifest.provenance.gateRan must be a boolean')
  }
  if (!isRecord(value.skipCheck)) {
    throw new Error('manifest.provenance.skipCheck must be an object')
  }
  if (typeof value.skipCheck.requested !== 'boolean') {
    throw new Error('manifest.provenance.skipCheck.requested must be a boolean')
  }
  const sources: readonly WindowsNsisAbSkipCheckSource[] = [
    'none',
    '--skip-check',
    'DSH_PACKAGE_CHECK_ALREADY_RAN',
    '--skip-check + DSH_PACKAGE_CHECK_ALREADY_RAN',
  ]
  if (!sources.includes(value.skipCheck.source as WindowsNsisAbSkipCheckSource)) {
    throw new Error('manifest.provenance.skipCheck.source is unsupported')
  }
  const skipped = value.skipCheck.source !== 'none'
  if (value.skipCheck.requested !== skipped || value.gateRan === skipped) {
    throw new Error('manifest.provenance gate and skip-check state are inconsistent')
  }
  if (!isRecord(value.signing)
      || value.signing.state !== 'unsigned'
      || value.signing.signExecutable !== false
      || value.signing.cscIdentityAutoDiscovery !== false
      || value.signing.signingSecretsRemoved !== true) {
    throw new Error('manifest.provenance.signing must describe the credential-free unsigned build')
  }
}

/** Read and validate a generated A/B manifest. */
export function readWindowsNsisAbManifest(path: string): WindowsNsisAbManifest {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(value) || value.schemaVersion !== WINDOWS_NSIS_AB_SCHEMA_VERSION) {
    throw new Error(`unsupported Windows NSIS A/B manifest: ${path}`)
  }
  requireString(value, 'createdAt', 'manifest')
  requireString(value, 'appVersion', 'manifest')
  if (value.electronBuilderVersion !== WINDOWS_NSIS_AB_BUILDER_VERSION) {
    throw new Error(`Windows NSIS A/B manifest does not use electron-builder ${WINDOWS_NSIS_AB_BUILDER_VERSION}`)
  }
  validateProvenance(value.provenance)
  if (!isRecord(value.application)) throw new Error('manifest.application must be an object')
  const applicationDirectory = requireString(value.application, 'directory', 'manifest.application')
  if (normalizeWindowsNsisAbRelativePath(applicationDirectory) !== applicationDirectory) {
    throw new Error('manifest.application.directory must be a normalized manifest-relative path')
  }
  validateTree(value.application.tree, 'manifest.application.tree')
  validateTree(value.application.resources, 'manifest.application.resources')
  validateArtifact(value.application.appAsar, 'manifest.application.appAsar')
  if (value.application.unpacked !== null) {
    validateTree(value.application.unpacked, 'manifest.application.unpacked')
  }
  if (!isRecord(value.variants)) throw new Error('manifest.variants must be an object')
  if (!isRecord(value.variants.direct)
      || value.variants.direct.extraction !== 'patched-direct-extract'
      || value.variants.direct.builder !== 'workspace-resolution') {
    throw new Error('manifest.variants.direct has an unexpected builder identity')
  }
  validateArtifact(value.variants.direct.installer, 'manifest.variants.direct.installer')
  if (!isRecord(value.variants.staged)
      || value.variants.staged.extraction !== 'electron-builder-default-staged-copy'
      || value.variants.staged.builder !== 'isolated-single-hunk-reversal') {
    throw new Error('manifest.variants.staged has an unexpected builder identity')
  }
  if (!/^[a-f\d]{64}$/u.test(requireString(
    value.variants.staged,
    'extractTemplateSha256',
    'manifest.variants.staged',
  ))) {
    throw new Error('manifest.variants.staged.extractTemplateSha256 must be a lowercase SHA-256 digest')
  }
  validateArtifact(value.variants.staged.installer, 'manifest.variants.staged.installer')
  return value as unknown as WindowsNsisAbManifest
}

/** Resolve a manifest-owned relative path without allowing traversal. */
export function resolveWindowsNsisAbPath(manifestPath: string, path: string): string {
  const root = resolve(dirname(manifestPath))
  const target = resolve(root, path)
  const relation = relative(root, target)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Windows NSIS A/B path escapes its manifest: ${path}`)
  }
  return target
}
