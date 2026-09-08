/** Build an unsigned unpacked application for the current host platform. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')

/** Electron Builder overrides that make the directory build unconditionally unsigned. */
export const UNSIGNED_DIRECTORY_BUILD_ARGS = Object.freeze([
  '--dir',
  '--publish',
  'never',
  '--config.forceCodeSigning=false',
  '--config.mac.identity=null',
  '--config.mac.notarize=false',
  '--config.win.signExecutable=false',
])

/**
 * Remove every release credential recognized by the native release entry points.
 * @param {NodeJS.ProcessEnv} environment
 * @returns {NodeJS.ProcessEnv}
 */
export function unsignedDirectoryBuildEnvironment(environment) {
  return {
    ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(environment)),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  }
}

/**
 * Build an unsigned, unpacked application for the current host platform.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   electronBuilderCli?: string,
 *   nodeExecutable?: string,
 *   run?: typeof spawnSync,
 * }} [options]
 */
export function packageDirectory(options = {}) {
  const run = options.run ?? spawnSync
  const nodeExecutable = options.nodeExecutable ?? process.execPath
  const electronBuilderCli = options.electronBuilderCli ?? builderCli
  const result = run(
    nodeExecutable,
    [electronBuilderCli, ...UNSIGNED_DIRECTORY_BUILD_ARGS],
    {
      cwd: options.cwd ?? packageRoot,
      env: unsignedDirectoryBuildEnvironment(options.env ?? process.env),
      stdio: 'inherit',
    },
  )

  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`electron-builder --dir exited with ${String(result.status)}`)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  packageDirectory()
}
