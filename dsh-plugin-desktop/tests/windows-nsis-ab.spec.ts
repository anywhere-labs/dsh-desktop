import { spawnSync } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertIsolatedAppBuilderLibResolution,
  buildWindowsNsisAb,
  type WindowsNsisAbBuildOptions,
} from '../scripts/build-windows-nsis-ab.ts'
import {
  inspectInstalledWindowsApp,
  parseInstalledWindowsAppArguments,
} from '../scripts/inspect-windows-installed-app.ts'
import { probeInstalledWindowsRuntime } from '../scripts/probe-windows-packaged-runtime.ts'
import verifyNsisAbPrepackagedBuild, {
  NSIS_AB_HOOK_AUTHORIZATION_FILE,
  NSIS_AB_HOOK_TOKEN_ENV,
} from '../scripts/verify-nsis-ab-prepackaged.ts'
import type { PackagedElectronSmoke } from '../scripts/verify-packaged-runtime.ts'
import {
  identifyWindowsNsisAbTree,
  normalizeWindowsNsisAbRelativePath,
  readWindowsNsisAbManifest,
  resolveWindowsNsisAbPath,
} from '../scripts/windows-nsis-ab.ts'

const roots: string[] = []
const require = createRequire(import.meta.url)
const asarCli = require.resolve('@electron/asar/bin/asar.js')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function pe(): Buffer {
  const value = Buffer.alloc(128)
  value.write('MZ', 0, 'ascii')
  value.writeUInt32LE(64, 0x3c)
  value.write('PE\0\0', 64, 'binary')
  return value
}

interface Call {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function fixture(mutateStaged = false): { options: WindowsNsisAbBuildOptions, calls: Call[] } {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-nsis-ab-'))
  roots.push(workspaceRoot)
  const desktopRoot = join(workspaceRoot, 'dsh-plugin-desktop')
  const outputRoot = join(desktopRoot, 'dist', 'nsis-ab', 'test')
  const electronBuilderRoot = join(workspaceRoot, 'dependencies', 'electron-builder')
  const appBuilderLibRoot = join(workspaceRoot, 'dependencies', 'app-builder-lib')
  const appBuilderPatch = join(workspaceRoot, 'patches', 'app-builder-lib@26.15.7.patch')
  mkdirSync(desktopRoot, { recursive: true })
  writeFileSync(join(desktopRoot, 'package.json'), '{"version":"9.8.7"}\n')
  mkdirSync(electronBuilderRoot, { recursive: true })
  mkdirSync(join(appBuilderLibRoot, 'templates', 'nsis', 'include'), { recursive: true })
  mkdirSync(join(workspaceRoot, 'patches'), { recursive: true })
  writeFileSync(join(electronBuilderRoot, 'package.json'), '{"version":"26.15.7"}\n')
  writeFileSync(join(electronBuilderRoot, 'cli.js'), '')
  writeFileSync(join(appBuilderLibRoot, 'package.json'), '{"version":"26.15.7"}\n')
  writeFileSync(
    join(appBuilderLibRoot, 'templates', 'nsis', 'include', 'extractAppPackage.nsh'),
    '# favors install speed over atomic replacement\n',
  )
  writeFileSync(appBuilderPatch, 'fixture patch\n')
  const calls: Call[] = []
  let tokenIndex = 0
  const options: WindowsNsisAbBuildOptions = {
    platform: 'win32',
    arch: 'x64',
    nodeVersion: '24.1.0',
    env: { PATH: 'safe', WIN_CSC_LINK: 'secret' },
    workspaceRoot,
    desktopRoot,
    outputRoot,
    builderCli: 'C:\\repo\\electron-builder.js',
    electronBuilderRoot,
    appBuilderLibRoot,
    appBuilderPatch,
    commandShell: 'C:\\Windows\\System32\\cmd.exe',
    gitExecutable: 'git.exe',
    nodeExecutable: 'C:\\Program Files\\node.exe',
    skipCheck: false,
    skipCheckSource: 'none',
    now: () => new Date('2026-09-05T00:00:00.000Z'),
    randomToken: () => (++tokenIndex).toString(16).padStart(32, '0'),
    run: (command, args, cwd, env) => {
      calls.push({ command, args: [...args], cwd, env: { ...env } })
      if (command === 'git.exe') {
        const isolatedRoot = args[1] as string
        writeFileSync(
          join(isolatedRoot, 'templates', 'nsis', 'include', 'extractAppPackage.nsh'),
          '!macro extractUsing7za FILE\n  CreateDirectory "$PLUGINSDIR\\7z-out"\n'
            + '  CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR\n!macroend\n',
        )
        return
      }
      const outputArg = args.find(value => value.startsWith('--config.directories.output='))
        ?? args.at(-1)?.split(' ').find(value => value.startsWith('--config.directories.output='))
      if (outputArg === undefined) return
      const output = outputArg.slice('--config.directories.output='.length).replace(/^"|"$/gu, '')
      if (args.includes('--dir')) {
        const app = join(output, 'win-unpacked')
        mkdirSync(join(app, 'resources', 'app.asar.unpacked', 'native'), { recursive: true })
        writeFileSync(join(app, 'DSH Desktop.exe'), pe())
        writeFileSync(join(app, 'resources', 'app.asar'), 'one archive')
        writeFileSync(join(app, 'resources', 'app.asar.unpacked', 'native', 'addon.node'), 'native')
        return
      }
      mkdirSync(output, { recursive: true })
      writeFileSync(join(output, 'DSH-Desktop-9.8.7-x64-Setup.exe'), pe())
      const prepackaged = args.find(value => value.startsWith('--prepackaged='))?.slice('--prepackaged='.length)
        ?? /--prepackaged=(?:"([^"]+)"|([^ ]+))/u.exec(args.at(-1) ?? '')?.slice(1).find(Boolean)
      if (prepackaged !== undefined) {
        const elevate = join(prepackaged, 'resources', 'elevate.exe')
        if (!mutateStaged || args[0] === options.builderCli) {
          writeFileSync(elevate, 'same input for both installers')
        }
      }
      if (mutateStaged && prepackaged !== undefined && args[0] !== options.builderCli) {
        writeFileSync(join(prepackaged, 'resources', 'mutation.txt'), 'bad')
      }
      if (env[NSIS_AB_HOOK_TOKEN_ENV] !== undefined) {
        verifyNsisAbPrepackagedBuild(
          { outDir: output },
          { desktopRoot, env },
        )
      }
    },
    log: () => {},
  }
  return { options, calls }
}

describe('Windows NSIS A/B packaging', () => {
  it('uses one prepackaged tree for the patched and official builder variants', () => {
    const { options, calls } = fixture()
    const manifest = buildWindowsNsisAb(options)

    expect(calls).toHaveLength(5)
    expect(calls[1]?.args).toContain('--dir')
    expect(calls[2]?.args).toContain(`--prepackaged=${join(options.outputRoot, 'prepackaged', 'win-unpacked')}`)
    expect(calls[2]?.args).toContain(
      '--config.afterAllArtifactBuild=./scripts/verify-nsis-ab-prepackaged.ts',
    )
    expect(calls[3]?.args).toContain('--reverse')
    expect(calls[3]?.args).toContain('--unsafe-paths')
    expect(calls[3]?.args).toContain('--directory=.')
    expect(calls[3]?.args).toContain('--include=templates/nsis/include/extractAppPackage.nsh')
    expect(calls[3]?.env.GIT_CEILING_DIRECTORIES)
      .toBe(join(options.outputRoot, '.staged-builder', 'node_modules'))
    expect(calls[4]?.args).toContain(`--prepackaged=${join(options.outputRoot, 'prepackaged', 'win-unpacked')}`)
    expect(calls[4]?.args).toContain(
      '--config.afterAllArtifactBuild=./scripts/verify-nsis-ab-prepackaged.ts',
    )
    expect(calls[2]?.env[NSIS_AB_HOOK_TOKEN_ENV]).toMatch(/^[0-9a-f]{32}$/u)
    expect(calls[4]?.env[NSIS_AB_HOOK_TOKEN_ENV]).toMatch(/^[0-9a-f]{32}$/u)
    expect(calls[2]?.env[NSIS_AB_HOOK_TOKEN_ENV]).not.toBe(calls[4]?.env[NSIS_AB_HOOK_TOKEN_ENV])
    expect(manifest.variants.direct.extraction).toBe('patched-direct-extract')
    expect(manifest.variants.staged.extraction).toBe('electron-builder-default-staged-copy')
    expect(manifest.variants.staged.builder).toBe('isolated-single-hunk-reversal')
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.provenance).toEqual({
      gateRan: true,
      skipCheck: { requested: false, source: 'none' },
      signing: {
        state: 'unsigned',
        signExecutable: false,
        cscIdentityAutoDiscovery: false,
        signingSecretsRemoved: true,
      },
    })
    expect(manifest.application.resources.files.map(entry => entry.path)).toContain('elevate.exe')
    for (const call of calls.filter(call => call.command === options.nodeExecutable)) {
      expect(call.env.WIN_CSC_LINK).toBeUndefined()
      expect(call.env.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
    }

    const stored = readWindowsNsisAbManifest(join(options.outputRoot, 'nsis-ab-manifest.json'))
    expect(stored).toEqual(manifest)
  })

  it('records why a package gate was skipped', () => {
    const { options, calls } = fixture()
    const manifest = buildWindowsNsisAb({
      ...options,
      skipCheck: true,
      skipCheckSource: '--skip-check',
    })

    expect(calls).toHaveLength(4)
    expect(manifest.provenance.gateRan).toBe(false)
    expect(manifest.provenance.skipCheck).toEqual({
      requested: true,
      source: '--skip-check',
    })
    expect(() => buildWindowsNsisAb({
      ...options,
      outputRoot: join(options.desktopRoot, 'dist', 'nsis-ab', 'inconsistent'),
      skipCheck: true,
      skipCheckSource: 'none',
    })).toThrow('provenance are inconsistent')
  })

  it('fails when the installer-only builder does not consume its one-time hook authorization', () => {
    const { options } = fixture()
    const run = options.run
    expect(() => buildWindowsNsisAb({
      ...options,
      run: (command, args, cwd, env) => run(command, args, cwd, {
        ...env,
        [NSIS_AB_HOOK_TOKEN_ENV]: undefined,
      }),
    })).toThrow('did not consume its one-time afterAll authorization')
  })

  it('rejects manifest signing or gate provenance that does not describe the build', () => {
    const { options } = fixture()
    const manifest = buildWindowsNsisAb(options)
    const manifestPath = join(options.outputRoot, 'nsis-ab-manifest.json')
    const invalid = {
      ...manifest,
      provenance: {
        ...manifest.provenance,
        signing: { ...manifest.provenance.signing, state: 'signed' },
      },
    }
    writeFileSync(manifestPath, `${JSON.stringify(invalid)}\n`)
    expect(() => readWindowsNsisAbManifest(manifestPath)).toThrow('credential-free unsigned build')

    writeFileSync(manifestPath, `${JSON.stringify({
      ...manifest,
      provenance: {
        ...manifest.provenance,
        gateRan: false,
      },
    })}\n`)
    expect(() => readWindowsNsisAbManifest(manifestPath)).toThrow('state are inconsistent')
  })

  it('really reverses only the extract template from below the outer worktree', () => {
    const packageRoot = fileURLToPath(new URL('../', import.meta.url))
    const outputRoot = join(packageRoot, 'dist')
    mkdirSync(outputRoot, { recursive: true })
    const isolatedRoot = mkdtempSync(join(outputRoot, 'nsis-ab-apply-'))
    roots.push(isolatedRoot)
    const template = join(isolatedRoot, 'templates', 'nsis', 'include', 'extractAppPackage.nsh')
    mkdirSync(join(isolatedRoot, 'templates', 'nsis', 'include'), { recursive: true })
    writeFileSync(template, readFileSync(require.resolve(
      'app-builder-lib/templates/nsis/include/extractAppPackage.nsh',
    )))

    execFileSync('git', [
      '-C',
      isolatedRoot,
      'apply',
      '--reverse',
      '--unsafe-paths',
      '--directory=.',
      '--include=templates/nsis/include/extractAppPackage.nsh',
      fileURLToPath(new URL('../../patches/app-builder-lib@26.15.7.patch', import.meta.url)),
    ], {
      env: {
        ...process.env,
        GIT_CEILING_DIRECTORIES: outputRoot,
      },
    })

    const restored = readFileSync(template, 'utf8')
    expect(restored).toContain('CreateDirectory "$PLUGINSDIR\\7z-out"')
    expect(restored).toContain('CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR')
    expect(restored).not.toContain('favors install speed over atomic replacement')
  })

  it('rejects a staged build that mutates the common application input', () => {
    const { options } = fixture(true)
    expect(() => buildWindowsNsisAb(options)).toThrow('mutated the shared prepackaged application')
  })

  it('rejects an isolated CLI that resolves app-builder-lib from an outer workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-builder-resolution-'))
    roots.push(root)
    const electronBuilder = join(root, 'node_modules', 'electron-builder')
    const outerAppBuilder = join(root, 'node_modules', 'app-builder-lib')
    const expectedAppBuilder = join(root, 'isolated', 'app-builder-lib')
    mkdirSync(electronBuilder, { recursive: true })
    mkdirSync(outerAppBuilder, { recursive: true })
    mkdirSync(expectedAppBuilder, { recursive: true })
    writeFileSync(join(electronBuilder, 'cli.js'), '')
    writeFileSync(join(outerAppBuilder, 'package.json'), '{"name":"app-builder-lib"}\n')

    expect(() => assertIsolatedAppBuilderLibResolution(
      join(electronBuilder, 'cli.js'),
      expectedAppBuilder,
      process.platform,
    )).toThrow('outside its copy')
  })

  it('hashes directory contents independent of creation order', () => {
    const first = mkdtempSync(join(tmpdir(), 'dsh-tree-a-'))
    const second = mkdtempSync(join(tmpdir(), 'dsh-tree-b-'))
    roots.push(first, second)
    writeFileSync(join(first, 'b'), 'two')
    writeFileSync(join(first, 'a'), 'one')
    writeFileSync(join(second, 'a'), 'one')
    writeFileSync(join(second, 'b'), 'two')
    expect(identifyWindowsNsisAbTree(first).treeSha256)
      .toBe(identifyWindowsNsisAbTree(second).treeSha256)
  })

  it('excludes only exact normalized tree paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tree-ignore-'))
    roots.push(root)
    mkdirSync(join(root, 'nested'), { recursive: true })
    writeFileSync(join(root, 'keep.txt'), 'keep')
    writeFileSync(join(root, 'sentinel.txt'), 'old')
    writeFileSync(join(root, 'nested', 'sentinel.txt'), 'nested')

    const identity = identifyWindowsNsisAbTree(root, ['sentinel.txt'])
    expect(identity.files.map(file => file.path)).toEqual([
      'keep.txt',
      'nested/sentinel.txt',
    ])
    expect(identifyWindowsNsisAbTree(root, ['*.txt']).fileCount).toBe(3)
    expect(normalizeWindowsNsisAbRelativePath('nested\\sentinel.txt'))
      .toBe('nested/sentinel.txt')
    for (const invalid of ['', '../sentinel', 'nested//sentinel', 'C:\\sentinel']) {
      expect(() => normalizeWindowsNsisAbRelativePath(invalid)).toThrow()
    }
  })

  it('keeps resolved paths inside the manifest directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-manifest-path-'))
    roots.push(root)
    const manifest = join(root, 'manifest.json')
    writeFileSync(manifest, '{}')
    expect(resolveWindowsNsisAbPath(manifest, 'direct/setup.exe')).toBe(join(root, 'direct', 'setup.exe'))
    expect(() => resolveWindowsNsisAbPath(manifest, '../setup.exe')).toThrow('escapes')
  })

  it('limits the prepackaged afterAll bypass to installer-only NSIS A/B outputs', () => {
    const packageRoot = mkdtempSync(join(tmpdir(), 'dsh-nsis-hook-'))
    roots.push(packageRoot)
    const direct = join(packageRoot, 'dist', 'nsis-ab', 'candidate', 'direct')
    const prepackaged = join(packageRoot, 'dist', 'nsis-ab', 'candidate', 'prepackaged', 'win-unpacked')
    mkdirSync(join(prepackaged, 'resources'), { recursive: true })
    writeFileSync(join(prepackaged, 'resources', 'app.asar'), 'archive')
    mkdirSync(direct, { recursive: true })
    const authorize = (token: string) => writeFileSync(
      join(direct, NSIS_AB_HOOK_AUTHORIZATION_FILE),
      `${JSON.stringify({ schemaVersion: 1, token, variant: 'direct', prepackaged })}\n`,
    )
    const token = '1'.repeat(32)
    authorize(token)
    expect(verifyNsisAbPrepackagedBuild(
      { outDir: direct },
      { desktopRoot: packageRoot, env: { [NSIS_AB_HOOK_TOKEN_ENV]: token } },
    )).toEqual([])
    expect(existsSync(join(direct, NSIS_AB_HOOK_AUTHORIZATION_FILE))).toBe(false)
    expect(() => verifyNsisAbPrepackagedBuild(
      { outDir: direct },
      { desktopRoot: packageRoot, env: { [NSIS_AB_HOOK_TOKEN_ENV]: token } },
    )).toThrow('authorization is missing')

    const regular = join(packageRoot, 'dist', 'release')
    mkdirSync(regular, { recursive: true })
    expect(() => verifyNsisAbPrepackagedBuild(
      { outDir: regular },
      { desktopRoot: packageRoot, env: { [NSIS_AB_HOOK_TOKEN_ENV]: token } },
    )).toThrow(
      'outside an NSIS A/B artifact build',
    )

    const spoofRoot = mkdtempSync(join(tmpdir(), 'dsh-nsis-hook-spoof-'))
    roots.push(spoofRoot)
    const spoofOutput = join(spoofRoot, 'nsis-ab', 'candidate', 'direct')
    const spoofPrepackaged = join(spoofRoot, 'nsis-ab', 'candidate', 'prepackaged', 'win-unpacked')
    mkdirSync(join(spoofPrepackaged, 'resources'), { recursive: true })
    mkdirSync(spoofOutput, { recursive: true })
    writeFileSync(join(spoofPrepackaged, 'resources', 'app.asar'), 'archive')
    writeFileSync(
      join(spoofOutput, NSIS_AB_HOOK_AUTHORIZATION_FILE),
      `${JSON.stringify({
        schemaVersion: 1,
        token,
        variant: 'direct',
        prepackaged: spoofPrepackaged,
      })}\n`,
    )
    expect(() => verifyNsisAbPrepackagedBuild(
      { outDir: spoofOutput },
      { desktopRoot: packageRoot, env: { [NSIS_AB_HOOK_TOKEN_ENV]: token } },
    )).toThrow('outside an NSIS A/B artifact build')

    mkdirSync(join(direct, 'win-unpacked'))
    authorize(token)
    expect(() => verifyNsisAbPrepackagedBuild(
      { outDir: direct },
      { desktopRoot: packageRoot, env: { [NSIS_AB_HOOK_TOKEN_ENV]: token } },
    )).toThrow(
      'unexpectedly contains unpacked applications',
    )
  })

  it('does not write a manifest when the host is unsupported', () => {
    const { options } = fixture()
    expect(() => buildWindowsNsisAb({ ...options, platform: 'darwin' })).toThrow('native Windows host')
    expect(() => readFileSync(join(options.outputRoot, 'nsis-ab-manifest.json'))).toThrow()
  })

  it('inspects a readable ASAR and its physical resources', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-installed-app-'))
    roots.push(root)
    const source = join(root, 'asar-source')
    const installRoot = join(root, 'installed')
    const resources = join(installRoot, 'resources')
    mkdirSync(join(source, 'lib'), { recursive: true })
    mkdirSync(join(resources, 'app.asar.unpacked'), { recursive: true })
    writeFileSync(join(source, 'package.json'), '{"name":"dsh-plugin-desktop"}\n')
    writeFileSync(join(source, 'lib', 'main.js'), 'export {}\n')
    writeFileSync(join(installRoot, 'DSH Desktop.exe'), pe())
    writeFileSync(join(resources, 'app.asar.unpacked', 'native.node'), 'native')
    // The library-level createPackage() promise resolves when it calls
    // WriteStream.end(), not when the file's finish event fires. A short-lived
    // CLI child exits only after the archive descriptor is fully flushed,
    // keeping this fixture deterministic under the full parallel test suite.
    execFileSync(process.execPath, [asarCli, 'pack', source, join(resources, 'app.asar')])

    const baselineApplication = identifyWindowsNsisAbTree(installRoot)
    const baselineResources = identifyWindowsNsisAbTree(resources)
    const baselineUnpacked = identifyWindowsNsisAbTree(join(resources, 'app.asar.unpacked'))
    const baselineAppAsar = baselineResources.files.find(file => file.path === 'app.asar')?.sha256
    const sentinel = '.dsh-nsis-ab-old-sentinel-test'
    writeFileSync(join(installRoot, 'Uninstall DSH Desktop.exe'), pe())
    writeFileSync(join(resources, 'app.asar.unpacked', sentinel), 'old')

    const inspection = inspectInstalledWindowsApp(installRoot, [
      'Uninstall DSH Desktop.exe',
      `resources\\app.asar.unpacked\\${sentinel}`,
    ])
    expect(inspection.valid, inspection.errors.join('\n')).toBe(true)
    expect(inspection.appAsar).toMatchObject({ packageName: 'dsh-plugin-desktop' })
    expect(inspection.appAsar?.sha256).toBe(baselineAppAsar)
    expect(inspection.application).toEqual(baselineApplication)
    expect(inspection.resources).toEqual(baselineResources)
    expect(inspection.unpacked).toEqual(baselineUnpacked)
    expect(inspection.resources?.fileCount).toBe(2)
    expect(inspection.unpacked?.fileCount).toBe(1)
  })

  it('parses repeated exact application-relative inspector exclusions', () => {
    expect(parseInstalledWindowsAppArguments([
      '--ignore-relative-path',
      'Uninstall DSH Desktop.exe',
      '--install-root',
      'C:\\DSH',
      '--ignore-relative-path',
      'resources\\app.asar.unpacked\\sentinel',
    ])).toEqual({
      installRoot: 'C:\\DSH',
      ignoreRelativePaths: [
        'Uninstall DSH Desktop.exe',
        'resources/app.asar.unpacked/sentinel',
      ],
    })
    expect(() => parseInstalledWindowsAppArguments([
      '--install-root',
      'C:\\DSH',
      '--ignore-relative-path',
      '../payload',
    ])).toThrow('normalized')
  })

  it('reports a corrupt app.asar without throwing away the resource identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-corrupt-app-'))
    roots.push(root)
    const resources = join(root, 'resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(root, 'DSH Desktop.exe'), pe())
    writeFileSync(join(resources, 'app.asar'), 'not an asar')

    const inspection = inspectInstalledWindowsApp(root)
    expect(inspection.valid).toBe(false)
    expect(inspection.errors.join('\n')).toContain('app.asar is unreadable')
    expect(inspection.application?.fileCount).toBe(2)
    expect(inspection.resources?.fileCount).toBe(1)
  })

  it('runs the shared packaged-runtime smoke with an Electron Builder-shaped context', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-installed-runtime-'))
    roots.push(root)
    writeFileSync(join(root, 'DSH Desktop.exe'), pe())
    const contexts: Parameters<PackagedElectronSmoke>[0][] = []

    const result = probeInstalledWindowsRuntime(root, context => contexts.push(context), 'win32')

    expect(result).toMatchObject({ success: true, error: null })
    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({
      appOutDir: root,
      electronPlatformName: 'win32',
      arch: 1,
      packager: {
        executableName: 'DSH Desktop',
        appInfo: { productFilename: 'DSH Desktop' },
      },
    })
    expect(contexts[0]).not.toHaveProperty('executableName')

    const unsupported = probeInstalledWindowsRuntime(root, () => {
      throw new Error('smoke must not run on a non-Windows host')
    }, 'darwin')
    expect(unsupported.success).toBe(false)
    expect(unsupported.error).toContain('requires a native Windows host')
  })

  it('keeps benchmark timing, stale-file, interruption, lock, ASAR, and startup evidence together', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'run-windows-nsis-ab.ps1'), 'utf8')
    expect(script).toContain('schemaVersion = 2')
    expect(script).toContain("@('fresh-install', 'upgrade')")
    expect(script).toContain("[ValidateSet('WarmBatch', 'ColdSnapshot')]")
    expect(script).toContain("'PrepareColdSnapshot'")
    expect(script).toContain('ColdSnapshotStatePath')
    expect(script).toContain('InstallerHashVerifiedInThisRun')
    expect(script).toContain('canonicalBaseVariant')
    expect(script).toContain("$taskManifest.Value.application.tree.treeSha256")
    expect(script).toContain("@('--ignore-relative-path', $taskIgnoredPath)")
    expect(script).toContain('.dsh-nsis-ab-old-sentinel-')
    expect(script).toContain('oldUnpackedFileCount')
    expect(script).toContain('oldResidualSentinelPresent')
    expect(script).toContain("@('interrupted-upgrade', 'locked-app-asar')")
    expect(script).toContain('[System.IO.FileShare]::None')
    expect(script).toContain('injectionConfirmed')
    expect(script).toContain('$taskObservedProcessIds -contains $taskProcessId')
    expect(script).toContain('Stop-TaskTrackedInstallerProcesses')
    expect(script).toContain('Confirm-TaskInstallTreeStable')
    expect(script).toContain('quietWindowMs')
    expect(script).toContain('installTreeStability')
    expect(script).toContain('globalInstallEntriesRemaining')
    expect(script).toContain("'ineligible-cold-snapshot-observation'")
    expect(script).toContain('$taskSuccess')
    expect(script).toContain('Invoke-TaskInspection')
    expect(script).toContain('Invoke-TaskStartupProbe')
    expect(script).toContain('probe-windows-packaged-runtime.ts')
    expect(script).not.toContain('probe-windows-installer-quit.ps1')
    expect(script).not.toContain('Add-MpPreference')
  })

  it.runIf(process.platform === 'win32')('parses in Windows PowerShell before requiring manifests', () => {
    const script = join(process.cwd(), 'scripts', 'run-windows-nsis-ab.ps1')
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
    ], { encoding: 'utf8' })
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      '-BaseManifest and -CandidateManifest are required on Windows.',
    )
  })
})
