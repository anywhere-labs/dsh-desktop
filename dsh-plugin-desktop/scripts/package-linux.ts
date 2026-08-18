/** Build unsigned Linux x64 deb, rpm, and AppImage artifacts on a native Linux host. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Injectable native Linux packaging boundary used by focused tests. */
export interface LinuxPackageOptions {
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
  /** Corepack executable used to run the workspace gate. */
  readonly corepackExecutable: string
  /** Absolute electron-builder CLI module. */
  readonly builderCli: string
  /** Absolute packaged-artifact verification script. */
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

function defaultOptions(): LinuxPackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot,
    desktopRoot,
    corepackExecutable: 'corepack',
    builderCli: require.resolve('electron-builder/cli.js'),
    verifier: fileURLToPath(new URL('./verify-linux-installer.ts', import.meta.url)),
    nodeExecutable: process.execPath,
    run,
    log: message => console.log(message),
  }
}

/**
 * Run the headless release gates and package deb, rpm, and AppImage for x64.
 * @param options - Injectable process and command boundaries.
 */
export function packageLinuxInstallers(
  options: LinuxPackageOptions = defaultOptions(),
): void {
  if (options.platform !== 'linux') {
    throw new Error('Linux packages must be built on a native Linux host')
  }
  if (options.arch !== 'x64') {
    throw new Error(`Linux x64 packaging requires x64 Node; received ${options.arch}`)
  }
  const versionMatch = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(versionMatch?.[1])
  const minor = Number(versionMatch?.[2])
  if (!((major === 22 && minor >= 19) || major === 24)) {
    throw new Error(
      `Linux packages require Node 22.19+ or Node 24.x with bundled Corepack; received ${options.nodeVersion}`,
    )
  }

  options.log(
    'Building unsigned Linux x64 deb, rpm, and AppImage artifacts; the rpm target requires host rpmbuild.',
  )
  if (options.env.DSH_PACKAGE_CHECK_ALREADY_RAN !== '1') {
    options.run(
      options.corepackExecutable,
      ['yarn', 'workspace', 'dsh-plugin-desktop', 'check:linux-package'],
      options.workspaceRoot,
      options.env,
    )
  } else {
    options.log('Skipping the Linux package preflight; the CI shared gate already passed.')
  }
  options.run(
    options.nodeExecutable,
    [
      options.builderCli,
      '--linux',
      'deb',
      'rpm',
      'AppImage',
      '--x64',
      '--publish',
      'never',
      '--config.npmRebuild=false',
    ],
    options.desktopRoot,
    options.env,
  )
  options.run(
    options.nodeExecutable,
    [options.verifier],
    options.desktopRoot,
    options.env,
  )
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageLinuxInstallers()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
