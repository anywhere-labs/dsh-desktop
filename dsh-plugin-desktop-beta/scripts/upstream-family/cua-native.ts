/** Provide the macOS helper application of the official Computer Use bundle where its provider starts it, building it when the release ships none. */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { OFFICIAL_CUA_PROVIDER_PACKAGE } from '../../src/upstream-family/official-cua.ts'

/** The official Computer Use bundle; a Desktop package that depends on it ships the bundle's macOS provider. */
export const OFFICIAL_COMPUTER_USE_BUNDLE = '@deepseek-ai/dsh-cua-bundle'

/** CPUs as the provider names its helper directories. */
export type CuaNativeArch = 'arm64' | 'x64'

/** Every CPU a universal macOS package carries a helper for. */
export const CUA_NATIVE_ARCHS: readonly CuaNativeArch[] = ['arm64', 'x64']

/** Runs `/usr/bin/xcrun` with these arguments and throws when it fails. */
export type RunXcrun = (args: readonly string[]) => void

/** The application one generation directory holds. */
const APPLICATION = 'DSH Computer Use.app'

/** Generation directories are named by the content digest of the application they hold. */
const GENERATION = /^[a-f0-9]{64}$/u

const runXcrun: RunXcrun = (args) => {
  const result = spawnSync('/usr/bin/xcrun', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`xcrun ${args.join(' ')} ${result.signal ?? `exited with ${String(result.status)}`}: ${`${result.stdout}${result.stderr}`.trim()}`)
  }
}

/**
 * Locate the installed macOS provider when this Desktop package ships the official bundle.
 * @param desktopRoot - Desktop package root.
 * @returns The provider's package directory, or undefined when the package does not depend on the bundle.
 * @throws When the bundle is a dependency but its provider is not installed, as on other platforms.
 */
export function cuaNativePackageDir(desktopRoot: string): string | undefined {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  if (manifest.dependencies?.[OFFICIAL_COMPUTER_USE_BUNDLE] === undefined) return undefined
  const bundle = createRequire(join(desktopRoot, 'package.json')).resolve(`${OFFICIAL_COMPUTER_USE_BUNDLE}/package.json`)
  return dirname(createRequire(bundle).resolve(`${OFFICIAL_CUA_PROVIDER_PACKAGE}/package.json`))
}

/**
 * The directory holding one CPU's application generations and the `current.json` receipt that selects one.
 * @param arch - Helper CPU.
 * @returns Slash-separated path below the provider's package directory.
 */
export function cuaNativeDirectory(arch: CuaNativeArch): string {
  return `native/bin/darwin-${arch}`
}

/**
 * The executable the provider starts for a Host process of one CPU.
 * @param arch - Helper CPU.
 * @param generation - Generation the CPU's receipt selects.
 * @returns Slash-separated path below the provider's package directory.
 */
export function cuaNativeExecutable(arch: CuaNativeArch, generation: string): string {
  return `${cuaNativeDirectory(arch)}/${generation}/${APPLICATION}/Contents/MacOS/dsh-cua-native`
}

/**
 * Read the generation a CPU's receipt selects, as the provider does before starting the helper.
 * @param directory - The CPU's helper directory.
 * @returns The selected generation, or undefined when the directory has no receipt.
 * @throws When the receipt names no generation.
 */
function selectedGeneration(directory: string): string | undefined {
  const receipt = join(directory, 'current.json')
  if (!existsSync(receipt)) return undefined
  const { bundle } = JSON.parse(readFileSync(receipt, 'utf8')) as { bundle?: unknown }
  if (typeof bundle !== 'string' || !GENERATION.test(bundle)) throw new Error(`${receipt} selects no helper application generation`)
  return bundle
}

/**
 * The helpers a packaged application must carry, as entries of the universal native-file inventory.
 * @param desktopRoot - Desktop package root, after {@link prepareCuaNative} prepared every CPU.
 * @returns One thin executable per CPU, or none when the package does not ship the official bundle.
 * @throws When a CPU has no helper application yet.
 */
export function cuaNativeEntries(desktopRoot: string): { arch: 'arm64' | 'x86_64'; path: string }[] {
  const packageDir = cuaNativePackageDir(desktopRoot)
  if (packageDir === undefined) return []
  return CUA_NATIVE_ARCHS.map((arch) => {
    const generation = selectedGeneration(join(packageDir, ...cuaNativeDirectory(arch).split('/')))
    if (generation === undefined) throw new Error(`The official Computer Use provider has no ${arch} helper application; prepare it first`)
    return {
      arch: arch === 'x64' ? 'x86_64' : 'arm64',
      path: `node_modules/${OFFICIAL_CUA_PROVIDER_PACKAGE}/${cuaNativeExecutable(arch, generation)}`,
    }
  })
}

/**
 * Prepare the helper applications the official Computer Use provider starts. An installed provider reads
 * `native/bin/darwin-<arch>/current.json` below its package directory, starts `dsh-cua-native` inside the
 * `DSH Computer Use.app` of the generation the receipt selects, and never builds one itself. A helper the
 * official release ships is used as published: Desktop only makes its executable runnable and never builds,
 * signs or rewrites it. Desktop builds only the helpers the package lacks, with the package's own
 * `native/build_app.py` and the arguments the provider uses in a source checkout: one incremental SwiftPM build
 * per CPU under `.desktop-build/cua-native/<arch>`, signed ad hoc until packaging signs the application. The
 * generation of each application Desktop selects is recorded there, outside the package, so a later run rebuilds
 * only while the receipt still selects that generation; reinstalling the package removes such an application.
 * The build script selects a changed application by replacing the receipt, so a running helper keeps its own
 * files; Desktop then removes the other generations of that CPU so a package carries one application per CPU.
 * @param desktopRoot - Desktop package root.
 * @param archs - CPUs to prepare.
 * @param run - `xcrun` executor; the Swift toolchain of Xcode or the Command Line Tools must be installed.
 * @returns Absolute paths of the prepared helper executables; empty when the package does not ship the official bundle.
 */
export function prepareCuaNative(desktopRoot: string, archs: readonly CuaNativeArch[], run: RunXcrun = runXcrun): string[] {
  const packageDir = cuaNativePackageDir(desktopRoot)
  if (packageDir === undefined) return []
  return archs.map((arch) => {
    const scratch = join(desktopRoot, '.desktop-build', 'cua-native', arch)
    const record = join(scratch, 'written-application')
    const directory = join(packageDir, ...cuaNativeDirectory(arch).split('/'))
    const written = existsSync(record) ? readFileSync(record, 'utf8') : undefined
    const shipped = selectedGeneration(directory)
    if (shipped !== undefined && shipped !== written) {
      const executable = join(packageDir, ...cuaNativeExecutable(arch, shipped).split('/'))
      chmodSync(executable, 0o755)
      return executable
    }
    mkdirSync(scratch, { recursive: true })
    run(['python3', join(packageDir, 'native', 'build_app.py'), '--scratch-path', scratch,
      '--output-directory', directory, '--arch', arch === 'x64' ? 'x86_64' : 'arm64'])
    const generation = selectedGeneration(directory)
    if (generation === undefined) throw new Error(`Building the official Computer Use helper selected no ${arch} application`)
    for (const entry of readdirSync(directory)) {
      if (GENERATION.test(entry) && entry !== generation) rmSync(join(directory, entry), { recursive: true, force: true })
    }
    writeFileSync(record, generation)
    const executable = join(packageDir, ...cuaNativeExecutable(arch, generation).split('/'))
    chmodSync(executable, 0o755)
    return executable
  })
}
