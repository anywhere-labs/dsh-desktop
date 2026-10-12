/** Unsigned NSIS installer build for the TinTin channel (local packaging).
 *
 * Reuses the channel's own unsigned-build plumbing (the same environment and
 * flag surface as scripts/package-dir.mjs) but targets NSIS instead of --dir.
 * The repository's dist:win release chain runs Beta-pinned packaging specs
 * that are not yet identity-normalized for the TinTin channel; local
 * packaging goes through here and relies on artifact verification instead.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'
// 版本日期戳（2026-10-12 用户裁决）：与 package-dir.mjs 同源——DSH_VERSION_STAMP
// 由 Release-Builder 统一下发（目录名/setup 名/应用内版本三处一致），缺省=构建时刻
import { versionStampArgs } from './package-dir.mjs'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')
const electronDist = resolve(dirname(require.resolve('electron/package.json')), 'dist')

const env = electronBuilderEnvironment({
  ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(process.env)),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
})

const args = [
  builderCli,
  '--win', 'nsis',
  '--publish', 'never',
  '--config.forceCodeSigning=false',
  '--config.win.signExecutable=false',
  '--config.mac.identity=null',
  '--config.mac.notarize=false',
  ...versionStampArgs(process.env),
  `--config.electronDist=${electronDist}`,
]

const result = spawnSync(process.execPath, args, { cwd: packageRoot, env, stdio: 'inherit' })
if (result.error !== undefined) throw result.error
if (result.status !== 0) {
  throw new Error(`electron-builder --win nsis exited with ${String(result.status)}`)
}
