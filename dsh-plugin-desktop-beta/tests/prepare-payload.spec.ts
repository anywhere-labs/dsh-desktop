import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import beforeBuild from '../scripts/before-build.ts'
import { nextPackagingTarget, PAYLOAD_DIR, verifyNextPayload } from '../scripts/packaged-payload.ts'
import { collectProductionClosure, preparePayload, publishedEntries } from '../scripts/prepare-payload.ts'
import { DESKTOP_RUNTIME_FILE, physicalPayload, readDesktopRuntime, verifyPayload } from '../src/runtime-tree.ts'
import { completeApplication, FIXTURE_RELEASE, writeApplication, writePackage } from './runtime-fixture.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const unix = process.platform !== 'win32'
const target = nextPackagingTarget(process.platform, process.arch)

/**
 * A development checkout: the application with its build output and development files, the
 * installed tree with nested conflicts and leftovers, and a linked workspace package that Yarn
 * gave its own installed tree.
 */
function workspace(): { root: string; desktop: string; market: string } {
  const root = mkdtempSync(join(tmpdir(), 'desktop-prepare-'))
  roots.push(root)
  const desktop = join(root, 'dsh-plugin-desktop-beta')
  writeApplication(desktop)
  completeApplication(desktop)
  const modules = join(desktop, 'node_modules')
  for (const path of ['src/main.ts', 'tests/main.spec.ts', 'README.md', '.desktop-next/home/desktop-next.json', 'build/app-icon.icns',
    'lib/main.js.map', 'lib/main.d.ts', 'assets/.DS_Store']) {
    mkdirSync(join(desktop, path, '..'), { recursive: true })
    writeFileSync(join(desktop, path), `dev:${path}\n`)
  }
  const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as Record<string, unknown> & { dependencies: Record<string, string> }
  Object.assign(manifest, { scripts: { build: 'tsdown' }, devDependencies: { 'dev-only': '*' }, build: { asar: true },
    optionalDependencies: { 'missing-optional': '*' } })
  Object.assign(manifest.dependencies, { 'nested-user': '*', 'peer-user': '*', 'dsh-community-market': 'workspace:*', conflict: '*' })
  writeFileSync(join(desktop, 'package.json'), JSON.stringify(manifest) + '\n')
  writePackage(modules, 'dev-only')
  writePackage(modules, 'conflict', { version: '1.0.0' }, 'export const version = 1\n')
  const nestedUser = writePackage(modules, 'nested-user', { dependencies: { conflict: '2.0.0' },
    _resolved: 'https://registry.example/nested-user.tgz', bugs: { url: 'https://issues.example' }, scripts: { postinstall: 'node -e 0' } })
  writePackage(join(nestedUser, 'node_modules'), 'conflict', { version: '2.0.0' }, 'export const version = 2\n')
  writePackage(modules, 'peer-user', { peerDependencies: { '@deepseek-ai/dsh-base': '*', 'absent-peer': '*' }, peerDependenciesMeta: { 'absent-peer': { optional: true } } })
  writeFileSync(join(modules, '@deepseek-ai', 'dsh', 'index.js.map'), '{}')
  writeFileSync(join(modules, '@deepseek-ai', 'dsh', 'index.d.ts'), 'export {}\n')
  writeFileSync(join(modules, '.yarn-state.yml'), 'version: 1\n')
  writeFileSync(join(modules, 'conflict', '.DS_Store'), '')
  const market = join(root, 'dsh-community-market')
  for (const directory of ['lib', 'src', 'tests']) mkdirSync(join(market, directory), { recursive: true })
  writeFileSync(join(market, 'package.json'), JSON.stringify({ name: 'dsh-community-market', version: '0.3.0', type: 'module', main: 'lib/index.js',
    files: ['lib/**', 'cordis.patch.yml', 'docs/**'], dependencies: { '@deepseek-ai/dsh-base': '*', 'only-here': '*', conflict: '2.0.0' },
    devDependencies: { vitest: '*' } }) + '\n')
  writeFileSync(join(market, 'lib', 'index.js'), 'export {}\n')
  writeFileSync(join(market, 'lib', 'index.d.ts'), 'export {}\n')
  writeFileSync(join(market, 'src', 'index.ts'), 'export {}\n')
  writeFileSync(join(market, 'tests', 'index.spec.ts'), 'export {}\n')
  writeFileSync(join(market, 'README.md'), '# market\n')
  writeFileSync(join(market, 'LICENSE'), 'MIT\n')
  writeFileSync(join(market, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(market, 'tsconfig.json'), '{}\n')
  const marketModules = join(market, 'node_modules')
  writePackage(marketModules, '@deepseek-ai/dsh-base', {}, 'export const copy = "market"\n')
  writePackage(marketModules, 'only-here', { version: '3.1.0' })
  writePackage(marketModules, 'conflict', { version: '2.0.0' }, 'export const version = 2\n')
  symlinkSync(market, join(modules, 'dsh-community-market'), 'junction')
  return { root, desktop, market }
}

it('places the production closure like an installer and copies one version once', () => {
  const { desktop, market } = workspace()
  const closure = collectProductionClosure(desktop)
  const placed = Object.fromEntries(closure.map(pkg => [pkg.destination, pkg]))
  expect(closure.map(pkg => pkg.destination)).toEqual(Object.keys(placed).sort())
  expect(placed.conflict).toMatchObject({ version: '1.0.0', workspace: false })
  expect(placed['nested-user/node_modules/conflict']).toMatchObject({ version: '2.0.0', workspace: false })
  expect(placed['dsh-community-market']).toMatchObject({ version: '0.3.0', workspace: true, source: realpathSync(market) })
  // The workspace copy of a package the root already holds at the same version is not copied again.
  expect(placed['@deepseek-ai/dsh-base']?.source).toBe(realpathSync(join(desktop, 'node_modules', '@deepseek-ai', 'dsh-base')))
  expect(placed['dsh-community-market/node_modules/@deepseek-ai/dsh-base']).toBeUndefined()
  // A dependency only the workspace tree holds is hoisted; another version of a root package nests under its dependent.
  expect(placed['only-here']).toMatchObject({ version: '3.1.0', source: realpathSync(join(market, 'node_modules', 'only-here')) })
  expect(placed['dsh-community-market/node_modules/conflict']).toMatchObject({ version: '2.0.0', source: realpathSync(join(market, 'node_modules', 'conflict')) })
  expect(closure.map(pkg => pkg.name)).not.toContain('dev-only')
  expect(closure.map(pkg => pkg.name)).not.toContain('missing-optional')
  expect(closure.map(pkg => pkg.name)).not.toContain('absent-peer')
  expect(closure.map(pkg => pkg.name)).toContain('peer-user')
})

it('materializes, cleans and seals the payload the archive is later checked against', async () => {
  const { root, desktop } = workspace()
  const output = join(root, 'payload')
  const log: string[] = []
  const descriptor = await preparePayload({ desktopRoot: desktop, output, target, electronVersion: '44.0.0',
    extraMetadata: { version: '2.0.1-beta.1' }, log: message => log.push(message) })
  expect(readdirSync(output).sort()).toEqual(['assets', 'build', 'cordis.patch.yml', DESKTOP_RUNTIME_FILE, 'host.cordis.patch.yml', 'lib', 'node_modules', 'package.json', 'scripts'])
  for (const absent of ['src', 'tests', 'README.md', '.desktop-next', 'build/app-icon.icns', 'lib/main.js.map', 'lib/main.d.ts', 'assets/.DS_Store',
    'node_modules/dev-only', 'node_modules/.yarn-state.yml', 'node_modules/conflict/.DS_Store',
    'node_modules/@deepseek-ai/dsh/index.js.map', 'node_modules/@deepseek-ai/dsh/index.d.ts',
    'node_modules/dsh-community-market/src', 'node_modules/dsh-community-market/tests', 'node_modules/dsh-community-market/tsconfig.json',
    'node_modules/dsh-community-market/lib/index.d.ts', 'node_modules/dsh-community-market/node_modules/@deepseek-ai',
    'node_modules/dsh-community-market/node_modules/only-here']) {
    expect(existsSync(join(output, ...absent.split('/'))), absent).toBe(false)
  }
  for (const present of ['lib/main.js', 'lib/native-ui/index.html', 'build/app-icon.png', 'scripts/node-bin/node', 'assets/tray-icon-blue.png',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html', 'node_modules/nested-user/node_modules/conflict/index.js',
    'node_modules/dsh-community-market/lib/index.js', 'node_modules/dsh-community-market/README.md', 'node_modules/dsh-community-market/LICENSE',
    'node_modules/dsh-community-market/cordis.patch.yml', 'node_modules/dsh-community-market/node_modules/conflict/index.js', 'node_modules/only-here/index.js']) {
    expect(existsSync(join(output, ...present.split('/'))), present).toBe(true)
  }
  expect(readFileSync(join(output, 'node_modules', 'conflict', 'index.js'), 'utf8')).toBe('export const version = 1\n')
  expect(readFileSync(join(output, 'node_modules', 'dsh-community-market', 'node_modules', 'conflict', 'index.js'), 'utf8')).toBe('export const version = 2\n')
  expect(readFileSync(join(output, 'node_modules', '@deepseek-ai', 'dsh-base', 'index.js'), 'utf8')).toBe('export const identity = {}\n')
  expect(lstatSync(join(output, 'node_modules', 'dsh-community-market')).isSymbolicLink()).toBe(false)
  if (unix) expect(lstatSync(join(output, 'scripts', 'node-bin', 'node')).mode & 0o111).not.toBe(0)
  // Manifests as electron-builder would transform them: the drill version applied, build-only fields gone.
  const main = JSON.parse(readFileSync(join(output, 'package.json'), 'utf8')) as Record<string, unknown>
  expect(main.version).toBe('2.0.1-beta.1')
  for (const field of ['scripts', 'devDependencies', 'build']) expect(main).not.toHaveProperty(field)
  expect(main).toHaveProperty('optionalDependencies')
  expect(JSON.parse(readFileSync(join(output, 'node_modules', 'nested-user', 'package.json'), 'utf8')))
    .toEqual({ name: 'nested-user', version: '1.0.0', type: 'module', exports: './index.js', dependencies: { conflict: '2.0.0' } })
  expect(JSON.parse(readFileSync(join(output, 'node_modules', 'dsh-community-market', 'package.json'), 'utf8'))).toHaveProperty('devDependencies')
  // The descriptor sits inside the tree, records every direct dependency and verifies against a fresh listing.
  expect(descriptor.release).toEqual({ ...FIXTURE_RELEASE, version: '2.0.1-beta.1' })
  expect(descriptor.platform).toBe(target.platform)
  expect(descriptor.sharedPackages.map(entry => entry.name)).toEqual(Object.keys(main.dependencies as object).sort())
  expect(readDesktopRuntime(join(output, DESKTOP_RUNTIME_FILE))).toEqual(descriptor)
  expect(verifyPayload(physicalPayload(output), descriptor, '2.0.1-beta.1', target)).toEqual(descriptor)
  expect(() => verifyNextPayload(physicalPayload(output))).not.toThrow()
  expect(log).toEqual([expect.stringMatching(/^Materialized \d+ packages for /u),
    ...(target.platform === 'win32' ? [expect.stringMatching(/^Discovered \d+ Windows PE files while hashing the payload$/u)] : []),
    expect.stringMatching(new RegExp(`^Sealed the prepared payload: \\d+ files; DSH Desktop Beta 2\\.0\\.1-beta\\.1, dsh 1\\.0\\.0, Electron 44\\.0\\.0, pnpm ${FIXTURE_RELEASE.pnpmVersion.replaceAll('.', '\\.')}$`, 'u'))])
  // Preparing again starts from an empty directory and, without a drill version, keeps the manifest version.
  writeFileSync(join(output, 'stale'), '')
  await preparePayload({ desktopRoot: desktop, output, target, electronVersion: '44.0.0' })
  expect(existsSync(join(output, 'stale'))).toBe(false)
  expect((JSON.parse(readFileSync(join(output, 'package.json'), 'utf8')) as { version: string }).version).toBe(FIXTURE_RELEASE.version)
})

it('stops on a missing required dependency and on publish patterns it cannot honour', () => {
  const { desktop, market } = workspace()
  expect(publishedEntries(market)).toEqual(['LICENSE', 'README.md', 'cordis.patch.yml', 'lib', 'package.json'])
  writeFileSync(join(market, 'package.json'), JSON.stringify({ name: 'dsh-community-market', version: '0.3.0', files: ['lib/*.js'] }))
  expect(() => publishedEntries(market)).toThrow(/unsupported files pattern "lib\/\*\.js" in dsh-community-market/u)
  rmSync(join(desktop, 'node_modules', 'peer-user'), { recursive: true })
  expect(() => collectProductionClosure(desktop)).toThrow(/dependency peer-user required by dsh-plugin-desktop-beta is not installed/u)
})

it('prunes only incompatible optional packages and their exclusive dependencies before copying and sealing', async () => {
  const { root, desktop } = workspace()
  const modules = join(desktop, 'node_modules')
  const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>; optionalDependencies: Record<string, string>
  }
  const natives = [
    ['windows-x64', 'win32', 'x64'], ['windows-arm64', 'win32', 'arm64'],
    ['darwin-x64', 'darwin', 'x64'], ['darwin-arm64', 'darwin', 'arm64'],
    ['linux-x64', 'linux', 'x64'], ['linux-arm64', 'linux', 'arm64'],
  ] as const
  for (const [name, os, cpu] of natives) {
    manifest.optionalDependencies[`@fixture/${name}`] = '*'
    writePackage(modules, `@fixture/${name}`, { os: [os], cpu: [cpu], dependencies: { [`${name}-helper`]: '*' } })
    writePackage(modules, `${name}-helper`)
  }
  // An optional declaration overrides the same dependency, as it does in an installed manifest.
  manifest.dependencies['@fixture/windows-arm64'] = '*'
  manifest.optionalDependencies['assets-arm64'] = '*'
  writePackage(modules, 'assets-arm64')
  manifest.optionalDependencies['neutral.d.ts'] = '*'
  writePackage(modules, 'neutral.d.ts')
  writeFileSync(join(desktop, 'package.json'), JSON.stringify(manifest))
  const nested = writePackage(join(modules, 'nested-user', 'node_modules'), '@fixture/nested-arm64', { os: ['win32'], cpu: ['arm64'] })
  const nestedManifest = join(modules, 'nested-user', 'package.json')
  const data = JSON.parse(readFileSync(nestedManifest, 'utf8')) as Record<string, unknown>
  writeFileSync(nestedManifest, JSON.stringify({ ...data, optionalDependencies: { '@fixture/nested-arm64': '*' } }))
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const release = nextPackagingTarget(platform, 'arm64')
    const names = collectProductionClosure(desktop, release).map(pkg => pkg.name)
    for (const [name, os, cpu] of natives) {
      const keep = os === platform && release.archs.includes(cpu)
      expect(names.includes(`@fixture/${name}`), `${platform}: ${name}`).toBe(keep)
      expect(names.includes(`${name}-helper`), `${platform}: ${name}-helper`).toBe(keep)
    }
    expect(names).toContain('assets-arm64')
    expect(names).toContain('neutral.d.ts')
    expect(names).not.toContain('@fixture/nested-arm64')
  }
  const output = join(root, 'payload')
  const release = nextPackagingTarget('win32')
  const descriptor = await preparePayload({ desktopRoot: desktop, output, target: release, electronVersion: '44.0.0' })
  expect(existsSync(join(output, 'node_modules', '@fixture', 'windows-x64', 'package.json'))).toBe(true)
  expect(existsSync(join(output, 'node_modules', '@fixture', 'windows-arm64'))).toBe(false)
  expect(existsSync(join(output, 'node_modules', 'nested-user', 'node_modules', '@fixture', 'nested-arm64'))).toBe(false)
  expect(descriptor.files.some(file => file.path.includes('@fixture/windows-arm64/'))).toBe(false)
  expect(() => verifyNextPayload(physicalPayload(output))).not.toThrow()
  // The development installation is untouched, and a required edge cannot silently disappear.
  expect(existsSync(join(nested, 'package.json'))).toBe(true)
  writePackage(modules, 'required-native-user', { peerDependencies: { '@fixture/windows-arm64': '*' } })
  manifest.dependencies['required-native-user'] = '*'
  writeFileSync(join(desktop, 'package.json'), JSON.stringify(manifest))
  expect(() => collectProductionClosure(desktop, release)).toThrow(/windows-arm64 required by required-native-user cannot be packaged/u)
})

it('declines electron-builder dependency handling once a matching payload is prepared', async () => {
  const { desktop } = workspace()
  const context = { appDir: desktop, electronVersion: '44.0.0', platform: { nodeName: process.platform }, arch: process.arch }
  await expect(beforeBuild(context)).rejects.toThrow(/no prepared payload at \.desktop-build\/payload/u)
  await preparePayload({ desktopRoot: desktop, output: join(desktop, ...PAYLOAD_DIR.split('/')), target, electronVersion: '44.0.0' })
  const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await expect(beforeBuild(context)).resolves.toBe(false)
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/^Packaging the prepared Next payload: \d+ files for /u))
    await expect(beforeBuild({ ...context, electronVersion: '45.0.0' })).rejects.toThrow(/declares Electron 44\.0\.0, but 45\.0\.0 is being packaged/u)
    await expect(beforeBuild({ ...context, platform: { nodeName: 'aix' } })).rejects.toThrow(/targets \w+, not aix/u)
  } finally { logged.mockRestore() }
})
