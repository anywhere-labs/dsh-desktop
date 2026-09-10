/** Prepare an Electron-ABI fs-ext binding where the packaged runtime requires one. */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const FS_EXT_VERSION = '2.1.1'
const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux', 'win32'])
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64'])

export interface NativeBuildInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

export interface PrepareFsExtOptions {
  /** Target platform. Cross-platform compilation is intentionally unsupported. */
  readonly platform?: NodeJS.Platform
  /** Electron target architecture. `x86_64` is normalized to Node's `x64`. */
  readonly arch?: string
  /** Platform running node-gyp; injectable for focused tests. */
  readonly hostPlatform?: NodeJS.Platform
  /** Package root used to resolve installed dependencies. */
  readonly desktopRoot?: string
  /** Installed fs-ext source root. */
  readonly fsExtRoot?: string
  /** Installed nan package root. */
  readonly nanRoot?: string
  /** Resolved node-gyp JavaScript CLI. */
  readonly nodeGypCli?: string
  /** Node executable used to launch node-gyp. */
  readonly nodeExecutable?: string
  /** Installed Electron version whose headers should be used. */
  readonly electronVersion?: string
  /** Build environment inherited by node-gyp. */
  readonly env?: NodeJS.ProcessEnv
  /** Injectable command boundary. It must throw when the build fails. */
  readonly runBuild?: (invocation: NativeBuildInvocation) => void
  /** Optional progress logger. */
  readonly log?: (message: string) => void
}

export interface PreparedFsExtBinding {
  readonly status: 'prepared'
  readonly path: string
  readonly platform: NodeJS.Platform
  readonly arch: 'arm64' | 'x64'
  readonly electronVersion: string
  readonly abi: string
}

/** Windows uses the JSONL backend's named-semaphore path and never calls fs-ext. */
export interface FsExtNotRequired {
  readonly status: 'not-required'
  readonly platform: 'win32'
  readonly arch: 'arm64' | 'x64'
}

export type PrepareFsExtResult = PreparedFsExtBinding | FsExtNotRequired

interface InstalledFsExtInputs {
  readonly fsExtRoot: string
  readonly nanRoot: string
  readonly nodeGypCli: string
  readonly nodeExecutable: string
  readonly electronVersion: string
}

function readPackageVersion(packageRoot: string, packageName: string): string {
  const packageJsonPath = join(packageRoot, 'package.json')
  const document = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
  if (typeof document.version !== 'string' || document.version.length === 0) {
    throw new Error(`${packageName} package.json does not declare a version: ${packageJsonPath}`)
  }
  return document.version
}

function resolvePackageRoot(requireFromDesktop: NodeJS.Require, packageName: string): string {
  return dirname(requireFromDesktop.resolve(`${packageName}/package.json`))
}

function resolveInstalledInputs(options: PrepareFsExtOptions): InstalledFsExtInputs {
  const scriptDesktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const desktopRoot = resolve(options.desktopRoot ?? scriptDesktopRoot)
  const requireFromDesktop = createRequire(join(desktopRoot, 'package.json'))
  const fsExtRoot = resolve(
    options.fsExtRoot ?? resolvePackageRoot(requireFromDesktop, 'fs-ext'),
  )
  const nanRoot = resolve(options.nanRoot ?? resolvePackageRoot(requireFromDesktop, 'nan'))
  const nodeGypCli = resolve(
    options.nodeGypCli ?? requireFromDesktop.resolve('node-gyp/bin/node-gyp.js'),
  )
  const electronRoot = options.electronVersion === undefined
    ? resolvePackageRoot(requireFromDesktop, 'electron')
    : undefined
  const electronVersion = options.electronVersion
    ?? readPackageVersion(electronRoot!, 'electron')

  return {
    fsExtRoot,
    nanRoot,
    nodeGypCli,
    nodeExecutable: options.nodeExecutable ?? process.execPath,
    electronVersion,
  }
}

function normalizeArchitecture(arch: string): 'arm64' | 'x64' {
  const normalized = arch === 'x86_64' ? 'x64' : arch
  if (!SUPPORTED_ARCHITECTURES.has(normalized)) {
    throw new Error(`fs-ext Electron preparation supports arm64 or x64; received ${arch}`)
  }
  return normalized as 'arm64' | 'x64'
}

function assertTargetPlatform(
  platform: NodeJS.Platform,
  hostPlatform: NodeJS.Platform,
): void {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`fs-ext Electron preparation does not support platform ${platform}`)
  }
  if (platform !== hostPlatform) {
    throw new Error(
      `fs-ext must be compiled on the target platform; target ${platform}, host ${hostPlatform}`,
    )
  }
}

function assertRegularFile(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} is missing: ${path}`)
  }
}

function copyFsExtSource(fsExtRoot: string, sourceRoot: string, nanRoot: string): void {
  const requiredSourceFiles = ['binding.gyp', 'fs-ext.cc', 'package.json'] as const
  mkdirSync(sourceRoot, { recursive: true })
  for (const name of requiredSourceFiles) {
    const source = join(fsExtRoot, name)
    assertRegularFile(source, `fs-ext source file ${name}`)
    copyFileSync(source, join(sourceRoot, name))
  }

  const temporaryNanRoot = join(sourceRoot, 'node_modules', 'nan')
  mkdirSync(dirname(temporaryNanRoot), { recursive: true })
  cpSync(nanRoot, temporaryNanRoot, { recursive: true })
}

function readBuiltAbi(configPath: string, expectedArch: string): string {
  const config = readFileSync(configPath, 'utf8')
  const abi = /["']node_module_version["']\s*:\s*["']?(\d+)/u.exec(config)?.[1]
  if (abi === undefined) {
    throw new Error(`node-gyp did not record an Electron module ABI in ${configPath}`)
  }
  const builtArch = /["']target_arch["']\s*:\s*["']([^"']+)/u.exec(config)?.[1]
  if (builtArch !== expectedArch) {
    throw new Error(
      `node-gyp built fs-ext for ${builtArch ?? 'an unknown architecture'}; expected ${expectedArch}`,
    )
  }
  return abi
}

function runNativeBuild(invocation: NativeBuildInvocation): void {
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${invocation.command} ${invocation.args.join(' ')} exited with ${String(result.status)}`,
    )
  }
}

/**
 * Compile one fs-ext Electron target in an isolated source tree.
 *
 * The installed `build/Release/fs_ext.node` remains the ordinary Node binding.
 * Only the ABI-qualified file under `prebuilds/` is written to the installation.
 */
export function prepareFsExtForElectron(
  options: PrepareFsExtOptions = {},
): PrepareFsExtResult {
  const platform = options.platform ?? process.platform
  const hostPlatform = options.hostPlatform ?? process.platform
  const arch = normalizeArchitecture(options.arch ?? process.arch)
  assertTargetPlatform(platform, hostPlatform)

  if (platform === 'win32') {
    options.log?.(
      `fs-ext Electron binding is not required on Windows (${platform}-${arch}); `
      + 'the session backend uses a native named semaphore.',
    )
    return { status: 'not-required', platform, arch }
  }

  const installed = resolveInstalledInputs(options)
  const installedVersion = readPackageVersion(installed.fsExtRoot, 'fs-ext')
  if (installedVersion !== FS_EXT_VERSION) {
    throw new Error(
      `fs-ext Electron preparation requires ${FS_EXT_VERSION}; found ${installedVersion}`,
    )
  }
  assertRegularFile(installed.nodeGypCli, 'node-gyp CLI')

  const temporaryParent = mkdtempSync(join(tmpdir(), 'dsh-fs-ext-electron-'))
  const temporarySource = join(temporaryParent, 'fs-ext')
  try {
    copyFsExtSource(installed.fsExtRoot, temporarySource, installed.nanRoot)
    const invocation: NativeBuildInvocation = {
      command: installed.nodeExecutable,
      args: [
        installed.nodeGypCli,
        'rebuild',
        '--release',
        '--runtime=electron',
        `--target=${installed.electronVersion}`,
        `--dist-url=${ELECTRON_HEADERS_URL}`,
        `--arch=${arch}`,
      ],
      cwd: temporarySource,
      env: options.env ?? process.env,
    }
    ;(options.runBuild ?? runNativeBuild)(invocation)

    const builtBinary = join(temporarySource, 'build', 'Release', 'fs_ext.node')
    const buildConfig = join(temporarySource, 'build', 'config.gypi')
    assertRegularFile(builtBinary, 'compiled fs-ext binding')
    assertRegularFile(buildConfig, 'node-gyp configuration')
    const abi = readBuiltAbi(buildConfig, arch)

    const destinationDirectory = join(
      installed.fsExtRoot,
      'prebuilds',
      `${platform}-${arch}`,
    )
    const destination = join(destinationDirectory, `electron.abi${abi}.node`)
    mkdirSync(destinationDirectory, { recursive: true })
    const staged = join(
      destinationDirectory,
      `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
    )
    try {
      copyFileSync(builtBinary, staged)
      renameSync(staged, destination)
    } finally {
      rmSync(staged, { force: true })
    }

    options.log?.(
      `Prepared fs-ext ${FS_EXT_VERSION} for Electron ${installed.electronVersion} `
      + `(${platform}-${arch}, ABI ${abi}): ${destination}`,
    )
    return {
      status: 'prepared',
      path: destination,
      platform,
      arch,
      electronVersion: installed.electronVersion,
      abi,
    }
  } finally {
    rmSync(temporaryParent, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  prepareFsExtForElectron({ log: message => console.log(message) })
}
