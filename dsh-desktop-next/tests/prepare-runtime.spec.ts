import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { primaryRuntimePayloadDigest, readPrimaryRuntimeLock } from '../scripts/primary-runtime.ts'
import { expectedNextVersion, nextRuntimeBuildPaths, nextRuntimeTargets, officeSkillsDirectory, primaryRuntimeDirectory, reusableNextRuntimeTree, verifyNextRuntimeTree, type NextRuntimeArch } from '../scripts/prepare-runtime.ts'

const roots: string[] = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

const machO = { arm64: Buffer.from('cffaedfe0c00000100000000', 'hex'), x64: Buffer.from('cffaedfe0700000100000000', 'hex') }

interface PayloadOptions {
  readonly manifest?: Record<string, unknown>
  readonly cpu?: NextRuntimeArch
  readonly omit?: readonly string[]
}

/** Write one CPU payload with the Darwin layout the published tool resolves. */
function writePayload(runtimeRoot: string, arch: NextRuntimeArch, options: PayloadOptions = {}): string {
  const directory = primaryRuntimeDirectory(runtimeRoot, arch)
  const files: Record<string, Buffer | string> = {
    'runtime.json': JSON.stringify({ desktopVersion: '2.0.0-next', platform: 'darwin', arch, payloadDigest: 'a'.repeat(64), python: '3.12.14', node: '24.21.0', pnpm: '11.28.5',
      pythonPackages: { numpy: '2.3.5' }, ...options.manifest }),
    'dependencies/python/bin/python3': machO[options.cpu ?? arch],
    'dependencies/python/lib/python3.12/site-packages/numpy/__init__.py': '',
    'dependencies/node/bin/node': machO[options.cpu ?? arch],
    'dependencies/pnpm/bin/pnpm.mjs': 'export {}\n',
  }
  for (const [path, content] of Object.entries(files)) {
    if (options.omit?.includes(path)) continue
    mkdirSync(join(directory, path, '..'), { recursive: true })
    writeFileSync(join(directory, path), content)
  }
  const skills = officeSkillsDirectory(runtimeRoot, arch)
  for (const path of ['office/SKILL.md', 'office-docx/SKILL.md', 'office-pptx/SKILL.md', 'office-xlsx/SKILL.md', 'office-render/SKILL.md', 'office-recalculate/SKILL.md', 'office-export-pdf/SKILL.md']) {
    if (options.omit?.includes(`office-skills/${path}`)) continue
    mkdirSync(join(skills, path, '..'), { recursive: true })
    writeFileSync(join(skills, path), '')
  }
  return directory
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'next-runtime-tree-'))
  roots.push(root)
  return root
}

it('ships both Darwin CPUs by default or the requested smoke CPU, Windows x64, the Linux host CPU and nothing elsewhere', () => {
  expect(nextRuntimeTargets('darwin', 'arm64', {})).toEqual([{ target: 'mac-arm64', arch: 'arm64' }, { target: 'mac-x64', arch: 'x64' }])
  expect(nextRuntimeTargets('darwin', 'arm64', { DSH_MAC_SMOKE_ARCH: 'arm64' })).toEqual([{ target: 'mac-arm64', arch: 'arm64' }])
  expect(nextRuntimeTargets('darwin', 'arm64', { DSH_MAC_SMOKE_ARCH: 'x64' })).toEqual([{ target: 'mac-x64', arch: 'x64' }])
  expect(nextRuntimeTargets('win32')).toEqual([{ target: 'win-x64', arch: 'x64' }])
  expect(nextRuntimeTargets('linux', 'x64')).toEqual([{ target: 'linux-x64', arch: 'x64' }])
  expect(nextRuntimeTargets('linux', 'arm64')).toEqual([{ target: 'linux-arm64', arch: 'arm64' }])
  expect(nextRuntimeTargets('linux', 'ia32')).toEqual([])
  expect(nextRuntimeTargets('freebsd')).toEqual([])
})

it('lays out each CPU payload beside its Office resources under the build directory', () => {
  expect(nextRuntimeBuildPaths('/next')).toEqual({ runtime: join('/next', '.desktop-build', 'runtime'), downloads: join('/next', '.desktop-build', 'downloads') })
  expect(primaryRuntimeDirectory('/resources/runtime', 'x64')).toBe(join('/resources/runtime', 'x64', 'primary-runtime'))
  expect(officeSkillsDirectory('/resources/runtime', 'x64')).toBe(join('/resources/runtime', 'x64', 'office-skills'))
})

it('reads the drill version over the source manifest', () => {
  const root = fixture()
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.0.17-next' }))
  expect(expectedNextVersion(root, {})).toBe('2.0.17-next')
  expect(expectedNextVersion(root, { DSH_NEXT_BUILD_VERSION: '2.0.18-next.1' })).toBe('2.0.18-next.1')
})

it('accepts a complete two-CPU tree on Darwin and a single-CPU tree on Linux', () => {
  const root = fixture()
  const arm64 = writePayload(root, 'arm64')
  const x64 = writePayload(root, 'x64')
  expect(verifyNextRuntimeTree(root, 'darwin', '2.0.0-next')).toEqual([
    { arch: 'arm64', directory: arm64, manifest: expect.objectContaining({ platform: 'darwin', arch: 'arm64', node: '24.21.0', pnpm: '11.28.5' }) },
    { arch: 'x64', directory: x64, manifest: expect.objectContaining({ platform: 'darwin', arch: 'x64' }) },
  ])
  const linuxRoot = fixture()
  const linuxX64 = writePayload(linuxRoot, 'x64', { manifest: { platform: 'linux' } })
  expect(verifyNextRuntimeTree(linuxRoot, 'linux', '2.0.0-next', 'x64')).toEqual([
    { arch: 'x64', directory: linuxX64, manifest: expect.objectContaining({ platform: 'linux', arch: 'x64', node: '24.21.0', pnpm: '11.28.5' }) },
  ])
  expect(verifyNextRuntimeTree(root, 'freebsd', '2.0.0-next')).toEqual([])
})

it('rejects a missing CPU, another version, a payload without Node, or a foreign CPU slice', () => {
  const missing = fixture()
  writePayload(missing, 'arm64')
  expect(() => verifyNextRuntimeTree(missing, 'darwin', '2.0.0-next')).toThrow('missing x64 payload manifest')
  const version = fixture()
  writePayload(version, 'arm64')
  writePayload(version, 'x64', { manifest: { desktopVersion: '2.0.1-next' } })
  expect(() => verifyNextRuntimeTree(version, 'darwin', '2.0.0-next')).toThrow('declares version 2.0.1-next, expected 2.0.0-next')
  const swapped = fixture()
  writePayload(swapped, 'arm64', { manifest: { arch: 'x64' } })
  expect(() => verifyNextRuntimeTree(swapped, 'darwin', '2.0.0-next')).toThrow('declares darwin x64, expected darwin arm64')
  const noNode = fixture()
  writePayload(noNode, 'arm64', { manifest: { node: undefined, pnpm: undefined } })
  expect(() => verifyNextRuntimeTree(noNode, 'darwin', '2.0.0-next')).toThrow('must bundle Node and pnpm')
  const slice = fixture()
  writePayload(slice, 'arm64')
  writePayload(slice, 'x64', { cpu: 'arm64' })
  expect(() => verifyNextRuntimeTree(slice, 'darwin', '2.0.0-next')).toThrow('expected a thin x64 executable')
})

it('rejects missing entry points and Office resources', () => {
  const python = fixture()
  writePayload(python, 'arm64', { omit: ['dependencies/python/bin/python3'] })
  writePayload(python, 'x64')
  expect(() => verifyNextRuntimeTree(python, 'darwin', '2.0.0-next')).toThrow('missing arm64 Python interpreter')
  const router = fixture()
  writePayload(router, 'arm64')
  writePayload(router, 'x64', { omit: ['office-skills/office/SKILL.md'] })
  expect(() => verifyNextRuntimeTree(router, 'darwin', '2.0.0-next')).toThrow('missing x64 office skill')
  const skill = fixture()
  writePayload(skill, 'arm64', { omit: ['office-skills/office-xlsx/SKILL.md'] })
  expect(() => verifyNextRuntimeTree(skill, 'darwin', '2.0.0-next')).toThrow('missing arm64 office-xlsx skill')
})

it('reuses a runtime tree only when every target matches the current lock digest and version', () => {
  const lock = readPrimaryRuntimeLock()
  const pnpmVersion = (JSON.parse(readFileSync(createRequire(import.meta.url).resolve('pnpm'), 'utf8')) as { version: string }).version
  const root = fixture()
  writePayload(root, 'arm64', { manifest: { payloadDigest: primaryRuntimePayloadDigest('mac-arm64', lock, pnpmVersion) } })
  writePayload(root, 'x64', { manifest: { payloadDigest: primaryRuntimePayloadDigest('mac-x64', lock, pnpmVersion) } })
  expect(reusableNextRuntimeTree(root, 'darwin', '2.0.0-next')).toHaveLength(2)
  expect(reusableNextRuntimeTree(root, 'darwin', '2.0.1-next')).toEqual([])
  mkdirSync(join(root, 'stale'))
  expect(reusableNextRuntimeTree(root, 'darwin', '2.0.0-next')).toEqual([])
  rmSync(join(root, 'stale'), { recursive: true, force: true })
  writePayload(root, 'x64', { manifest: { payloadDigest: '0'.repeat(64) } })
  expect(reusableNextRuntimeTree(root, 'darwin', '2.0.0-next')).toEqual([])
})
