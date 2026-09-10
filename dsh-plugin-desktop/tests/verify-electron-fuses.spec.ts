import { FuseV1Options, FuseVersion, type FuseConfig } from '@electron/fuses'
import { FuseState } from '@electron/fuses/dist/constants.js'
import { Arch } from 'builder-util'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  afterAllArtifactBuild,
  resolveFinalPackagedRuntimeContexts,
  verifyElectronExecutableFuses,
  type ElectronArtifactBuildResult,
  type ElectronFuseReader,
} from '../scripts/verify-electron-fuses.ts'
import type {
  PackagedElectronSmoke,
} from '../scripts/verify-packaged-runtime.ts'

function result(
  platforms: readonly {
    readonly archs: readonly number[]
    readonly key: string
  }[],
  configuration: ElectronArtifactBuildResult['configuration'] = {
    productName: 'DSH Desktop',
  },
): ElectronArtifactBuildResult {
  return {
    outDir: '/build',
    configuration,
    platformToTargets: new Map(
      platforms.map(({ archs, key }) => [
        { buildConfigurationKey: key },
        new Map(archs.map(arch => [arch, []])),
      ]),
    ),
  }
}

function fuseWire(overrides: Partial<Record<FuseV1Options, FuseState>> = {}): FuseConfig<FuseState> {
  return {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: FuseState.ENABLE,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
    [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
    ...overrides,
  }
}

describe('final Electron fuse verification', () => {
  it('maps only requested platform and architecture keys to complete runtime contexts', () => {
    const expected = [
      join('/build', 'linux-unpacked', 'dsh-plugin-desktop'),
      join('/build', 'mac-universal', 'DSH Desktop.app', 'Contents', 'MacOS', 'DSH Desktop'),
      join('/build', 'win-unpacked', 'DSH Desktop.exe'),
      join('/build', 'win-arm64-unpacked', 'DSH Desktop.exe'),
    ].sort()

    expect(resolveFinalPackagedRuntimeContexts(
      result([
        { key: 'mac', archs: [Arch.universal] },
        { key: 'win', archs: [Arch.x64, Arch.arm64] },
        { key: 'linux', archs: [Arch.x64] },
      ]),
      filename => expected.includes(filename),
    )).toEqual([
      {
        appOutDir: join('/build', 'linux-unpacked'),
        arch: 1,
        electronPlatformName: 'linux',
        packager: {
          executableName: 'dsh-plugin-desktop',
          appInfo: { productFilename: 'DSH Desktop' },
        },
      },
      {
        appOutDir: join('/build', 'mac-universal'),
        arch: 4,
        electronPlatformName: 'darwin',
        packager: { appInfo: { productFilename: 'DSH Desktop' } },
      },
      {
        appOutDir: join('/build', 'win-arm64-unpacked'),
        arch: 3,
        electronPlatformName: 'win32',
        packager: { appInfo: { productFilename: 'DSH Desktop' } },
      },
      {
        appOutDir: join('/build', 'win-unpacked'),
        arch: 1,
        electronPlatformName: 'win32',
        packager: { appInfo: { productFilename: 'DSH Desktop' } },
      },
    ])
  })

  it('honors Linux executableName and recovers a configured suffixless architecture', () => {
    const configured = result([{ key: 'linux', archs: [Arch.arm64] }], {
      productName: 'DSH Desktop',
      linux: { defaultArch: 'arm64', executableName: 'dsh-desktop' },
    })
    const executable = join('/build', 'linux-unpacked', 'dsh-desktop')

    expect(resolveFinalPackagedRuntimeContexts(
      configured,
      filename => filename === executable,
    )).toEqual([{
      appOutDir: join('/build', 'linux-unpacked'),
      arch: 3,
      electronPlatformName: 'linux',
      packager: {
        executableName: 'dsh-desktop',
        appInfo: { productFilename: 'dsh-desktop' },
      },
    }])
  })

  it.each([
    ['mac', 'mac', 'darwin', 1],
    ['mac-arm64', 'mac', 'darwin', 3],
    ['mac-universal', 'mac', 'darwin', 4],
    ['win-ia32-unpacked', 'win', 'win32', 0],
    ['linux-armv7l-unpacked', 'linux', 'linux', 2],
  ] as const)(
    'maps %s to its platform, architecture, and appOutDir',
    (directory, key, platform, arch) => {
      expect(resolveFinalPackagedRuntimeContexts(
        result([{ key, archs: [arch] }]),
        () => true,
      )).toEqual([expect.objectContaining({
        appOutDir: join('/build', directory),
        arch,
        electronPlatformName: platform,
      })])
    },
  )

  it('rejects an unsupported configured default architecture', () => {
    expect(() => resolveFinalPackagedRuntimeContexts(
      result([{ key: 'linux', archs: [Arch.x64] }], {
        linux: { defaultArch: 'mips64' },
      }),
      () => true,
    )).toThrow('unsupported Electron linux output default architecture "mips64"')
  })

  it('ignores a stale sibling architecture from an earlier build', () => {
    const expected = join('/build', 'win-unpacked', 'DSH Desktop.exe')
    const stale = join('/build', 'win-arm64-unpacked', 'DSH Desktop.exe')
    const exists = vi.fn((filename: string) => filename === expected || filename === stale)

    expect(resolveFinalPackagedRuntimeContexts(
      result([{ key: 'win', archs: [Arch.x64] }]),
      exists,
    )).toEqual([expect.objectContaining({
      appOutDir: join('/build', 'win-unpacked'),
      arch: Arch.x64,
    })])
    expect(exists).toHaveBeenCalledTimes(1)
    expect(exists).toHaveBeenCalledWith(expected)
    expect(exists).not.toHaveBeenCalledWith(stale)
  })

  it('fails when one requested architecture is missing even if a sibling exists', () => {
    const x64Executable = join('/build', 'win-unpacked', 'DSH Desktop.exe')

    expect(() => resolveFinalPackagedRuntimeContexts(
      result([{ key: 'win', archs: [Arch.x64, Arch.arm64] }]),
      filename => filename === x64Executable,
    )).toThrow('win/arm64 at /build/win-arm64-unpacked/DSH Desktop.exe')
  })

  it('resolves a real target-name map through the target archs retained by NSIS', () => {
    const platform = { buildConfigurationKey: 'win' }
    const built = {
      outDir: '/build',
      configuration: { productName: 'DSH Desktop' },
      platformToTargets: new Map([[platform, new Map([
        ['nsis', { archs: new Map([
          [Arch.x64, '/build/win-unpacked'],
          [Arch.arm64, '/build/win-arm64-unpacked'],
        ]) }],
      ])]]),
    } satisfies ElectronArtifactBuildResult

    expect(resolveFinalPackagedRuntimeContexts(built, () => true))
      .toEqual([
        expect.objectContaining({ appOutDir: join('/build', 'win-arm64-unpacked'), arch: Arch.arm64 }),
        expect.objectContaining({ appOutDir: join('/build', 'win-unpacked'), arch: Arch.x64 }),
      ])
  })

  it('resolves mac universal from the target packager request and ignores component outputs', () => {
    const platform = { buildConfigurationKey: 'mac' }
    const requestedTargets = new Map([[platform, new Map([
      [Arch.universal, ['dmg']],
    ])]])
    const built = {
      outDir: '/build',
      configuration: { productName: 'DSH Desktop' },
      platformToTargets: new Map([[platform, new Map([
        ['dmg', { packager: { packagerOptions: { targets: requestedTargets } } }],
      ])]]),
    } satisfies ElectronArtifactBuildResult
    const universalExecutable = join(
      '/build',
      'mac-universal',
      'DSH Desktop.app',
      'Contents',
      'MacOS',
      'DSH Desktop',
    )
    const exists = vi.fn((filename: string) => filename === universalExecutable)

    expect(resolveFinalPackagedRuntimeContexts(built, exists)).toEqual([
      expect.objectContaining({ appOutDir: join('/build', 'mac-universal'), arch: Arch.universal }),
    ])
    expect(exists).toHaveBeenCalledTimes(1)
    expect(exists).toHaveBeenCalledWith(universalExecutable)
  })

  it('checks every requested final executable after all artifact builds', async () => {
    const executables = [
      join('/build', 'mac-arm64', 'DSH Desktop.app', 'Contents', 'MacOS', 'DSH Desktop'),
      join('/build', 'mac', 'DSH Desktop.app', 'Contents', 'MacOS', 'DSH Desktop'),
    ]
    const events: string[] = []
    const read = vi.fn<ElectronFuseReader>(async (executable) => {
      events.push(`fuse:${executable}`)
      return fuseWire()
    })
    const smoke = vi.fn<PackagedElectronSmoke>((runtimeContext) => {
      events.push(`smoke:${runtimeContext.appOutDir}`)
    })

    await expect(afterAllArtifactBuild(
      result([{ key: 'mac', archs: [Arch.arm64, Arch.x64] }]),
      read,
      filename => executables.includes(filename),
      smoke,
    )).resolves.toEqual([])
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(executables.sort())
    expect(smoke.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ appOutDir: join('/build', 'mac'), arch: Arch.x64 }),
      expect.objectContaining({ appOutDir: join('/build', 'mac-arm64'), arch: 3 }),
    ])
    expect(events).toEqual([
      `fuse:${executables[1]}`,
      `smoke:${join('/build', 'mac')}`,
      `fuse:${executables[0]}`,
      `smoke:${join('/build', 'mac-arm64')}`,
    ])
  })

  it.each([
    [FuseV1Options.RunAsNode, 'RunAsNode'],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, 'EnableEmbeddedAsarIntegrityValidation'],
    [FuseV1Options.OnlyLoadAppFromAsar, 'OnlyLoadAppFromAsar'],
  ])('fails loud when required fuse %s is not enabled', async (option, name) => {
    const read: ElectronFuseReader = async () => fuseWire({ [option]: FuseState.DISABLE })

    await expect(verifyElectronExecutableFuses('/build/DSH Desktop.exe', read))
      .rejects.toThrow(`${name}=DISABLE`)
  })

  it('wraps an unreadable final executable with its resolved path', async () => {
    const read: ElectronFuseReader = async () => { throw new Error('missing sentinel') }

    await expect(verifyElectronExecutableFuses('/build/DSH Desktop.exe', read))
      .rejects.toThrow('/build/DSH Desktop.exe')
  })
})
