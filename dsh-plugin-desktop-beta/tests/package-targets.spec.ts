import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { packageLinuxArtifacts, type LinuxPackageOptions } from '../../dsh-plugin-desktop/scripts/package-linux.ts'
import { packageMacSmoke, type MacSmokePackageOptions } from '../../dsh-plugin-desktop/scripts/package-mac.ts'
import { verifyMacRelease } from '../../dsh-plugin-desktop/scripts/verify-mac-release.ts'
import { linuxPackageTargets, macApplicationDirectory, macSmokeTarget } from '../scripts/package-targets.ts'
import { nextMacVerification } from '../scripts/verify-mac-release.ts'

// A one-file inventory stands in for the application's native files.
vi.mock('../scripts/mac-runtime.ts', () => ({ NEXT_MAC_NATIVE_ENTRIES: [{ arch: 'arm64', path: 'node_modules/fixture-native/bin/uv' }] }))

type Command = readonly string[]

describe('smoke installer selection', () => {
  it('builds the DMG unless the smoke asks for the application directory only', () => {
    expect(macSmokeTarget({})).toBe('dmg')
    expect(macSmokeTarget({ DSH_MAC_SMOKE_TARGET: '' })).toBe('dmg')
    expect(macSmokeTarget({ DSH_MAC_SMOKE_TARGET: 'dmg' })).toBe('dmg')
    expect(macSmokeTarget({ DSH_MAC_SMOKE_TARGET: 'dir' })).toBe('dir')
    expect(() => macSmokeTarget({ DSH_MAC_SMOKE_TARGET: 'zip' })).toThrow('DSH_MAC_SMOKE_TARGET must be dmg or dir')
  })

  it('names the application directory electron-builder writes for each smoke architecture', () => {
    expect(macApplicationDirectory('x64')).toBe('mac')
    expect(macApplicationDirectory('arm64')).toBe('mac-arm64')
    expect(macApplicationDirectory('universal')).toBe('mac-universal')
  })

  it('builds both Linux packages unless a subset is listed', () => {
    expect(linuxPackageTargets({})).toEqual(['AppImage', 'deb'])
    expect(linuxPackageTargets({ DSH_LINUX_PACKAGE_TARGETS: 'AppImage' })).toEqual(['AppImage'])
    expect(linuxPackageTargets({ DSH_LINUX_PACKAGE_TARGETS: 'deb, AppImage' })).toEqual(['AppImage', 'deb'])
    expect(() => linuxPackageTargets({ DSH_LINUX_PACKAGE_TARGETS: 'rpm' })).toThrow('DSH_LINUX_PACKAGE_TARGETS must list AppImage and/or deb once each')
    expect(() => linuxPackageTargets({ DSH_LINUX_PACKAGE_TARGETS: 'deb,deb' })).toThrow('DSH_LINUX_PACKAGE_TARGETS must list AppImage and/or deb once each')
  })
})

describe('smoke packaging with a reduced installer set', () => {
  const builder = '/repo/node_modules/electron-builder/cli.js'

  function macOptions(calls: Command[], target?: 'dmg' | 'dir'): MacSmokePackageOptions {
    return { env: { DSH_PACKAGE_CHECK_ALREADY_RAN: '1', DSH_MAC_SMOKE_ARCH: 'arm64' }, platform: 'darwin', arch: 'arm64', nodeVersion: '24.21.0',
      workspaceRoot: '/repo', desktopRoot: '/repo/desktop', outputDir: '/repo/desktop/dist/mac-smoke', resetOutput: () => undefined,
      prepareRuntime: () => undefined, builderCli: builder, verifier: '/repo/desktop/scripts/verify-mac-smoke.ts', nodeExecutable: '/usr/local/bin/node',
      run: (_command, args) => { calls.push(args) }, log: () => undefined, ...(target === undefined ? {} : { target }) }
  }

  function linuxOptions(calls: Command[], targets?: LinuxPackageOptions['targets']): LinuxPackageOptions {
    return { env: { DSH_PACKAGE_CHECK_ALREADY_RAN: '1', DSH_LINUX_PACKAGE_COMPRESSION: 'store' }, platform: 'linux', arch: 'x64', supportedArchs: ['x64', 'arm64'],
      nodeVersion: '24.21.0', workspaceRoot: '/repo', desktopRoot: '/repo/desktop', builderCli: builder, prepareRuntime: () => undefined,
      verifier: '/repo/desktop/scripts/verify-win-installer.ts', nodeExecutable: '/usr/local/bin/node', run: (_command, args) => { calls.push(args) },
      log: () => undefined, ...(targets === undefined ? {} : { targets }) }
  }

  it('hands electron-builder the DMG target by default and the directory target on request', () => {
    const dmg: Command[] = []
    packageMacSmoke(macOptions(dmg))
    expect(dmg[0]?.slice(0, 4)).toEqual([builder, '--mac', 'dmg', '--arm64'])
    const dir: Command[] = []
    packageMacSmoke(macOptions(dir, 'dir'))
    expect(dir[0]?.slice(0, 4)).toEqual([builder, '--mac', 'dir', '--arm64'])
    expect(dir[1]).toEqual(['/repo/desktop/scripts/verify-mac-smoke.ts', '/repo/desktop/dist/mac-smoke'])
  })

  it('builds only the listed Linux targets and drops the Debian compression with the Debian package', () => {
    const both: Command[] = []
    packageLinuxArtifacts(linuxOptions(both))
    expect(both[0]?.slice(0, 4)).toEqual([builder, '--linux', 'AppImage', 'deb'])
    expect(both[0]).toContain('--config.deb.compression=gz')
    const appImage: Command[] = []
    packageLinuxArtifacts(linuxOptions(appImage, ['AppImage']))
    expect(appImage[0]?.slice(0, 4)).toEqual([builder, '--linux', 'AppImage', '--x64'])
    expect(appImage[0]).not.toContain('--config.deb.compression=gz')
    expect(() => packageLinuxArtifacts(linuxOptions([], []))).toThrow('Linux packaging needs at least one target')
  })
})

describe('macOS smoke verification', () => {
  it('checks an application-directory smoke in place without mounting an image', () => {
    const commands: Command[] = []
    const options = nextMacVerification(false, '/repo/dist/mac-smoke', { DSH_MAC_SMOKE_ARCH: 'arm64', DSH_MAC_SMOKE_TARGET: 'dir' },
      (command, args) => { commands.push([command, ...args]) })
    const app = '/repo/dist/mac-smoke/mac-arm64/DSH Desktop Beta.app'
    expect(verifyMacRelease({ ...options, verifyRuntime: () => undefined }).appPath).toBe(app)
    expect(commands.map(([command]) => command)).not.toContain('hdiutil')
    expect(commands).toContainEqual(['lipo', `${app}/Contents/MacOS/DSH Desktop Beta`, '-verify_arch', 'arm64'])
    expect(commands).not.toContainEqual(['lipo', `${app}/Contents/MacOS/DSH Desktop Beta`, '-verify_arch', 'x86_64'])
    expect(commands).toContainEqual(['lipo', `${app}/Contents/Resources/app.asar.unpacked/node_modules/fixture-native/bin/uv`, '-verify_arch', 'arm64'])
  })

  it('mounts the DMG for a DMG smoke and always for a signed release', () => {
    const dist = mkdtempSync(join(tmpdir(), 'dsh-mac-verification-'))
    try {
      writeFileSync(join(dist, 'smoke.dmg'), '')
      const commands: Command[] = []
      const options = nextMacVerification(false, dist, { DSH_MAC_SMOKE_ARCH: 'arm64' }, (command, args) => { commands.push([command, ...args]) })
      verifyMacRelease({ ...options, verifyRuntime: () => undefined })
      expect(commands[0]?.slice(0, 3)).toEqual(['hdiutil', 'attach', join(dist, 'smoke.dmg')])
      expect(commands.at(-1)?.slice(0, 2)).toEqual(['hdiutil', 'detach'])
      expect(nextMacVerification(true, dist, { DSH_MAC_SMOKE_TARGET: 'dir' }).listDmgs(dist)).toEqual([join(dist, 'smoke.dmg')])
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })
})
