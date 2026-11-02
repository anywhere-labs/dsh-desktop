/** Next entry points reuse Stable/Beta's native packaging and credential boundaries. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageDirectory } from '../../dsh-plugin-desktop/scripts/package-dir.mjs'
import { createLinuxPackageOptions, packageLinuxArtifacts } from '../../dsh-plugin-desktop/scripts/package-linux.ts'
import { releaseMac } from '../../dsh-plugin-desktop/scripts/release-mac.ts'
import { adaptMacReleaseEnvironment, assertMacReleaseReady, withoutMacReleaseSecrets } from '../../dsh-plugin-desktop/scripts/release-preflight.ts'
import { packageMacSmoke } from '../../dsh-plugin-desktop/scripts/package-mac.ts'
import { macSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { createWindowsPackageOptions, packageWindowsArtifact, packageWindowsInstaller } from '../../dsh-plugin-desktop/scripts/package-win.ts'
import { assertMacPackagesRunnable, macPackageCpus, macReleaseArchs, prepareNextMacRuntime, stagePackagedRuntime, type MacPackageArch, type MacPackageCpu } from './mac-runtime.ts'
import { rosettaAvailable } from './primary-runtime.ts'
import { runNextPackagingCommand } from './packaging-command.ts'
import { expectedNextVersion, nextRuntimeBuildPaths, nextRuntimeTargets, prepareNextRuntime, primaryRuntimeDirectory, reusableNextRuntimeTree, smokeNextRuntime, verifyNextRuntimeTree, verifyPackagedNextRuntime } from './prepare-runtime.ts'
import { signMacRuntime, withMacSigningIdentity } from './sign-runtime.ts'
import { packagingStep, packagingStepSync } from './packaging-step.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = resolve(desktopRoot, '..')
const require = createRequire(import.meta.url)
const APP_ID = (JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { build: { appId: string } }).build.appId

/**
 * Optional test-only build version for update drills.
 *
 * electron-builder merges `extraMetadata` before signing, so one value reaches
 * the packaged `package.json` (which the runtime and the updater's bundle check
 * read), `Info.plist` `CFBundleShortVersionString`/`CFBundleVersion`, and the
 * `${version}` artifact name. That produces an installable, correctly signed
 * release whose version differs from the source tree, without editing any
 * version declaration. Only the two shapes the Next channel accepts are allowed.
 * The bundled interpreter payloads and the prepared archive payload record the
 * same version.
 */
const TEST_BUILD_VERSION = process.env.DSH_NEXT_BUILD_VERSION
if (TEST_BUILD_VERSION !== undefined && !/^[0-9]+\.[0-9]+\.[0-9]+-next(?:\.[0-9]+)?$/u.test(TEST_BUILD_VERSION)) {
  throw new Error(`DSH_NEXT_BUILD_VERSION must be x.y.z-next or x.y.z-next.N; received ${TEST_BUILD_VERSION}`)
}
const buildVersion = expectedNextVersion(desktopRoot)
const run = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void => {
  // Windows resolves the CLI path with backslashes.
  const isBuilder = args.includes('electron-builder') || args.some(arg => arg.replaceAll('\\', '/').endsWith('electron-builder/cli.js'))
  // Beta skips electron-builder's dependency rebuild with npmRebuild=false. electron-builder honours
  // that flag before it calls beforeBuild, and only a beforeBuild answer makes it leave node_modules
  // to the prepared payload, so Next drops the flag: its beforeBuild hook declines the rebuild too.
  const withoutRebuildFlag = isBuilder ? args.filter(arg => arg !== '--config.npmRebuild=false') : args
  const forwarded = TEST_BUILD_VERSION !== undefined && isBuilder
    ? [...withoutRebuildFlag, `--config.extraMetadata.version=${TEST_BUILD_VERSION}`, `--config.buildVersion=${TEST_BUILD_VERSION}`]
    : withoutRebuildFlag
  if (TEST_BUILD_VERSION !== undefined && isBuilder) console.log(`Packaging with test build version ${TEST_BUILD_VERSION}; source manifests are unchanged.`)
  const isPreflight = (args.includes('run') && args.includes('check')) || args.some(arg => arg.includes('check:win-package') || arg.includes('check:linux-package'))
  const stage = isBuilder ? 'builder:total' : isPreflight ? 'build:package-preflight' : 'package:command'
  const measuredArgs = isBuilder && env.DSH_DESKTOP_PACKAGING_RUN_DIR !== undefined
    ? ['--import', new URL('./packaging-builder.mjs', import.meta.url).href, ...forwarded]
    : forwarded
  const builderEnv = isBuilder ? { ...env, DSH_NEXT_WINDOWS_FAST_COMPRESSION: '1' } : env
  packagingStepSync(stage, () => runNextPackagingCommand(command, measuredArgs, cwd, builderEnv, workspaceRoot))
}
const listCodeSigningIdentities = (env: NodeJS.ProcessEnv): string => {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { env, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw result.error ?? new Error('Signing identity discovery failed')
  return result.stdout
}

let interpretersVerified = false

/**
 * Prepare every interpreter payload the platform ships, sign them when a release identity is given,
 * then check and execute the final bytes. Packages copy them as extra resources.
 * @param sign - Signs the prepared tree with the release identity.
 * @param macCpus - macOS CPUs a release selected, in place of the smoke selection.
 */
async function prepareInterpreters(sign?: (runtimeRoot: string) => Promise<void>, macCpus?: readonly MacPackageCpu[]): Promise<void> {
  const paths = nextRuntimeBuildPaths(desktopRoot)
  const reusable = packagingStepSync('runtime:check-reuse', () => reusableNextRuntimeTree(paths.runtime, process.platform, buildVersion, process.arch, macCpus))
  if (reusable.length > 0 && sign === undefined) {
    console.log(`Reusing prepared primary runtime for ${reusable.map(item => item.arch).join(', ')}`)
    interpretersVerified = true
    return
  }
  const root = reusable.length > 0
    ? paths.runtime
    : await packagingStep('runtime:prepare-primary', () => prepareNextRuntime({ desktopRoot, platform: process.platform, version: buildVersion, macCpus }))
  if (sign !== undefined) await sign(root)
  packagingStepSync('runtime:verify-primary', () => verifyNextRuntimeTree(root, process.platform, buildVersion, process.arch, macCpus))
  packagingStepSync('runtime:smoke-primary', () => smokeNextRuntime(root, process.platform, console.log, process.arch, macCpus))
  interpretersVerified = true
}
/**
 * Materialize and seal the payload electron-builder archives. A separate process keeps the
 * manifest transformer it borrows from electron-builder out of this entry point.
 * @param platform - Platform being packaged.
 * @param macArch - The macOS package the payload is for.
 */
const preparePayload = (platform: NodeJS.Platform, macArch?: MacPackageArch): void => packagingStepSync('payload:total', () => {
  const result = spawnSync(process.execPath, [join(desktopRoot, 'scripts', 'prepare-payload.ts'), '--platform', platform,
    ...(macArch === undefined ? [] : ['--arch', macArch]),
    ...(TEST_BUILD_VERSION === undefined ? [] : ['--version', TEST_BUILD_VERSION])], { cwd: desktopRoot, env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Next payload preparation exited with ${String(result.status)}`)
})
/**
 * The shared flows call this right before electron-builder: the interpreter payloads were prepared
 * before they started and must still verify, and the archive payload is prepared now. A macOS
 * package also gets its own copy of the interpreter payloads of its CPUs, which its extra
 * resources take as `Resources/runtime`.
 * @param platform - Platform being packaged; the shared flows package the host platform.
 * @param macArch - The macOS package: a release names each in turn, other builds follow `DSH_MAC_SMOKE_ARCH`.
 */
const prepareRuntime = (platform: NodeJS.Platform = process.platform, macArch: MacPackageArch = macSmokeArchitecture(process.env)): void => {
  const cpus = macPackageCpus(macArch)
  const runtime = nextRuntimeBuildPaths(desktopRoot).runtime
  if (platform === 'darwin') prepareNextMacRuntime(desktopRoot, cpus)
  if (!interpretersVerified || platform !== process.platform) {
    verifyNextRuntimeTree(runtime, platform, buildVersion, process.arch, platform === 'darwin' ? cpus : undefined)
  }
  if (platform === 'darwin') {
    packagingStepSync('runtime:stage-package', () => verifyPackagedNextRuntime(stagePackagedRuntime(desktopRoot, runtime, cpus), platform, buildVersion, cpus))
  }
  if (process.env.DSH_WINDOWS_REUSE_UNPACKED === '1' && existsSync(join(desktopRoot, '.desktop-build', 'payload', '.dsh-desktop-runtime.json'))) {
    console.log('Reusing prepared payload for unpacked Windows application directory.')
    return
  }
  preparePayload(platform, platform === 'darwin' ? macArch : undefined)
}
const mode = process.argv[2]
const outputDir = join(desktopRoot, 'dist', mode === 'mac' ? 'mac-release' : 'mac-smoke')
const shared = { env: process.env, platform: process.platform, desktopRoot, outputDir,
  resetOutput: () => rmSync(outputDir, { force: true, recursive: true }), run, log: console.log, prepareRuntime }
if (mode === 'dir') {
  await prepareInterpreters()
  prepareRuntime()
  packageDirectory({ cwd: desktopRoot, electronBuilderCli: require.resolve('electron-builder/cli.js'), electronDistPath: join(dirname(require.resolve('electron/package.json')), 'dist') })
} else if (mode === 'mac') {
  // The DMGs this release builds, and the CPUs whose interpreter payloads they carry between them.
  const releaseArchs = macReleaseArchs(process.env)
  assertMacPackagesRunnable(releaseArchs, process.arch, rosettaAvailable)
  const releaseCpus = (['arm64', 'x64'] as const).filter(cpu => releaseArchs.some(arch => macPackageCpus(arch).includes(cpu)))
  // The preflight the shared release flow repeats; the payload signatures must carry the identity it selects.
  const releaseEnvironment = adaptMacReleaseEnvironment(process.env)
  const ready = assertMacReleaseReady({ env: releaseEnvironment, platform: process.platform,
    listCodeSigningIdentities: () => listCodeSigningIdentities(withoutMacReleaseSecrets(releaseEnvironment)) })
  await prepareInterpreters(root => withMacSigningIdentity(releaseEnvironment, ready.identity, async (signer) => {
    for (const { arch } of nextRuntimeTargets('darwin', process.arch, process.env, releaseCpus)) {
      const signed = await signMacRuntime(primaryRuntimeDirectory(root, arch), APP_ID, signer, arch)
      console.log(`Signed ${String(signed)} native files of the ${arch} primary runtime as ${ready.identity}`)
    }
  }), releaseCpus)
  console.log(`Building the macOS DMGs for ${releaseArchs.join(', ')}`)
  releaseMac({ ...shared, listCodeSigningIdentities, targets: releaseArchs, prepareRuntime: target => { prepareRuntime('darwin', target) } })
} else if (mode === 'mac-smoke') {
  assertMacPackagesRunnable([macSmokeArchitecture(process.env)], process.arch, rosettaAvailable)
  await prepareInterpreters()
  packageMacSmoke({ ...shared, workspaceRoot, arch: process.arch, nodeVersion: process.versions.node,
    builderCli: require.resolve('electron-builder/cli.js'), verifier: join(desktopRoot, 'scripts/verify-mac-smoke.ts'), nodeExecutable: process.execPath })
} else if (mode === 'win') {
  await prepareInterpreters()
  packageWindowsInstaller({ ...createWindowsPackageOptions(), desktopRoot, workspaceRoot, run, prepareRuntime,
    verifier: join(desktopRoot, 'scripts/verify-win-installer.ts') })
} else if (mode === 'win-portable') {
  await prepareInterpreters()
  const winOptions = createWindowsPackageOptions()
  packageWindowsArtifact({ ...winOptions, env: { ...winOptions.env, DSH_PACKAGE_VERIFY_MODE: 'win-portable' }, desktopRoot, workspaceRoot, run, prepareRuntime,
    verifier: join(desktopRoot, 'scripts/verify-win-installer.ts') }, 'zip', 'portable archive')
} else if (mode === 'linux') {
  await prepareInterpreters()
  const linuxOptions = createLinuxPackageOptions()
  // The interpreter payload and the archive audit follow the host CPU, so both Linux CPUs package natively.
  packageLinuxArtifacts({ ...linuxOptions, supportedArchs: ['x64', 'arm64'], env: { ...linuxOptions.env, DSH_PACKAGE_VERIFY_MODE: 'linux' }, desktopRoot, workspaceRoot, run, prepareRuntime,
    verifier: join(desktopRoot, 'scripts/verify-win-installer.ts') })
} else throw new Error('Expected dir, mac, mac-smoke, win, win-portable or linux')
