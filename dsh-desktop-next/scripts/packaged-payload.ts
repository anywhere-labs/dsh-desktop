/** Read, audit and verify the archived Next payload after Electron Builder assembled it from the prepared tree. */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { basename as posixBasename, dirname as posixDirname } from 'node:path/posix'
import { getRawHeader } from '@electron/asar'
import { nextRuntimeFileExclusion, type NextPackagingTarget } from './runtime-file-policy.ts'
import { DESKTOP_RUNTIME_FILE, parseDesktopRuntime, verifyPayload, type DesktopRuntimeDescriptor, type DesktopRuntimeFile, type NextRelease, type PayloadEntry, type PayloadSource, type VerifyPayloadOptions } from '../src/runtime-tree.ts'

/** Application-relative directory holding the prepared payload that Electron Builder archives verbatim. */
export const PAYLOAD_DIR = '.desktop-build/payload'

/**
 * Architectures whose native dependencies one Next package carries.
 * macOS releases are universal and the Yarn tree installs both Darwin CPU variants, so even a
 * single-architecture directory build ships both; Windows releases are x64 only.
 * @param platform - Electron platform being packaged.
 * @param hostArch - Build host architecture, used for platforms without a release target.
 * @returns Platform and architectures recorded in the payload descriptor.
 */
export function nextPackagingTarget(platform: NodeJS.Platform, hostArch: string = process.arch): NextPackagingTarget {
  if (platform === 'darwin') return { platform, archs: ['arm64', 'x64'] }
  if (platform === 'win32') return { platform, archs: ['x64'] }
  return { platform, archs: [hostArch] }
}

interface AsarFile { readonly size: number; readonly offset?: string; readonly executable?: boolean; readonly unpacked?: boolean }
interface AsarDirectory { readonly files: Readonly<Record<string, AsarDirectory | AsarFile | { readonly link: string }>> }

/** The archive and its unpacked sibling; `close` releases the archive file descriptor. */
export interface ArchivedPayload extends PayloadSource {
  readonly archive: string
  /** The descriptor the archive carries at its root. */
  descriptor(): DesktopRuntimeDescriptor
  close(): void
}

/**
 * Open `app.asar` and `app.asar.unpacked` as one payload. Archive entries are read from their
 * recorded offsets; unpacked entries are the physical files Electron Builder placed beside the
 * archive. The descriptor entry is readable but, as in a prepared tree, outside the inventory.
 * @param resourcesDir - Application resources directory containing `app.asar`.
 * @returns The payload; call `close` when done.
 */
export function archivedPayload(resourcesDir: string): ArchivedPayload {
  const archive = join(resourcesDir, 'app.asar')
  const unpackedRoot = `${archive}.unpacked`
  const { header, headerSize } = getRawHeader(archive) as { header: AsarDirectory; headerSize: number }
  const dataOffset = 8 + headerSize
  let fd: number | undefined
  const descriptor = (): number => fd ??= openSync(archive, 'r')
  const entries = new Map<string, PayloadEntry>()
  const visit = (directory: AsarDirectory, prefix: string): void => {
    for (const [name, node] of Object.entries(directory.files)) {
      const path = prefix === '' ? name : `${prefix}/${name}`
      if ('files' in node) { visit(node, path); continue }
      if ('link' in node) throw new Error(`Next payload: unexpected archive link ${path}`)
      if (node.unpacked === true) {
        const physical = join(unpackedRoot, ...path.split('/'))
        const stat = lstatSync(physical, { throwIfNoEntry: false })
        if (stat === undefined || !stat.isFile()) throw new Error(`Next payload: unpacked entry ${path} has no physical file`)
        entries.set(path, { path, unpacked: true, executable: process.platform !== 'win32' && (stat.mode & 0o111) !== 0,
          read: () => readFileSync(physical) })
        continue
      }
      const { size } = node
      const offset = Number(node.offset)
      entries.set(path, { path, unpacked: false, executable: node.executable === true, read: () => {
        const buffer = Buffer.alloc(size)
        let done = 0
        while (done < size) {
          const read = readSync(descriptor(), buffer, done, size - done, dataOffset + offset + done)
          if (read === 0) throw new Error(`Next payload: truncated archive entry ${path}`)
          done += read
        }
        return buffer
      } })
    }
  }
  visit(header, '')
  const list = [...entries.values()].filter(entry => entry.path !== DESKTOP_RUNTIME_FILE).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return {
    archive, list: () => list, entry: path => entries.get(path),
    descriptor: () => {
      const entry = entries.get(DESKTOP_RUNTIME_FILE)
      if (entry === undefined) throw new Error(`Next payload: ${DESKTOP_RUNTIME_FILE} is missing from the archive`)
      return parseDesktopRuntime(JSON.parse(entry.read().toString('utf8')))
    },
    close: () => { if (fd !== undefined) { closeSync(fd); fd = undefined } },
  }
}

/**
 * Resources-relative path of the manifest copy the updaters shipped in 2.0.14-next through
 * 2.0.17-next read. Those updaters verify a downloaded disk image by reading the application
 * manifest at its pre-archive location, `Contents/Resources/app/package.json`, and reject the
 * image when it is missing (`src/update-installer.ts`). Archived releases keep a byte-for-byte
 * copy of the archived manifest there as an extra resource so every shipped updater accepts them.
 */
export const UPDATER_MANIFEST_SHIM = 'app/package.json'

/** Largest manifest those updaters accept. */
export const UPDATER_MANIFEST_SHIM_MAX_BYTES = 128 * 1024

/**
 * Check the manifest copy beside the archive. On macOS it must exist as the only entry of
 * `Resources/app`, be a regular file within the size those updaters accept, match the archived
 * manifest byte for byte and name this release. The other platforms must ship no `app` directory:
 * nothing reads one there. Electron loads `app.asar` before `app`, so the copy cannot change which
 * application a launch loads.
 * @param resourcesDir - Application resources directory containing `app.asar`.
 * @param source - Assembled payload the copy must match.
 * @param platform - Electron platform being packaged.
 * @param expectedVersion - Version the manifest must declare.
 */
export function verifyUpdaterManifestShim(resourcesDir: string, source: PayloadSource, platform: NodeJS.Platform, expectedVersion: string): void {
  const directory = join(resourcesDir, 'app')
  const directoryStat = lstatSync(directory, { throwIfNoEntry: false })
  if (platform !== 'darwin') {
    if (directoryStat !== undefined) throw new Error('Next must not ship an unpacked application directory beside app.asar')
    return
  }
  if (directoryStat === undefined || !directoryStat.isDirectory()) {
    throw new Error(`Next must ship ${UPDATER_MANIFEST_SHIM} beside app.asar: the updaters of releases before the archive read the manifest there`)
  }
  const entries = readdirSync(directory)
  if (entries.length !== 1 || entries[0] !== 'package.json') {
    throw new Error(`Resources/app may hold only package.json for earlier updaters; found ${entries.length === 0 ? 'nothing' : entries.join(', ')}`)
  }
  const shim = join(resourcesDir, ...UPDATER_MANIFEST_SHIM.split('/'))
  const stat = lstatSync(shim)
  if (!stat.isFile()) throw new Error(`${UPDATER_MANIFEST_SHIM} must be a regular file`)
  if (stat.size > UPDATER_MANIFEST_SHIM_MAX_BYTES) {
    throw new Error(`${UPDATER_MANIFEST_SHIM} exceeds the ${String(UPDATER_MANIFEST_SHIM_MAX_BYTES)} bytes earlier updaters accept`)
  }
  const archived = source.entry('package.json')
  if (archived === undefined) throw new Error('Next payload: the archive carries no application manifest')
  const shipped = readFileSync(shim)
  if (!shipped.equals(archived.read())) throw new Error(`${UPDATER_MANIFEST_SHIM} differs from the archived application manifest`)
  const manifest = JSON.parse(shipped.toString('utf8')) as { name?: unknown; version?: unknown }
  if (manifest.name !== 'dsh-desktop-next' || manifest.version !== expectedVersion) {
    throw new Error(`${UPDATER_MANIFEST_SHIM} names ${String(manifest.name)} ${String(manifest.version)}, not dsh-desktop-next ${expectedVersion}`)
  }
}

/** Mach-O and ELF magic numbers; PE starts with `MZ`. */
const NATIVE_MAGIC = new Set([0xFEEDFACE, 0xFEEDFACF, 0xCEFAEDFE, 0xCFFAEDFE, 0xCAFEBABE, 0xBEBAFECA, 0x7F454C46])

function isNativeImage(head: Buffer): boolean {
  return head.length >= 4 && (NATIVE_MAGIC.has(head.readUInt32BE(0)) || (head[0] === 0x4D && head[1] === 0x5A))
}

/**
 * Entries another program opens by path: the shell runs the Node shims, the tray and window
 * read icons through `nativeImage`, pnpm starts as its own process with workers, and uv runs
 * the Connector project. All of them need physical files.
 */
const REQUIRED_UNPACKED = [
  /^scripts\/node-bin\//u, /^assets\//u, /^build\//u, /^node_modules\/pnpm\//u,
  /^node_modules\/@agents-anywhere\/dsh-bridge-next\/lib\/bundled-connector\//u,
  // The Creator preset mounts this package's skills through the Host's filesystem service, which stats with bigint
  // and gets plain-number stats for archived entries; the Host resolves the package manifest to this copy.
  /^node_modules\/@deepseek-ai\/dsh-agent-preset\//u,
  // The badge skill announces its `assets/` directory to the model as where to take `dsh-badge.png` from; shells and
  // the Host's filesystem service read no archive, and the Host resolves the package to this copy.
  /^node_modules\/@deepseek-ai\/dsh-skill-badge\//u,
  // The computer-use driver resolves its platform package's manifest and hands the library beside it to the system
  // loader; the Host resolves that package to this copy.
  /^node_modules\/@trycua\/cua-driver-/u,
  // The Office CLI and its direct dependencies run under the bundled standalone Node, which reads no archive;
  // beforePack unpacks the complete closure, and these guard its roots.
  /^node_modules\/@deepseek-ai\/libreoffice-kit\//u, /^node_modules\/(?:fflate|fontkit|koffi|saxes)\//u,
] as const

/** The only entries the prepared payload places at its root. */
const ALLOWED_ROOT_ENTRIES = new Set(['assets', 'build', 'cordis.patch.yml', DESKTOP_RUNTIME_FILE, 'host.cordis.patch.yml', 'lib', 'node_modules', 'package.json', 'scripts'])

/**
 * Audit an assembled payload: only the declared root entries may exist, nothing the Desktop file
 * policy omits may be present, and native code and shell-executed files must be unpacked, because
 * Electron's archive view serves only its own `fs` and `dlopen`, not child processes.
 * @param source - Assembled payload.
 * @param target - Platform and architectures of the package.
 * @returns Problems, one line each; empty when the payload passes.
 */
export function auditNextPayload(source: PayloadSource, target: NextPackagingTarget): string[] {
  const problems: string[] = []
  const strayRoots = new Set<string>()
  for (const entry of source.list()) {
    const root = entry.path.split('/')[0] ?? ''
    if (!ALLOWED_ROOT_ENTRIES.has(root)) { strayRoots.add(root); continue }
    if (entry.path.startsWith('node_modules/')) {
      const reason = nextRuntimeFileExclusion(entry.path.slice('node_modules/'.length), target)
      if (reason !== undefined) problems.push(`${entry.path}: ${reason} must not be packaged`)
    }
    if (entry.unpacked) continue
    if (REQUIRED_UNPACKED.some(pattern => pattern.test(entry.path))) problems.push(`${entry.path}: must be unpacked beside app.asar`)
    else if (isNativeImage(entry.read().subarray(0, 4))) problems.push(`${entry.path}: native code is packed inside app.asar`)
  }
  return [...[...strayRoots].sort().map(root => `${root}: outside the declared application files`), ...problems]
}

/**
 * Check the payload is complete and resolvable: the files the shell and Host open by name, and the
 * dependency closure every packaged manifest declares.
 * @param source - Assembled payload.
 */
export function verifyNextPayload(source: PayloadSource): void {
  // `host.cordis.patch.yml` and `scripts/node-bin` are read from the packaged application by the
  // Host: the overlay swaps the official webserver for Next's private loopback one, and the shims
  // put a `node` on the package manager's PATH. Both are invisible to a `yarn start` run, which
  // resolves them in the source tree, so only this check keeps them in the payload.
  for (const path of ['lib/main.js', 'lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-shell.cjs',
    'lib/native-ui/index.html', 'cordis.patch.yml', 'host.cordis.patch.yml',
    'scripts/node-bin/node', 'scripts/node-bin/node.cmd',
    'assets/tray-iconTemplate.png', 'assets/tray-icon-blue.png']) {
    if (source.entry(path) === undefined) throw new Error(`Missing Next payload: ${path}`)
  }
  const queued = ['package.json']
  const visited = new Set<string>()
  while (queued.length) {
    const manifestPath = queued.pop()!
    if (visited.has(manifestPath)) continue
    visited.add(manifestPath)
    const data = JSON.parse(source.entry(manifestPath)!.read().toString('utf8')) as {
      name?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>; optionalDependencies?: Record<string, string>
    }
    // Required peers are runtime edges too: a plugin whose peer is absent throws on import and the
    // Host reports it as an entry that did not activate, long after packaging reported success.
    // They are the packages most easily missed, because the workspace resolves them from the
    // repository root even when this application never declares them.
    const optionalPeers = data.peerDependenciesMeta ?? {}
    const required = [...Object.keys(data.dependencies ?? {}),
      ...Object.keys(data.peerDependencies ?? {}).filter(name => optionalPeers[name]?.optional !== true)]
    for (const name of required) {
      let parent = posixDirname(manifestPath)
      let found: string | undefined
      while (true) {
        const candidate = `${parent === '.' ? '' : `${parent}/`}node_modules/${name}/package.json`
        if (source.entry(candidate) !== undefined) { found = candidate; break }
        if (parent === '.') break
        parent = posixDirname(parent)
      }
      if (found === undefined) {
        if (Object.hasOwn(data.optionalDependencies ?? {}, name)) continue
        throw new Error(`Missing packaged dependency ${name} required by ${String(data.name)}`)
      }
      queued.push(found)
    }
  }
  if (source.entry('node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html') === undefined) throw new Error('Official Web frontend was not packaged')
}

function manifestVersion(source: PayloadSource, path: string, subject: string): string {
  const entry = source.entry(path)
  if (entry === undefined) throw new Error(`Next payload: ${subject} is missing`)
  const manifest = JSON.parse(entry.read().toString('utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error(`Next payload: ${subject} has no version`)
  return manifest.version
}

/**
 * Release facts of one assembled payload.
 * @param source - Assembled payload.
 * @param electronVersion - Electron release the package embeds.
 * @returns Shell, dsh, Electron and pnpm versions the descriptor records.
 */
export function nextPayloadRelease(source: PayloadSource, electronVersion: string): NextRelease {
  return {
    schemaVersion: 1,
    // electron-builder merges extraMetadata before archiving, so this is the version Electron reports.
    version: manifestVersion(source, 'package.json', 'the packaged manifest'),
    dshVersion: manifestVersion(source, 'node_modules/@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh'),
    electronVersion,
    pnpmVersion: manifestVersion(source, 'node_modules/pnpm/package.json', 'pnpm'),
  }
}

/** Rewrites a verification accepted, for the build log. */
export interface MergeRewriteTolerance {
  readonly accept: (file: DesktopRuntimeFile, shipped: Buffer) => boolean
  /** Paths accepted so far, in verification order. */
  readonly accepted: readonly string[]
}

interface PlistParser { parse(xml: string): unknown }

// The parser @electron/universal itself writes the merged plists with.
const plistParser = (): PlistParser => createRequire(createRequire(import.meta.url).resolve('@electron/universal/package.json'))('plist') as PlistParser

/**
 * The one rewrite a universal macOS build makes inside the payload: @electron/universal parses
 * every `Info.plist` in the application, including those of nested bundles among the unpacked
 * files, injects the archive integrity and serializes it again. Such a file is accepted when the
 * prepared copy still matches its record and both parse to the same content apart from
 * `ElectronAsarIntegrity`, the same equality @electron/universal demands of the two CPU builds.
 * @param payloadDir - Prepared payload the descriptor was sealed from.
 * @returns Tolerance for {@link verifyPayload}, recording what it accepted.
 */
export function universalMergeRewrite(payloadDir: string): MergeRewriteTolerance {
  const accepted: string[] = []
  const content = (xml: Buffer): string => {
    const { ElectronAsarIntegrity: _integrity, ...rest } = plistParser().parse(xml.toString('utf8')) as Record<string, unknown>
    return JSON.stringify(rest)
  }
  return {
    accepted,
    accept: (file, shipped) => {
      if (posixBasename(file.path) !== 'Info.plist') return false
      const preparedFile = join(payloadDir, ...file.path.split('/'))
      if (!existsSync(preparedFile)) return false
      const prepared = readFileSync(preparedFile)
      if (prepared.byteLength !== file.bytes || createHash('sha256').update(prepared).digest('hex') !== file.sha256) return false
      try { if (content(prepared) !== content(shipped)) return false } catch { return false }
      accepted.push(file.path)
      return true
    },
  }
}

/** Outcome of the cross-check between an assembled archive and the prepared tree. */
export interface ArchiveCrossCheck {
  readonly descriptor: DesktopRuntimeDescriptor
  /** `Info.plist` files the universal merge rewrote; empty for a single-CPU build. */
  readonly rewrittenPlists: readonly string[]
}

/**
 * Cross-check an assembled archive against the descriptor the prepared tree was sealed with:
 * the archive must carry that descriptor byte for byte, and its files must match the inventory
 * exactly, apart from the `Info.plist` rewrites of {@link universalMergeRewrite}. The prepared
 * tree and the archive are two independent copies of the installation.
 * @param source - Assembled archive.
 * @param preparedDescriptorFile - Descriptor file inside the prepared payload.
 * @param expectedVersion - Version the payload must declare.
 * @param target - Platform and architectures of the package.
 * @returns The verified descriptor and the rewrites tolerated.
 */
export function verifyArchiveAgainstPrepared(source: ArchivedPayload, preparedDescriptorFile: string, expectedVersion: string, target: NextPackagingTarget): ArchiveCrossCheck {
  const prepared = readFileSync(preparedDescriptorFile)
  const archived = source.entry(DESKTOP_RUNTIME_FILE)?.read()
  if (archived === undefined) throw new Error(`Next payload: ${DESKTOP_RUNTIME_FILE} is missing from the archive`)
  if (!archived.equals(prepared)) throw new Error('Next payload: the archived descriptor differs from the prepared one')
  const tolerance = universalMergeRewrite(dirname(preparedDescriptorFile))
  const descriptor = verifyPayload(source, parseDesktopRuntime(JSON.parse(prepared.toString('utf8'))), expectedVersion, target, { acceptRewrite: tolerance.accept })
  return { descriptor, rewrittenPlists: tolerance.accepted }
}

/**
 * Verify a final application's archive and unpacked files against the descriptor it carries.
 * @param resourcesDir - Application resources directory.
 * @param expectedVersion - Version the payload must declare.
 * @param target - Platform and architectures of the package.
 * @param options - Code-signing tolerance for a signed application.
 * @returns The verified descriptor.
 */
export function verifyNextRuntime(resourcesDir: string, expectedVersion: string, target: NextPackagingTarget, options: VerifyPayloadOptions = {}): DesktopRuntimeDescriptor {
  const source = archivedPayload(resourcesDir)
  try { return verifyPayload(source, source.descriptor(), expectedVersion, target, options) }
  finally { source.close() }
}
