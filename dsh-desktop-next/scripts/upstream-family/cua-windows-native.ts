/**
 * Provide the helper of the official Computer Use bundle's Windows provider in the Windows packages that ship the bundle.
 * dsh 0.2.3 publishes `@deepseek-ai/dsh-cua-windows` without it, and the provider compiles one only inside an upstream
 * source checkout. Desktop publishes it from the pinned upstream checkout with the provider's own `dotnet publish`
 * arguments, keeps the output under `.desktop-build/cua-windows/<cpu>/` until those sources change, and copies it to
 * `native/bin/win-<cpu>/` below the installed provider, where the provider starts it.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, cpSync, existsSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { assertWindowsArchitecture, type WindowsArchitecture } from '../../../dsh-plugin-desktop/scripts/windows-architecture.ts'
import { OFFICIAL_CUA_WINDOWS_EXECUTABLE, OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE } from '../../src/upstream-family/official-cua.ts'
import { OFFICIAL_COMPUTER_USE_BUNDLE, officialProviderPackageDir } from './cua-native.ts'

/** The provider's copy in the pinned upstream checkout, which holds the helper sources the published package omits. */
export const CUA_WINDOWS_SOURCE = resolve(import.meta.dirname, '..', '..', '..', 'deepseek-harness', 'packages', 'experimental', 'cua-windows')

/** What the helper project compiles or embeds, below the provider's `native/` directory. */
const NATIVE_INPUTS = ['Directory.Build.props', 'protocol.schema.json', 'entry', 'protocol'] as const
/** Build outputs and editor state that the provider's `native/.gitignore` keeps out of those inputs. */
const BUILD_OUTPUTS = new Set(['.build', 'bin', 'obj', '.vs'])
/** Changes whenever the build below produces something else from the same sources, so earlier output is not reused. */
const BUILD_FORMAT = 'dsh-desktop-cua-windows-1'
/** The executable and the files the self-contained .NET host reads beside it. */
const HELPER_FILES = [OFFICIAL_CUA_WINDOWS_EXECUTABLE, 'dsh-cua-windows.runtimeconfig.json', 'dsh-cua-windows.deps.json'] as const

/** Runs `dotnet` with these arguments and throws when it cannot start or fails. */
export type RunDotnet = (args: readonly string[]) => void
/** Starts the packaged helper once without arguments and reports how it exited. */
export type StartHelper = (executable: string) => { status: number | null; stderr: string }

/**
 * The `dotnet publish` arguments of the provider's own source build (`buildNativeExecutable` in its `src/native-build.ts`),
 * plus a restore that must match the projects' lock files.
 * @param project - The helper project, `entry/CuaWindows.csproj`.
 * @param arch - CPU of the helper.
 * @param output - Directory that receives the self-contained helper.
 * @returns Arguments after `dotnet`.
 */
export function cuaWindowsPublishArgs(project: string, arch: WindowsArchitecture, output: string): string[] {
  return ['publish', project, '--configuration', 'Release', '--runtime', `win-${arch}`, '--self-contained', 'true',
    '--output', output, '-p:EnableWindowsTargeting=true', '-p:RestoreLockedMode=true']
}

const runDotnet: RunDotnet = (args) => {
  const result = spawnSync('dotnet', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' },
  })
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new Error('The official Windows Computer Use helper needs the .NET 10 SDK: install it from https://dotnet.microsoft.com/download/dotnet/10.0 so that `dotnet` is on PATH')
  }
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`dotnet ${args.join(' ')} ${result.signal ?? `exited with ${String(result.status)}`}: ${`${result.stdout}${result.stderr}`.trim().slice(-8000)}`)
  }
}

const startHelper: StartHelper = (executable) => {
  const result = spawnSync(executable, [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stderr: result.stderr }
}

/**
 * List the files of one input, skipping build outputs.
 * @param root - The provider's `native/` directory.
 * @param input - A file or directory below it.
 * @returns Slash-separated paths below `root`, sorted.
 */
function inputFiles(root: string, input: string): string[] {
  if (!statSync(join(root, input)).isDirectory()) return [input]
  return readdirSync(join(root, input), { withFileTypes: true })
    .filter(entry => !BUILD_OUTPUTS.has(entry.name))
    .flatMap(entry => inputFiles(root, `${input}/${entry.name}`))
    .sort()
}

/**
 * Digest everything a publish depends on: the build format, the publish arguments for the CPU and every input file.
 * @param nativeRoot - The provider's `native/` directory in the checkout.
 * @param arch - CPU of the helper.
 * @returns Hexadecimal SHA-256.
 */
function inputDigest(nativeRoot: string, arch: WindowsArchitecture): string {
  const hash = createHash('sha256').update(`${BUILD_FORMAT}\0${cuaWindowsPublishArgs('', arch, '').join('\0')}\0`)
  for (const input of NATIVE_INPUTS) {
    for (const file of inputFiles(nativeRoot, input)) hash.update(`${file}\0`).update(readFileSync(join(nativeRoot, file))).update('\0')
  }
  return hash.digest('hex')
}

/**
 * Find the helper sources of the provider release the package installed.
 * @param packageDir - The installed provider.
 * @param source - The provider's copy in the upstream checkout.
 * @returns The checkout's `native/` directory.
 * @throws When the checkout is missing or holds another release of the provider, whose helper might speak another protocol.
 */
function pinnedNativeSources(packageDir: string, source: string): string {
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error(`The upstream checkout lacks ${OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE} at ${source}; run git submodule update --init --recursive`)
  }
  const manifest = (root: string) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string; version?: string }
  const installed = manifest(packageDir)
  const pinned = manifest(source)
  const sameSource = inputFiles(packageDir, 'src').every(file => existsSync(join(source, file))
    && readFileSync(join(packageDir, file)).equals(readFileSync(join(source, file))))
  if (pinned.name !== installed.name || pinned.version !== installed.version || !sameSource) {
    throw new Error(`The upstream checkout holds another ${OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE} (${String(pinned.version)}) than the package installed (${String(installed.version)}); check out the pinned submodule commit`)
  }
  return join(source, 'native')
}

/**
 * Publish the helper for each CPU of the package, or reuse the earlier publish of the same sources, and copy it to where the
 * installed provider starts it.
 * @param desktopRoot - Desktop package root.
 * @param archs - CPUs of the package.
 * @param run - Runs `dotnet`.
 * @param source - The provider's copy in the upstream checkout.
 * @returns The installed helper executables; none when the package does not ship the official bundle.
 * @throws When the bundle is a dependency but its Windows provider is not installed, when the checkout does not hold the
 * installed release, or when the publish fails, including for a missing .NET SDK.
 */
export function prepareCuaWindowsNative(desktopRoot: string, archs: readonly WindowsArchitecture[], run: RunDotnet = runDotnet, source: string = CUA_WINDOWS_SOURCE): string[] {
  const packageDir = officialProviderPackageDir(desktopRoot, OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE)
  if (packageDir === undefined) return []
  const nativeRoot = pinnedNativeSources(packageDir, source)
  return archs.map((arch) => {
    const scratch = join(desktopRoot, '.desktop-build', 'cua-windows', arch)
    const output = join(scratch, 'publish')
    const record = join(scratch, 'inputs.sha256')
    const digest = inputDigest(nativeRoot, arch)
    const reusable = existsSync(record) && readFileSync(record, 'utf8') === digest && HELPER_FILES.every(file => existsSync(join(output, file)))
    if (!reusable) {
      rmSync(scratch, { recursive: true, force: true })
      // The project writes its intermediate files next to Directory.Build.props, so it builds from a copy, not the checkout.
      const sources = join(scratch, 'src')
      for (const input of NATIVE_INPUTS) {
        cpSync(join(nativeRoot, input), join(sources, input), { recursive: true, filter: path => !BUILD_OUTPUTS.has(basename(path)) })
      }
      run(cuaWindowsPublishArgs(join(sources, 'entry', 'CuaWindows.csproj'), arch, output))
      const missing = HELPER_FILES.filter(file => !existsSync(join(output, file)))
      if (missing.length > 0) throw new Error(`dotnet publish produced no ${missing.join(', ')} for win-${arch}`)
      rmSync(sources, { recursive: true, force: true })
      writeFileSync(record, digest)
    }
    const installed = join(packageDir, 'native', 'bin', `win-${arch}`)
    rmSync(installed, { recursive: true, force: true })
    cpSync(output, installed, { recursive: true })
    return join(installed, OFFICIAL_CUA_WINDOWS_EXECUTABLE)
  })
}

/**
 * Leave the helper of a CPU a package does not carry out of its payload; a development machine may hold both.
 * @param name - Package name.
 * @param entry - Slash-separated path below the package directory.
 * @param archs - CPUs the package carries.
 * @returns Omission reason, or undefined to keep the entry.
 */
export function cuaWindowsNativeExclusion(name: string, entry: string, archs: readonly string[]): string | undefined {
  if (name !== OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE) return undefined
  const arch = /^native\/bin\/win-([^/]+)(?:\/|$)/u.exec(entry)?.[1]
  return arch !== undefined && !archs.includes(arch) ? 'Computer Use helper other architecture' : undefined
}

/**
 * Where a Windows package keeps the helpers among the files unpacked beside its archive.
 * @param unpackedRoot - The package's `app.asar.unpacked`.
 * @returns The provider's `native/bin` there.
 */
export function cuaWindowsHelperRoot(unpackedRoot: string): string {
  return join(unpackedRoot, 'node_modules', ...OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE.split('/'), 'native', 'bin')
}

/**
 * Read the COFF machine, the optional header magic and, for a managed image, the CLR header flags of a PE file.
 * @param path - The file.
 * @returns What the headers declare; `clrFlags` is undefined for native code.
 */
function peImage(path: string): { machine: number; magic: number; clrFlags: number | undefined } {
  const fd = openSync(path, 'r')
  try {
    const read = (position: number, length: number): Buffer => {
      const bytes = Buffer.alloc(length)
      if (readSync(fd, bytes, 0, length, position) !== length) throw new Error(`Truncated Windows PE header: ${path}`)
      return bytes
    }
    const dos = read(0, 64)
    if (dos.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Invalid Windows PE header: ${path}`)
    const header = dos.readUInt32LE(60)
    const coff = read(header, 24)
    if (coff.toString('ascii', 0, 4) !== 'PE\0\0') throw new Error(`Invalid Windows PE signature: ${path}`)
    const machine = coff.readUInt16LE(4)
    const sections = coff.readUInt16LE(6)
    const optional = read(header + 24, coff.readUInt16LE(20))
    const magic = optional.readUInt16LE(0)
    if (magic !== 0x10b && magic !== 0x20b) throw new Error(`Unknown Windows PE optional header: ${path}`)
    const directories = magic === 0x20b ? 112 : 96
    // The CLR runtime header is data directory 14.
    if (optional.readUInt32LE(directories - 4) <= 14) return { machine, magic, clrFlags: undefined }
    const clr = optional.readUInt32LE(directories + 14 * 8)
    if (clr === 0) return { machine, magic, clrFlags: undefined }
    const table = read(header + 24 + optional.length, sections * 40)
    for (let index = 0; index < sections; index++) {
      const address = table.readUInt32LE(index * 40 + 12)
      const size = Math.max(table.readUInt32LE(index * 40 + 8), table.readUInt32LE(index * 40 + 16))
      if (clr >= address && clr < address + size) {
        return { machine, magic, clrFlags: read(table.readUInt32LE(index * 40 + 20) + clr - address + 16, 4).readUInt32LE(0) }
      }
    }
    throw new Error(`Windows PE CLR header lies outside its sections: ${path}`)
  } finally { closeSync(fd) }
}

/**
 * Whether a PE file is IL that any 64-bit .NET runtime compiles for its own CPU: a PE32 image for x86 whose CLR header
 * sets COMIMAGE_FLAGS_ILONLY and clears COMIMAGE_FLAGS_32BITREQUIRED.
 * @param path - The file.
 * @returns true for such a library.
 */
function architectureNeutralLibrary(path: string): boolean {
  const { machine, magic, clrFlags } = peImage(path)
  return machine === 0x14c && magic === 0x10b && clrFlags !== undefined && (clrFlags & 0x1) !== 0 && (clrFlags & 0x2) === 0
}

/**
 * Check the helper a Windows package carries beside its archive, then start it once. Electron loads none of these files:
 * the helper runs as a .NET process of its own, so a managed library may be architecture-neutral IL rather than code for
 * the package's CPU.
 * @param unpackedRoot - The package's `app.asar.unpacked`.
 * @param arch - CPU of the package.
 * @param desktopRoot - Desktop package root, whose manifest says whether the package ships the official bundle.
 * @param start - Starts the helper.
 * @returns Number of executables and libraries checked, or undefined when the package does not ship the official bundle.
 */
export function verifyCuaWindowsHelper(unpackedRoot: string, arch: WindowsArchitecture, desktopRoot: string, start: StartHelper = startHelper): number | undefined {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  if (manifest.dependencies?.[OFFICIAL_COMPUTER_USE_BUNDLE] === undefined) return undefined
  const root = cuaWindowsHelperRoot(unpackedRoot)
  const carried = existsSync(root) ? readdirSync(root).sort() : []
  if (carried.join(',') !== `win-${arch}`) {
    throw new Error(`A Windows ${arch} package must carry the official Computer Use helper for win-${arch} alone beside its archive; found ${carried.length === 0 ? 'none' : carried.join(', ')}`)
  }
  const directory = join(root, `win-${arch}`)
  const missing = HELPER_FILES.filter(file => !existsSync(join(directory, file)))
  if (missing.length > 0) throw new Error(`The official Computer Use helper beside the archive lacks ${missing.join(', ')}`)
  let checked = 0
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !['.dll', '.exe'].includes(extname(entry.name).toLowerCase())) continue
    const path = join(entry.parentPath, entry.name)
    if (!architectureNeutralLibrary(path)) assertWindowsArchitecture(path, arch)
    checked++
  }
  const { status, stderr } = start(join(directory, OFFICIAL_CUA_WINDOWS_EXECUTABLE))
  // Without the provider's arguments the helper starts its runtime and then refuses to serve.
  if (status === 0 || !stderr.includes('INVALID_ARGUMENT')) {
    throw new Error(`The packaged official Computer Use helper did not start: exit ${String(status)}: ${stderr.trim()}`)
  }
  return checked
}
