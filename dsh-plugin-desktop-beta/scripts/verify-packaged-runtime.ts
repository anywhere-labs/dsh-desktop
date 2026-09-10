/** Fail-loud verification of the runtime entries sealed into Electron's app.asar. */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRawHeader } from '@electron/asar'
import {
  FORBIDDEN_MACOS_UNIVERSAL_ENTRIES,
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
} from './mac-universal.ts'

/** Resolve a package root even when its exports hide `package.json`. */
export function resolveRuntimePackageRoot(
  packageName: string,
  resolveEntry: (specifier: string) => string = createRequire(import.meta.url).resolve,
  readManifest: (filename: string) => string = filename => readFileSync(filename, 'utf8'),
): string {
  let manifestCause: unknown
  try {
    return dirname(resolveEntry(`${packageName}/package.json`))
  } catch (cause) {
    manifestCause = cause
  }

  let directory = dirname(resolveEntry(packageName))
  const root = parse(directory).root
  while (true) {
    try {
      const manifest: unknown = JSON.parse(readManifest(join(directory, 'package.json')))
      if (manifest !== null
        && typeof manifest === 'object'
        && (manifest as { name?: unknown }).name === packageName) {
        return directory
      }
    } catch {
      // Continue toward the filesystem root until the owning manifest is found.
    }
    if (directory === root) {
      throw new Error(`dsh-plugin-desktop: cannot locate package root for ${packageName}`, {
        cause: manifestCause,
      })
    }
    directory = dirname(directory)
  }
}

const DSH_PACKAGE_ROOT = resolveRuntimePackageRoot('@deepseek-ai/dsh')
const PNPM_PACKAGE_ROOT = resolveRuntimePackageRoot('pnpm')
const DESKTOP_PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))

function packageVersion(packageRoot: string): string {
  return (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version
}

const DSH_RUNTIME_VERSION = packageVersion(DSH_PACKAGE_ROOT)
const PNPM_RUNTIME_VERSION = packageVersion(PNPM_PACKAGE_ROOT)

/** Maximum physical file count accepted beside ASAR after smart unpack. */
export const MAX_UNPACKED_RUNTIME_FILES = 1_500

/** Maximum physical payload accepted beside ASAR after smart unpack. */
export const MAX_UNPACKED_RUNTIME_BYTES = 128 * 1024 * 1024

/** Narrow ceiling for pnpm's smart-unpacked native-helper package root. */
export const MAX_PNPM_SMART_UNPACK_FILES = 32
export const MAX_PNPM_SMART_UNPACK_BYTES = 32 * 1024 * 1024

/** Package roots electron-builder may smart-unpack as one indivisible unit. */
export const ALLOWED_SMART_UNPACK_PACKAGE_ROOTS = [
  'node_modules/fs-ext',
  'node_modules/koffi',
  'node_modules/node-addon-require-builtin',
  'node_modules/node-pty',
  // pnpm embeds executable and native helper payloads.
  'node_modules/pnpm',
  'node_modules/sharp',
] as const

/** Platform package families selected by native dependencies at package time. */
export const ALLOWED_SMART_UNPACK_PACKAGE_PREFIXES = [
  'node_modules/@deepseek-ai/node-addon-system-',
  'node_modules/@img/sharp-',
  'node_modules/@koromix/koffi-',
  'node_modules/@vscode/ripgrep-',
  'node_modules/node-addon-require-builtin-',
] as const

/** Every generated JavaScript file shipped by the installed DSH CLI package. */
export const REQUIRED_DSH_CLI_RUNTIME_ENTRIES = Object.freeze(
  readdirSync(join(DSH_PACKAGE_ROOT, 'lib'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => `node_modules/@deepseek-ai/dsh/lib/${entry.name}`)
    .sort(),
)

/** PTC preset inputs selected by upstream's historical Session migration. */
export const REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES = [
  'node_modules/@deepseek-ai/dsh-agent-presets/presets/ptc/agent.cordis.yml',
  'node_modules/@deepseek-ai/dsh-agent-presets/presets/ptc/preset.yml',
] as const

/** AfterPack fields consumed without importing Electron Builder's incomplete declaration graph. */
export interface PackagedRuntimeContext {
  /** Completed platform application directory. */
  readonly appOutDir: string
  /** Electron Builder target architecture (`4` is its stable universal enum value). */
  readonly arch?: number
  /** Electron target platform selected by the packager. */
  readonly electronPlatformName: string
  /** Product metadata used to locate the macOS application bundle. */
  readonly packager: {
    /** Electron Builder project root containing the completed lib/ build output. */
    readonly projectDir?: string
    /** LinuxPackager's executable name differs from appInfo.productFilename by default. */
    readonly executableName?: string
    readonly appInfo: {
      readonly productFilename: string
    }
  }
}

/** Stable non-desktop archive entries required by the packaged runtime. */
export const REQUIRED_PACKAGED_RUNTIME_ENTRIES = [
  'package.json',
  'cordis.patch.yml',
  ...REQUIRED_DSH_CLI_RUNTIME_ENTRIES,
  'node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
  'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
  ...REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES,
  'node_modules/open/index.js',
  'node_modules/pnpm/bin/pnpm.mjs',
] as const

/** macOS-only desktop assets loaded by nativeImage from physical paths. */
export const REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES = [
  'build/app-icon-mac.png',
  'build/tray-iconTemplate.png',
  'build/tray-iconTemplate@2x.png',
] as const

/** Windows/Linux desktop assets, including nativeImage scale variants. */
export const REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES = [
  'build/app-icon.png',
  'build/tray-icon-blue.png',
  'build/tray-icon-blue@1.25x.png',
  'build/tray-icon-blue@1.5x.png',
  'build/tray-icon-blue@2x.png',
] as const

/** Complete cross-platform asset surface, used only as a closed allowlist. */
export const REQUIRED_UNPACKED_RUNTIME_ENTRIES = [
  ...REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES,
  ...REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES,
] as const

/** Ordinary modules that must stay archived to prevent a full physical mirror regression. */
export const FORBIDDEN_UNPACKED_RUNTIME_ENTRIES = [
  'package.json',
  'cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
  'node_modules/@deepseek-ai/dsh-base/lib/index.js',
  'node_modules/@deepseek-ai/dsh-web-app/lib/index.js',
  // Preset inputs are ordinary read-only data covered by ASAR integrity.
  ...REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES,
  'node_modules/@vscode/ripgrep/lib/index.js',
  'node_modules/open/index.js',
  'node_modules/yaml/dist/index.js',
] as const

/** Prebuilt Node-API modules required when the Windows package skips native source rebuilds. */
export const REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES = [
  'node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
  'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
  'node_modules/node-pty/prebuilds/win32-x64/conpty_console_list.node',
  'node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
  'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
] as const

/** ABI-pinned fs-ext bindings selected by non-universal macOS and Linux packages. */
export const REQUIRED_POSIX_FS_EXT_ENTRIES = {
  darwin: {
    x64: 'node_modules/fs-ext/prebuilds/darwin-x64/electron.abi148.node',
    arm64: 'node_modules/fs-ext/prebuilds/darwin-arm64/electron.abi148.node',
  },
  linux: {
    x64: 'node_modules/fs-ext/prebuilds/linux-x64/electron.abi148.node',
    arm64: 'node_modules/fs-ext/prebuilds/linux-arm64/electron.abi148.node',
  },
} as const

/** CPU-specific runtime assets that must coexist in a universal macOS application. */
export const REQUIRED_MACOS_UNIVERSAL_ENTRIES = [
  ...MACOS_UNIVERSAL_NATIVE_ENTRIES.map(entry => entry.path),
] as const

/** Minimal raw ASAR header surface returned by @electron/asar. */
export interface RawAsarHeader {
  readonly header: unknown
}

/** Injectable raw-header reader used by focused tests. */
export type ArchiveHeaderReader = (archivePath: string) => RawAsarHeader

/** Canonical ASAR leaf paths and the subset whose payloads live beside the archive. */
export interface PackagedAsarIndex {
  readonly files: ReadonlySet<string>
  readonly unpackedFiles: ReadonlySet<string>
}

/** Injectable desktop build-output inventory used by focused tests. */
export type DesktopRuntimeLister = (libRoot: string) => readonly string[]

/** Injectable physical-file probe used by focused tests. */
export type FileProbe = (filename: string) => boolean

/** One physical file emitted beside app.asar. */
export interface UnpackedRuntimeFile {
  readonly path: string
  readonly bytes: number
}

/** One package-root or desktop-root inventory bucket. */
export interface UnpackedRuntimeGroup {
  readonly root: string
  readonly files: number
  readonly bytes: number
}

/** Bounded physical payload summary printed by afterPack. */
export interface UnpackedRuntimeSummary {
  readonly files: number
  readonly bytes: number
  readonly groups: readonly UnpackedRuntimeGroup[]
}

/** Injectable physical unpacked-file inventory used by focused tests. */
export type UnpackedFileLister = (unpackedRoot: string) => readonly UnpackedRuntimeFile[]

/** Result surface required from one packaged Electron child. */
export interface PackagedElectronResult {
  readonly error?: Error
  readonly signal?: NodeJS.Signals | null
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Injectable packaged Electron process seam used by focused tests. */
export type PackagedElectronRunner = (
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => PackagedElectronResult

/** Injectable ASAR/CLI/native smoke seam used by the post-fuse artifact hook. */
export type PackagedElectronSmoke = (context: PackagedRuntimeContext) => void

/** Resolve the packaged Electron executable created beside the application resources. */
export function resolvePackagedExecutablePath(context: PackagedRuntimeContext): string {
  const filename = context.packager.appInfo.productFilename
  if (context.electronPlatformName === 'darwin') {
    return join(context.appOutDir, `${filename}.app`, 'Contents', 'MacOS', filename)
  }
  if (context.electronPlatformName === 'win32') return join(context.appOutDir, `${filename}.exe`)
  if (context.electronPlatformName === 'linux') {
    return join(context.appOutDir, context.packager.executableName ?? filename)
  }
  throw new Error(
    `dsh-plugin-desktop: unsupported Electron afterPack platform ${JSON.stringify(context.electronPlatformName)}`,
  )
}

function runPackagedElectron(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): PackagedElectronResult {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: environment,
    shell: false,
    timeout: 60_000,
    windowsHide: true,
  })
  return {
    ...(result.error === undefined ? {} : { error: result.error }),
    signal: result.signal,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function packagedRuntimeRunnable(context: PackagedRuntimeContext): boolean {
  if (context.electronPlatformName !== process.platform) return false
  const { arch } = context
  if (arch === undefined || arch === 4) return true
  if (arch === 1) return process.arch === 'x64'
  if (arch === 3) return process.arch === 'arm64'
  if (arch === 0) return process.arch === 'ia32'
  return false
}

/**
 * Execute the real packaged runtime through Electron's supported RunAsNode
 * path. This proves DSH and pnpm can load from logical ASAR paths, the upstream
 * Profile proxy selects Electron, and smartUnpack exposes the ripgrep binary.
 */
export function smokePackagedElectronRuntime(
  context: PackagedRuntimeContext,
  run: PackagedElectronRunner = runPackagedElectron,
): void {
  // A universal executable runs natively on either macOS CPU. Per-architecture
  // intermediate apps are only executable on the matching packaging host.
  if (!packagedRuntimeRunnable(context)) return
  const executable = resolvePackagedExecutablePath(context)
  const asarRoot = resolvePackagedAsarPath(context)
  const smokeHome = mkdtempSync(join(tmpdir(), 'dsh-packaged-cli-'))
  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: smokeHome,
    DSH_TELEMETRY_DISABLED: '1',
  }
  const checks = [
    {
      label: 'DSH CLI',
      entry: join(asarRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      args: ['--version'],
      accepts: (stdout: string) => stdout.trim() === DSH_RUNTIME_VERSION,
    },
    {
      label: 'pnpm CLI',
      entry: join(asarRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
      args: ['--version'],
      accepts: (stdout: string) => stdout.trim() === PNPM_RUNTIME_VERSION,
    },
    {
      label: 'ASAR/Profile/CJS/ripgrep',
      entry: join(asarRoot, 'lib', 'packaged-runtime-smoke.js'),
      args: [],
      accepts: (stdout: string) => stdout.trim() === 'DSH_PACKAGED_RUNTIME_OK',
    },
    {
      label: 'Desktop CLI config composition',
      entry: join(asarRoot, 'lib', 'desktop-cli.js'),
      args: ['--profile', 'headless', '--dump-config'],
      accepts: (stdout: string) => stdout.includes('# == ') && stdout.includes('name:'),
    },
    {
      // This is deliberately the Desktop wrapper rather than DSH's bin.js:
      // a child RunAsNode process cannot inherit main's resolver hook.
      label: 'Desktop CLI Loader boot',
      entry: join(asarRoot, 'lib', 'desktop-cli.js'),
      args: ['--profile', 'headless', '--help'],
      accepts: (stdout: string) => stdout.includes('dsh --profile headless'),
    },
  ] as const
  try {
    for (const check of checks) {
      const result = run(executable, ['--expose-internals', check.entry, ...check.args], environment)
      if (result.error !== undefined) {
        throw new Error(`dsh-plugin-desktop: packaged ${check.label} smoke could not start`, {
          cause: result.error,
        })
      }
      if (result.status !== 0 || !check.accepts(result.stdout)) {
        throw new Error(
          `dsh-plugin-desktop: packaged ${check.label} smoke failed with status ${String(result.status)}; `
          + `signal=${String(result.signal ?? null)}; `
          + `stdout=${JSON.stringify(result.stdout.trim())}; stderr=${JSON.stringify(result.stderr.trim())}`,
        )
      }
    }
    const obsoleteFallback = join(smokeHome, 'profiles', 'node_modules')
    if (existsSync(obsoleteFallback) && readdirSync(obsoleteFallback).length > 0) {
      throw new Error(
        `dsh-plugin-desktop: packaged Desktop CLI recreated the obsolete shared Profile fallback at ${obsoleteFallback}`,
      )
    }
  } finally {
    rmSync(smokeHome, { recursive: true, force: true })
  }
}

/**
 * Resolve the platform-specific archive produced by Electron Builder.
 * @param context - completed application directory and target platform.
 * @returns absolute path to the packaged app.asar.
 */
export function resolvePackagedAsarPath(context: PackagedRuntimeContext): string {
  if (context.electronPlatformName === 'darwin') {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
      'app.asar',
    )
  }
  if (context.electronPlatformName === 'win32' || context.electronPlatformName === 'linux') {
    return join(context.appOutDir, 'resources', 'app.asar')
  }
  throw new Error(
    `dsh-plugin-desktop: unsupported Electron afterPack platform ${JSON.stringify(context.electronPlatformName)}`,
  )
}

/**
 * Resolve the physical dependency tree emitted beside app.asar.
 * @param context - completed application directory and target platform.
 * @returns absolute path to app.asar.unpacked.
 */
export function resolvePackagedUnpackedRoot(context: PackagedRuntimeContext): string {
  return `${resolvePackagedAsarPath(context)}.unpacked`
}

/** Normalize archive and physical-tree paths without allowing traversal aliases. */
function normalizeArchiveEntry(entry: string): string {
  const segments = entry
    .replaceAll('\\', '/')
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.')
  if (segments.length === 0 || segments.includes('..')) {
    throw new Error(`dsh-plugin-desktop: invalid packaged runtime path ${JSON.stringify(entry)}`)
  }
  return segments.join('/')
}

/** Recursively inventory every runtime file emitted by the desktop build. */
export function listDesktopRuntimeEntries(libRoot: string): string[] {
  const entries: string[] = []
  const pending: Array<{ absolute: string; archive: string }> = [{
    absolute: libRoot,
    archive: 'lib',
  }]
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for (const entry of readdirSync(directory.absolute, { withFileTypes: true })) {
      const absolute = join(directory.absolute, entry.name)
      const archive = normalizeArchiveEntry(`${directory.archive}/${entry.name}`)
      if (entry.isDirectory()) pending.push({ absolute, archive })
      else if (!entry.name.endsWith('.map') && !/\.d\.(?:cts|mts|ts)$/u.test(entry.name)) {
        entries.push(archive)
      }
    }
  }
  return entries.sort((left, right) => left.localeCompare(right, 'en'))
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Derive canonical file and unpacked-file sets directly from the ASAR header. */
export function indexPackagedAsarHeader(header: unknown): PackagedAsarIndex {
  const files = new Set<string>()
  const unpackedFiles = new Set<string>()
  const visit = (
    value: unknown,
    path: string | undefined,
    parentUnpacked: boolean,
  ): void => {
    if (!record(value)) {
      throw new Error(`dsh-plugin-desktop: malformed ASAR header entry at ${path ?? '(root)'}`)
    }
    if ('unpacked' in value && typeof value.unpacked !== 'boolean') {
      throw new Error(`dsh-plugin-desktop: malformed ASAR unpacked flag at ${path ?? '(root)'}`)
    }
    const unpacked = parentUnpacked || value.unpacked === true
    if ('files' in value) {
      if (!record(value.files) || 'link' in value || 'size' in value) {
        throw new Error(`dsh-plugin-desktop: malformed ASAR directory entry at ${path ?? '(root)'}`)
      }
      for (const [name, child] of Object.entries(value.files)) {
        const childPath = normalizeArchiveEntry(path === undefined ? name : `${path}/${name}`)
        visit(child, childPath, unpacked)
      }
      return
    }
    if (path === undefined || (!('size' in value) && !('link' in value))) {
      throw new Error(`dsh-plugin-desktop: malformed ASAR leaf entry at ${path ?? '(root)'}`)
    }
    if (files.has(path)) {
      throw new Error(`dsh-plugin-desktop: duplicate normalized ASAR header entry ${path}`)
    }
    files.add(path)
    if (unpacked) unpackedFiles.add(path)
  }
  visit(header, undefined, false)
  return { files, unpackedFiles }
}

/**
 * Inspect one archive and reject an incomplete packaged runtime.
 * @param archivePath - resolved app.asar path.
 * @param requiredEntries - build-derived and stable runtime leaves that must be present.
 * @param readHeader - raw ASAR header reader.
 * @returns Canonical file sets for physical-tree verification.
 */
export function verifyPackagedAsar(
  archivePath: string,
  requiredEntries: readonly string[],
  readHeader: ArchiveHeaderReader = getRawHeader,
): PackagedAsarIndex {
  let rawHeader: RawAsarHeader
  try {
    rawHeader = readHeader(archivePath)
  } catch (cause) {
    throw new Error(
      `dsh-plugin-desktop: failed to inspect packaged runtime at ${archivePath}`,
      { cause },
    )
  }

  const index = indexPackagedAsarHeader(rawHeader.header)
  const missing = requiredEntries
    .map(normalizeArchiveEntry)
    .filter(entry => !index.files.has(entry))
  if (missing.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: packaged runtime at ${archivePath} is missing required ASAR entries: ${missing.join(', ')}`,
    )
  }
  return index
}

/** Enumerate physical file/symlink leaves and byte sizes without following links. */
export function listUnpackedRuntimeFiles(unpackedRoot: string): UnpackedRuntimeFile[] {
  const files: UnpackedRuntimeFile[] = []
  const pending = ['']
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for (const entry of readdirSync(join(unpackedRoot, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else files.push({
        path: path.replaceAll('\\', '/'),
        bytes: lstatSync(join(unpackedRoot, path)).size,
      })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function unpackedPackageRoot(path: string): string | undefined {
  const segments = path.split('/')
  if (segments[0] !== 'node_modules' || segments.length < 2) return undefined
  if (segments[1]?.startsWith('@') === true) {
    return segments.length >= 3 ? segments.slice(0, 3).join('/') : undefined
  }
  return segments.slice(0, 2).join('/')
}

function unpackedGroupRoot(path: string): string {
  return unpackedPackageRoot(path) ?? `desktop/${path.split('/')[0] ?? '(root)'}`
}

function allowedSmartUnpackPackageRoot(root: string): boolean {
  return ALLOWED_SMART_UNPACK_PACKAGE_ROOTS.some(candidate => root === candidate)
    || ALLOWED_SMART_UNPACK_PACKAGE_PREFIXES.some(prefix => root.startsWith(prefix))
}

/** Summarize smart-unpacked payload by package root for actionable build output. */
export function summarizeUnpackedRuntime(
  files: readonly UnpackedRuntimeFile[],
): UnpackedRuntimeSummary {
  const groups = new Map<string, { files: number; bytes: number }>()
  let bytes = 0
  for (const file of files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new Error(
        `dsh-plugin-desktop: unpacked runtime entry ${JSON.stringify(file.path)} has invalid byte size ${String(file.bytes)}`,
      )
    }
    bytes += file.bytes
    const root = unpackedGroupRoot(normalizeArchiveEntry(file.path))
    const group = groups.get(root) ?? { files: 0, bytes: 0 }
    group.files += 1
    group.bytes += file.bytes
    groups.set(root, group)
  }
  return {
    files: files.length,
    bytes,
    groups: [...groups]
      .map(([root, group]) => ({ root, ...group }))
      .sort((left, right) => right.bytes - left.bytes || left.root.localeCompare(right.root, 'en')),
  }
}

/** Render a stable one-line inventory suitable for Electron Builder logs and failures. */
export function formatUnpackedRuntimeSummary(summary: UnpackedRuntimeSummary): string {
  const groups = summary.groups
    .map(group => `${group.root}=${String(group.files)} files/${String(group.bytes)} bytes`)
    .join(', ')
  return `${String(summary.files)} files/${String(summary.bytes)} bytes${groups.length === 0 ? '' : `; ${groups}`}`
}

/**
 * Reject a regression back to the old full app.asar mirror. Header unpacked
 * leaves and physical file/symlink leaves must match exactly before the native
 * allowlist and payload budgets are applied.
 */
export function verifySelectiveUnpackedRuntime(
  archive: PackagedAsarIndex,
  unpackedRoot: string,
  files: readonly UnpackedRuntimeFile[],
  allowedDesktopEntries: readonly string[] = REQUIRED_UNPACKED_RUNTIME_ENTRIES,
): UnpackedRuntimeSummary {
  const normalizedFiles = files.map(file => ({
    path: normalizeArchiveEntry(file.path),
    bytes: file.bytes,
  }))
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const file of normalizedFiles) {
    if (seen.has(file.path)) duplicates.add(file.path)
    seen.add(file.path)
  }
  if (duplicates.size > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} contains duplicate normalized physical entries: ${[...duplicates].sort().join(', ')}`,
    )
  }
  const summary = summarizeUnpackedRuntime(normalizedFiles)
  const inventory = formatUnpackedRuntimeSummary(summary)
  const outsideArchive = normalizedFiles
    .map(file => file.path)
    .filter(entry => !archive.files.has(entry))
    .sort()
  const packedInHeader = normalizedFiles
    .map(file => file.path)
    .filter(entry => archive.files.has(entry) && !archive.unpackedFiles.has(entry))
    .sort()
  const missingPhysical = [...archive.unpackedFiles]
    .filter(entry => !seen.has(entry))
    .sort()
  const mismatches = [
    ...(outsideArchive.length === 0
      ? []
      : [`physical entries absent from the ASAR header: ${outsideArchive.join(', ')}`]),
    ...(packedInHeader.length === 0
      ? []
      : [`physical entries not marked unpacked in the ASAR header: ${packedInHeader.join(', ')}`]),
    ...(missingPhysical.length === 0
      ? []
      : [`ASAR header entries missing from the physical tree: ${missingPhysical.join(', ')}`]),
  ]
  if (mismatches.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} does not exactly match ASAR unpacked flags: ${mismatches.join('; ')}; inventory: ${inventory}`,
    )
  }
  const desktopCode = normalizedFiles
    .map(file => file.path)
    .filter(entry => /^lib\/.+\.(?:cjs|html|js|json|mjs)$/u.test(entry))
  if (desktopCode.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} contains desktop code/data that must stay in app.asar: ${desktopCode.join(', ')}; inventory: ${inventory}`,
    )
  }
  const forbidden = FORBIDDEN_UNPACKED_RUNTIME_ENTRIES
    .filter(entry => seen.has(entry))
  if (forbidden.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} mirrors ordinary archived modules: ${forbidden.join(', ')}; inventory: ${inventory}`,
    )
  }
  const allowedDesktop = new Set(allowedDesktopEntries.map(normalizeArchiveEntry))
  const unexpectedDesktopEntries = normalizedFiles
    .map(file => file.path)
    .filter(entry => unpackedPackageRoot(entry) === undefined && !allowedDesktop.has(entry))
    .sort()
  if (unexpectedDesktopEntries.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} contains non-allowlisted desktop entries: ${unexpectedDesktopEntries.join(', ')}; inventory: ${inventory}`,
    )
  }
  const unexpectedPackageRoots = [...new Set(normalizedFiles.flatMap((file) => {
    const root = unpackedPackageRoot(file.path)
    return root === undefined || allowedSmartUnpackPackageRoot(root)
      || file.path.startsWith('node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/') ? [] : [root]
  }))].sort()
  if (unexpectedPackageRoots.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} contains non-allowlisted package roots: ${unexpectedPackageRoots.join(', ')}; inventory: ${inventory}`,
    )
  }
  const pnpm = summary.groups.find(group => group.root === 'node_modules/pnpm')
  if (pnpm !== undefined
    && (pnpm.files > MAX_PNPM_SMART_UNPACK_FILES || pnpm.bytes > MAX_PNPM_SMART_UNPACK_BYTES)) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} exceeds pnpm smart-unpack budget `
      + `${String(MAX_PNPM_SMART_UNPACK_FILES)} files/${String(MAX_PNPM_SMART_UNPACK_BYTES)} bytes; `
      + `inventory: ${inventory}`,
    )
  }
  if (summary.files > MAX_UNPACKED_RUNTIME_FILES) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} exceeds selective ASAR file budget ${String(MAX_UNPACKED_RUNTIME_FILES)}; inventory: ${inventory}`,
    )
  }
  if (summary.bytes > MAX_UNPACKED_RUNTIME_BYTES) {
    throw new Error(
      `dsh-plugin-desktop: unpacked runtime at ${unpackedRoot} exceeds selective ASAR byte budget ${String(MAX_UNPACKED_RUNTIME_BYTES)}; inventory: ${inventory}`,
    )
  }
  return summary
}

/**
 * Verify Electron Builder's completed application before signing begins.
 * @param context - Electron Builder's afterPack context.
 * @param readHeader - raw ASAR header reader.
 * @param exists - physical-file probe for the unpacked CLI dependency tree.
 * @param listUnpacked - physical file inventory below app.asar.unpacked.
 * @param listDesktop - recursive inventory of the completed desktop lib/ output.
 * @returns Physical payload inventory; failure rejects the package before signing.
 */
export function verifyPackagedRuntime(
  context: PackagedRuntimeContext,
  readHeader: ArchiveHeaderReader = getRawHeader,
  exists: FileProbe = existsSync,
  listUnpacked: UnpackedFileLister = listUnpackedRuntimeFiles,
  listDesktop: DesktopRuntimeLister = listDesktopRuntimeEntries,
): UnpackedRuntimeSummary {
  const libRoot = join(context.packager.projectDir ?? DESKTOP_PACKAGE_ROOT, 'lib')
  let desktopRuntimeEntries: readonly string[]
  try {
    desktopRuntimeEntries = listDesktop(libRoot)
  } catch (cause) {
    throw new Error(
      `dsh-plugin-desktop: failed to inventory desktop build output at ${libRoot}`,
      { cause },
    )
  }
  const archive = verifyPackagedAsar(
    resolvePackagedAsarPath(context),
    [...REQUIRED_PACKAGED_RUNTIME_ENTRIES, ...desktopRuntimeEntries],
    readHeader,
  )
  const unpackedRoot = resolvePackagedUnpackedRoot(context)
  if (context.electronPlatformName === 'win32' && context.arch !== undefined && context.arch !== 1) {
    throw new Error(
      `dsh-plugin-desktop: unsupported Windows package architecture ${String(context.arch)}; only x64 is configured`,
    )
  }
  const desktopPhysicalEntries = context.electronPlatformName === 'darwin'
    ? REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES
    : REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES
  const posixFsExtEntry = context.electronPlatformName === 'darwin'
    || context.electronPlatformName === 'linux'
    ? context.arch === 1
      ? REQUIRED_POSIX_FS_EXT_ENTRIES[context.electronPlatformName].x64
      : context.arch === 3
        ? REQUIRED_POSIX_FS_EXT_ENTRIES[context.electronPlatformName].arm64
        : undefined
    : undefined
  const requiredPhysicalEntries = context.electronPlatformName === 'win32'
    ? [
        ...desktopPhysicalEntries,
        ...REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES,
      ]
    : context.electronPlatformName === 'darwin' && context.arch === 4
      ? [...desktopPhysicalEntries, ...REQUIRED_MACOS_UNIVERSAL_ENTRIES]
      : posixFsExtEntry === undefined
        ? desktopPhysicalEntries
        : [...desktopPhysicalEntries, posixFsExtEntry]
  const missing = requiredPhysicalEntries.filter(entry => !exists(join(unpackedRoot, entry)))
  if (missing.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: packaged runtime at ${unpackedRoot} is missing required physical entries: ${missing.join(', ')}`,
    )
  }
  if (context.electronPlatformName === 'darwin' && context.arch === 4) {
    const forbidden = FORBIDDEN_MACOS_UNIVERSAL_ENTRIES
      .filter(entry => exists(join(unpackedRoot, entry)))
    if (forbidden.length > 0) {
      throw new Error(
        `dsh-plugin-desktop: universal macOS runtime at ${unpackedRoot} contains host-architecture build output: ${forbidden.join(', ')}`,
      )
    }
  }
  return verifySelectiveUnpackedRuntime(
    archive,
    unpackedRoot,
    listUnpacked(unpackedRoot),
    desktopPhysicalEntries,
  )
}

/** Emit one compact package-root inventory after the static ASAR check passes. */
export function reportUnpackedRuntime(summary: UnpackedRuntimeSummary): void {
  process.stdout.write(`dsh-plugin-desktop: selective ASAR unpacked inventory: ${formatUnpackedRuntimeSummary(summary)}\n`)
}

/**
 * Run the static packaged-runtime check as Electron Builder's afterPack hook.
 * @param context - Electron Builder's afterPack context.
 * @returns A promise that rejects before signing when the runtime is incomplete.
 */
export async function afterPack(
  context: PackagedRuntimeContext,
  verify: typeof verifyPackagedRuntime = verifyPackagedRuntime,
  report: (summary: UnpackedRuntimeSummary) => void = reportUnpackedRuntime,
): Promise<void> {
  const summary = verify(context)
  report(summary)
}

export default afterPack
