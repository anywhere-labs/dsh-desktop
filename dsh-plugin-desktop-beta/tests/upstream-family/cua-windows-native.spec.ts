/** Publish the official Windows Computer Use helper for the Windows packages that ship the official bundle, and check what they carry. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { verifyWindowsNativeTree } from '../../../dsh-plugin-desktop/scripts/windows-architecture.ts'
import { nextRuntimeFileExclusion } from '../../scripts/runtime-file-policy.ts'
import {
  cuaWindowsHelperRoot, cuaWindowsNativeExclusion, prepareCuaWindowsNative, verifyCuaWindowsHelper, type RunDotnet, type StartHelper,
} from '../../scripts/upstream-family/cua-windows-native.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const BUNDLE = '@deepseek-ai/dsh-cua-bundle'
const PROVIDER = '@deepseek-ai/dsh-cua-windows'
const HELPER_FILES = ['dsh-cua-windows.exe', 'dsh-cua-windows.runtimeconfig.json', 'dsh-cua-windows.deps.json']

function temporary(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** A Desktop package root, with the official bundle as a dependency and its Windows provider installed unless omitted. */
function desktop(options: { bundle?: boolean; provider?: boolean } = {}): string {
  const root = temporary('desktop-cua-windows-')
  const bundle = options.bundle ?? true
  write(join(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-desktop-beta', dependencies: bundle ? { [BUNDLE]: '0.2.3-alpha.2' } : {} }))
  if (bundle) write(join(root, 'node_modules', BUNDLE, 'package.json'), JSON.stringify({ name: BUNDLE, version: '0.2.3-alpha.2' }))
  if (bundle && (options.provider ?? true)) {
    write(join(root, 'node_modules', PROVIDER, 'package.json'), JSON.stringify({ name: PROVIDER, version: '0.2.3-alpha.2' }))
    write(join(root, 'node_modules', PROVIDER, 'src', 'index.ts'), 'export const name = "cua-windows"\n')
  }
  return root
}

/** The provider's copy in an upstream checkout: the same release, plus the helper sources the package omits. */
function checkout(options: { version?: string; index?: string } = {}): string {
  const root = temporary('upstream-cua-windows-')
  write(join(root, 'package.json'), JSON.stringify({ name: PROVIDER, version: options.version ?? '0.2.3-alpha.2' }))
  write(join(root, 'src', 'index.ts'), options.index ?? 'export const name = "cua-windows"\n')
  write(join(root, 'native', 'Directory.Build.props'), '<Project />\n')
  write(join(root, 'native', 'protocol.schema.json'), '{}\n')
  write(join(root, 'native', 'entry', 'CuaWindows.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />\n')
  write(join(root, 'native', 'entry', 'Program.cs'), 'return 0;\n')
  write(join(root, 'native', 'protocol', 'CuaProtocol.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />\n')
  // A local build of the checkout; publishing must not depend on it.
  write(join(root, 'native', 'entry', 'bin', 'Release', 'stale.dll'), 'stale')
  write(join(root, 'native', 'tests', 'Protocol.Tests.csproj'), '<Project />\n')
  return root
}

/** Model `dotnet publish`: check the copied sources and write a self-contained helper into the output directory. */
function publisher(product: (arch: string) => string = arch => `helper ${arch}`) {
  return vi.fn<RunDotnet>((args) => {
    const project = args[1]!
    const sources = dirname(dirname(project))
    expect(readFileSync(project, 'utf8')).toContain('Microsoft.NET.Sdk')
    for (const input of ['Directory.Build.props', 'protocol.schema.json', 'protocol/CuaProtocol.csproj']) expect(existsSync(join(sources, input))).toBe(true)
    expect(existsSync(join(sources, 'entry', 'bin'))).toBe(false)
    expect(existsSync(join(sources, 'tests'))).toBe(false)
    const output = args[args.indexOf('--output') + 1]!
    const arch = args[args.indexOf('--runtime') + 1]!.slice('win-'.length)
    for (const file of HELPER_FILES) write(join(output, file), file.endsWith('.exe') ? product(arch) : '{}')
    write(join(output, 'cs', 'System.CommandLine.resources.dll'), 'satellite')
  })
}

it('publishes the helper from a copy of the pinned sources with the provider\'s own arguments and installs it where the provider starts it', () => {
  const root = desktop()
  const source = checkout()
  const run = publisher()
  const [helper] = prepareCuaWindowsNative(root, ['x64'], run, source)
  const scratch = join(root, '.desktop-build', 'cua-windows', 'x64')
  expect(run).toHaveBeenCalledExactlyOnceWith(['publish', join(scratch, 'src', 'entry', 'CuaWindows.csproj'), '--configuration', 'Release',
    '--runtime', 'win-x64', '--self-contained', 'true', '--output', join(scratch, 'publish'), '-p:EnableWindowsTargeting=true', '-p:RestoreLockedMode=true'])
  expect(helper).toBe(join(root, 'node_modules', PROVIDER, 'native', 'bin', 'win-x64', 'dsh-cua-windows.exe'))
  expect(readFileSync(helper!, 'utf8')).toBe('helper x64')
  expect(existsSync(join(dirname(helper!), 'cs', 'System.CommandLine.resources.dll'))).toBe(true)
  // The copied sources and their intermediate files go once the helper is published.
  expect(existsSync(join(scratch, 'src'))).toBe(false)
  expect(existsSync(join(source, 'native', '.build'))).toBe(false)
})

it('reuses the earlier publish until an input of the helper changes', () => {
  const root = desktop()
  const source = checkout()
  let bytes = 'first'
  const run = publisher(() => bytes)
  const [helper] = prepareCuaWindowsNative(root, ['arm64'], run, source)
  bytes = 'second'
  rmSync(join(root, 'node_modules', PROVIDER, 'native'), { recursive: true })
  expect(prepareCuaWindowsNative(root, ['arm64'], run, source)).toEqual([helper])
  expect(run).toHaveBeenCalledOnce()
  // The installed copy comes back from the earlier publish.
  expect(readFileSync(helper!, 'utf8')).toBe('first')
  // A local build in the checkout is no input; a source file is.
  write(join(source, 'native', 'entry', 'obj', 'project.assets.json'), '{}')
  prepareCuaWindowsNative(root, ['arm64'], run, source)
  expect(run).toHaveBeenCalledOnce()
  write(join(source, 'native', 'entry', 'Program.cs'), 'return 1;\n')
  prepareCuaWindowsNative(root, ['arm64'], run, source)
  expect(run).toHaveBeenCalledTimes(2)
  expect(readFileSync(helper!, 'utf8')).toBe('second')
})

it('builds nothing for a package that does not ship the official bundle', () => {
  const run = publisher()
  expect(prepareCuaWindowsNative(desktop({ bundle: false }), ['x64'], run, checkout())).toEqual([])
  expect(run).not.toHaveBeenCalled()
})

it('fails when the package ships the bundle but its Windows provider is not installed', () => {
  const run = publisher()
  expect(() => prepareCuaWindowsNative(desktop({ provider: false }), ['x64'], run, checkout())).toThrow(PROVIDER)
  expect(run).not.toHaveBeenCalled()
})

it.each([
  ['another release', { version: '0.2.3-alpha.3' }],
  ['other provider sources', { index: 'export const name = "cua-windows-next"\n' }],
])('refuses an upstream checkout that holds %s of the provider', (_case, options) => {
  const run = publisher()
  expect(() => prepareCuaWindowsNative(desktop(), ['x64'], run, checkout(options))).toThrow('check out the pinned submodule commit')
  expect(run).not.toHaveBeenCalled()
})

it('asks for the submodule when the upstream checkout lacks the provider', () => {
  expect(() => prepareCuaWindowsNative(desktop(), ['x64'], publisher(), join(temporary('empty-checkout-'), 'cua-windows')))
    .toThrow('git submodule update --init --recursive')
})

it('fails when the publish leaves out a file the self-contained helper needs, and publishes again next time', () => {
  const root = desktop()
  const source = checkout()
  const incomplete = vi.fn<RunDotnet>((args) => { write(join(args[args.indexOf('--output') + 1]!, 'dsh-cua-windows.exe'), 'helper') })
  expect(() => prepareCuaWindowsNative(root, ['x64'], incomplete, source)).toThrow('dsh-cua-windows.runtimeconfig.json, dsh-cua-windows.deps.json')
  const run = publisher()
  prepareCuaWindowsNative(root, ['x64'], run, source)
  expect(run).toHaveBeenCalledOnce()
})

it('leaves the helper of a CPU a Windows package does not carry out of its payload', () => {
  expect(cuaWindowsNativeExclusion(PROVIDER, 'native/bin/win-arm64/dsh-cua-windows.exe', ['x64'])).toBe('Computer Use helper other architecture')
  expect(cuaWindowsNativeExclusion(PROVIDER, 'native/bin/win-x64', ['arm64'])).toBe('Computer Use helper other architecture')
  expect(cuaWindowsNativeExclusion(PROVIDER, 'native/bin/win-x64/dsh-cua-windows.exe', ['x64'])).toBeUndefined()
  expect(cuaWindowsNativeExclusion(PROVIDER, 'lib/index.js', ['x64'])).toBeUndefined()
  expect(cuaWindowsNativeExclusion('@deepseek-ai/dsh-cua-macos', 'native/bin/win-arm64/x.exe', ['x64'])).toBeUndefined()
  const path = `${PROVIDER}/native/bin/win-arm64/dsh-cua-windows.exe`
  expect(nextRuntimeFileExclusion(path, { platform: 'win32', archs: ['x64'] })).toBe('Computer Use helper other architecture')
  expect(nextRuntimeFileExclusion(path, { platform: 'win32', archs: ['arm64'] })).toBeUndefined()
})

/**
 * A minimal PE image: a COFF header for `machine`, an optional header, one section and, for a managed image, a CLR header
 * with `clrFlags` (0x1 IL only, 0x2 32-bit required).
 */
function pe(machine: number, options: { pe32Plus?: boolean; clrFlags?: number } = {}): Buffer {
  const data = Buffer.alloc(0x600)
  data.write('MZ', 0, 'ascii')
  data.writeUInt32LE(0x80, 0x3c)
  data.write('PE\0\0', 0x80, 'ascii')
  data.writeUInt16LE(machine, 0x84)
  data.writeUInt16LE(1, 0x86)
  const optionalSize = options.pe32Plus === true ? 0xf0 : 0xe0
  data.writeUInt16LE(optionalSize, 0x94)
  data.writeUInt16LE(options.pe32Plus === true ? 0x20b : 0x10b, 0x98)
  const directories = 0x98 + (options.pe32Plus === true ? 112 : 96)
  data.writeUInt32LE(16, directories - 4)
  const section = 0x98 + optionalSize
  data.writeUInt32LE(0x1000, section + 8)
  data.writeUInt32LE(0x2000, section + 12)
  data.writeUInt32LE(0x200, section + 16)
  data.writeUInt32LE(0x400, section + 20)
  if (options.clrFlags !== undefined) {
    data.writeUInt32LE(0x2000, directories + 14 * 8)
    data.writeUInt32LE(72, directories + 14 * 8 + 4)
    data.writeUInt32LE(72, 0x400)
    data.writeUInt32LE(options.clrFlags, 0x410)
  }
  return data
}

/** The files a Windows x64 package unpacks beside its archive, with the helper the package carries. */
function unpacked(files: Record<string, Buffer | string>): string {
  const root = temporary('app-asar-unpacked-')
  const helper = join(cuaWindowsHelperRoot(root), 'win-x64')
  write(join(helper, 'dsh-cua-windows.exe'), pe(0x8664, { pe32Plus: true }))
  write(join(helper, 'dsh-cua-windows.runtimeconfig.json'), '{}')
  write(join(helper, 'dsh-cua-windows.deps.json'), '{}')
  for (const [path, content] of Object.entries(files)) write(join(root, path), content)
  return root
}

const refusing: StartHelper = () => ({ status: 4294967295, stderr: 'INVALID_ARGUMENT: The helper must be launched by the dsh Windows provider\n' })
const HELPER = 'node_modules/@deepseek-ai/dsh-cua-windows/native/bin/win-x64'

it('accepts helper code for the package CPU and architecture-neutral IL, and starts the helper once', () => {
  const root = unpacked({
    [`${HELPER}/coreclr.dll`]: pe(0x8664, { pe32Plus: true }),
    [`${HELPER}/System.Private.CoreLib.dll`]: pe(0x8664, { pe32Plus: true, clrFlags: 0xc }),
    [`${HELPER}/dsh-cua-windows.dll`]: pe(0x8664, { pe32Plus: true, clrFlags: 0x1 }),
    [`${HELPER}/System.CommandLine.dll`]: pe(0x14c, { clrFlags: 0x9 }),
    [`${HELPER}/cs/System.CommandLine.resources.dll`]: pe(0x14c, { clrFlags: 0x1 }),
  })
  const start = vi.fn<StartHelper>(refusing)
  expect(verifyCuaWindowsHelper(root, 'x64', desktop(), start)).toBe(6)
  expect(start).toHaveBeenCalledExactlyOnceWith(join(root, HELPER, 'dsh-cua-windows.exe'))
  // Electron's own check skips the helper, which runs as a process of its own; it still covers everything else.
  write(join(root, 'node_modules', 'addon', 'addon.node'), pe(0x8664, { pe32Plus: true }))
  expect(() => verifyWindowsNativeTree(root, 'x64')).toThrow('architecture mismatch')
  expect(verifyWindowsNativeTree(root, 'x64', path => path === cuaWindowsHelperRoot(root))).toBe(1)
})

it.each([
  ['native code for another CPU', pe(0xaa64, { pe32Plus: true })],
  ['IL that requires a 32-bit process', pe(0x14c, { clrFlags: 0x3 })],
  ['native x86 code', pe(0x14c)],
])('rejects %s in the helper', (_case, image) => {
  const root = unpacked({ [`${HELPER}/library.dll`]: image })
  expect(() => verifyCuaWindowsHelper(root, 'x64', desktop(), refusing)).toThrow('architecture mismatch')
})

it('requires the helper of the package CPU alone, with the files its runtime reads', () => {
  expect(() => verifyCuaWindowsHelper(temporary('app-asar-unpacked-'), 'x64', desktop(), refusing)).toThrow('found none')
  const other = unpacked({ 'node_modules/@deepseek-ai/dsh-cua-windows/native/bin/win-arm64/dsh-cua-windows.exe': pe(0xaa64, { pe32Plus: true }) })
  expect(() => verifyCuaWindowsHelper(other, 'x64', desktop(), refusing)).toThrow('found win-arm64, win-x64')
  const incomplete = unpacked({})
  rmSync(join(incomplete, HELPER, 'dsh-cua-windows.deps.json'))
  expect(() => verifyCuaWindowsHelper(incomplete, 'x64', desktop(), refusing)).toThrow('lacks dsh-cua-windows.deps.json')
})

it('rejects a packaged helper that does not start its runtime', () => {
  const root = unpacked({})
  expect(() => verifyCuaWindowsHelper(root, 'x64', desktop(), () => ({ status: 2147516553, stderr: 'You must install .NET to run this application.' })))
    .toThrow('did not start')
  expect(() => verifyCuaWindowsHelper(root, 'x64', desktop(), () => ({ status: 0, stderr: '' }))).toThrow('did not start')
})

it('checks nothing in a package that does not ship the official bundle', () => {
  const start = vi.fn<StartHelper>(refusing)
  expect(verifyCuaWindowsHelper(temporary('app-asar-unpacked-'), 'x64', desktop({ bundle: false }), start)).toBeUndefined()
  expect(start).not.toHaveBeenCalled()
})
