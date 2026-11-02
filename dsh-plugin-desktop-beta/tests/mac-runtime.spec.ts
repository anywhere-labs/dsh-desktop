import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { assertMacPackagesRunnable, DEFAULT_MAC_RELEASE_ARCHS, macDmgArch, macPackageCpus, macReleaseArchs, nextMacNativeEntries, PACKAGED_RUNTIME_DIR, stagePackagedRuntime } from '../scripts/mac-runtime.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('carries one CPU per single-CPU package and both in the universal one', () => {
  expect(macPackageCpus('arm64')).toEqual(['arm64'])
  expect(macPackageCpus('x64')).toEqual(['x64'])
  expect(macPackageCpus('universal')).toEqual(['arm64', 'x64'])
})

it('builds a DMG per CPU and the universal one older installations update to, unless a release selects others', () => {
  expect(macReleaseArchs({})).toEqual(['arm64', 'x64', 'universal'])
  expect(macReleaseArchs({ DSH_MAC_RELEASE_ARCHS: ' ' })).toBe(DEFAULT_MAC_RELEASE_ARCHS)
  expect(macReleaseArchs({ DSH_MAC_RELEASE_ARCHS: 'arm64' })).toEqual(['arm64'])
  expect(macReleaseArchs({ DSH_MAC_RELEASE_ARCHS: 'universal, x64' })).toEqual(['universal', 'x64'])
  for (const value of ['arm64,arm64', 'amd64', 'arm64,,x64', 'mac-arm64']) {
    expect(() => macReleaseArchs({ DSH_MAC_RELEASE_ARCHS: value }), value).toThrow('DSH_MAC_RELEASE_ARCHS must list arm64, x64 or universal')
  }
})

it('reads the package a DMG holds from the architecture electron-builder names it after', () => {
  expect(macDmgArch('/dist/DSH-Desktop-Beta-2.0.22-beta.1-arm64.dmg')).toBe('arm64')
  expect(macDmgArch('DSH-Desktop-Beta-2.0.22-beta.1-x64.dmg')).toBe('x64')
  expect(macDmgArch('DSH-Desktop-Beta-2.0.22-beta.1-universal.dmg')).toBe('universal')
  expect(macDmgArch('DSH-Desktop-Beta-2.0.22-beta.1.dmg')).toBeUndefined()
  expect(macDmgArch('DSH-Desktop-Beta-2.0.22-beta.1-arm64.dmg.blockmap')).toBeUndefined()
})

it('lists the native files of the CPUs a package carries', () => {
  const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
  const arm64 = nextMacNativeEntries(desktopRoot, ['arm64'])
  const x64 = nextMacNativeEntries(desktopRoot, ['x64'])
  expect(arm64.map(entry => entry.path)).toContain('node_modules/@dataiku/uv-darwin-arm64/bin/uv')
  expect(arm64.every(entry => entry.arch === 'arm64')).toBe(true)
  expect(x64.map(entry => entry.path)).toContain('node_modules/node-pty/prebuilds/darwin-x64/spawn-helper')
  expect(x64.every(entry => entry.arch === 'x86_64')).toBe(true)
  const universal = nextMacNativeEntries(desktopRoot)
  expect(universal.filter(entry => entry.arch === 'arm64')).toEqual(arm64)
  expect(universal.filter(entry => entry.arch === 'x86_64')).toEqual(x64)
})

it('stages the payloads of the package CPUs from the prepared tree, keeping links and modes as they are', () => {
  const desktopRoot = mkdtempSync(join(tmpdir(), 'desktop-package-runtime-'))
  roots.push(desktopRoot)
  const runtime = join(desktopRoot, '.desktop-build', 'runtime')
  for (const cpu of ['arm64', 'x64']) {
    const bin = join(runtime, cpu, 'primary-runtime', 'dependencies', 'python', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'python3.12'), cpu)
    chmodSync(join(bin, 'python3.12'), 0o755)
    symlinkSync('python3.12', join(bin, 'python3'))
  }
  const staged = stagePackagedRuntime(desktopRoot, runtime, ['arm64'])
  expect(staged).toBe(join(desktopRoot, ...PACKAGED_RUNTIME_DIR.split('/')))
  expect(readdirSync(staged)).toEqual(['arm64'])
  const bin = join(staged, 'arm64', 'primary-runtime', 'dependencies', 'python', 'bin')
  expect(lstatSync(join(bin, 'python3')).isSymbolicLink()).toBe(true)
  expect(readlinkSync(join(bin, 'python3'))).toBe('python3.12')
  expect(statSync(join(bin, 'python3.12')).mode & 0o777).toBe(0o755)
  // The next package replaces the staging of the previous one; the prepared tree is never changed.
  expect(readdirSync(stagePackagedRuntime(desktopRoot, runtime, ['x64']))).toEqual(['x64'])
  expect(readdirSync(stagePackagedRuntime(desktopRoot, runtime, ['arm64', 'x64'])).sort()).toEqual(['arm64', 'x64'])
  expect(readdirSync(runtime).sort()).toEqual(['arm64', 'x64'])
  rmSync(join(runtime, 'x64'), { recursive: true })
  expect(() => stagePackagedRuntime(desktopRoot, runtime, ['x64'])).toThrow('no prepared x64 payload')
  expect(existsSync(join(staged, 'x64'))).toBe(false)
})

it('builds a package only where its final checks can start it', () => {
  const noRosetta = (): boolean => false
  expect(() => { assertMacPackagesRunnable(['arm64', 'x64', 'universal'], 'arm64', () => true) }).not.toThrow()
  expect(() => { assertMacPackagesRunnable(['arm64', 'universal'], 'arm64', noRosetta) }).not.toThrow()
  expect(() => { assertMacPackagesRunnable(['x64'], 'arm64', noRosetta) }).toThrow('softwareupdate --install-rosetta')
  expect(() => { assertMacPackagesRunnable(['x64', 'universal'], 'x64', noRosetta) }).not.toThrow()
  expect(() => { assertMacPackagesRunnable(['arm64'], 'x64', () => true) }).toThrow('Apple silicon Mac')
})
