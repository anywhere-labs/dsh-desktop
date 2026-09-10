import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_SMART_UNPACK_PACKAGE_PREFIXES,
  ALLOWED_SMART_UNPACK_PACKAGE_ROOTS,
  afterPack,
  formatUnpackedRuntimeSummary,
  FORBIDDEN_UNPACKED_RUNTIME_ENTRIES,
  indexPackagedAsarHeader,
  listDesktopRuntimeEntries,
  MAX_PNPM_SMART_UNPACK_BYTES,
  MAX_PNPM_SMART_UNPACK_FILES,
  MAX_UNPACKED_RUNTIME_BYTES,
  MAX_UNPACKED_RUNTIME_FILES,
  REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES,
  REQUIRED_DSH_CLI_RUNTIME_ENTRIES,
  REQUIRED_PACKAGED_RUNTIME_ENTRIES,
  REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES,
  REQUIRED_MACOS_UNIVERSAL_ENTRIES,
  REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES,
  REQUIRED_POSIX_FS_EXT_ENTRIES,
  REQUIRED_UNPACKED_RUNTIME_ENTRIES,
  REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES,
  resolvePackagedAsarPath,
  resolvePackagedExecutablePath,
  resolvePackagedUnpackedRoot,
  resolveRuntimePackageRoot,
  smokePackagedElectronRuntime,
  summarizeUnpackedRuntime,
  verifyPackagedRuntime,
  verifySelectiveUnpackedRuntime,
  type ArchiveHeaderReader,
  type FileProbe,
  type PackagedAsarIndex,
  type PackagedElectronRunner,
  type PackagedRuntimeContext,
  type UnpackedRuntimeFile,
  type UnpackedRuntimeSummary,
} from '../scripts/verify-packaged-runtime.ts'
import { FORBIDDEN_MACOS_UNIVERSAL_ENTRIES } from '../scripts/mac-universal.ts'

function context(
  appOutDir: string,
  electronPlatformName: string,
  arch?: number,
  executableName?: string,
): PackagedRuntimeContext {
  return {
    appOutDir,
    electronPlatformName,
    ...(arch === undefined ? {} : { arch }),
    packager: {
      ...(executableName === undefined ? {} : { executableName }),
      appInfo: { productFilename: 'DSH Desktop' },
    },
  }
}

const DESKTOP_RUNTIME_ENTRIES = listDesktopRuntimeEntries(
  fileURLToPath(new URL('../lib', import.meta.url)),
)

function normalized(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).join('/')
}

interface TestAsarHeaderEntry {
  files?: Record<string, TestAsarHeaderEntry>
  link?: string
  offset?: string
  size?: number
  unpacked?: boolean
}

function rawAsarHeader(
  entries: readonly string[],
  unpackedEntries: readonly string[] = [],
  links: ReadonlySet<string> = new Set(),
): { header: TestAsarHeaderEntry } {
  const root: TestAsarHeaderEntry = { files: {} }
  const unpacked = new Set(unpackedEntries.map(normalized))
  for (const entry of entries) {
    const path = normalized(entry)
    const segments = path.split('/')
    let directory = root
    for (const segment of segments.slice(0, -1)) {
      directory.files ??= {}
      const child = directory.files[segment] ?? { files: {} }
      directory.files[segment] = child
      directory = child
    }
    const name = segments.at(-1) as string
    directory.files ??= {}
    directory.files[name] = links.has(path)
      ? { link: 'target', ...(unpacked.has(path) ? { unpacked: true } : {}) }
      : { size: 1, offset: '0', ...(unpacked.has(path) ? { unpacked: true } : {}) }
  }
  return { header: root }
}

function headerReader(
  entries: readonly string[],
  unpackedEntries: readonly string[] = [],
  links: ReadonlySet<string> = new Set(),
): ArchiveHeaderReader {
  const raw = rawAsarHeader(entries, unpackedEntries, links)
  return () => raw
}

function asarIndex(
  entries: readonly string[],
  unpackedEntries: readonly string[] = entries,
): PackagedAsarIndex {
  return {
    files: new Set(entries.map(normalized)),
    unpackedFiles: new Set(unpackedEntries.map(normalized)),
  }
}

function completeArchiveEntries(): string[] {
  return [...new Set([
    ...REQUIRED_PACKAGED_RUNTIME_ENTRIES,
    ...DESKTOP_RUNTIME_ENTRIES,
    ...REQUIRED_UNPACKED_RUNTIME_ENTRIES,
    ...REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES,
    ...Object.values(REQUIRED_POSIX_FS_EXT_ENTRIES.darwin),
    ...Object.values(REQUIRED_POSIX_FS_EXT_ENTRIES.linux),
    ...REQUIRED_MACOS_UNIVERSAL_ENTRIES,
  ])]
}

function requiredPhysicalEntries(runtimeContext: PackagedRuntimeContext): string[] {
  const desktopAssets = runtimeContext.electronPlatformName === 'darwin'
    ? REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES
    : REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES
  if (runtimeContext.electronPlatformName === 'win32') {
    return [
      ...desktopAssets,
      ...REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES,
    ]
  }
  if (runtimeContext.electronPlatformName === 'darwin' && runtimeContext.arch === 4) {
    return [...desktopAssets, ...REQUIRED_MACOS_UNIVERSAL_ENTRIES]
  }
  if ((runtimeContext.electronPlatformName === 'darwin'
      || runtimeContext.electronPlatformName === 'linux')
    && (runtimeContext.arch === 1 || runtimeContext.arch === 3)) {
    const architecture = runtimeContext.arch === 1 ? 'x64' : 'arm64'
    return [
      ...desktopAssets,
      REQUIRED_POSIX_FS_EXT_ENTRIES[runtimeContext.electronPlatformName][architecture],
    ]
  }
  return [...desktopAssets]
}

function physicalFixture(
  runtimeContext: PackagedRuntimeContext,
  options: { missing?: string; extra?: readonly string[] } = {},
): { exists: FileProbe; files: UnpackedRuntimeFile[]; paths: string[] } {
  const unpackedRoot = resolvePackagedUnpackedRoot(runtimeContext)
  const paths = [...requiredPhysicalEntries(runtimeContext), ...(options.extra ?? [])]
    .filter(entry => entry !== options.missing)
  return {
    files: paths.map(path => ({ path, bytes: 1 })),
    exists: filename => paths.includes(relative(unpackedRoot, filename).replaceAll('\\', '/')),
    paths,
  }
}

describe('packaged desktop runtime verification', () => {
  it('finds a package root from its public entry when package.json is not exported', () => {
    const packageRoot = join('/workspace', 'node_modules', 'pnpm')
    const entry = join(packageRoot, 'bin', 'pnpm.cjs')
    const resolveEntry = (specifier: string): string => {
      if (specifier === 'pnpm') return entry
      const error = new Error('Package subpath ./package.json is not defined') as NodeJS.ErrnoException
      error.code = 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      throw error
    }
    const readManifest = (filename: string): string => {
      if (filename === join(packageRoot, 'package.json')) return '{"name":"pnpm"}'
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }

    expect(resolveRuntimePackageRoot('pnpm', resolveEntry, readManifest)).toBe(packageRoot)
  })

  it('tracks every generated DSH CLI chunk without pinning one release hash', () => {
    expect(REQUIRED_DSH_CLI_RUNTIME_ENTRIES).toContain('node_modules/@deepseek-ai/dsh/lib/bin.js')
    expect(REQUIRED_DSH_CLI_RUNTIME_ENTRIES).toEqual(expect.arrayContaining([
      expect.stringMatching(/^node_modules\/@deepseek-ai\/dsh\/lib\/plugin-[^/]+\.js$/u),
    ]))
    expect(REQUIRED_DSH_CLI_RUNTIME_ENTRIES).not.toContain('node_modules/@deepseek-ai/dsh/lib/plugin-9h8shc4d.js')
  })

  it('keeps stable root files explicit without hand-listing desktop lib output', () => {
    expect(REQUIRED_PACKAGED_RUNTIME_ENTRIES).toContain('package.json')
    expect(REQUIRED_PACKAGED_RUNTIME_ENTRIES).toContain('cordis.patch.yml')
    expect(REQUIRED_PACKAGED_RUNTIME_ENTRIES.some(entry => entry.startsWith('lib/'))).toBe(false)
    expect(DESKTOP_RUNTIME_ENTRIES).toContain('lib/main.js')
    expect(DESKTOP_RUNTIME_ENTRIES).toContain('lib/native-ui/setup-wizard.html')
  })

  it('keeps the shipped PTC preset present and integrity-protected in app.asar', () => {
    expect(REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES).toEqual([
      'node_modules/@deepseek-ai/dsh-agent-presets/presets/ptc/agent.cordis.yml',
      'node_modules/@deepseek-ai/dsh-agent-presets/presets/ptc/preset.yml',
    ])
    for (const entry of REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES) {
      expect(REQUIRED_PACKAGED_RUNTIME_ENTRIES).toContain(entry)
      expect(FORBIDDEN_UNPACKED_RUNTIME_ENTRIES).toContain(entry)
    }
  })

  it('recursively derives every non-map desktop runtime file from the completed build', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-list-'))
    mkdirSync(join(root, 'native-ui'))
    writeFileSync(join(root, 'main.js'), '')
    writeFileSync(join(root, 'main.js.map'), '')
    writeFileSync(join(root, 'main.d.ts'), '')
    writeFileSync(join(root, 'native-ui', 'setup.html'), '')
    writeFileSync(join(root, 'native-ui', 'payload.json'), '{}')
    try {
      expect(listDesktopRuntimeEntries(root)).toEqual([
        'lib/main.js',
        'lib/native-ui/payload.json',
        'lib/native-ui/setup.html',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires newly emitted desktop chunks from the active Electron Builder project', () => {
    const base = context('/build', 'win32')
    const runtimeContext: PackagedRuntimeContext = {
      ...base,
      packager: { ...base.packager, projectDir: '/project' },
    }
    const fixture = physicalFixture(runtimeContext)
    const listDesktop = vi.fn(() => ['lib/new-build-chunk.js'])

    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader(completeArchiveEntries(), fixture.paths),
      fixture.exists,
      () => fixture.files,
      listDesktop,
    )).toThrow('missing required ASAR entries: lib/new-build-chunk.js')
    expect(listDesktop).toHaveBeenCalledWith(join('/project', 'lib'))
  })

  it('runs only static verification and inventory reporting during afterPack', async () => {
    const runtimeContext = context('/build', 'win32')
    const calls: string[] = []
    const summary: UnpackedRuntimeSummary = { files: 4, bytes: 1024, groups: [] }

    await afterPack(
      runtimeContext,
      () => {
        calls.push('static')
        return summary
      },
      received => {
        expect(received).toBe(summary)
        calls.push('report')
      },
    )

    expect(calls).toEqual(['static', 'report'])
  })

  it('tracks ripgrep and the ConPTY native surface required on Windows', () => {
    expect(REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES).toEqual([
      'node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
      'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
      'node_modules/node-pty/prebuilds/win32-x64/conpty_console_list.node',
      'node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
      'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
    ])
  })

  it.each([
    [
      'darwin',
      join('/build', 'DSH Desktop.app', 'Contents', 'Resources', 'app.asar'),
      join('/build', 'DSH Desktop.app', 'Contents', 'MacOS', 'DSH Desktop'),
    ],
    [
      'win32',
      join('/build', 'resources', 'app.asar'),
      join('/build', 'DSH Desktop.exe'),
    ],
  ])('inspects the %s selective ASAR layout', (platform, expectedPath, expectedExecutable) => {
    const runtimeContext = context('/build', platform)
    const fixture = physicalFixture(runtimeContext)
    const readHeader = vi.fn<ArchiveHeaderReader>(
      headerReader(completeArchiveEntries(), fixture.paths),
    )
    const listUnpacked = vi.fn(() => fixture.files)

    verifyPackagedRuntime(runtimeContext, readHeader, fixture.exists, listUnpacked)

    expect(resolvePackagedAsarPath(runtimeContext)).toBe(expectedPath)
    expect(resolvePackagedExecutablePath(runtimeContext)).toBe(expectedExecutable)
    expect(readHeader).toHaveBeenCalledWith(expectedPath)
    expect(listUnpacked).toHaveBeenCalledWith(`${expectedPath}.unpacked`)
  })

  it('uses LinuxPackager executableName instead of appInfo.productFilename', () => {
    const runtimeContext = context('/build', 'linux', 1, 'dsh-plugin-desktop')
    const expectedPath = join('/build', 'resources', 'app.asar')
    const fixture = physicalFixture(runtimeContext)

    verifyPackagedRuntime(
      runtimeContext,
      headerReader(completeArchiveEntries(), fixture.paths),
      fixture.exists,
      () => fixture.files,
    )

    expect(resolvePackagedAsarPath(runtimeContext)).toBe(expectedPath)
    expect(resolvePackagedExecutablePath(runtimeContext))
      .toBe(join('/build', 'dsh-plugin-desktop'))
  })

  it('rejects an unsupported platform instead of guessing a package layout', () => {
    expect(() => resolvePackagedAsarPath(context('/build', 'mas')))
      .toThrow('unsupported Electron afterPack platform "mas"')
    expect(() => resolvePackagedExecutablePath(context('/build', 'mas')))
      .toThrow('unsupported Electron afterPack platform "mas"')
  })

  it('requires both CPU variants from a universal macOS runtime', () => {
    const runtimeContext = context('/build', 'darwin', 4)
    const missing = 'node_modules/@vscode/ripgrep-darwin-x64/bin/rg'
    const incomplete = physicalFixture(runtimeContext, { missing })

    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader(completeArchiveEntries(), requiredPhysicalEntries(runtimeContext)),
      incomplete.exists,
      () => incomplete.files,
    )).toThrow(`missing required physical entries: ${missing}`)

    const complete = physicalFixture(runtimeContext)
    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader(completeArchiveEntries(), complete.paths),
      complete.exists,
      () => complete.files,
    )).not.toThrow()
  })

  it('rejects unpacked files absent from the ASAR header', () => {
    const unpackedRoot = join('/build', 'resources', 'app.asar.unpacked')
    const unexpected = 'node_modules/unexpected/index.js'

    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex(['build/app-icon.png'], ['build/app-icon.png']),
      unpackedRoot,
      [
        { path: 'build/app-icon.png', bytes: 10 },
        { path: unexpected, bytes: 20 },
      ],
    )).toThrow(`physical entries absent from the ASAR header: ${unexpected}`)
  })

  it('rejects a physical file whose ASAR header leaf is not marked unpacked', () => {
    const path = 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node'
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex([path], []),
      '/build/resources/app.asar.unpacked',
      [{ path, bytes: 10 }],
    )).toThrow(`physical entries not marked unpacked in the ASAR header: ${path}`)
  })

  it('rejects an ASAR unpacked leaf missing from the physical tree', () => {
    const path = 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node'
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex([path]),
      '/build/resources/app.asar.unpacked',
      [],
    )).toThrow(`ASAR header entries missing from the physical tree: ${path}`)
  })

  it('rejects duplicate normalized physical paths', () => {
    const path = 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node'
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex([path]),
      '/build/resources/app.asar.unpacked',
      [
        { path, bytes: 10 },
        { path: `/${path.replaceAll('/', '\\')}`, bytes: 10 },
      ],
    )).toThrow(`duplicate normalized physical entries: ${path}`)
  })

  it('rejects duplicate normalized paths in a malformed ASAR header', () => {
    const leaf = { size: 1, offset: '0' }
    expect(() => indexPackagedAsarHeader({
      files: {
        'node_modules/node-pty/binding.node': leaf,
        node_modules: {
          files: { 'node-pty': { files: { 'binding.node': leaf } } },
        },
      },
    })).toThrow('duplicate normalized ASAR header entry node_modules/node-pty/binding.node')
  })

  it('propagates unpacked directory flags to file and symlink leaves', () => {
    const binding = 'node_modules/node-pty/binding.node'
    const link = 'node_modules/node-pty/current.node'
    const archive = indexPackagedAsarHeader({
      files: {
        node_modules: {
          files: {
            'node-pty': {
              unpacked: true,
              files: {
                'binding.node': { size: 10 },
                'current.node': { link: 'binding.node' },
              },
            },
          },
        },
      },
    })

    expect(archive.unpackedFiles).toEqual(new Set([binding, link]))
    expect(() => verifySelectiveUnpackedRuntime(
      archive,
      '/build/resources/app.asar.unpacked',
      [{ path: binding, bytes: 10 }, { path: link, bytes: 12 }],
    )).not.toThrow()
  })

  it.each([
    'lib/main.js',
    'lib/native-ui/setup-wizard.html',
    'lib/runtime/config.json',
    'lib/worker.mjs',
    'lib/legacy.cjs',
  ])('rejects desktop-owned code/data %s from the physical tree', (path) => {
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex([path]),
      '/build/resources/app.asar.unpacked',
      [{ path, bytes: 10 }],
    )).toThrow(`desktop code/data that must stay in app.asar: ${path}`)
  })

  it.each(FORBIDDEN_UNPACKED_RUNTIME_ENTRIES)(
    'rejects mirrored ordinary module %s from the physical tree',
    (forbidden) => {
      const unpackedRoot = join('/build', 'resources', 'app.asar.unpacked')
      expect(() => verifySelectiveUnpackedRuntime(
        asarIndex([forbidden]),
        unpackedRoot,
        [{ path: forbidden, bytes: 10 }],
      )).toThrow(`mirrors ordinary archived modules: ${forbidden}`)
    },
  )

  it('unpacks AA Python sources while keeping its JavaScript runtime archived', () => {
    const source = 'node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/connector/cli.py'
    expect(() => verifySelectiveUnpackedRuntime(asarIndex([source]), '/build/resources/app.asar.unpacked',
      [{ path: source, bytes: 100 }])).not.toThrow()
    const host = 'node_modules/@agents-anywhere/dsh-bridge-next/lib/index.js'
    expect(() => verifySelectiveUnpackedRuntime(asarIndex([host]), '/build/resources/app.asar.unpacked',
      [{ path: host, bytes: 100 }])).toThrow('non-allowlisted package roots')
  })

  it('rejects a new smart-unpacked package until its native root is reviewed', () => {
    const path = 'node_modules/unexpected-native/binding.node'
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex([path]),
      '/build/resources/app.asar.unpacked',
      [{ path, bytes: 10 }],
    )).toThrow('non-allowlisted package roots: node_modules/unexpected-native')
  })

  it('rejects an unreviewed desktop-owned physical asset', () => {
    const path = 'build/accidental-large-documentation.pdf'
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex([path]),
      '/build/resources/app.asar.unpacked',
      [{ path, bytes: 10 }],
    )).toThrow(`non-allowlisted desktop entries: ${path}`)
  })

  it('requires only the platform-specific nativeImage asset set', () => {
    const mac = context('/build', 'darwin', 3)
    const windows = context('/build', 'win32', 1)
    expect(requiredPhysicalEntries(mac)).toEqual([
      ...REQUIRED_MACOS_UNPACKED_RUNTIME_ENTRIES,
      REQUIRED_POSIX_FS_EXT_ENTRIES.darwin.arm64,
    ])
    expect(requiredPhysicalEntries(windows)).toEqual([
      ...REQUIRED_NON_MACOS_UNPACKED_RUNTIME_ENTRIES,
      ...REQUIRED_WINDOWS_X64_NODE_PTY_ENTRIES,
    ])
    expect(requiredPhysicalEntries(mac)).not.toContain('build/app-icon.png')
    expect(requiredPhysicalEntries(windows)).not.toContain('build/app-icon-mac.png')
  })

  it('rejects a Windows architecture that is not configured for release', () => {
    const runtimeContext = context('/build', 'win32', 3)
    const fixture = physicalFixture(runtimeContext)
    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader(completeArchiveEntries(), fixture.paths),
      fixture.exists,
      () => fixture.files,
    )).toThrow('unsupported Windows package architecture 3; only x64 is configured')
  })

  it('summarizes physical file count and bytes by native package root', () => {
    const files: UnpackedRuntimeFile[] = [
      { path: 'build/app-icon.png', bytes: 10 },
      { path: 'node_modules/node-pty/index.js', bytes: 20 },
      { path: 'node_modules/node-pty/prebuilds/win32-x64/conpty.node', bytes: 30 },
      { path: 'node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe', bytes: 40 },
    ]
    const summary = summarizeUnpackedRuntime(files)
    expect(summary).toEqual({
      files: 4,
      bytes: 100,
      groups: [
        { root: 'node_modules/node-pty', files: 2, bytes: 50 },
        { root: 'node_modules/@vscode/ripgrep-win32-x64', files: 1, bytes: 40 },
        { root: 'desktop/build', files: 1, bytes: 10 },
      ],
    })
    expect(formatUnpackedRuntimeSummary(summary)).toBe(
      '4 files/100 bytes; node_modules/node-pty=2 files/50 bytes, '
      + 'node_modules/@vscode/ripgrep-win32-x64=1 files/40 bytes, desktop/build=1 files/10 bytes',
    )
  })

  it('keeps the reviewed smart-unpack surface explicit', () => {
    expect(ALLOWED_SMART_UNPACK_PACKAGE_ROOTS).toContain('node_modules/fs-ext')
    expect(ALLOWED_SMART_UNPACK_PACKAGE_ROOTS).toContain('node_modules/node-pty')
    expect(ALLOWED_SMART_UNPACK_PACKAGE_ROOTS).toContain('node_modules/pnpm')
    expect(ALLOWED_SMART_UNPACK_PACKAGE_PREFIXES).toContain('node_modules/@vscode/ripgrep-')
    expect(ALLOWED_SMART_UNPACK_PACKAGE_PREFIXES).toContain('node_modules/@img/sharp-')
  })

  it('accepts pnpm as an indivisible smart-unpacked package with native helpers', () => {
    const files = [
      { path: 'node_modules/pnpm/bin/pnpm.mjs', bytes: 10 },
      { path: 'node_modules/pnpm/dist/vendor/fastlist-0.3.0-x64.exe', bytes: 20 },
    ]
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex(files.map(file => file.path)),
      '/build/resources/app.asar.unpacked',
      files,
    )).not.toThrow()
  })

  it('caps pnpm smart-unpack independently of the full physical payload budget', () => {
    const expectedBudget = `${String(MAX_PNPM_SMART_UNPACK_FILES)} files/`
      + `${String(MAX_PNPM_SMART_UNPACK_BYTES)} bytes`
    const tooManyFiles = Array.from(
      { length: MAX_PNPM_SMART_UNPACK_FILES + 1 },
      (_, index) => ({ path: `node_modules/pnpm/native-${String(index)}.node`, bytes: 1 }),
    )
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex(tooManyFiles.map(file => file.path)),
      '/build/resources/app.asar.unpacked',
      tooManyFiles,
    )).toThrow(`pnpm smart-unpack budget ${expectedBudget}`)

    const path = 'node_modules/pnpm/bin/pnpm.mjs'
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex([path]),
      '/build/resources/app.asar.unpacked',
      [{ path, bytes: MAX_PNPM_SMART_UNPACK_BYTES + 1 }],
    )).toThrow(`pnpm smart-unpack budget ${expectedBudget}`)
  })

  it('caps Electron Builder smartUnpack output instead of accepting a full mirror', () => {
    const files = Array.from(
      { length: MAX_UNPACKED_RUNTIME_FILES + 1 },
      (_, index) => ({ path: `node_modules/node-pty/native-${String(index)}.node`, bytes: 1 }),
    )
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex(files.map(file => file.path)),
      '/build/resources/app.asar.unpacked',
      files,
    )).toThrow(`exceeds selective ASAR file budget ${String(MAX_UNPACKED_RUNTIME_FILES)}`)
  })

  it('caps Electron Builder smartUnpack bytes as well as inode count', () => {
    const path = 'node_modules/node-pty/prebuilds/win32-x64/conpty.node'
    expect(() => verifySelectiveUnpackedRuntime(
      asarIndex([path]),
      '/build/resources/app.asar.unpacked',
      [{ path, bytes: MAX_UNPACKED_RUNTIME_BYTES + 1 }],
    )).toThrow(`exceeds selective ASAR byte budget ${String(MAX_UNPACKED_RUNTIME_BYTES)}`)
  })

  it('rejects a host-architecture node-pty build from a universal app', () => {
    const runtimeContext = context('/build', 'darwin', 4)
    const forbidden = FORBIDDEN_MACOS_UNIVERSAL_ENTRIES[0]
    const fixture = physicalFixture(runtimeContext, { extra: [forbidden] })

    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader([...completeArchiveEntries(), forbidden], fixture.paths),
      fixture.exists,
      () => fixture.files,
    )).toThrow(`contains host-architecture build output: ${forbidden}`)
  })

  it.each([
    'package.json',
    'cordis.patch.yml',
    'lib/client.js',
    'lib/native-ui/setup-wizard.html',
    'lib/desktop-runtime-environment.js',
    'lib/profile-service.js',
    'lib/diagnostics.js',
    'lib/diagnostic-export-worker.js',
    'lib/packaged-runtime-smoke.js',
    'lib/pnpm.js',
    'lib/update-download.js',
    ...REQUIRED_AGENT_PRESET_RUNTIME_ENTRIES,
    'node_modules/open/index.js',
  ])('fails loud when required ASAR entry %s is absent', (missing) => {
    const runtimeContext = context('/build', 'win32')
    const fixture = physicalFixture(runtimeContext)
    const entries = completeArchiveEntries().filter(entry => entry !== missing)

    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader(entries, fixture.paths),
      fixture.exists,
      () => fixture.files,
    ))
      .toThrow(`missing required ASAR entries: ${missing}`)
  })

  it.each([
    'build/app-icon.png',
    'build/tray-icon-blue@2x.png',
    'node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
    'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
  ])('fails loud when selective physical entry %s is absent', (missing) => {
    const runtimeContext = context('/build', 'win32')
    const fixture = physicalFixture(runtimeContext, { missing })

    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader(completeArchiveEntries(), requiredPhysicalEntries(runtimeContext)),
      fixture.exists,
      () => fixture.files,
    )).toThrow(`missing required physical entries: ${missing}`)
  })

  it('requires the macOS Retina template asset', () => {
    const runtimeContext = context('/build', 'darwin', 3)
    const missing = 'build/tray-iconTemplate@2x.png'
    const fixture = physicalFixture(runtimeContext, { missing })
    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader(completeArchiveEntries(), requiredPhysicalEntries(runtimeContext)),
      fixture.exists,
      () => fixture.files,
    )).toThrow(`missing required physical entries: ${missing}`)
  })

  it.each([
    ['darwin', 1, REQUIRED_POSIX_FS_EXT_ENTRIES.darwin.x64],
    ['darwin', 3, REQUIRED_POSIX_FS_EXT_ENTRIES.darwin.arm64],
    ['linux', 1, REQUIRED_POSIX_FS_EXT_ENTRIES.linux.x64],
    ['linux', 3, REQUIRED_POSIX_FS_EXT_ENTRIES.linux.arm64],
  ] as const)('requires the %s architecture %s fs-ext binding', (platform, arch, missing) => {
    const runtimeContext = context('/build', platform, arch, platform === 'linux'
      ? 'dsh-plugin-desktop'
      : undefined)
    const fixture = physicalFixture(runtimeContext, { missing })
    expect(() => verifyPackagedRuntime(
      runtimeContext,
      headerReader(completeArchiveEntries(), requiredPhysicalEntries(runtimeContext)),
      fixture.exists,
      () => fixture.files,
    )).toThrow(`missing required physical entries: ${missing}`)
  })

  it('runs every logical ASAR entry through the packaged Electron executable', () => {
    const runtimeContext = context(
      '/build',
      process.platform,
      process.platform === 'darwin' ? 4 : undefined,
      process.platform === 'linux' ? 'dsh-plugin-desktop' : undefined,
    )
    const dshVersion = JSON.parse(readFileSync(
      new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url),
      'utf8',
    )).version as string
    const pnpmVersion = JSON.parse(readFileSync(
      new URL('../node_modules/pnpm/package.json', import.meta.url),
      'utf8',
    )).version as string
    const run = vi.fn<PackagedElectronRunner>((_executable, args) => {
      const normalizedArgs = args.map(arg => arg.replaceAll('\\', '/'))
      return {
        status: 0,
        stdout: normalizedArgs.some(arg => arg.endsWith('/@deepseek-ai/dsh/lib/bin.js'))
          ? dshVersion
          : normalizedArgs.some(arg => arg.endsWith('/pnpm/bin/pnpm.mjs'))
            ? pnpmVersion
            : args.includes('--dump-config')
              ? '# == cordis.yml\n- name: @deepseek-ai/dsh-base\n'
              : normalizedArgs.some(arg => arg.endsWith('/lib/desktop-cli.js'))
                ? 'Usage: dsh --profile headless [options]'
                : 'DSH_PACKAGED_RUNTIME_OK',
        stderr: '',
      }
    })

    smokePackagedElectronRuntime(runtimeContext, run)

    expect(run).toHaveBeenCalledTimes(5)
    for (const [executable, args, environment] of run.mock.calls) {
      expect(executable).toBe(resolvePackagedExecutablePath(runtimeContext))
      expect(args).toContain('--expose-internals')
      expect(args.some(arg => arg.includes('app.asar'))).toBe(true)
      expect(environment.ELECTRON_RUN_AS_NODE).toBe('1')
      expect(environment.DSH_HOME).toEqual(expect.any(String))
    }
  })

  it('does not try to execute a cross-platform package on the build host', () => {
    const target = process.platform === 'win32' ? 'darwin' : 'win32'
    const run = vi.fn<PackagedElectronRunner>()

    smokePackagedElectronRuntime(context('/build', target), run)

    expect(run).not.toHaveBeenCalled()
  })

  it('does not try to execute a same-platform package for another CPU', () => {
    const targetArch = process.arch === 'arm64' ? 1 : 3
    const run = vi.fn<PackagedElectronRunner>()

    smokePackagedElectronRuntime(context('/build', process.platform, targetArch), run)

    expect(run).not.toHaveBeenCalled()
  })

  it('reports the terminating signal when a packaged Electron smoke is killed', () => {
    const run: PackagedElectronRunner = () => ({
      signal: 'SIGTERM',
      status: null,
      stdout: '',
      stderr: '',
    })

    expect(() => smokePackagedElectronRuntime(context('/build', process.platform), run))
      .toThrow('status null; signal=SIGTERM')
  })
})
