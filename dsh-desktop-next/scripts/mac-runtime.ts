import { chmodSync, cpSync, constants, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES, prepareMacUniversalRuntime, type MacSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { cuaNativeEntries, prepareCuaNative } from './upstream-family.ts'

/** One macOS package: the application for one CPU, or the universal application that carries both. */
export type MacPackageArch = MacSmokeArchitecture

/** CPU of the native files and interpreter payloads a macOS package carries. */
export type MacPackageCpu = 'arm64' | 'x64'

/**
 * CPUs one macOS package carries.
 * @param arch - The package.
 * @returns Both CPUs for the universal package, else its own CPU.
 */
export function macPackageCpus(arch: MacPackageArch): MacPackageCpu[] {
  return arch === 'universal' ? ['arm64', 'x64'] : [arch]
}

// Next uses the official Host, which has no dependency on the old desktop lock binding.
export const NEXT_MAC_NATIVE_ENTRIES = [
  ...MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(entry => !entry.path.startsWith('node_modules/fs-ext/')),
  { arch: 'arm64' as const, path: 'node_modules/@trycua/cua-driver-darwin-arm64/cua_driver_node_runtime.node' },
  { arch: 'x86_64' as const, path: 'node_modules/@trycua/cua-driver-darwin-x64/cua_driver_node_runtime.node' },
  { arch: 'arm64' as const, path: 'node_modules/@ubjs/node-darwin-arm64/uniffi-runtime-napi.darwin-arm64.node' },
  { arch: 'x86_64' as const, path: 'node_modules/@ubjs/node-darwin-x64/uniffi-runtime-napi.darwin-x64.node' },
]
/**
 * Native files one macOS package carries: the fixed inventory and, when it ships the official Computer Use
 * bundle, that bundle's helpers.
 * @param desktopRoot - Desktop package root.
 * @param cpus - CPUs the package carries.
 * @returns Thin native files per CPU, relative to the application directory.
 */
export function nextMacNativeEntries(desktopRoot: string, cpus: readonly MacPackageCpu[] = ['arm64', 'x64']): { arch: 'arm64' | 'x86_64'; path: string }[] {
  return [...NEXT_MAC_NATIVE_ENTRIES, ...cuaNativeEntries?.(desktopRoot) ?? []]
    .filter(entry => cpus.includes(entry.arch === 'x86_64' ? 'x64' : 'arm64'))
}
export function prepareNextMacRuntime(desktopRoot: string, cpus: readonly MacPackageCpu[] = ['arm64', 'x64']): void {
  prepareCuaNative?.(desktopRoot, cpus)
  prepareMacUniversalRuntime({ desktopRoot, nativeEntries: nextMacNativeEntries(desktopRoot, cpus), exists: existsSync, chmod: chmodSync })
}

/**
 * DMGs a signed release builds by default, in build order: one per CPU, and the universal one that installations
 * from releases before per-CPU packages update to, because their updaters name no CPU.
 */
export const DEFAULT_MAC_RELEASE_ARCHS: readonly MacPackageArch[] = ['arm64', 'x64', 'universal']

/**
 * DMGs a signed release builds: `DSH_MAC_RELEASE_ARCHS`, a comma-separated selection of `arm64`, `x64` and
 * `universal`, else {@link DEFAULT_MAC_RELEASE_ARCHS}.
 * @param env - Packaging environment.
 * @returns Packages in build order.
 */
export function macReleaseArchs(env: NodeJS.ProcessEnv): readonly MacPackageArch[] {
  const value = env.DSH_MAC_RELEASE_ARCHS
  if (value === undefined || value.trim() === '') return DEFAULT_MAC_RELEASE_ARCHS
  const archs = value.split(',').map(item => item.trim())
  if (archs.some(arch => !['arm64', 'x64', 'universal'].includes(arch)) || new Set(archs).size !== archs.length) {
    throw new Error(`DSH_MAC_RELEASE_ARCHS must list arm64, x64 or universal, each at most once; received ${JSON.stringify(value)}`)
  }
  return archs as MacPackageArch[]
}

/**
 * The package a DMG holds, from the `${arch}` electron-builder writes before the extension.
 * @param path - DMG path or name.
 * @returns The package, or undefined for a name without one.
 */
export function macDmgArch(path: string): MacPackageArch | undefined {
  return /-(arm64|x64|universal)\.dmg$/u.exec(path)?.[1] as MacPackageArch | undefined
}

/**
 * Check that this Mac can start every package a run builds, as the final checks start each packaged application:
 * the Apple silicon application needs an Apple silicon Mac, and the Intel one an Intel Mac or Rosetta. The universal
 * application runs on either.
 * @param archs - Packages the run builds.
 * @param hostArch - CPU of this Node process.
 * @param rosetta - Whether Rosetta runs Intel code on this Mac.
 */
export function assertMacPackagesRunnable(archs: readonly MacPackageArch[], hostArch: string, rosetta: () => boolean): void {
  if (archs.includes('arm64') && hostArch !== 'arm64') throw new Error('The arm64 macOS package can only be built and checked on an Apple silicon Mac')
  if (archs.includes('x64') && hostArch === 'arm64' && !rosetta()) {
    throw new Error('The x64 macOS package runs its final checks under Rosetta on Apple silicon; install it with `softwareupdate --install-rosetta --agree-to-license`')
  }
}

/** Directory, relative to the package root, that `build.mac.extraResources` copies as `Resources/runtime`. */
export const PACKAGED_RUNTIME_DIR = '.desktop-build/package-runtime'

/**
 * Stage the interpreter payloads one macOS package carries. The prepared runtime tree holds every CPU a packaging
 * run needs and is signed in place, so each package copies the payloads of its own CPUs from it, as clones where the
 * volume supports them; links are copied as they are.
 * @param desktopRoot - Desktop package root.
 * @param runtimeRoot - Prepared runtime tree with one directory per CPU.
 * @param cpus - CPUs the package carries.
 * @returns The staged directory.
 */
export function stagePackagedRuntime(desktopRoot: string, runtimeRoot: string, cpus: readonly MacPackageCpu[]): string {
  const staged = join(desktopRoot, ...PACKAGED_RUNTIME_DIR.split('/'))
  rmSync(staged, { recursive: true, force: true })
  for (const cpu of cpus) {
    const source = join(runtimeRoot, cpu)
    if (!existsSync(source)) throw new Error(`Next runtime: no prepared ${cpu} payload to package in ${runtimeRoot}`)
    cpSync(source, join(staged, cpu), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE })
  }
  return staged
}
