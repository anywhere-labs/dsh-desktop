/** Provide the macOS helper of the official Computer Use bundle where its provider starts it, compiling it when the release ships none. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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
 * The helper of one CPU, where the provider looks it up for a Host process of that CPU.
 * @param arch - Helper CPU.
 * @returns Slash-separated path below the provider's package directory.
 */
export function cuaNativeExecutable(arch: CuaNativeArch): string {
  return `native/bin/darwin-${arch}/dsh-cua-native`
}

/**
 * The helpers a packaged application must carry, as entries of the universal native-file inventory.
 * @param desktopRoot - Desktop package root.
 * @returns One thin executable per CPU, or none when the package does not ship the official bundle.
 */
export function cuaNativeEntries(desktopRoot: string): { arch: 'arm64' | 'x86_64'; path: string }[] {
  if (cuaNativePackageDir(desktopRoot) === undefined) return []
  return CUA_NATIVE_ARCHS.map(arch => ({
    arch: arch === 'x64' ? 'x86_64' : 'arm64',
    path: `node_modules/${OFFICIAL_CUA_PROVIDER_PACKAGE}/${cuaNativeExecutable(arch)}`,
  }))
}

/**
 * Prepare the helpers the official Computer Use provider starts from `native/bin/darwin-<arch>/dsh-cua-native`
 * below its package directory. The provider's README and published `files` place compiled helpers there, so a
 * helper the official release ships is used as published: Desktop only makes it executable and never compiles
 * or rewrites it. Desktop builds only the helpers the package lacks (0.2.2-alpha.2 ships none), with the
 * arguments the provider itself uses in a source checkout and one incremental SwiftPM build per CPU under
 * `.desktop-build/cua-native/<arch>`. The sha256 of each helper Desktop writes is recorded there, outside the
 * package, so a later run rebuilds only a helper whose bytes still match that record; reinstalling the package
 * removes such a helper. A changed helper replaces the previous file by rename, so a running helper keeps its
 * own executable.
 * @param desktopRoot - Desktop package root.
 * @param archs - CPUs to prepare.
 * @param run - `xcrun` executor; the Swift toolchain of Xcode or the Command Line Tools must be installed.
 * @returns Absolute paths of the prepared helpers; empty when the package does not ship the official bundle.
 */
export function prepareCuaNative(desktopRoot: string, archs: readonly CuaNativeArch[], run: RunXcrun = runXcrun): string[] {
  const packageDir = cuaNativePackageDir(desktopRoot)
  if (packageDir === undefined) return []
  return archs.map((arch) => {
    const scratch = join(desktopRoot, '.desktop-build', 'cua-native', arch)
    const record = join(scratch, 'written-helper.sha256')
    const executable = join(packageDir, ...cuaNativeExecutable(arch).split('/'))
    const written = existsSync(record) ? readFileSync(record, 'utf8') : undefined
    if (existsSync(executable) && sha256(readFileSync(executable)) !== written) {
      chmodSync(executable, 0o755)
      return executable
    }
    run(['swift', 'build', '--package-path', join(packageDir, 'native'), '--scratch-path', scratch,
      '--configuration', 'release', '--product', 'dsh-cua-native', '--arch', arch === 'x64' ? 'x86_64' : 'arm64'])
    const built = readFileSync(join(scratch, 'release', 'dsh-cua-native'))
    if (!existsSync(executable) || !readFileSync(executable).equals(built)) {
      mkdirSync(dirname(executable), { recursive: true })
      const staged = `${executable}.${String(process.pid)}.tmp`
      writeFileSync(staged, built, { mode: 0o755 })
      renameSync(staged, executable)
    }
    writeFileSync(record, sha256(built))
    chmodSync(executable, 0o755)
    return executable
  })
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
