import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  clearElectronRunAsNode,
  desktopCliProfilePackageUrl,
  profileBootNameFromArgv,
  runDesktopDshCli,
  withDefaultDesktopProfile,
} from '../src/desktop-cli.ts'
import { packagedDependencyPath, unpackedAsarPath } from '../src/packaged-runtime-path.ts'

describe('packaged dsh bootstrap', () => {
  it('removes every Windows casing of Electron Node mode', () => {
    const environment = {
      ELECTRON_RUN_AS_NODE: '1',
      electron_run_as_node: 'inherited',
      Path: 'C:\\Windows',
    }

    clearElectronRunAsNode(environment)

    expect(environment).toEqual({ Path: 'C:\\Windows' })
  })

  it('clears Node mode before loading the fixed packaged CLI entry', async () => {
    const environment = {
      ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP_DEFAULT_PROFILE: 'desktop',
      KEEP: 'value',
    }
    const argv = ['/Applications/DSH Desktop', '/app.asar/lib/desktop-cli.js', '--dump-config']
    const load = vi.fn(async (url: string) => {
      expect(environment).toEqual({ KEEP: 'value' })
      expect(argv).toEqual([
        '/Applications/DSH Desktop',
        '/app.asar/lib/desktop-cli.js',
        '--profile',
        'desktop',
        '--dump-config',
      ])
      expect(url).toMatch(/\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js$/u)
    })

    await runDesktopDshCli(environment, load, argv)

    expect(load).toHaveBeenCalledOnce()
  })

  it('leaves the release-age policy to the final pnpm shim exactly once', async () => {
    const load = vi.fn(async () => {})
    const defaulted = [
      '/Applications/DSH Desktop',
      '/app.asar/lib/desktop-cli.js',
      'plugin',
      '--config.minimumReleaseAge=0',
      'remove',
      'example-plugin',
    ]
    await runDesktopDshCli({ DSH_DESKTOP_DEFAULT_PROFILE: 'desktop' }, load, defaulted)
    expect(defaulted.slice(2)).toEqual([
      'plugin',
      '--profile',
      'desktop',
      'remove',
      'example-plugin',
    ])

    const explicit = [
      '/Applications/DSH Desktop',
      '/app.asar/lib/desktop-cli.js',
      'plugin',
      '--profile=work',
      '--config.minimumReleaseAge=0',
      'update',
    ]
    await runDesktopDshCli({}, load, explicit)
    expect(explicit.slice(2)).toEqual(['plugin', '--profile=work', 'update'])
  })

  it('defaults profile and plugin commands without overriding explicit or global modes', () => {
    expect(withDefaultDesktopProfile([], 'desktop')).toEqual(['--profile', 'desktop'])
    expect(withDefaultDesktopProfile(['--dump-config'], 'desktop')).toEqual([
      '--profile',
      'desktop',
      '--dump-config',
    ])
    expect(withDefaultDesktopProfile(['plugin', 'add', 'third-party'], 'desktop')).toEqual([
      'plugin',
      '--profile',
      'desktop',
      'add',
      'third-party',
    ])
    expect(withDefaultDesktopProfile(['--profile', 'web'], 'desktop')).toEqual(['--profile', 'web'])
    expect(withDefaultDesktopProfile(['--profile=web'], 'desktop')).toEqual(['--profile=web'])
    expect(withDefaultDesktopProfile(['web'], 'desktop')).toEqual(['web'])
    expect(withDefaultDesktopProfile(['--help'], 'desktop')).toEqual(['--help'])
    expect(withDefaultDesktopProfile(['--version'], 'desktop')).toEqual(['--version'])
    expect(withDefaultDesktopProfile(['plugin', 'update'], '工作 profile')).toEqual([
      'plugin',
      '--profile',
      '工作 profile',
      'update',
    ])
    expect(() => withDefaultDesktopProfile([], '../desktop')).toThrow('invalid desktop profile name')
  })

  it('identifies only launcher-owned profile boots', () => {
    expect(profileBootNameFromArgv(['web'])).toBe('web')
    expect(profileBootNameFromArgv(['web', '--help'])).toBe('web')
    expect(profileBootNameFromArgv(['web', '--profile', 'inner-app'])).toBe('web')
    expect(profileBootNameFromArgv(['web', '--profile=inner-app'])).toBe('web')
    expect(profileBootNameFromArgv(['web', '--dump-config'])).toBeUndefined()
    expect(profileBootNameFromArgv(['--profile', 'work', '--resume', 'abc'])).toBe('work')
    expect(profileBootNameFromArgv(['--profile=work', '--patch', 'extra.yml'])).toBe('work')
    expect(profileBootNameFromArgv(['plugin', '--profile', 'work', 'add', 'plugin'])).toBeUndefined()
    expect(profileBootNameFromArgv(['--profile', 'work', '--', '--profile', 'other'])).toBe('work')
    expect(profileBootNameFromArgv(['--profile', '../work'])).toBeUndefined()
    expect(profileBootNameFromArgv(['--profile', 'work', '--profile', 'other'])).toBeUndefined()
    expect(profileBootNameFromArgv(['--profile', 'work', '--patch='])).toBeUndefined()
    expect(profileBootNameFromArgv(['--profile', 'work', '--dump-default-config'])).toBeUndefined()
  })

  it('installs the resolver against the selected DSH_HOME profile anchor', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-cli-home-'))
    try {
      const environment = {
        DSH_HOME: home,
        DSH_DESKTOP_DEFAULT_PROFILE: 'desktop',
      }
      const argv = ['/Applications/DSH Desktop', '/app.asar/lib/desktop-cli.js']
      const installResolver = vi.fn(() => vi.fn())
      const load = vi.fn(async () => {})

      await runDesktopDshCli(environment, load, argv, installResolver)

      expect(installResolver).toHaveBeenCalledWith(desktopCliProfilePackageUrl('desktop', { DSH_HOME: home }))
      expect(installResolver).toHaveBeenCalledWith(pathToFileURL(join(home, 'profiles', 'desktop', 'package.json')).href)
      expect(load).toHaveBeenCalledOnce()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('awaits resolver installation before importing the packaged CLI', async () => {
    const events: string[] = []

    await runDesktopDshCli(
      {},
      async () => { events.push('load') },
      ['/Applications/DSH Desktop', '/app.asar/lib/desktop-cli.js', '--profile', 'work'],
      async () => {
        events.push('install')
        await Promise.resolve()
        events.push('ready')
        return () => {}
      },
    )

    expect(events).toEqual(['install', 'ready', 'load'])
  })

  it('keeps the resolver installed after a successful profile boot', async () => {
    const releaseResolver = vi.fn()
    const installResolver = vi.fn(() => releaseResolver)

    await runDesktopDshCli(
      {},
      async () => {},
      ['/Applications/DSH Desktop', '/app.asar/lib/desktop-cli.js', '--profile', 'work'],
      installResolver,
    )

    expect(releaseResolver).not.toHaveBeenCalled()
  })

  it('does not install the resolver for plugin management or config dumps', async () => {
    const installResolver = vi.fn(() => vi.fn())
    const load = vi.fn(async () => {})

    await runDesktopDshCli(
      { DSH_DESKTOP_DEFAULT_PROFILE: 'desktop' },
      load,
      ['/Applications/DSH Desktop', '/app.asar/lib/desktop-cli.js', '--dump-config'],
      installResolver,
    )
    await runDesktopDshCli(
      { DSH_DESKTOP_DEFAULT_PROFILE: 'desktop' },
      load,
      ['/Applications/DSH Desktop', '/app.asar/lib/desktop-cli.js', 'plugin', 'add', 'plugin'],
      installResolver,
    )

    expect(installResolver).not.toHaveBeenCalled()
  })

  it('releases the resolver when importing the packaged CLI fails', async () => {
    const releaseResolver = vi.fn()
    const installResolver = vi.fn(() => releaseResolver)
    const failure = new Error('boot failed')
    const load = vi.fn(async () => { throw failure })

    await expect(runDesktopDshCli(
      {},
      load,
      ['/Applications/DSH Desktop', '/app.asar/lib/desktop-cli.js', '--profile', 'work'],
      installResolver,
    )).rejects.toBe(failure)

    expect(releaseResolver).toHaveBeenCalledOnce()
  })

  it('uses the physical unpacked dependency tree only inside an Electron package', () => {
    expect(unpackedAsarPath('/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules/pkg'))
      .toBe('/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/pkg')
    expect(unpackedAsarPath('C:\\Program Files\\DSH Desktop\\resources\\app.asar\\node_modules\\pkg'))
      .toBe('C:\\Program Files\\DSH Desktop\\resources\\app.asar.unpacked\\node_modules\\pkg')
    expect(unpackedAsarPath('/Applications/DSH Desktop.app/Contents/Resources/app.asar/package.json'))
      .toBe('/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/package.json')
    expect(unpackedAsarPath('/workspace/node_modules/pkg')).toBe('/workspace/node_modules/pkg')
    expect(() => packagedDependencyPath(import.meta.url, '../outside.js'))
      .toThrow('relative POSIX path')
  })

  it('maps a resolved ASAR dependency to its physical unpacked path', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-asar-profile-'))
    const desktopLib = join(root, 'app.asar', 'lib')
    const dshPackage = join(root, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh')
    try {
      mkdirSync(desktopLib, { recursive: true })
      mkdirSync(join(dshPackage, 'lib'), { recursive: true })
      writeFileSync(join(dshPackage, 'package.json'), JSON.stringify({
        name: '@deepseek-ai/dsh',
        type: 'module',
      }))
      writeFileSync(join(dshPackage, 'lib', 'bin.js'), '')

      const moduleUrl = pathToFileURL(join(desktopLib, 'desktop-cli.js')).href
      expect(packagedDependencyPath(moduleUrl, '@deepseek-ai/dsh/lib/bin.js')).toBe(join(
        realpathSync(root),
        'app.asar.unpacked',
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'lib',
        'bin.js',
      ))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves the DSH entry from a pnpm profile with flat package dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-flat-profile-'))
    const desktopLib = join(root, 'node_modules', 'dsh-plugin-desktop', 'lib')
    const dshPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    const dshEntry = join(dshPackage, 'lib', 'bin.js')
    const pnpmPackage = join(root, 'node_modules', 'pnpm')
    const pnpmEntry = join(pnpmPackage, 'bin', 'pnpm.mjs')
    try {
      mkdirSync(desktopLib, { recursive: true })
      mkdirSync(join(dshPackage, 'lib'), { recursive: true })
      mkdirSync(join(pnpmPackage, 'bin'), { recursive: true })
      writeFileSync(join(dshPackage, 'package.json'), JSON.stringify({
        name: '@deepseek-ai/dsh',
        type: 'module',
      }))
      writeFileSync(dshEntry, '')
      writeFileSync(join(pnpmPackage, 'package.json'), JSON.stringify({
        name: 'pnpm',
        exports: { '.': './package.json' },
      }))
      writeFileSync(pnpmEntry, '')

      const moduleUrl = pathToFileURL(join(desktopLib, 'desktop-cli.js')).href
      expect(packagedDependencyPath(moduleUrl, '@deepseek-ai/dsh/lib/bin.js'))
        .toBe(join(realpathSync(root), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      expect(packagedDependencyPath(moduleUrl, 'pnpm/bin/pnpm.mjs'))
        .toBe(join(realpathSync(root), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
