import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error package-dir deliberately remains a directly executable ESM script.
import { packageDirectory, UNSIGNED_DIRECTORY_BUILD_ARGS, unsignedDirectoryBuildEnvironment } from '../scripts/package-dir.mjs'

describe('unsigned directory packaging', () => {
  it('removes release secrets while preserving ordinary build inputs', () => {
    const environment = unsignedDirectoryBuildEnvironment({
      APPLE_API_KEY: '/tmp/private.p8',
      APPLE_ID: 'release@example.com',
      CSC_KEY_PASSWORD: 'secret',
      CSC_LINK: '/tmp/release.p12',
      CSC_NAME: 'Developer ID Application: Release',
      MAC_CERT_P12_BASE64: 'private',
      WIN_CSC_KEY_PASSWORD: 'secret',
      WIN_CSC_LINK: '/tmp/windows.pfx',
      DSH_PACKAGE_CHECK_ALREADY_RAN: '1',
    })

    expect(environment).toEqual({
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      DSH_PACKAGE_CHECK_ALREADY_RAN: '1',
    })
  })

  it('passes explicit unsigned and no-notarization overrides to Electron Builder', () => {
    const run = vi.fn(() => ({ status: 0 }))

    packageDirectory({
      cwd: '/workspace/desktop',
      electronBuilderCli: '/workspace/electron-builder.js',
      env: { CSC_NAME: 'Developer ID Application: Release', KEEP: 'yes' },
      nodeExecutable: '/runtime/node',
      run: run as unknown as typeof import('node:child_process').spawnSync,
    })

    expect(UNSIGNED_DIRECTORY_BUILD_ARGS).toEqual([
      '--dir',
      '--publish',
      'never',
      '--config.forceCodeSigning=false',
      '--config.mac.identity=null',
      '--config.mac.notarize=false',
      '--config.win.signExecutable=false',
    ])
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(
      '/runtime/node',
      ['/workspace/electron-builder.js', ...UNSIGNED_DIRECTORY_BUILD_ARGS],
      {
        cwd: '/workspace/desktop',
        env: {
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
          KEEP: 'yes',
        },
        stdio: 'inherit',
      },
    )
  })

  it('propagates spawn failures and non-zero exits', () => {
    const failure = new Error('cannot spawn')
    expect(() => packageDirectory({
      run: (() => ({ error: failure })) as unknown as typeof import('node:child_process').spawnSync,
    })).toThrow(failure)
    expect(() => packageDirectory({
      run: (() => ({ status: 7 })) as unknown as typeof import('node:child_process').spawnSync,
    })).toThrow('electron-builder --dir exited with 7')
  })
})
