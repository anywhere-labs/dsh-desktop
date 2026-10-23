/** Relocatable, integrity-recorded production payload carried by one Next release. */

import { createHash } from 'node:crypto'
import { closeSync, createReadStream, lstatSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Descriptor sealed at the payload root; a packaged application carries it inside `app.asar`. */
export const DESKTOP_RUNTIME_FILE = 'desktop-runtime.json'

/** Release facts shared by one Electron shell and the dsh runtime it carries. */
export interface NextRelease {
  readonly schemaVersion: 1
  /** Exact Next product version Electron reports. */
  readonly version: string
  /** Exact `@deepseek-ai/dsh` version the payload carries. */
  readonly dshVersion: string
  /** Electron release whose Node mode runs the Host and every package operation. */
  readonly electronVersion: string
  /** Bundled pnpm version used for Profile package operations. */
  readonly pnpmVersion: string
}

/** Platform and CPU architectures whose native dependencies the payload includes. */
export interface NextRuntimeTarget {
  readonly platform: NodeJS.Platform
  readonly archs: readonly string[]
}

/** Release-owned package that Profiles resolve through the Next installation anchor. */
export interface DesktopSharedPackage {
  readonly name: string
  readonly version: string
  readonly path: string
}

/** Final bytes, executable permission and Mach-O identity of one payload file, wherever the archive places it. */
export interface DesktopRuntimeFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly executable: boolean
  /** Mach-O image; macOS code signing rewrites these after the descriptor is sealed. */
  readonly machO: boolean
}

/** One packaged application's production payload. */
export interface DesktopRuntimeDescriptor {
  readonly schemaVersion: 1
  readonly release: NextRelease
  readonly platform: NodeJS.Platform
  readonly archs: readonly string[]
  readonly sharedPackages: readonly DesktopSharedPackage[]
  readonly files: readonly DesktopRuntimeFile[]
}

/** One payload file as the shipped application sees it, in archive or physical form. */
export interface PayloadEntry {
  /** Slash-separated path from the application root. */
  readonly path: string
  readonly unpacked: boolean
  readonly executable: boolean
  /** Final bytes. */
  read(): Buffer
  /** Stream final bytes for bounded-memory asynchronous inventory, when available. */
  readChunks?(): AsyncIterable<Buffer>
  /** Read at most the leading `bytes` of the entry without loading the entire file. */
  readHeader?(bytes: number): Buffer
}

/** A complete payload: an unpacked directory, or an archive with its unpacked sibling. */
export interface PayloadSource {
  /** Every file, sorted by path, without the descriptor. */
  list(): readonly PayloadEntry[]
  /** One file by its slash-separated path. */
  entry(path: string): PayloadEntry | undefined
}

/** Facts the running application compares with its sealed descriptor. */
export interface PackagedRuntimeIdentity {
  readonly version: string
  readonly dshVersion: string
  readonly platform: NodeJS.Platform
  readonly arch: string
}

/** Verification options after Electron Builder signed the payload in place. */
export interface VerifyPayloadOptions {
  /**
   * Accept code-signing rewrites: Mach-O files and `_CodeSignature` contents may differ from the
   * sealed bytes, and new files may exist. Every recorded file must still exist with its permission.
   */
  readonly afterCodeSigning?: boolean
  /**
   * Accept a recorded file whose shipped bytes differ when this returns true for the record and
   * the shipped bytes. Build steps use it for rewrites they can prove equivalent, such as the
   * `Info.plist` files a universal merge re-serializes. Missing and unexpected files are never
   * rewrites.
   */
  readonly acceptRewrite?: (file: DesktopRuntimeFile, shipped: Buffer) => boolean
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
/** Thin and fat Mach-O magic numbers in both byte orders. */
const MACH_O_MAGIC = new Set([0xFEEDFACE, 0xFEEDFACF, 0xCEFAEDFE, 0xCFFAEDFE, 0xCAFEBABE, 0xBEBAFECA])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byPath<T extends { readonly path: string }>(a: T, b: T): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

/**
 * Resolve one portable resource path without permitting traversal or absolute paths.
 * @param root - Runtime root.
 * @param path - Slash-separated relative path from durable metadata.
 * @returns Absolute resource path.
 */
export function runtimePath(root: string, path: string): string {
  if (path === '' || isAbsolute(path) || path.includes('\\') || path.includes(':')
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`desktop runtime: invalid relative path ${JSON.stringify(path)}`)
  }
  return join(root, ...path.split('/'))
}

/**
 * An unpacked application directory, as a development tree or a test fixture presents it.
 * @param root - Application directory.
 * @param omit - Root-relative files left out of the inventory; the descriptor itself by default.
 * @returns Payload whose entries are all physical.
 */
export function physicalPayload(root: string, omit: readonly string[] = [DESKTOP_RUNTIME_FILE]): PayloadSource {
  const entries = new Map<string, PayloadEntry>()
  const visit = (directory: string): void => {
    for (const dirent of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, dirent.name)
      const name = relative(root, path).split(sep).join('/')
      if (omit.includes(name)) continue
      if (dirent.isDirectory()) visit(path)
      else if (dirent.isFile()) {
        entries.set(name, { path: name, unpacked: false,
          // Windows has no portable Unix executable permission bits.
          executable: process.platform !== 'win32' && (lstatSync(path).mode & 0o111) !== 0,
          read: () => readFileSync(path),
          readChunks: () => createReadStream(path),
          readHeader: (bytes) => {
            const fd = openSync(path, 'r')
            try {
              const buffer = Buffer.alloc(bytes)
              return buffer.subarray(0, readSync(fd, buffer, 0, bytes, 0))
            } finally {
              closeSync(fd)
            }
          } })
      } else throw new Error(`desktop runtime: unsupported filesystem entry ${name}`)
    }
  }
  visit(root)
  const list = [...entries.values()].sort(byPath)
  return { list: () => list, entry: path => entries.get(path) }
}

function isMachO(body: Buffer): boolean {
  return body.byteLength >= 4 && MACH_O_MAGIC.has(body.readUInt32BE(0))
}

function runtimeFile(entry: PayloadEntry, body: Buffer): DesktopRuntimeFile {
  return { path: entry.path, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'),
    executable: entry.executable, machO: isMachO(body) }
}

/**
 * Inventory a payload: every file's final bytes and permissions.
 * @param source - Payload to read completely.
 * @returns Sorted inventory; executable permissions are false on Windows.
 */
export function inventoryPayload(source: PayloadSource): DesktopRuntimeFile[] {
  return source.list().map(entry => runtimeFile(entry, entry.read()))
}

async function runtimeFileAsync(entry: PayloadEntry): Promise<DesktopRuntimeFile> {
  if (entry.readChunks === undefined) return runtimeFile(entry, entry.read())
  const hash = createHash('sha256')
  let bytes = 0
  let header = Buffer.alloc(0)
  for await (const chunk of entry.readChunks()) {
    if (header.length < 4) header = Buffer.concat([header, chunk.subarray(0, 4 - header.length)])
    bytes += chunk.byteLength
    hash.update(chunk)
  }
  return { path: entry.path, bytes, sha256: hash.digest('hex'), executable: entry.executable, machO: isMachO(header) }
}

/**
 * Inventory every byte with a bounded number of readers, preserving the source's sorted order.
 * Physical files stream through SHA-256 so large native binaries do not accumulate in memory.
 * @param source - Complete payload to hash.
 * @param concurrency - Number of readers, from 1 to 32; eight by default.
 * @returns The same inventory as the synchronous path, independent of completion order.
 */
export async function inventoryPayloadAsync(source: PayloadSource, concurrency = 8): Promise<DesktopRuntimeFile[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('desktop runtime: hash concurrency must be an integer from 1 to 32')
  const entries = source.list()
  const files = new Array<DesktopRuntimeFile>(entries.length)
  let cursor = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && cursor < entries.length) {
      const index = cursor++
      try { files[index] = await runtimeFileAsync(entries[index]!) }
      catch (error) { failed = true; throw error }
    }
  }
  // Drain readers on failure before returning control to callers that may remove the tree.
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
  for (const result of results) if (result.status === 'rejected') throw result.reason
  return files
}

/**
 * Validate release facts read from a packaged or generated descriptor.
 * @param value - Parsed `release` field.
 * @returns The release facts.
 */
export function parseNextRelease(value: unknown): NextRelease {
  if (!record(value) || value.schemaVersion !== 1) throw new Error('desktop runtime: unsupported release schema')
  for (const field of ['version', 'dshVersion', 'electronVersion', 'pnpmVersion'] as const) {
    if (typeof value[field] !== 'string' || !VERSION.test(value[field])) throw new Error(`desktop runtime: invalid release ${field}`)
  }
  return { schemaVersion: 1, version: value.version as string, dshVersion: value.dshVersion as string,
    electronVersion: value.electronVersion as string, pnpmVersion: value.pnpmVersion as string }
}

function parseTarget(platform: unknown, archs: unknown): NextRuntimeTarget {
  if (typeof platform !== 'string' || platform === '' || !Array.isArray(archs) || archs.length === 0
    || archs.some(arch => typeof arch !== 'string' || arch === '')) throw new Error('desktop runtime: invalid target')
  const unique = [...new Set(archs as string[])].sort()
  if (unique.length !== archs.length) throw new Error('desktop runtime: duplicate target architecture')
  return { platform: platform as NodeJS.Platform, archs: unique }
}

function readManifest(source: PayloadSource, path: string): unknown {
  const entry = source.entry(path)
  if (entry === undefined) throw new Error(`desktop runtime: missing ${path}`)
  return JSON.parse(entry.read().toString('utf8'))
}

/**
 * Validate the release, target and release-owned package metadata before inventorying files.
 * @param source - Complete payload.
 * @param release - Matching shell, dsh, Electron and pnpm versions.
 * @param sharedNames - Release-owned packages supplied to Profiles.
 * @param target - Platform and architectures whose native dependencies the payload includes.
 * @returns Descriptor fields shared by both inventory paths.
 */
function payloadMetadata(source: PayloadSource, release: NextRelease, sharedNames: readonly string[], target: NextRuntimeTarget): Omit<DesktopRuntimeDescriptor, 'files'> {
  const { platform, archs } = parseTarget(target.platform, target.archs)
  const sharedPackages = [...new Set(sharedNames)].sort().map((name) => {
    if (!PACKAGE_NAME.test(name)) throw new Error(`desktop runtime: invalid shared package ${name}`)
    const path = `node_modules/${name}`
    const manifest = readManifest(source, `${path}/package.json`)
    if (!record(manifest) || manifest.name !== name || typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) {
      throw new Error(`desktop runtime: invalid shared package manifest ${name}`)
    }
    return { name, version: manifest.version, path }
  })
  return { schemaVersion: 1, release: parseNextRelease(release), platform, archs, sharedPackages }
}

function writeDescriptor(descriptorFile: string, descriptor: DesktopRuntimeDescriptor): DesktopRuntimeDescriptor {
  writeFileSync(descriptorFile, `${JSON.stringify(descriptor, undefined, 2)}\n`)
  return descriptor
}

/**
 * Seal the complete payload synchronously; fixture and archive callers keep this API.
 * @param source - Complete payload.
 * @param descriptorFile - Output descriptor, excluded from the inventory.
 * @param release - Shell and runtime versions.
 * @param sharedNames - Packages supplied to Profiles.
 * @param target - Release platform and architectures.
 * @returns The written descriptor.
 */
export function sealPayload(
  source: PayloadSource, descriptorFile: string, release: NextRelease, sharedNames: readonly string[], target: NextRuntimeTarget,
): DesktopRuntimeDescriptor {
  return writeDescriptor(descriptorFile, { ...payloadMetadata(source, release, sharedNames, target), files: inventoryPayload(source) })
}

/**
 * Seal a prepared payload using bounded asynchronous readers and unchanged descriptor bytes.
 * Nothing is written until every file has been hashed successfully.
 * @param source - Complete physical payload.
 * @param descriptorFile - Output descriptor, excluded from the inventory.
 * @param release - Shell and runtime versions.
 * @param sharedNames - Packages supplied to Profiles.
 * @param target - Release platform and architectures.
 * @param concurrency - Number of hash readers, eight by default.
 * @returns The written descriptor.
 */
export async function sealPayloadAsync(
  source: PayloadSource, descriptorFile: string, release: NextRelease, sharedNames: readonly string[], target: NextRuntimeTarget, concurrency = 8,
): Promise<DesktopRuntimeDescriptor> {
  const metadata = payloadMetadata(source, release, sharedNames, target)
  const files = await inventoryPayloadAsync(source, concurrency)
  return writeDescriptor(descriptorFile, { ...metadata, files })
}

/**
 * Validate packaged metadata and check the shared package records.
 * @param value - Parsed descriptor document.
 * @returns Runtime metadata whose file inventory is verified only during packaging.
 */
export function parseDesktopRuntime(value: unknown): DesktopRuntimeDescriptor {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.sharedPackages) || !Array.isArray(value.files)) {
    throw new Error('desktop runtime: invalid descriptor')
  }
  const release = parseNextRelease(value.release)
  const { platform, archs } = parseTarget(value.platform, value.archs)
  const sharedPackages = value.sharedPackages.map((entry: unknown): DesktopSharedPackage => {
    if (!record(entry) || typeof entry.name !== 'string' || !PACKAGE_NAME.test(entry.name)
      || typeof entry.version !== 'string' || !VERSION.test(entry.version) || entry.path !== `node_modules/${entry.name}`) {
      throw new Error('desktop runtime: invalid shared package record')
    }
    return { name: entry.name, version: entry.version, path: entry.path }
  })
  if (new Set(sharedPackages.map(entry => entry.name)).size !== sharedPackages.length) {
    throw new Error('desktop runtime: duplicate shared package')
  }
  if (sharedPackages.find(entry => entry.name === '@deepseek-ai/dsh')?.version !== release.dshVersion) {
    throw new Error('desktop runtime: missing or mismatched @deepseek-ai/dsh')
  }
  return { schemaVersion: 1, release, platform, archs, sharedPackages, files: value.files as DesktopRuntimeFile[] }
}

/**
 * Read packaged metadata from the descriptor file and check the shared package records.
 * @param descriptorFile - Descriptor at the application root; inside Electron, `app.asar` reads like a directory.
 * @returns Runtime metadata whose file inventory is verified only during packaging.
 */
export function readDesktopRuntime(descriptorFile: string): DesktopRuntimeDescriptor {
  return parseDesktopRuntime(JSON.parse(readFileSync(descriptorFile, 'utf8')))
}

/** Whether a recorded path belongs to a nested code-signature directory that signing rewrites. */
function isCodeSignatureEntry(path: string): boolean {
  return path.split('/').includes('_CodeSignature')
}

/**
 * Verify every payload file against its recorded bytes and permissions at build time.
 * @param source - Prepared or assembled payload.
 * @param descriptor - Descriptor sealed by {@link sealPayload}, or the file holding it.
 * @param expectedVersion - Version the payload must declare: the product version, or the
 * `DSH_BETA_BUILD_VERSION` a drill build was given.
 * @param target - Required platform and architectures.
 * @param options - Code-signing tolerance for a payload that Electron Builder already signed.
 * @returns Validated runtime descriptor.
 */
export function verifyPayload(
  source: PayloadSource, descriptor: DesktopRuntimeDescriptor | string, expectedVersion: string, target: NextRuntimeTarget, options: VerifyPayloadOptions = {},
): DesktopRuntimeDescriptor {
  if (typeof descriptor === 'string') descriptor = readDesktopRuntime(descriptor)
  const expected = parseTarget(target.platform, target.archs)
  if (descriptor.platform !== expected.platform || descriptor.archs.join(',') !== expected.archs.join(',')) {
    throw new Error('desktop runtime: incompatible platform/architecture')
  }
  if (descriptor.release.version !== expectedVersion) {
    throw new Error(`desktop runtime: bundled ${descriptor.release.version} is not the expected ${expectedVersion}`)
  }
  for (const entry of descriptor.sharedPackages) {
    const manifest = readManifest(source, `${entry.path}/package.json`)
    if (!record(manifest) || manifest.name !== entry.name || manifest.version !== entry.version) {
      throw new Error(`desktop runtime: shared package metadata mismatch for ${entry.name}`)
    }
  }
  // Windows has no portable Unix executable permission bits.
  if (options.afterCodeSigning === true) {
    for (const file of descriptor.files) {
      const entry = source.entry(file.path)
      if (entry === undefined) throw new Error(`desktop runtime: missing payload file ${file.path}`)
      if (process.platform !== 'win32' && entry.executable !== file.executable) throw new Error(`desktop runtime: permission changed for ${file.path}`)
      if (file.machO || isCodeSignatureEntry(file.path)) continue
      const body = entry.read()
      const actual = runtimeFile(entry, body)
      if (actual.bytes === file.bytes && actual.sha256 === file.sha256) continue
      if (options.acceptRewrite?.(file, body) !== true) throw new Error(`desktop runtime: payload file changed ${file.path}`)
    }
    return descriptor
  }
  // Every recorded file, byte for byte, and nothing else; the failure names the first difference.
  const fail = (detail: string): never => { throw new Error(`desktop runtime: integrity verification failed: ${detail}`) }
  const recorded = new Set(descriptor.files.map(file => file.path))
  for (const entry of source.list()) if (!recorded.has(entry.path)) fail(`unexpected ${entry.path}`)
  for (const file of descriptor.files) {
    const entry = source.entry(file.path)
    if (entry === undefined) return fail(`missing ${file.path}`)
    if (process.platform !== 'win32' && entry.executable !== file.executable) return fail(`permission changed for ${file.path}`)
    const body = entry.read()
    const actual = runtimeFile(entry, body)
    if (actual.bytes === file.bytes && actual.sha256 === file.sha256 && actual.machO === file.machO) continue
    if (options.acceptRewrite?.(file, body) !== true) return fail(`changed ${file.path}`)
  }
  return descriptor
}

/**
 * Read the version of one package installed at the application root.
 * @param appRoot - Application directory; inside Electron, `app.asar` reads like a directory.
 * @param name - Package name.
 * @returns The installed version.
 */
export function readInstalledPackageVersion(appRoot: string, name: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(runtimePath(appRoot, `node_modules/${name}`), 'package.json'), 'utf8'))
  if (!record(manifest) || typeof manifest.version !== 'string') throw new Error(`desktop runtime: ${name} has no version`)
  return manifest.version
}

/**
 * Check at startup that the installed payload is the one this application was released with.
 * File bytes are verified only during packaging; here the descriptor must exist, parse, and
 * name the running shell, dsh runtime, platform and architecture.
 * @param descriptorFile - Descriptor at the application root; inside Electron, `app.asar` reads like a directory.
 * @param identity - Facts of the running application.
 * @returns The sealed descriptor.
 */
export function verifyPackagedRuntimeIdentity(descriptorFile: string, identity: PackagedRuntimeIdentity): DesktopRuntimeDescriptor {
  const descriptor = readDesktopRuntime(descriptorFile)
  if (descriptor.release.version !== identity.version) {
    throw new Error(`desktop runtime: payload ${descriptor.release.version} does not belong to DSH Desktop Beta ${identity.version}`)
  }
  if (descriptor.release.dshVersion !== identity.dshVersion) {
    throw new Error(`desktop runtime: payload declares dsh ${descriptor.release.dshVersion} but ${identity.dshVersion} is installed`)
  }
  if (descriptor.platform !== identity.platform || !descriptor.archs.includes(identity.arch)) {
    throw new Error(`desktop runtime: payload for ${descriptor.platform} ${descriptor.archs.join('/')} cannot run on ${identity.platform} ${identity.arch}`)
  }
  return descriptor
}
