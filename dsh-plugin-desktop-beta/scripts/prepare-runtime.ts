import { OFFICE_SKILLS_IN_PACKAGE, prepareCuaNative } from './upstream-family.ts'
/** Prepare, execute and check the bundled interpreter payloads for every CPU one Next package carries. */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { macSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { assertWindowsArchitecture, verifyWindowsNativeTree } from '../../dsh-plugin-desktop/scripts/windows-architecture.ts'
import { machOArchitectures, preparePrimaryRuntime, primaryRuntimePayloadDigest, readPrimaryRuntimeLock, rosettaAvailable, smokePrimaryRuntime, type PrimaryRuntimeTarget } from './primary-runtime.ts'

/** CPU of one bundled payload. */
export type NextRuntimeArch = 'arm64' | 'x64'

/** One payload the package carries. */
export interface NextRuntimeTarget {
  readonly target: PrimaryRuntimeTarget
  readonly arch: NextRuntimeArch
}

/**
 * Payloads one packaging run prepares: on macOS the CPUs of its packages, both Darwin CPUs unless
 * `DSH_MAC_SMOKE_ARCH` selects one, because the installed application selects the payload of the CPU it
 * runs on; and the build host CPU on Windows and Linux.
 * @param platform - Electron platform being packaged.
 * @param hostArch - Build host architecture, used on Linux where packages are single-architecture.
 * @param env - Process environment inspected for single-architecture smoke selection.
 * @param macCpus - Darwin CPUs to prepare instead: the CPUs of a release's packages, or the single CPU of a development launch.
 * @returns Locked targets and their CPUs.
 */
export function nextRuntimeTargets(
  platform: NodeJS.Platform,
  hostArch: string = process.arch,
  env: NodeJS.ProcessEnv = process.env,
  macCpus?: readonly NextRuntimeArch[],
): readonly NextRuntimeTarget[] {
  if (platform === 'darwin') {
    if (macCpus !== undefined) return macCpus.map(arch => ({ target: `mac-${arch}`, arch }))
    const arch = macSmokeArchitecture(env)
    if (arch === 'arm64') return [{ target: 'mac-arm64', arch: 'arm64' }]
    if (arch === 'x64') return [{ target: 'mac-x64', arch: 'x64' }]
    return [{ target: 'mac-arm64', arch: 'arm64' }, { target: 'mac-x64', arch: 'x64' }]
  }
  if (platform === 'win32') {
    if (hostArch === 'arm64') return [{ target: 'win-arm64', arch: 'arm64' }]
    if (hostArch === 'x64') return [{ target: 'win-x64', arch: 'x64' }]
    throw new Error(`Unsupported Windows runtime architecture: ${hostArch}`)
  }
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
  /** Darwin CPUs to prepare instead; see {@link nextRuntimeTargets}. */
  readonly macCpus?: readonly NextRuntimeArch[]
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
  const targets = nextRuntimeTargets(options.platform, options.hostArch, process.env, options.macCpus)
  if (targets.length === 0) {
    log(`Next ships no interpreter payload for ${options.platform}`)
    return paths.runtime
  }
  const lock = readPrimaryRuntimeLock(undefined, targets[0]?.target)
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
 * @param macCpus - Darwin CPUs prepared instead; see {@link nextRuntimeTargets}.
 * @returns CPUs whose payload ran.
 */
export function smokeNextRuntime(runtimeRoot: string, platform: NodeJS.Platform, log: (message: string) => void = console.log, hostArch: string = process.arch,
  macCpus?: readonly NextRuntimeArch[]): NextRuntimeArch[] {
  const executed: NextRuntimeArch[] = []
  for (const { arch } of nextRuntimeTargets(platform, hostArch, process.env, macCpus)) {
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
 * @param macCpus - Darwin CPUs prepared instead; see {@link nextRuntimeTargets}.
 * @returns The verified payloads in target order.
 */
export function verifyNextRuntimeTree(runtimeRoot: string, platform: NodeJS.Platform, expectedVersion: string, hostArch: string = process.arch,
  macCpus?: readonly NextRuntimeArch[]): VerifiedNextRuntime[] {
  const verified: VerifiedNextRuntime[] = []
  for (const { arch } of nextRuntimeTargets(platform, hostArch, process.env, macCpus)) {
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
    if (platform === 'win32') {
      assertWindowsArchitecture(entries.node, arch)
      assertWindowsArchitecture(entries.python, arch)
      verifyWindowsNativeTree(directory, arch)
    }
    const skills = officeSkillsDirectory(runtimeRoot, arch)
    for (const skill of OFFICE_SKILLS_IN_PACKAGE ? [] : ['office', 'office-docx', 'office-pptx', 'office-xlsx', 'office-render', 'office-recalculate', 'office-export-pdf']) {
      requireFile(join(skills, skill, 'SKILL.md'), `${arch} ${skill} skill`)
    }
    verified.push({ arch, directory, manifest })
  }
  return verified
}

/**
 * Check the payloads a package copies: the runtime root holds a directory for each CPU the package carries and
 * nothing else, and every payload verifies.
 * @param runtimeRoot - The packaged `Resources/runtime`, or the tree staged for it.
 * @param platform - Platform the package targets.
 * @param expectedVersion - Product version every manifest must record.
 * @param cpus - CPUs the package carries.
 * @returns The verified payloads in target order.
 */
export function verifyPackagedNextRuntime(runtimeRoot: string, platform: NodeJS.Platform, expectedVersion: string, cpus: readonly string[]): VerifiedNextRuntime[] {
  const present = existsSync(runtimeRoot) ? readdirSync(runtimeRoot).sort() : []
  const expected = [...cpus].sort()
  if (present.join(',') !== expected.join(',')) {
    throw new Error(`Next runtime: ${runtimeRoot} holds ${present.join(', ') || 'no payload'}; the package carries ${expected.join(' and ')}`)
  }
  const verified = verifyNextRuntimeTree(runtimeRoot, platform, expectedVersion, process.arch, platform === 'darwin' ? expected as NextRuntimeArch[] : undefined)
  if (verified.map(runtime => runtime.arch).sort().join(',') !== expected.join(',')) {
    throw new Error(`Next runtime: ${platform} packages carry ${verified.map(runtime => runtime.arch).join(' and ')}, not ${expected.join(' and ')}`)
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
 * @param macCpus - Darwin CPUs prepared instead; see {@link nextRuntimeTargets}.
 * @returns The verified payloads when the existing tree can be reused, or an empty array.
 */
export function reusableNextRuntimeTree(
  runtimeRoot: string,
  platform: NodeJS.Platform,
  expectedVersion: string,
  hostArch: string = process.arch,
  macCpus?: readonly NextRuntimeArch[],
): VerifiedNextRuntime[] {
  const targets = nextRuntimeTargets(platform, hostArch, process.env, macCpus)
  if (targets.length === 0 || !existsSync(runtimeRoot)) return []
  try {
    const verified = verifyNextRuntimeTree(runtimeRoot, platform, expectedVersion, hostArch, macCpus)
    const expectedArchs = new Set<string>(targets.map(item => item.arch))
    if (readdirSync(runtimeRoot).some(entry => !expectedArchs.has(entry))) return []
    const lock = readPrimaryRuntimeLock(undefined, targets[0]?.target)
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

/** Identify the same locked payloads used by local reuse, including both CPUs of the macOS cache. */
export function nextRuntimeCacheKey(platform: NodeJS.Platform = process.platform, hostArch: string = process.arch): string {
  const targets = nextRuntimeTargets(platform, hostArch, {})
  if (targets.length === 0) throw new Error(`Unsupported runtime cache platform: ${platform}-${hostArch}`)
  const lock = readPrimaryRuntimeLock(undefined, targets[0]!.target)
  const pnpmManifest = createRequire(import.meta.url).resolve('pnpm')
  const pnpmVersion = (JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }).version
  return createHash('sha256').update(JSON.stringify(targets.map(({ target }) => primaryRuntimePayloadDigest(target, lock, pnpmVersion)))).digest('hex')
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--cache-key')) {
    console.log(nextRuntimeCacheKey())
  } else {
    const desktopRoot = resolve(import.meta.dirname, '..')
    const version = expectedNextVersion(desktopRoot)
    const paths = nextRuntimeBuildPaths(desktopRoot)
    // `dev` and `start` run this entry, and the development shell selects the payload of its own CPU (src/main.ts), so a
    // Mac prepares that one, as upstream's development launcher does. Packaging prepares every CPU through package.ts.
    const macCpus = process.platform === 'darwin' ? [process.arch === 'x64' ? 'x64' : 'arm64'] as const : undefined
    const reusable = reusableNextRuntimeTree(paths.runtime, process.platform, version, process.arch, macCpus)
    if (reusable.length > 0) {
      console.log(`Reusing prepared primary runtime for ${reusable.map(item => item.arch).join(', ')}`)
    } else {
      const root = await prepareNextRuntime({ desktopRoot, platform: process.platform, version, macCpus })
      verifyNextRuntimeTree(root, process.platform, version, process.arch, macCpus)
      smokeNextRuntime(root, process.platform, console.log, process.arch, macCpus)
    }
    if (macCpus !== undefined) prepareCuaNative(desktopRoot, macCpus)
  }
}
