/** Next entry points reuse Stable/Beta's native packaging and credential boundaries. */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageDirectory } from '../../dsh-plugin-desktop-beta/scripts/package-dir.mjs'
import { releaseMac } from '../../dsh-plugin-desktop-beta/scripts/release-mac.ts'
import { packageMacSmoke } from '../../dsh-plugin-desktop-beta/scripts/package-mac.ts'
import { createWindowsPackageOptions, packageWindowsInstaller } from '../../dsh-plugin-desktop-beta/scripts/package-win.ts'
import { prepareNextMacRuntime } from './mac-runtime.ts'
import { runNextPackagingCommand } from './packaging-command.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = resolve(desktopRoot, '..')
const require = createRequire(import.meta.url)
const run = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void => {
  runNextPackagingCommand(command, args, cwd, env, workspaceRoot)
}
const prepareRuntime = (): void => {
  prepareNextMacRuntime(desktopRoot)
}
const mode = process.argv[2]
const outputDir = join(desktopRoot, 'dist', mode === 'mac' ? 'mac-release' : 'mac-smoke')
const shared = { env: process.env, platform: process.platform, desktopRoot, outputDir,
  resetOutput: () => rmSync(outputDir, { force: true, recursive: true }), run, log: console.log, prepareRuntime }
if (mode === 'dir') {
  if (process.platform === 'darwin') prepareRuntime()
  packageDirectory({ cwd: desktopRoot, electronBuilderCli: require.resolve('electron-builder/cli.js'), electronDistPath: join(dirname(require.resolve('electron/package.json')), 'dist') })
} else if (mode === 'mac') {
  releaseMac({ ...shared, listCodeSigningIdentities: env => {
    const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { env, encoding: 'utf8' })
    if (result.error || result.status !== 0) throw result.error ?? new Error('Signing identity discovery failed')
    return result.stdout
  } })
} else if (mode === 'mac-smoke') {
  packageMacSmoke({ ...shared, workspaceRoot, arch: process.arch, nodeVersion: process.versions.node,
    builderCli: require.resolve('electron-builder/cli.js'), verifier: join(desktopRoot, 'scripts/verify-mac-smoke.ts'), nodeExecutable: process.execPath })
} else if (mode === 'win') {
  packageWindowsInstaller({ ...createWindowsPackageOptions(), desktopRoot, workspaceRoot, run,
    prepareRuntime: () => {},
    verifier: join(desktopRoot, 'scripts/verify-win-installer.ts') })
} else throw new Error('Expected dir, mac, mac-smoke or win')
