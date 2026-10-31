/** Exercise the installed builder so dependency upgrades cannot silently drop Desktop packaging policy. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
require('app-builder-lib')
const builderRoot = dirname(require.resolve('app-builder-lib/package.json'))
const archive = require('app-builder-lib/out/targets/archive.js') as {
  archive: (format: string, file: string, source: string, options: Record<string, unknown>) => Promise<string>
  compute7zCompressArgs: (format: string, options: Record<string, unknown>) => string[]
}
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js') as {
  NsisTarget: { prototype: { buildAppPackage: (source: string, arch: number) => Promise<{ path: string }> } }
}
const { Arch } = require('builder-util') as { Arch: { x64: number } }
const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it.each(['normal', 'store'].flatMap(compression => [true, false].map(enabled => ({ compression, enabled }))))('keeps fast NSIS options scoped to Next ($compression, enabled=$enabled)', async ({ compression, enabled }) => {
  vi.stubEnv('ELECTRON_BUILDER_COMPRESSION_LEVEL', undefined)
  vi.stubEnv('DSH_NEXT_WINDOWS_FAST_COMPRESSION', enabled ? '1' : undefined)
  const directory = mkdtempSync(join(tmpdir(), 'next-nsis-options-'))
  directories.push(directory)
  let effective: Record<string, unknown> | undefined
  vi.spyOn(archive, 'archive').mockImplementation(async (format, file, source, options) => {
    expect(format).toBe('7z')
    expect(source).toBe(join(directory, 'win-unpacked'))
    effective = options
    writeFileSync(file, 'archive fixture')
    return file
  })
  const options = { differentialPackage: false, useZip: false }
  const context = {
    options, isBuildDifferentialAware: false, outDir: directory,
    packager: { compression, appInfo: { sanitizedName: 'DSH-NEXT', version: '2.0.20-next' } },
    getPreCompressedFileExtensions: () => null,
  }
  const packaged = await NsisTarget.prototype.buildAppPackage.call(context, join(directory, 'win-unpacked'), Arch.x64)
  expect(packaged.path).toBe(join(directory, 'DSH-NEXT-2.0.20-next-x64.nsis.7z'))
  expect(options.differentialPackage).toBe(false)
  expect(effective).toMatchObject({ withoutDir: true, compression, installTimeDecodable: true })
  const args = archive.compute7zCompressArgs('7z', effective!)
  expect(args).toContain(compression === 'store' ? '-mx=0' : '-mx=9')
  if (enabled) {
    expect(effective).toMatchObject({ dictSize: 1, solid: false })
    expect(args).toEqual(expect.arrayContaining(['-md=1m', '-ms=off']))
  } else {
    expect(effective).not.toHaveProperty('dictSize')
    expect(effective).not.toHaveProperty('solid')
    expect(args).not.toContain('-md=1m')
    expect(args).not.toContain('-ms=off')
  }
  if (compression === 'normal') expect(args).toContain('-mf=BCJ')
})

it('retains long paths, scoped process detection, direct extraction and macOS keychain fixes after rollback', () => {
  expect(require('app-builder-lib/package.json').version).toBe('26.15.7')
  const template = (path: string): string => readFileSync(join(builderRoot, 'templates/nsis', path), 'utf8')
  for (const file of ['installer.nsi', 'portable.nsi']) expect(template(file)).toMatch(/^ManifestLongPathAware true\r?$/mu)
  const processes = template('include/allowOnlyOneInstallerInstance.nsh')
  expect(processes).toContain("[System.IO.Path]::GetFileName($$_.Path) -ieq '${_FILE}'")
  expect(processes).not.toContain("$$_.Path.StartsWith('$INSTDIR'")
  const extraction = template('include/extractAppPackage.nsh').split('!macro extractUsing7za FILE')[1]!.split('!macroend')[0]!
  expect(extraction).toContain('SetOutPath "$INSTDIR"')
  expect(extraction).toContain('Nsis7z::Extract "${FILE}"')
  expect(extraction).not.toContain('CopyFiles')
  expect(template('include/installUtil.nsh')).toContain('continuing with non-atomic in-place replacement')
  const signing = readFileSync(join(builderRoot, 'out/codeSign/macCodeSign.js'), 'utf8')
  expect(signing).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
  expect(signing).toContain('"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword')
})
