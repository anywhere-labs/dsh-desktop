/** Build an unsigned macOS DMG smoke artifact on a native macOS host. */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withoutMacReleaseSecrets } from './release-preflight.ts'
import {
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
  macSmokeArchitecture,
  macSmokeExecutableSlices,
  prepareMacUniversalRuntime,
} from './mac-universal.ts'
import { prepareFsExtForElectron } from './prepare-fs-ext.ts'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'
import { prepareDesktopInterpreters, verifyPreparedDesktopRuntime } from './prepare-runtime.ts'

const MAC_COMPRESSION_LEVELS = new Set(['store', 'normal', 'maximum'])

/**
 * Read an optional electron-builder compression override for unsigned CI
 * smoke artifacts. DMG zlib compression and blockmap generation dominate the
 * macOS job while smoke artifacts are never published, so CI may select
 * `store`; release builds leave the variable unset and keep the package
 * configuration.
 * @param environment - Environment of the packaging process.
 * @returns The override, or `undefined` to keep the package configuration.
 */
export function macCompressionOverride(
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const value = environment.DSH_MAC_PACKAGE_COMPRESSION
  if (value === undefined || value === '') return undefined
  if (!MAC_COMPRESSION_LEVELS.has(value)) {
    throw new Error(
      `DSH_MAC_PACKAGE_COMPRESSION must be store, normal, or maximum; received ${JSON.stringify(value)}`,
    )
  }
  return value
}

/** Injectable native macOS packaging boundary used by focused tests. */
export interface MacSmokePackageOptions {
  /** Environment inherited by the packaging command. */
  readonly env: NodeJS.ProcessEnv
  /** Platform executing the package build. */
  readonly platform: NodeJS.Platform
  /** Node architecture executing the package build. */
  readonly arch: string
  /** Node version executing the package build. */
  readonly nodeVersion: string
  /** Repository root containing the Yarn workspace. */
  readonly workspaceRoot: string
  /** Desktop package root containing electron-builder configuration. */
  readonly desktopRoot: string
  /** Dedicated smoke output directory, isolated from signed release artifacts. */
  readonly outputDir: string
  /** Remove only the dedicated generated smoke output before packaging. */
  readonly resetOutput: () => void
  /** Validate and prepare both architecture-specific runtime trees. */
  readonly prepareRuntime: () => void
  /** Absolute electron-builder CLI module. */
  readonly builderCli: string
  /** Absolute packaged-DMG verification script. */
  readonly verifier: string
  /** Node executable used to run package-local scripts. */
  readonly nodeExecutable: string
  /** Execute one packaging command. */
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
  /** Report non-secret packaging progress. */
  readonly log: (message: string) => void
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function defaultOptions(): MacSmokePackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  const outputDir = resolve(desktopRoot, 'dist', 'mac-smoke')
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot,
    desktopRoot,
    outputDir,
    resetOutput: () => rmSync(outputDir, { recursive: true, force: true }),
    prepareRuntime: () => {
      const slices = macSmokeExecutableSlices(macSmokeArchitecture(process.env))
      for (const slice of slices) {
        prepareFsExtForElectron({
          platform: 'darwin',
          arch: slice === 'x86_64' ? 'x64' : 'arm64',
          desktopRoot,
        })
      }
      prepareMacUniversalRuntime({
        desktopRoot,
        nativeEntries: MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(
          entry => slices.includes(entry.arch) || !entry.path.startsWith('node_modules/fs-ext/'),
        ),
        exists: existsSync,
        chmod: chmodSync,
      })
      verifyPreparedDesktopRuntime(desktopRoot, 'darwin')
    },
    builderCli: require.resolve('electron-builder/cli.js'),
    verifier: fileURLToPath(new URL('./verify-mac-smoke.ts', import.meta.url)),
    nodeExecutable: process.execPath,
    run,
    log: message => console.log(message),
  }
}

/**
 * Run the headless release gates and package one unsigned macOS DMG smoke.
 *
 * The signed and notarized release stays a manual step on a credentialed
 * machine; this smoke exists so macOS packaging regressions fail in CI before
 * a manual release. The universal target exercises both Intel and Apple
 * Silicon packaging in one artifact; `DSH_MAC_SMOKE_ARCH=arm64` or `x64`
 * packages a single CPU instead and skips the slow universal merge.
 * @param options - Injectable process and command boundaries.
 */
export function packageMacSmoke(options: MacSmokePackageOptions = defaultOptions()): void {
  if (options.platform !== 'darwin') {
    throw new Error('macOS DMG smoke must be built on a native macOS host')
  }
  if (options.arch !== 'x64' && options.arch !== 'arm64') {
    throw new Error(`macOS DMG smoke requires x64 or arm64 Node; received ${options.arch}`)
  }
  const versionMatch = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(versionMatch?.[1])
  const minor = Number(versionMatch?.[2])
  if (!((major === 22 && minor >= 19) || major === 24)) {
    throw new Error(
      `macOS DMG smoke requires Node 22.19+ or Node 24.x with bundled Corepack; received ${options.nodeVersion}`,
    )
  }

  const architecture = macSmokeArchitecture(options.env)
  const compression = macCompressionOverride(options.env)
  const cleanEnvironment = withoutMacReleaseSecrets(options.env)
  options.log('Building an unsigned macOS DMG smoke; signing and notarization are release-only steps.')
  if (architecture !== 'universal') {
    options.log(`Packaging only the ${architecture} application; the universal merge is skipped.`)
  }
  if (compression !== undefined) {
    options.log(`Packaging the macOS DMG smoke with ${compression} compression.`)
  }
  if (options.env.DSH_PACKAGE_CHECK_ALREADY_RAN !== '1') {
    options.run(
      'corepack',
      ['yarn', 'workspace', 'dsh-plugin-desktop', 'check:mac-package'],
      options.workspaceRoot,
      cleanEnvironment,
    )
  } else {
    options.log('Skipping the macOS package preflight; the package gate already passed.')
  }
  options.resetOutput()
  options.prepareRuntime()
  options.run(
    options.nodeExecutable,
    [
      options.builderCli,
      '--mac',
      'dmg',
      `--${architecture}`,
      '--publish',
      'never',
      '--config.mac.notarize=false',
      '--config.npmRebuild=false',
      `--config.directories.output=${options.outputDir}`,
      ...(compression === undefined ? [] : [`--config.mac.compression=${compression}`]),
      ...(compression === 'store' ? ['--config.dmg.writeUpdateInfo=false'] : []),
    ],
    options.desktopRoot,
    electronBuilderEnvironment({
      ...cleanEnvironment,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    }),
  )
  options.run(
    options.nodeExecutable,
    [options.verifier, options.outputDir],
    options.desktopRoot,
    cleanEnvironment,
  )
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    // The interpreter payloads are downloaded and assembled before the long package gate; the flow re-checks them right before electron-builder.
    await prepareDesktopInterpreters({ desktopRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..') })
    packageMacSmoke()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
