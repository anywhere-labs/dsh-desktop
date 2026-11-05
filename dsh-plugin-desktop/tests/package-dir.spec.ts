import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error package-dir deliberately remains a directly executable ESM script.
import { packageDirectory, UNSIGNED_DIRECTORY_BUILD_ARGS, unsignedDirectoryBuildEnvironment } from '../scripts/package-dir.mjs'
import { disableAsarArchiveView, type AsarArchiveProcess } from '../src/asar-archive-policy.ts'
import { dshProductVersion } from '../src/dsh-product-version.ts'
import { verifyBundledSkills } from '../src/packaged-filesystem-smoke.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

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
      DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
    })
  })

  it('passes explicit unsigned and no-notarization overrides to Electron Builder', () => {
    const run = vi.fn(() => ({ status: 0 }))

    packageDirectory({
      cwd: '/workspace/desktop',
      electronBuilderCli: '/workspace/electron-builder.js',
      electronDistPath: '/workspace/electron/dist',
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
      [
        '/workspace/electron-builder.js',
        ...UNSIGNED_DIRECTORY_BUILD_ARGS,
        '--config.electronDist=/workspace/electron/dist',
      ],
      {
        cwd: '/workspace/desktop',
        env: {
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
          DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
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

describe('packaged filesystem smoke', () => {
  it('discovers and reads shipped Cordis skills through fs-local in a plain app directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-packaged-skills-'))
    try {
      const app = join(root, 'resources', 'app')
      const preset = join(app, 'node_modules', '@deepseek-ai', 'dsh-agent-preset')
      mkdirSync(preset, { recursive: true })
      const require = createRequire(import.meta.url)
      cpSync(join(dirname(require.resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills'),
        join(preset, 'skills'), { recursive: true })
      await expect(verifyBundledSkills(app)).resolves.toBeUndefined()
      rmSync(join(preset, 'skills', 'cordis-plugin-development'), { recursive: true })
      await expect(verifyBundledSkills(app)).rejects.toThrow('bundled skill is unavailable: cordis-plugin-development')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Electron asar archive view', () => {
  const resourcesRoot = join(tmpdir(), 'DSH Desktop', 'resources')
  const moduleIn = (...segments: string[]): string => pathToFileURL(join(resourcesRoot, ...segments)).href

  it('turns the archive view off for code shipped unpacked', () => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn('app', 'lib', 'host-process-entry.js'), proc)).toBe(true)
    expect(proc.noAsar).toBe(true)
  })

  it('treats a directory that merely mentions asar as unpacked code', () => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn('app', 'node_modules', 'asar-helper', 'lib', 'index.js'), proc)).toBe(true)
    expect(proc.noAsar).toBe(true)
  })

  it.each([
    ['app.asar', 'lib', 'host-process-entry.js'],
    ['app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'],
    ['APP.ASAR', 'lib', 'desktop-cli.js'],
  ])('keeps the archive view for code loaded from %s', (...segments) => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn(...segments), proc)).toBe(false)
    expect(proc.noAsar).toBeUndefined()
  })
})

describe('installed DSH product version', () => {
  function fixture(manifest: unknown): { readonly moduleUrl: URL; readonly manifestPath: string } {
    const root = mkdtempSync(join(tmpdir(), 'dsh-product-version-'))
    temporaryDirectories.push(root)
    const manifestPath = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    mkdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"private":true}\n')
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
    return {
      moduleUrl: pathToFileURL(join(root, 'entry.mjs')),
      manifestPath,
    }
  }

  it('reads the package actually resolvable from the Desktop installation graph', () => {
    const desktopManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(dshProductVersion()).toBe(desktopManifest.dependencies['@deepseek-ai/dsh'])
  })

  it('resolves and validates a canonical prerelease from the caller package graph', () => {
    const { moduleUrl } = fixture({ name: '@deepseek-ai/dsh', version: '0.1.2-alpha.7' })
    expect(dshProductVersion(moduleUrl)).toBe('0.1.2-alpha.7')
  })

  it('rejects the wrong package identity and non-canonical versions', () => {
    const wrongIdentity = fixture({ name: '@deepseek-ai/not-dsh', version: '0.1.2' })
    expect(() => dshProductVersion(wrongIdentity.moduleUrl)).toThrow('invalid identity')

    const invalidVersion = fixture({ name: '@deepseek-ai/dsh', version: 'v0.1.2' })
    expect(() => dshProductVersion(invalidVersion.moduleUrl)).toThrow('not canonical')
  })
})
