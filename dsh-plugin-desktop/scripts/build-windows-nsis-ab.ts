/** Build direct-extract and upstream-default NSIS installers from one app directory. */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withoutWindowsSigningSecrets } from './package-win.ts'
import { assertPortableExecutable } from './verify-win-installer.ts'
import {
  WINDOWS_NSIS_AB_BUILDER_VERSION,
  WINDOWS_NSIS_AB_SCHEMA_VERSION,
  identifyWindowsNsisAbFile,
  identifyWindowsNsisAbTree,
  type WindowsNsisAbManifest,
  type WindowsNsisAbSkipCheckSource,
} from './windows-nsis-ab.ts'
import {
  NSIS_AB_HOOK_AUTHORIZATION_FILE,
  NSIS_AB_HOOK_TOKEN_ENV,
} from './verify-nsis-ab-prepackaged.ts'

export interface WindowsNsisAbBuildOptions {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly nodeVersion: string
  readonly env: NodeJS.ProcessEnv
  readonly workspaceRoot: string
  readonly desktopRoot: string
  readonly outputRoot: string
  readonly builderCli: string
  readonly electronBuilderRoot: string
  readonly appBuilderLibRoot: string
  readonly appBuilderPatch: string
  readonly commandShell: string
  readonly gitExecutable: string
  readonly nodeExecutable: string
  readonly skipCheck: boolean
  readonly skipCheckSource: WindowsNsisAbSkipCheckSource
  readonly now: () => Date
  readonly randomToken: () => string
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
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

function readVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

function assertHost(options: WindowsNsisAbBuildOptions): void {
  if (options.platform !== 'win32') throw new Error('Windows NSIS A/B artifacts require a native Windows host')
  if (options.arch !== 'x64') throw new Error(`Windows NSIS A/B artifacts require x64 Node; received ${options.arch}`)
  const match = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  if (!((major === 22 && minor >= 19) || major === 24)) {
    throw new Error(`Windows NSIS A/B artifacts require Node 22.19+ or Node 24.x; received ${options.nodeVersion}`)
  }
}

function assertDedicatedOutput(desktopRoot: string, outputRoot: string): void {
  const allowedRoot = resolve(desktopRoot, 'dist', 'nsis-ab')
  const target = resolve(outputRoot)
  const relation = relative(allowedRoot, target)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`NSIS A/B output must be a child of ${allowedRoot}`)
  }
}

/** Prove the staged CLI will load the copied app-builder-lib, not the workspace copy. */
export function assertIsolatedAppBuilderLibResolution(
  isolatedElectronBuilderCli: string,
  isolatedAppBuilderLib: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const isolatedRequire = createRequire(isolatedElectronBuilderCli)
  const resolvedManifest = isolatedRequire.resolve('app-builder-lib/package.json')
  const actualRoot = realpathSync(dirname(resolvedManifest))
  const expectedRoot = realpathSync(isolatedAppBuilderLib)
  const matches = platform === 'win32'
    ? actualRoot.toLocaleLowerCase('en-US') === expectedRoot.toLocaleLowerCase('en-US')
    : actualRoot === expectedRoot
  if (!matches) {
    throw new Error(
      `isolated electron-builder resolved app-builder-lib outside its copy: expected ${expectedRoot}; received ${actualRoot}`,
    )
  }
  return actualRoot
}

function builderArguments(output: string, prepackaged?: string): string[] {
  return [
    '--win',
    ...(prepackaged === undefined ? ['--dir'] : ['nsis', `--prepackaged=${prepackaged}`]),
    '--x64',
    '--publish',
    'never',
    '--config.win.signExecutable=false',
    '--config.npmRebuild=false',
    // The shared --dir build already ran the post-fuse executable gate. Use a
    // narrowly guarded installer-only hook because electron-builder does not
    // coerce a general `--config.afterAllArtifactBuild=null` string to null.
    ...(prepackaged === undefined
      ? []
      : ['--config.afterAllArtifactBuild=./scripts/verify-nsis-ab-prepackaged.ts']),
    `--config.directories.output=${output}`,
  ]
}

function runPrepackagedInstallerBuild(
  options: WindowsNsisAbBuildOptions,
  builder: string,
  output: string,
  applicationDirectory: string,
  variant: 'direct' | 'staged',
  environment: NodeJS.ProcessEnv,
): void {
  mkdirSync(output, { recursive: true })
  const token = options.randomToken()
  if (!/^[0-9a-f]{32}$/u.test(token)) {
    throw new Error('NSIS A/B hook token source must return 32 lowercase hexadecimal characters')
  }
  const authorizationPath = join(output, NSIS_AB_HOOK_AUTHORIZATION_FILE)
  writeFileSync(authorizationPath, `${JSON.stringify({
    schemaVersion: 1,
    token,
    variant,
    prepackaged: applicationDirectory,
  })}\n`, { flag: 'wx' })
  options.run(
    options.nodeExecutable,
    [builder, ...builderArguments(output, applicationDirectory)],
    options.desktopRoot,
    {
      ...environment,
      [NSIS_AB_HOOK_TOKEN_ENV]: token,
    },
  )
  if (existsSync(authorizationPath)) {
    throw new Error(`NSIS A/B ${variant} builder did not consume its one-time afterAll authorization`)
  }
}

/** Build the two installers and fail if either builder mutates their shared app input. */
export function buildWindowsNsisAb(options: WindowsNsisAbBuildOptions): WindowsNsisAbManifest {
  assertHost(options)
  assertDedicatedOutput(options.desktopRoot, options.outputRoot)
  if (options.skipCheck !== (options.skipCheckSource !== 'none')) {
    throw new Error('NSIS A/B skip-check option and provenance are inconsistent')
  }
  const version = readVersion(options.desktopRoot)
  for (const [label, root] of [
    ['electron-builder', options.electronBuilderRoot],
    ['app-builder-lib', options.appBuilderLibRoot],
  ] as const) {
    const dependencyVersion = readVersion(root)
    if (dependencyVersion !== WINDOWS_NSIS_AB_BUILDER_VERSION) {
      throw new Error(`${label} must be ${WINDOWS_NSIS_AB_BUILDER_VERSION}; received ${dependencyVersion}`)
    }
  }
  const cleanEnvironment: NodeJS.ProcessEnv = {
    ...withoutWindowsSigningSecrets(options.env),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  }

  if (!options.skipCheck) {
    options.log('Running the Windows package gate once before the A/B build.')
    options.run(
      options.commandShell,
      ['/d', '/s', '/c', 'corepack yarn workspace dsh-plugin-desktop check:win-package'],
      options.workspaceRoot,
      withoutWindowsSigningSecrets(options.env),
    )
  }

  rmSync(options.outputRoot, { recursive: true, force: true })
  mkdirSync(options.outputRoot, { recursive: true })
  const prepackagedOutput = join(options.outputRoot, 'prepackaged')
  const applicationDirectory = join(prepackagedOutput, 'win-unpacked')
  const directOutput = join(options.outputRoot, 'direct')
  const stagedOutput = join(options.outputRoot, 'staged')
  const isolatedNodeModules = join(options.outputRoot, '.staged-builder', 'node_modules')
  const isolatedElectronBuilder = join(isolatedNodeModules, 'electron-builder')
  const isolatedAppBuilderLib = join(isolatedNodeModules, 'app-builder-lib')

  options.log('Building the selective-ASAR Windows application directory once.')
  options.run(
    options.nodeExecutable,
    [options.builderCli, ...builderArguments(prepackagedOutput)],
    options.desktopRoot,
    cleanEnvironment,
  )
  if (!existsSync(join(applicationDirectory, 'resources', 'app.asar'))) {
    throw new Error(`prepackaged application is missing resources/app.asar: ${applicationDirectory}`)
  }

  options.log('Building A with the repository-patched direct-extract NSIS template.')
  runPrepackagedInstallerBuild(
    options,
    options.builderCli,
    directOutput,
    applicationDirectory,
    'direct',
    cleanEnvironment,
  )
  const directApplication = identifyWindowsNsisAbTree(applicationDirectory)

  options.log('Preparing an isolated builder with only the direct-extract hunk reversed.')
  mkdirSync(isolatedNodeModules, { recursive: true })
  cpSync(options.electronBuilderRoot, isolatedElectronBuilder, { recursive: true })
  cpSync(options.appBuilderLibRoot, isolatedAppBuilderLib, { recursive: true })
  const isolatedElectronBuilderCli = join(isolatedElectronBuilder, 'cli.js')
  assertIsolatedAppBuilderLibResolution(
    isolatedElectronBuilderCli,
    isolatedAppBuilderLib,
    options.platform,
  )
  options.run(
    options.gitExecutable,
    [
      '-C',
      isolatedAppBuilderLib,
      'apply',
      '--reverse',
      // The patch target is an untracked package copy, not repository state.
      '--unsafe-paths',
      // Anchor package-relative patch paths at the isolated -C directory.
      '--directory=.',
      '--include=templates/nsis/include/extractAppPackage.nsh',
      options.appBuilderPatch,
    ],
    options.workspaceRoot,
    {
      ...cleanEnvironment,
      // Keep git apply from discovering and anchoring at the outer worktree.
      GIT_CEILING_DIRECTORIES: isolatedNodeModules,
    },
  )
  const defaultExtractTemplate = join(
    isolatedAppBuilderLib,
    'templates',
    'nsis',
    'include',
    'extractAppPackage.nsh',
  )
  const defaultExtractSource = readFileSync(defaultExtractTemplate, 'utf8')
  if (!defaultExtractSource.includes('CreateDirectory "$PLUGINSDIR\\7z-out"')
      || !defaultExtractSource.includes('CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR')
      || defaultExtractSource.includes('favors install speed over atomic replacement')) {
    throw new Error('isolated builder does not contain electron-builder default staged/copy extraction')
  }
  const extractTemplateIdentity = identifyWindowsNsisAbFile(defaultExtractTemplate, options.outputRoot)

  options.log(`Building B with electron-builder ${WINDOWS_NSIS_AB_BUILDER_VERSION} default staged/copy extraction.`)
  runPrepackagedInstallerBuild(
    options,
    isolatedElectronBuilderCli,
    stagedOutput,
    applicationDirectory,
    'staged',
    {
      ...cleanEnvironment,
      NODE_PATH: [join(options.desktopRoot, 'node_modules'), cleanEnvironment.NODE_PATH]
        .filter((value): value is string => value !== undefined && value.length > 0)
        .join(delimiter),
    },
  )
  const stagedApplication = identifyWindowsNsisAbTree(applicationDirectory)
  if (directApplication.treeSha256 !== stagedApplication.treeSha256) {
    throw new Error(
      'the official staged builder mutated the shared prepackaged application; refusing a non-equivalent A/B pair',
    )
  }

  const installerName = `DSH-Desktop-${version}-x64-Setup.exe`
  const directInstaller = join(directOutput, installerName)
  const stagedInstaller = join(stagedOutput, installerName)
  assertPortableExecutable(directInstaller, 'direct-extract NSIS installer')
  assertPortableExecutable(stagedInstaller, 'default staged-copy NSIS installer')

  const manifestPath = join(options.outputRoot, 'nsis-ab-manifest.json')
  const resources = join(applicationDirectory, 'resources')
  const appAsar = join(resources, 'app.asar')
  const unpacked = join(resources, 'app.asar.unpacked')
  const manifest: WindowsNsisAbManifest = {
    schemaVersion: WINDOWS_NSIS_AB_SCHEMA_VERSION,
    createdAt: options.now().toISOString(),
    appVersion: version,
    electronBuilderVersion: WINDOWS_NSIS_AB_BUILDER_VERSION,
    provenance: {
      gateRan: !options.skipCheck,
      skipCheck: {
        requested: options.skipCheck,
        source: options.skipCheckSource,
      },
      signing: {
        state: 'unsigned',
        signExecutable: false,
        cscIdentityAutoDiscovery: false,
        signingSecretsRemoved: true,
      },
    },
    application: {
      directory: relative(options.outputRoot, applicationDirectory).split(sep).join('/'),
      tree: stagedApplication,
      resources: identifyWindowsNsisAbTree(resources),
      appAsar: identifyWindowsNsisAbFile(appAsar, options.outputRoot),
      unpacked: existsSync(unpacked) ? identifyWindowsNsisAbTree(unpacked) : null,
    },
    variants: {
      direct: {
        extraction: 'patched-direct-extract',
        builder: 'workspace-resolution',
        installer: identifyWindowsNsisAbFile(directInstaller, options.outputRoot),
      },
      staged: {
        extraction: 'electron-builder-default-staged-copy',
        builder: 'isolated-single-hunk-reversal',
        extractTemplateSha256: extractTemplateIdentity.sha256,
        installer: identifyWindowsNsisAbFile(stagedInstaller, options.outputRoot),
      },
    },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  options.log(`Windows NSIS A/B pair is ready: ${manifestPath}`)
  return manifest
}

function parseLabel(argv: readonly string[]): string {
  const labels = argv.filter(value => value.startsWith('--label='))
  if (labels.length > 1) throw new Error('--label may only be provided once')
  const label = labels[0]?.slice('--label='.length) ?? 'current'
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(label)) {
    throw new Error('--label must contain only letters, digits, dots, underscores, and hyphens')
  }
  for (const value of argv) {
    if (value !== '--skip-check' && !value.startsWith('--label=')) {
      throw new Error(`unknown argument: ${value}`)
    }
  }
  return label
}

/** Resolve native defaults without changing the repository's dependency graph. */
export function createWindowsNsisAbBuildOptions(argv = process.argv.slice(2)): WindowsNsisAbBuildOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  const electronBuilderRoot = dirname(require.resolve('electron-builder/package.json'))
  const appBuilderLibRoot = dirname(require.resolve('app-builder-lib/package.json'))
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR
  const label = parseLabel(argv)
  const cliSkipCheck = argv.includes('--skip-check')
  const environmentSkipCheck = process.env.DSH_PACKAGE_CHECK_ALREADY_RAN === '1'
  const skipCheckSource: WindowsNsisAbSkipCheckSource = cliSkipCheck && environmentSkipCheck
    ? '--skip-check + DSH_PACKAGE_CHECK_ALREADY_RAN'
    : cliSkipCheck
      ? '--skip-check'
      : environmentSkipCheck
        ? 'DSH_PACKAGE_CHECK_ALREADY_RAN'
        : 'none'
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    env: process.env,
    workspaceRoot,
    desktopRoot,
    outputRoot: join(desktopRoot, 'dist', 'nsis-ab', label),
    builderCli: require.resolve('electron-builder/cli.js'),
    electronBuilderRoot,
    appBuilderLibRoot,
    appBuilderPatch: join(workspaceRoot, 'patches', `app-builder-lib@${WINDOWS_NSIS_AB_BUILDER_VERSION}.patch`),
    commandShell: windowsRoot === undefined || windowsRoot.length === 0
      ? 'cmd.exe'
      : join(windowsRoot, 'System32', 'cmd.exe'),
    gitExecutable: 'git.exe',
    nodeExecutable: process.execPath,
    skipCheck: skipCheckSource !== 'none',
    skipCheckSource,
    now: () => new Date(),
    randomToken: () => randomBytes(16).toString('hex'),
    run,
    log: message => console.log(message),
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32') {
    console.log('Skipping Windows NSIS A/B build: a native Windows x64 host is required.')
  } else {
    try {
      buildWindowsNsisAb(createWindowsNsisAbBuildOptions())
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
