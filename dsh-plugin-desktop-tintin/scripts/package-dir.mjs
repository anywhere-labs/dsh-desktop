/** Build an unsigned unpacked application for the current host platform. */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')
const electronDist = resolve(dirname(require.resolve('electron/package.json')), 'dist')

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
  return electronBuilderEnvironment({
    ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(environment)),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  })
}

/**
 * Build an unsigned, unpacked application for the current host platform.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   electronBuilderCli?: string,
 *   electronDistPath?: string,
 *   nodeExecutable?: string,
 *   run?: typeof spawnSync,
 * }} [options]
 */
export function packageDirectory(options = {}) {
  const run = options.run ?? spawnSync
  const nodeExecutable = options.nodeExecutable ?? process.execPath
  const electronBuilderCli = options.electronBuilderCli ?? builderCli
  const configuredElectronDist = options.electronDistPath ?? electronDist
  const result = run(
    nodeExecutable,
    [
      electronBuilderCli,
      ...UNSIGNED_DIRECTORY_BUILD_ARGS,
      ...versionStampArgs(options.env ?? process.env),
      `--config.electronDist=${configuredElectronDist}`,
    ],
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

/**
 * 版本日期戳（2026-10-12 用户裁决：每次打出的版本都带日期——产物文件名、安装实例、
 * 卸载器三处可对齐，多个 0.2.0-dev.0 无法分辨的时代结束）。
 * 经 extraMetadata.version 注入本次构建（semver 预发布段），不落 package.json。
 * env.DSH_VERSION_STAMP：缺省=构建时刻 `YYYYMMDD.HHmm`；'off'=关闭；给定值=固定
 * 戳（Release-Builder 用自己目录时间对齐时传同值即可）。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Date} [now]
 * @returns {string[]} electron-builder 追加参数
 */
export function versionStampArgs(env = process.env, now = new Date()) {
  const stamp = env.DSH_VERSION_STAMP
  if (stamp === 'off') return []
  const resolved = stamp
    ?? `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  return [`--config.extraMetadata.version=${pkg.version}-${resolved}`]
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  packageDirectory()
}
