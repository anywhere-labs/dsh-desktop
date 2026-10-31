/** Prepare pinned, relocatable script interpreters without installing into the build host; ported from the upstream builder. */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, cpSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import extractZip from 'extract-zip'
import { x as extractTar } from 'tar'
import { copyPrimaryRuntime, parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { prunePrimaryRuntimePythonTests } from './prune-python-tests.ts'

/** The pinned upstream checkout owns the interpreter and wheel lock and the Python smoke script. */
export const UPSTREAM_PRIMARY_RUNTIME = resolve(import.meta.dirname, '..', '..', 'deepseek-harness', 'scripts', 'primary-runtime')

/** One hash-verified download. */
export interface PrimaryRuntimeWheel {
  readonly url: string
  readonly sha256: string
}

/** Interpreter archives and native wheels locked for one target. */
export interface PrimaryRuntimeArtifact {
  readonly nodeArchive: string
  readonly nodeSha256: string
  readonly pythonTarget: string
  readonly pythonSha256: string
  readonly wheels: readonly PrimaryRuntimeWheel[]
}

/** Targets the upstream lock pins. */
export const PRIMARY_RUNTIME_TARGETS = ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64', 'linux-arm64'] as const
/** A locked interpreter and wheel target. */
export type PrimaryRuntimeTarget = (typeof PRIMARY_RUNTIME_TARGETS)[number]

/** The upstream download lock: interpreter releases, per-target archives and the shared pure-Python wheels. */
export interface PrimaryRuntimeLock {
  readonly nodeVersion: string
  readonly pythonVersion: string
  readonly pythonRelease: string
  readonly targets: Readonly<Record<PrimaryRuntimeTarget, PrimaryRuntimeArtifact>>
  readonly wheels: readonly PrimaryRuntimeWheel[]
  readonly pythonPackages: Readonly<Record<string, string>>
}

const SHA256 = /^[a-f0-9]{64}$/u
const VERSION = /^\d+\.\d+\.\d+$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWheel(value: unknown): value is PrimaryRuntimeWheel {
  return isRecord(value) && typeof value.url === 'string' && value.url.startsWith('https://')
    && typeof value.sha256 === 'string' && SHA256.test(value.sha256)
}

function isArtifact(value: unknown): value is PrimaryRuntimeArtifact {
  return isRecord(value) && typeof value.nodeArchive === 'string' && typeof value.pythonTarget === 'string'
    && typeof value.nodeSha256 === 'string' && SHA256.test(value.nodeSha256)
    && typeof value.pythonSha256 === 'string' && SHA256.test(value.pythonSha256)
    && Array.isArray(value.wheels) && value.wheels.every(isWheel)
}

function isDistributionMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(version => typeof version === 'string' && version.length > 0)
}

/**
 * Validate the decoded upstream lock without copying it, so the key order that forms the payload identity survives.
 * @param value - Decoded `lock.json`.
 * @returns The typed lock.
 * @throws For a lock missing a pinned target or carrying malformed digests.
 */
export function parsePrimaryRuntimeLock(value: unknown): PrimaryRuntimeLock {
  if (!isRecord(value) || !isRecord(value.targets) || !Array.isArray(value.wheels)) throw new Error('primary runtime lock: malformed document')
  const { nodeVersion, pythonVersion, pythonRelease, wheels, pythonPackages } = value
  if (typeof nodeVersion !== 'string' || !VERSION.test(nodeVersion) || typeof pythonVersion !== 'string' || !VERSION.test(pythonVersion)
    || typeof pythonRelease !== 'string' || !/^\d{8}$/u.test(pythonRelease)) {
    throw new Error('primary runtime lock: malformed interpreter versions')
  }
  const targets: Partial<Record<PrimaryRuntimeTarget, PrimaryRuntimeArtifact>> = {}
  for (const target of PRIMARY_RUNTIME_TARGETS) {
    const artifact = value.targets[target]
    if (!isArtifact(artifact)) throw new Error(`primary runtime lock: malformed target ${target}`)
    targets[target] = artifact
  }
  if (!wheels.every(isWheel) || !isDistributionMap(pythonPackages)) throw new Error('primary runtime lock: malformed wheel records')
  return { nodeVersion, pythonVersion, pythonRelease, targets: targets as Record<PrimaryRuntimeTarget, PrimaryRuntimeArtifact>, wheels, pythonPackages }
}

/**
 * Read the upstream lock from the pinned checkout.
 * @param path - Lock file; defaults to the submodule's.
 * @returns The validated lock.
 */
export function readPrimaryRuntimeLock(path: string = join(UPSTREAM_PRIMARY_RUNTIME, 'lock.json')): PrimaryRuntimeLock {
  return parsePrimaryRuntimeLock(JSON.parse(readFileSync(path, 'utf8')))
}

/**
 * Download or reuse an archive only when its bytes match the release lock.
 * @param url - Locked archive URL.
 * @param sha256 - Expected hexadecimal digest for the selected algorithm.
 * @param cache - Download cache directory.
 * @param algorithm - Digest algorithm; npm archives use SHA-512.
 * @returns Verified local archive path.
 */
export async function downloadPrimaryRuntimeAsset(url: string, sha256: string, cache: string, algorithm: 'sha256' | 'sha512' = 'sha256'): Promise<string> {
  mkdirSync(cache, { recursive: true })
  const destination = join(cache, sha256)
  let bytes: Buffer
  let cached = true
  try { bytes = readFileSync(destination) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    cached = false
    const timeout = Number(process.env.DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS ?? '300000')
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error('DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS must be an integer from 1 to 2147483647')
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    if (!response.ok) throw new Error(`primary runtime download: ${String(response.status)} ${url}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash(algorithm).update(bytes).digest('hex') !== sha256) {
    rmSync(destination, { force: true })
    throw new Error(`primary runtime download: checksum mismatch for ${url}`)
  }
  if (cached) return destination
  const temporary = join(cache, `.${randomUUID()}`)
  try {
    writeFileSync(temporary, bytes)
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { force: true })
  }
  return destination
}

/**
 * Prepare the locked standalone Node independently of Python and pnpm.
 * @param target - Target interpreter platform.
 * @param destination - Directory receiving bin/node and LICENSE.
 * @param cache - Verified archive cache.
 * @param lock - Upstream download lock.
 * @returns Resolves after extracting the interpreter.
 */
export async function downloadNodeRuntime(target: PrimaryRuntimeTarget, destination: string, cache: string, lock: PrimaryRuntimeLock): Promise<void> {
  const artifact = lock.targets[target]
  const filename = `node-v${lock.nodeVersion}-${artifact.nodeArchive}`
  const archive = await downloadPrimaryRuntimeAsset(`https://nodejs.org/dist/v${lock.nodeVersion}/${filename}`, artifact.nodeSha256, cache)
  const staging = mkdtempSync(join(tmpdir(), 'dsh-node-'))
  try {
    if (target === 'win-x64') await extractZip(archive, { dir: staging })
    else await extractTar({ file: archive, cwd: staging })
    const source = join(staging, filename.replace(/\.(?:zip|tar\.gz)$/u, ''))
    mkdirSync(join(destination, 'bin'), { recursive: true })
    cpSync(join(source, ...(target === 'win-x64' ? ['node.exe'] : ['bin', 'node'])),
      join(destination, 'bin', target === 'win-x64' ? 'node.exe' : 'node'))
    cpSync(join(source, 'LICENSE'), join(destination, 'LICENSE'))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function pythonArchive(target: PrimaryRuntimeTarget, cache: string, lock: PrimaryRuntimeLock): Promise<string> {
  const artifact = lock.targets[target]
  const filename = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${artifact.pythonTarget}-install_only_stripped.tar.gz`
  return downloadPrimaryRuntimeAsset(`https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(filename)}`, artifact.pythonSha256, cache)
}

/**
 * Identify the inputs that assemble one target's payload, excluding unrelated target locks.
 * @param target - Runtime target whose archives are installed.
 * @param runtimeLock - Locked interpreter and wheel inputs.
 * @param pnpmVersion - Package-manager version copied into the payload.
 * @returns SHA-256 payload identity for installation reuse.
 */
export function primaryRuntimePayloadDigest(target: PrimaryRuntimeTarget, runtimeLock: PrimaryRuntimeLock, pnpmVersion: string | undefined): string {
  const { pythonVersion, pythonRelease, nodeVersion, wheels, pythonPackages } = runtimeLock
  // Identity preserves key order within the selected target, wheel records and distribution map, plus wheel-entry order.
  // Bump format when extraction or assembly changes payload bytes without changing locked inputs.
  return createHash('sha256').update(JSON.stringify({
    format: 7, target, pythonVersion, pythonRelease, nodeVersion: pnpmVersion === undefined ? undefined : nodeVersion,
    artifact: runtimeLock.targets[target], wheels, pythonPackages, pnpm: pnpmVersion,
  })).digest('hex')
}

/**
 * Unpack a locked library wheel, retaining auxiliary scripts in its distribution data directory.
 * @param archive - Hash-verified wheel archive.
 * @param destination - Absolute site-packages directory.
 * @returns Resolves after extraction without command wrappers; rejects other wheel installation schemes.
 */
export async function unpackPrimaryRuntimeWheel(archive: string, destination: string): Promise<void> {
  await extractZip(archive, {
    dir: destination,
    onEntry: (entry) => {
      const [directory, scheme] = entry.fileName.split('/')
      if (directory?.endsWith('.data') && scheme !== '' && scheme !== 'scripts') {
        throw new Error(`primary runtime: wheel requires unsupported installation paths: ${entry.fileName}`)
      }
    },
  })
}

/**
 * Copy the skill package's complete asset tree to ordinary filesystem resources.
 * @param source - The package's assets directory.
 * @param destination - External Office skill resource directory.
 * @returns Resolves after replacing the external assets with the complete package tree.
 */
export async function prepareOfficeSkillAssets(source: string, destination: string): Promise<void> {
  rmSync(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true })
}

/** Resource preparation inputs. */
export interface PreparePrimaryRuntimeOptions {
  /** Upstream download lock. */
  readonly lock: PrimaryRuntimeLock
  /** Target whose archives and wheels are downloaded. */
  readonly target: PrimaryRuntimeTarget
  /** Resource directory receiving primary-runtime/ and office-skills/. */
  readonly output: string
  /** SHA-256-addressed archive cache. */
  readonly cache: string
  /** Carrier release recorded in the legacy desktopVersion manifest field. */
  readonly version: string
  /** Ordinary filesystem Office assets; defaults to the installed skill package. */
  readonly skillSource?: string
}

/**
 * Materialize locked interpreters, libraries and Office resources without executing target code.
 * The pnpm distribution is the one installed beside this package, the same one the shell bundles.
 * @param options - Explicit target and output locations.
 * @returns Resolves after the complete payload and skills have been copied to the output directory.
 */
export async function preparePrimaryRuntime(options: PreparePrimaryRuntimeOptions): Promise<void> {
  const { target, lock } = options
  const paths = { runtime: resolve(options.output), downloads: resolve(options.cache) }
  mkdirSync(paths.runtime, { recursive: true })
  mkdirSync(paths.downloads, { recursive: true })
  const staging = mkdtempSync(join(tmpdir(), 'dsh-primary-'))
  try {
    const output = join(staging, 'payload')
    const dependencies = join(output, 'dependencies')
    mkdirSync(dependencies, { recursive: true })
    const node = join(dependencies, 'node')
    // pnpm exports only its manifest, which resolves the package entry to package.json itself.
    const pnpmManifest = createRequire(import.meta.url).resolve('pnpm')
    const pnpmVersion = (JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }).version
    const wheels = [...lock.targets[target].wheels, ...lock.wheels]
    const [, , , wheelArchives] = await Promise.all([
      (async () => {
        await downloadNodeRuntime(target, node, paths.downloads, lock)
        mkdirSync(join(node, 'node_modules'))
        writeFileSync(join(node, 'node_modules', 'README.txt'), 'Reserved for bundled Node packages. pnpm uses its default installation directories.\n')
      })(),
      cp(dirname(pnpmManifest), join(dependencies, 'pnpm'), { recursive: true, dereference: true }),
      pythonArchive(target, paths.downloads, lock).then(file => extractTar({ file, cwd: dependencies })),
      Promise.all(wheels.map(wheel => downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, paths.downloads))),
    ])
    const manifest: PrimaryRuntimeManifest = {
      desktopVersion: options.version,
      platform: target === 'win-x64' ? 'win32' : target.startsWith('linux-') ? 'linux' : 'darwin',
      arch: target.endsWith('-arm64') ? 'arm64' : 'x64',
      payloadDigest: primaryRuntimePayloadDigest(target, lock, pnpmVersion),
      python: lock.pythonVersion,
      node: lock.nodeVersion,
      pnpm: pnpmVersion,
      pythonPackages: lock.pythonPackages,
    }
    const entries = workspaceDependencyPaths(output, manifest)
    for (const archive of wheelArchives) {
      await unpackPrimaryRuntimeWheel(archive, entries.pythonPackages)
    }
    const { numpy, pandas } = lock.pythonPackages
    if (numpy === undefined || pandas === undefined) throw new Error('primary runtime lock: numpy and pandas versions are required')
    prunePrimaryRuntimePythonTests(entries.pythonPackages, { numpy, pandas })
    writeFileSync(join(output, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
    const destination = join(paths.runtime, 'primary-runtime')
    rmSync(destination, { recursive: true, force: true })
    const assets = options.skillSource ?? join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets')
    await Promise.all([
      copyPrimaryRuntime(output, destination, manifest),
      prepareOfficeSkillAssets(assets, join(paths.runtime, 'office-skills')),
    ])
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Whether this Apple Silicon host can run Intel executables.
 * @returns True when Rosetta accepts an x86_64 launch.
 */
export function rosettaAvailable(): boolean {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return false
  return spawnSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], { stdio: 'ignore' }).status === 0
}

/** Execution settings for one payload smoke. */
export interface PrimaryRuntimeSmokeOptions {
  /** Scrubbed subprocess environment; defaults to excluding credential-shaped names. */
  readonly environment?: NodeJS.ProcessEnv
  /** Command prefix that runs a foreign-CPU payload, such as `/usr/bin/arch -x86_64` under Rosetta. */
  readonly launcher?: readonly string[]
}

/**
 * Execute the payload's interpreters, package manager and Python libraries.
 * @param root - Final payload directory, including any platform signatures.
 * @param options - Environment and launcher.
 * @returns False when the payload targets another platform or CPU and no launcher runs it; true after the checks pass.
 */
export function smokePrimaryRuntime(root: string, options: PrimaryRuntimeSmokeOptions = {}): boolean {
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')))
  const launcher = options.launcher ?? []
  if (manifest.platform !== process.platform || (manifest.arch !== process.arch && launcher.length === 0)) return false
  if (Object.keys(manifest.pythonPackages).length === 0) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  if (entries.node === undefined || entries.pnpm === undefined) throw new Error('primary runtime: the Next payload must declare node and pnpm components.')
  if (manifest.platform !== 'win32') {
    const interpreter = `python${manifest.python.split('.').slice(0, 2).join('.')}`
    for (const name of ['python', 'python3']) {
      const path = join(dirname(entries.python), name)
      if (!lstatSync(path).isSymbolicLink() || readlinkSync(path) !== interpreter) {
        throw new Error(`primary runtime: Python commands must be relative aliases of ${interpreter}`)
      }
    }
    if (!lstatSync(join(dirname(entries.python), interpreter)).isFile()) throw new Error('primary runtime: versioned Python must be a regular file')
  }
  const environment = options.environment ?? Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
  const run = (file: string, args: readonly string[]): void => {
    const [command, ...prefix] = launcher.length === 0 ? [file] : [...launcher, file]
    execFileSync(command!, [...prefix, ...args], { stdio: 'inherit', timeout: 120_000, env: environment })
  }
  run(entries.python, ['-I', '-B', '-c', 'import decimal, xml.parsers.expat, lzma, uuid, numpy, pandas; assert numpy.arange(4).sum() == 6; assert pandas.DataFrame({"n": [1, 2]}).n.sum() == 3'])
  run(entries.python, ['-I', '-B', join(UPSTREAM_PRIMARY_RUNTIME, 'smoke.py'), JSON.stringify(manifest.pythonPackages),
    manifest.python])
  run(entries.python, ['-I', '-B', '-m', 'pip', 'check'])
  run(entries.node, ['-e', `if (process.versions.node !== ${JSON.stringify(manifest.node)}) process.exit(1)`])
  run(entries.node, [entries.pnpm, '--version'])
  return true
}

const MACH_O_MAGICS = new Set(['cafebabe', 'cafebabf', 'cefaedfe', 'cffaedfe', 'feedface', 'feedfacf', 'bebafeca', 'bfbafeca'])

function readHead(path: string, bytes: number): Buffer {
  const descriptor = openSync(path, 'r')
  try {
    const head = Buffer.alloc(bytes)
    return head.subarray(0, readSync(descriptor, head, 0, bytes, 0))
  } finally { closeSync(descriptor) }
}

/**
 * Whether a file starts with a Mach-O or fat archive magic.
 * @param path - Regular file.
 * @returns True for native macOS code that must be signed.
 */
export function isMachO(path: string): boolean {
  const head = readHead(path, 4)
  return head.length === 4 && MACH_O_MAGICS.has(head.toString('hex'))
}

/** CPU a Mach-O slice targets; `other` covers CPUs Next does not ship. */
export type MachOArchitecture = 'arm64' | 'x64' | 'other'

function cpuArchitecture(cputype: number): MachOArchitecture {
  return cputype === 0x0100000c ? 'arm64' : cputype === 0x01000007 ? 'x64' : 'other'
}

/**
 * Read the CPU types a Mach-O file carries, one per slice of a fat archive.
 * @param path - Regular file.
 * @returns CPU types in header order; empty for a file that is not Mach-O.
 */
export function machOArchitectures(path: string): readonly MachOArchitecture[] {
  const head = readHead(path, 4096)
  if (head.length < 8) return []
  const magic = head.subarray(0, 4).toString('hex')
  switch (magic) {
    case 'cffaedfe': case 'cefaedfe': return [cpuArchitecture(head.readUInt32LE(4))]
    case 'feedfacf': case 'feedface': return [cpuArchitecture(head.readUInt32BE(4))]
    case 'cafebabe': case 'cafebabf': {
      const stride = magic === 'cafebabe' ? 20 : 32
      const slices: MachOArchitecture[] = []
      for (let index = 0, offset = 8; index < head.readUInt32BE(4) && offset + 4 <= head.length; index++, offset += stride) {
        slices.push(cpuArchitecture(head.readUInt32BE(offset)))
      }
      return slices
    }
    default: return []
  }
}
