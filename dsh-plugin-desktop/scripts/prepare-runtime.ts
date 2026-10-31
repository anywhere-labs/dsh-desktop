/** Prepare, execute and check the bundled interpreter payloads for every CPU one Desktop package carries; ported from upstream Desktop. */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { macSmokeArchitecture } from './mac-universal.ts'
import { machOArchitectures, preparePrimaryRuntime, readPrimaryRuntimeLock, rosettaAvailable, smokePrimaryRuntime, type PrimaryRuntimeTarget } from './primary-runtime.ts'

/** CPU of one bundled payload. */
export type DesktopRuntimeArch = 'arm64' | 'x64'

/** One payload the package carries. */
export interface DesktopRuntimeTarget {
  readonly target: PrimaryRuntimeTarget
  readonly arch: DesktopRuntimeArch
}

/**
 * Payloads one Desktop package carries: both Darwin CPUs by default (or the single smoke CPU when
 * `DSH_MAC_SMOKE_ARCH` selects one), because macOS releases are universal and the installed slice
 * selects its payload at runtime; Windows x64 and Linux x64 on their hosts; nothing on other platforms.
 * @param platform - Electron platform being packaged.
 * @param env - Process environment inspected for single-architecture smoke selection.
 * @returns Locked targets and their CPUs.
 */
export function desktopRuntimeTargets(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): readonly DesktopRuntimeTarget[] {
  if (platform === 'darwin') {
    const arch = macSmokeArchitecture(env)
    if (arch === 'arm64') return [{ target: 'mac-arm64', arch: 'arm64' }]
    if (arch === 'x64') return [{ target: 'mac-x64', arch: 'x64' }]
    return [{ target: 'mac-arm64', arch: 'arm64' }, { target: 'mac-x64', arch: 'x64' }]
  }
  if (platform === 'win32') return [{ target: 'win-x64', arch: 'x64' }]
  if (platform === 'linux') return [{ target: 'linux-x64', arch: 'x64' }]
  return []
}

/**
 * Build-owned directories under the Desktop package: the prepared runtime tree that `extraResources`
 * copies verbatim, and the SHA-256-addressed download cache shared by every build.
 * @param desktopRoot - Desktop package root.
 * @returns Runtime root and download cache.
 */
export function desktopRuntimeBuildPaths(desktopRoot: string): { readonly runtime: string; readonly downloads: string } {
  return { runtime: join(desktopRoot, '.desktop-build', 'runtime'), downloads: join(desktopRoot, '.desktop-build', 'downloads') }
}

/**
 * Payload directory of one CPU: `<root>/<arch>/primary-runtime`, with `office-skills` beside it as
 * upstream Desktop lays out `Resources/runtime`.
 * @param runtimeRoot - Prepared or packaged runtime root.
 * @param arch - Payload CPU.
 * @returns Absolute payload directory.
 */
export function primaryRuntimeDirectory(runtimeRoot: string, arch: DesktopRuntimeArch): string {
  return join(runtimeRoot, arch, 'primary-runtime')
}

/**
 * Office skill resources of one CPU's payload.
 * @param runtimeRoot - Prepared or packaged runtime root.
 * @param arch - Payload CPU.
 * @returns Absolute resource directory.
 */
export function officeSkillsDirectory(runtimeRoot: string, arch: DesktopRuntimeArch): string {
  return join(runtimeRoot, arch, 'office-skills')
}

/**
 * Version every payload must declare: the product version of the package manifest.
 * @param desktopRoot - Desktop package root.
 * @returns Product version.
 */
export function expectedDesktopVersion(desktopRoot: string): string {
  return (JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }).version
}

/** Inputs of one preparation. */
export interface PrepareDesktopRuntimeOptions {
  readonly desktopRoot: string
  readonly platform: NodeJS.Platform
  readonly version: string
  readonly log?: (message: string) => void
}

/**
 * Materialize every payload of the platform from the upstream lock, replacing the previous tree.
 * First use downloads the locked archives; later runs reuse the cache.
 * @param options - Package root, platform and product version.
 * @returns The runtime root, empty for platforms without a payload.
 */
export async function prepareDesktopRuntime(options: PrepareDesktopRuntimeOptions): Promise<string> {
  const paths = desktopRuntimeBuildPaths(options.desktopRoot)
  const log = options.log ?? console.log
  rmSync(paths.runtime, { recursive: true, force: true })
  const targets = desktopRuntimeTargets(options.platform)
  if (targets.length === 0) {
    log(`Desktop ships no interpreter payload for ${options.platform}`)
    return paths.runtime
  }
  const lock = readPrimaryRuntimeLock()
  const skillSource = join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets')
  for (const { target, arch } of targets) {
    log(`Preparing the ${target} primary runtime (Python ${lock.pythonVersion}, Node ${lock.nodeVersion}) for ${options.version}`)
    await preparePrimaryRuntime({ lock, target, output: join(paths.runtime, arch), cache: paths.downloads, version: options.version, skillSource })
  }
  return paths.runtime
}

/**
 * Execute every payload this host can run: the native CPU directly, and the Intel payload under
 * Rosetta when an Apple Silicon host has it. Other payloads are reported, not executed.
 * @param runtimeRoot - Prepared runtime root.
 * @param platform - Platform the payloads target.
 * @param log - Progress output.
 * @returns CPUs whose payload ran.
 */
export function smokeDesktopRuntime(runtimeRoot: string, platform: NodeJS.Platform, log: (message: string) => void = console.log): DesktopRuntimeArch[] {
  const executed: DesktopRuntimeArch[] = []
  for (const { arch } of desktopRuntimeTargets(platform)) {
    const root = primaryRuntimeDirectory(runtimeRoot, arch)
    const launcher = platform === 'darwin' && arch === 'x64' && process.arch === 'arm64' && rosettaAvailable() ? ['/usr/bin/arch', '-x86_64'] : undefined
    if (smokePrimaryRuntime(root, launcher === undefined ? {} : { launcher })) {
      executed.push(arch)
      log(`Primary runtime smoke passed for ${arch}${launcher === undefined ? '' : ' under Rosetta'}`)
    } else log(`Primary runtime smoke skipped for ${arch}: this ${process.platform} ${process.arch} host cannot execute it`)
  }
  return executed
}

/** One verified payload. */
export interface VerifiedDesktopRuntime {
  readonly arch: DesktopRuntimeArch
  readonly directory: string
  readonly manifest: PrimaryRuntimeManifest
}

function requireFile(path: string, description: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Desktop runtime: missing ${description}: ${path}`)
}

/**
 * Check a prepared or packaged runtime root: every CPU's payload declares this platform, CPU and
 * version with Node and pnpm, its entry points and Office resources exist, and on macOS the
 * interpreters are thin Mach-O files of the declared CPU.
 * @param runtimeRoot - `.desktop-build/runtime` or the packaged `Resources/runtime`.
 * @param platform - Platform the package targets.
 * @param expectedVersion - Product version every manifest must record.
 * @returns The verified payloads in target order.
 */
export function verifyDesktopRuntimeTree(runtimeRoot: string, platform: NodeJS.Platform, expectedVersion: string): VerifiedDesktopRuntime[] {
  const verified: VerifiedDesktopRuntime[] = []
  for (const { arch } of desktopRuntimeTargets(platform)) {
    const directory = primaryRuntimeDirectory(runtimeRoot, arch)
    const manifestFile = join(directory, 'runtime.json')
    requireFile(manifestFile, `${arch} payload manifest`)
    const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(manifestFile, 'utf8')))
    if (manifest.platform !== platform || manifest.arch !== arch) throw new Error(`Desktop runtime: ${directory} declares ${manifest.platform} ${manifest.arch}, expected ${platform} ${arch}`)
    if (manifest.desktopVersion !== expectedVersion) throw new Error(`Desktop runtime: ${directory} declares version ${manifest.desktopVersion}, expected ${expectedVersion}`)
    if (manifest.node === undefined || manifest.pnpm === undefined) throw new Error(`Desktop runtime: ${directory} must bundle Node and pnpm`)
    const entries = workspaceDependencyPaths(directory, manifest)
    if (entries.node === undefined || entries.pnpm === undefined) throw new Error(`Desktop runtime: ${directory} resolves no Node or pnpm entry`)
    requireFile(entries.python, `${arch} Python interpreter`)
    requireFile(entries.node, `${arch} Node executable`)
    requireFile(entries.pnpm, `${arch} pnpm entry`)
    if (!existsSync(entries.pythonPackages) || !statSync(entries.pythonPackages).isDirectory()) throw new Error(`Desktop runtime: missing ${arch} site-packages: ${entries.pythonPackages}`)
    if (platform === 'darwin') {
      for (const file of [entries.python, entries.node]) {
        const slices = machOArchitectures(file)
        if (slices.length !== 1 || slices[0] !== arch) throw new Error(`Desktop runtime: ${file} is ${slices.join('/') || 'not Mach-O'}, expected a thin ${arch} executable`)
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

/** Inputs of one complete preparation. */
export interface PrepareDesktopInterpretersOptions {
  readonly desktopRoot: string
  /** Platform the payloads target; defaults to this host. */
  readonly platform?: NodeJS.Platform
  /** Signs every payload in place before the final checks; signed macOS releases pre-sign the interpreters. */
  readonly sign?: (runtimeRoot: string) => Promise<void>
  readonly log?: (message: string) => void
}

/**
 * Prepare every interpreter payload the platform ships, sign them when a release signer is given,
 * then check and execute the final bytes. Development launches and every packaging entry run this
 * first; electron-builder later copies the tree as extra resources.
 * @param options - Package root, target platform and optional signer.
 * @returns The prepared runtime root.
 */
export async function prepareDesktopInterpreters(options: PrepareDesktopInterpretersOptions): Promise<string> {
  const platform = options.platform ?? process.platform
  const version = expectedDesktopVersion(options.desktopRoot)
  const paths = desktopRuntimeBuildPaths(options.desktopRoot)
  if (options.sign === undefined && process.env.DSH_PACKAGE_CHECK_ALREADY_RAN === '1') {
    try {
      const verified = verifyDesktopRuntimeTree(paths.runtime, platform, version)
      if (verified.length > 0) {
        ;(options.log ?? console.log)(`Reusing prepared primary runtime for ${verified.map(item => item.arch).join(', ')}`)
        return paths.runtime
      }
    } catch {
      // Prepared runtime does not exist or is incomplete; materialize it below.
    }
  }
  const root = await prepareDesktopRuntime({ desktopRoot: options.desktopRoot, platform, version, ...(options.log === undefined ? {} : { log: options.log }) })
  if (options.sign !== undefined) await options.sign(root)
  verifyDesktopRuntimeTree(root, platform, version)
  smokeDesktopRuntime(root, platform, options.log)
  return root
}

/**
 * Re-check the prepared tree right before electron-builder copies it; the payloads were prepared
 * before the package gates started.
 * @param desktopRoot - Desktop package root.
 * @param platform - Platform the package targets.
 * @returns The verified payloads.
 */
export function verifyPreparedDesktopRuntime(desktopRoot: string, platform: NodeJS.Platform = process.platform): VerifiedDesktopRuntime[] {
  return verifyDesktopRuntimeTree(desktopRuntimeBuildPaths(desktopRoot).runtime, platform, expectedDesktopVersion(desktopRoot))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await prepareDesktopInterpreters({ desktopRoot: resolve(import.meta.dirname, '..') })
}
