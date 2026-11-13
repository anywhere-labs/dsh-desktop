/** Provide the macOS helper of the official Computer Use bundle where its provider starts it, compiling it when the release ships none. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { OFFICIAL_CUA_PROVIDER_PACKAGE } from '../../src/upstream-family/official-cua.ts'

/** The official Computer Use bundle; a Desktop package that depends on it ships the bundle's macOS provider. */
export const OFFICIAL_COMPUTER_USE_BUNDLE = '@deepseek-ai/dsh-cua-bundle'

/** CPUs as the provider names its helper directories. */
export type CuaNativeArch = 'arm64' | 'x64'

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
export function cuaNativeExecutable(arch: CuaNativeArch, packageDir: string): string {
  const directory = `native/bin/darwin-${arch}`
  const receipt = JSON.parse(readFileSync(join(packageDir, directory, 'current.json'), 'utf8')) as { bundle?: unknown }
  if (typeof receipt.bundle !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.bundle)) throw new Error('Invalid official CUA application receipt')
  const path = `${directory}/${receipt.bundle}/DSH Computer Use.app/Contents/MacOS/dsh-cua-native`
  accessSync(join(packageDir, path), constants.X_OK)
  return path
}

/**
 * Use a published signed application unchanged, or invoke the official application builder.
 * Each immutable application is selected by current.json; locally built applications are
 * tracked outside the package so subsequent builds can refresh their sources.
 */
export function prepareCuaNative(desktopRoot: string, archs: readonly CuaNativeArch[], run: RunXcrun = runXcrun): string[] {
  const packageDir = cuaNativePackageDir(desktopRoot)
  if (packageDir === undefined) return []
  return archs.map((arch) => {
    const scratch = join(desktopRoot, '.desktop-build', 'cua-native', arch)
    const record = join(scratch, 'written-helper.sha256')
    const directory = join(packageDir, 'native', 'bin', `darwin-${arch}`)
    if (existsSync(join(directory, 'current.json'))) {
      const existing = join(packageDir, cuaNativeExecutable(arch, packageDir))
      // Published signed bundles are authoritative. Only rebuild a helper this workspace produced.
      if (!existsSync(record) || sha256(readFileSync(existing)) !== readFileSync(record, 'utf8')) return existing
    }
    run(['python3', join(packageDir, 'native', 'build_app.py'), '--scratch-path', scratch,
      '--output-directory', directory, '--arch', arch === 'x64' ? 'x86_64' : 'arm64', '--variant', 'release', '--identity', '-'])
    const executable = join(packageDir, cuaNativeExecutable(arch, packageDir))
    mkdirSync(scratch, { recursive: true })
    writeFileSync(record, sha256(readFileSync(executable)))
    return executable
  })
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
