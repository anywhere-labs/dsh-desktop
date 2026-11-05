/** Prepare, execute and check the bundled interpreter payloads for every CPU one Next package carries. */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { macSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { machOArchitectures, preparePrimaryRuntime, primaryRuntimePayloadDigest, readPrimaryRuntimeLock, rosettaAvailable, smokePrimaryRuntime, type PrimaryRuntimeTarget } from './primary-runtime.ts'

/** CPU of one bundled payload. */
export type NextRuntimeArch = 'arm64' | 'x64'

/** One payload the package carries. */
export interface NextRuntimeTarget {
  readonly target: PrimaryRuntimeTarget
  readonly arch: NextRuntimeArch
}

/**
 * Payloads one Next package carries: both Darwin CPUs by default (or the single smoke CPU when
 * `DSH_MAC_SMOKE_ARCH` selects one), because macOS releases are universal and the installed slice
 * selects its payload at runtime; Windows x64; and the build host CPU on Linux.
 * @param platform - Electron platform being packaged.
 * @param hostArch - Build host architecture, used on Linux where packages are single-architecture.
 * @param env - Process environment inspected for single-architecture smoke selection.
 * @returns Locked targets and their CPUs.
 */
export function nextRuntimeTargets(
  platform: NodeJS.Platform,
  hostArch: string = process.arch,
  env: NodeJS.ProcessEnv = process.env,
): readonly NextRuntimeTarget[] {
  if (platform === 'darwin') {
    const arch = macSmokeArchitecture(env)
    if (arch === 'arm64') return [{ target: 'mac-arm64', arch: 'arm64' }]
    if (arch === 'x64') return [{ target: 'mac-x64', arch: 'x64' }]
    return [{ target: 'mac-arm64', arch: 'arm64' }, { target: 'mac-x64', arch: 'x64' }]
  }
  if (platform === 'win32') return [{ target: 'win-x64', arch: 'x64' }]
  if (platform === 'linux') {
    if (hostArch === 'arm64') return [{ target: 'linux-arm64', arch: 'arm64' }]
    if (hostArch === 'x64') return [{ target: 'linux-x64', arch: 'x64' }]
  }
  return []
}

/**
 * Build-owned directories under the Next package: the prepared runtime tree that `extraResources`
 * copies verbatim, and the SHA-256-addressed download cache shared by every build.
 * @param desktopRoot - Next package root.
 * @returns Runtime root and download cache.
 */
export function nextRuntimeBuildPaths(desktopRoot: string): { readonly runtime: string; readonly downloads: string } {
  return { runtime: join(desktopRoot, '.desktop-build', 'runtime'), downloads: join(desktopRoot, '.desktop-build', 'downloads') }
}

/**
 * Payload directory of one CPU: `<root>/<arch>/primary-runtime`, with `office-skills` beside it as
 * upstream Desktop lays out `Resources/runtime`.
 * @param runtimeRoot - Prepared or packaged runtime root.
 * @param arch - Payload CPU.
 * @returns Absolute payload directory.
 */
export function primaryRuntimeDirectory(runtimeRoot: string, arch: NextRuntimeArch): string {
  return join(runtimeRoot, arch, 'primary-runtime')
}

/**
 * Office skill resources of one CPU's payload.
 * @param runtimeRoot - Prepared or packaged runtime root.
 * @param arch - Payload CPU.
 * @returns Absolute resource directory.
 */
export function officeSkillsDirectory(runtimeRoot: string, arch: NextRuntimeArch): string {
  return join(runtimeRoot, arch, 'office-skills')
}

/**
 * Version every payload must declare: the drill override, otherwise the source manifest.
 * @param desktopRoot - Next package root.
 * @param env - Packaging environment.
 * @returns Product version.
 */
export function expectedNextVersion(desktopRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const source = (JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }).version
  return env.DSH_BETA_BUILD_VERSION ?? source
}

/** Inputs of one preparation. */
export interface PrepareNextRuntimeOptions {
  readonly desktopRoot: string
  readonly platform: NodeJS.Platform
  readonly version: string
  readonly hostArch?: string
  readonly log?: (message: string) => void
}

/**
 * Materialize every payload of the platform from the upstream lock, replacing the previous tree.
 * First use downloads the locked archives; later runs reuse the cache.
 * @param options - Package root, platform and product version.
 * @returns The runtime root, empty for platforms without a payload.
 */
export async function prepareNextRuntime(options: PrepareNextRuntimeOptions): Promise<string> {
  const paths = nextRuntimeBuildPaths(options.desktopRoot)
  const log = options.log ?? console.log
  rmSync(paths.runtime, { recursive: true, force: true })
  const targets = nextRuntimeTargets(options.platform, options.hostArch)
  if (targets.length === 0) {
    log(`Next ships no interpreter payload for ${options.platform}`)
    return paths.runtime
  }
  const lock = readPrimaryRuntimeLock()
  const skillSource = join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets')
  for (const { target } of targets) {
    log(`Preparing the ${target} primary runtime (Python ${lock.pythonVersion}, Node ${lock.nodeVersion}) for ${options.version}`)
  }
  await Promise.all(targets.map(({ target, arch }) =>
    preparePrimaryRuntime({ lock, target, output: join(paths.runtime, arch), cache: paths.downloads, version: options.version, skillSource }),
  ))
  return paths.runtime
}

/**
 * Execute every payload this host can run: the native CPU directly, and the Intel payload under
 * Rosetta when an Apple Silicon host has it. Other payloads are reported, not executed.
 * @param runtimeRoot - Prepared runtime root.
 * @param platform - Platform the payloads target.
 * @param log - Progress output.
 * @param hostArch - Build host architecture, used on Linux where packages are single-architecture.
 * @returns CPUs whose payload ran.
 */
export function smokeNextRuntime(runtimeRoot: string, platform: NodeJS.Platform, log: (message: string) => void = console.log, hostArch: string = process.arch): NextRuntimeArch[] {
  const executed: NextRuntimeArch[] = []
  for (const { arch } of nextRuntimeTargets(platform, hostArch)) {
    const root = primaryRuntimeDirectory(runtimeRoot, arch)
    const launcher = platform === 'darwin' && arch === 'x64' && process.arch === 'arm64' && rosettaAvailable() ? ['/usr/bin/arch', '-x86_64'] : undefined
    if (smokePrimaryRuntime(root, { launcher })) {
      executed.push(arch)
      log(`Primary runtime smoke passed for ${arch}${launcher === undefined ? '' : ' under Rosetta'}`)
    } else log(`Primary runtime smoke skipped for ${arch}: this ${process.platform} ${process.arch} host cannot execute it`)
  }
  return executed
}

/** One verified payload. */
export interface VerifiedNextRuntime {
  readonly arch: NextRuntimeArch
  readonly directory: string
  readonly manifest: PrimaryRuntimeManifest
}

function requireFile(path: string, description: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Next runtime: missing ${description}: ${path}`)
}

/**
 * Check a prepared or packaged runtime root: every CPU's payload declares this platform, CPU and
 * version with Node and pnpm, its entry points and Office resources exist, and on macOS the
 * interpreters are thin Mach-O files of the declared CPU.
 * @param runtimeRoot - `.desktop-build/runtime` or the packaged `Resources/runtime`.
 * @param platform - Platform the package targets.
 * @param expectedVersion - Product version every manifest must record.
 * @param hostArch - Build host architecture, used on Linux where packages are single-architecture.
 * @returns The verified payloads in target order.
 */
export function verifyNextRuntimeTree(runtimeRoot: string, platform: NodeJS.Platform, expectedVersion: string, hostArch: string = process.arch): VerifiedNextRuntime[] {
  const verified: VerifiedNextRuntime[] = []
  for (const { arch } of nextRuntimeTargets(platform, hostArch)) {
    const directory = primaryRuntimeDirectory(runtimeRoot, arch)
    const manifestFile = join(directory, 'runtime.json')
    requireFile(manifestFile, `${arch} payload manifest`)
    const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(manifestFile, 'utf8')))
    if (manifest.platform !== platform || manifest.arch !== arch) throw new Error(`Next runtime: ${directory} declares ${manifest.platform} ${manifest.arch}, expected ${platform} ${arch}`)
    if (manifest.desktopVersion !== expectedVersion) throw new Error(`Next runtime: ${directory} declares version ${manifest.desktopVersion}, expected ${expectedVersion}`)
    if (manifest.node === undefined || manifest.pnpm === undefined) throw new Error(`Next runtime: ${directory} must bundle Node and pnpm`)
    const entries = workspaceDependencyPaths(directory, manifest)
    if (entries.node === undefined || entries.pnpm === undefined) throw new Error(`Next runtime: ${directory} resolves no Node or pnpm entry`)
    requireFile(entries.python, `${arch} Python interpreter`)
    requireFile(entries.node, `${arch} Node executable`)
    requireFile(entries.pnpm, `${arch} pnpm entry`)
    if (!existsSync(entries.pythonPackages) || !statSync(entries.pythonPackages).isDirectory()) throw new Error(`Next runtime: missing ${arch} site-packages: ${entries.pythonPackages}`)
    if (platform === 'darwin') {
      for (const file of [entries.python, entries.node]) {
        const slices = machOArchitectures(file)
        if (slices.length !== 1 || slices[0] !== arch) throw new Error(`Next runtime: ${file} is ${slices.join('/') || 'not Mach-O'}, expected a thin ${arch} executable`)
      }
    }
    const skills = officeSkillsDirectory(runtimeRoot, arch)
    for (const skill of ['office', 'office-docx', 'office-pptx', 'office-xlsx', 'office-render', 'office-recalculate', 'office-export-pdf']) {
      requireFile(join(skills, skill, 'SKILL.md'), `${arch} ${skill} skill`)
    }
    verified.push({ arch, directory, manifest })
  }
  return verified
}

/**
 * Check whether an existing runtime root already matches the locked payload digests and product
 * version for every target of the platform without stale entries.
 * @param runtimeRoot - `.desktop-build/runtime`.
 * @param platform - Platform the package targets.
 * @param expectedVersion - Product version every manifest must record.
 * @param hostArch - Build host architecture, used on Linux where packages are single-architecture.
 * @returns The verified payloads when the existing tree can be reused, or an empty array.
 */
export function reusableNextRuntimeTree(
  runtimeRoot: string,
  platform: NodeJS.Platform,
  expectedVersion: string,
  hostArch: string = process.arch,
): VerifiedNextRuntime[] {
  const targets = nextRuntimeTargets(platform, hostArch)
  if (targets.length === 0 || !existsSync(runtimeRoot)) return []
  try {
    const verified = verifyNextRuntimeTree(runtimeRoot, platform, expectedVersion, hostArch)
    const expectedArchs = new Set<string>(targets.map(item => item.arch))
    if (readdirSync(runtimeRoot).some(entry => !expectedArchs.has(entry))) return []
    const lock = readPrimaryRuntimeLock()
    const pnpmManifest = createRequire(import.meta.url).resolve('pnpm')
    const pnpmVersion = (JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }).version
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index]!
      const runtime = verified[index]
      if (runtime?.manifest.payloadDigest !== primaryRuntimePayloadDigest(target.target, lock, pnpmVersion)) return []
    }
    return verified
  } catch {
    return []
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const desktopRoot = resolve(import.meta.dirname, '..')
  const version = expectedNextVersion(desktopRoot)
  const paths = nextRuntimeBuildPaths(desktopRoot)
  const reusable = reusableNextRuntimeTree(paths.runtime, process.platform, version)
  if (reusable.length > 0) {
    console.log(`Reusing prepared primary runtime for ${reusable.map(item => item.arch).join(', ')}`)
  } else {
    const root = await prepareNextRuntime({ desktopRoot, platform: process.platform, version })
    verifyNextRuntimeTree(root, process.platform, version)
    smokeNextRuntime(root, process.platform)
  }
}
