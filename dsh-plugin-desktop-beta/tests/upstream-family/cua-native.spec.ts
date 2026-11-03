/** Build the official Computer Use helper applications for the Desktop packages that ship the official bundle, and only for them. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { cuaNativeEntries, prepareCuaNative, type RunXcrun } from '../../scripts/upstream-family/cua-native.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const BUNDLE = '@deepseek-ai/dsh-cua-bundle'
const PROVIDER = '@deepseek-ai/dsh-experimental-cua-macos'
const EXECUTABLE = ['DSH Computer Use.app', 'Contents', 'MacOS', 'dsh-cua-native']

/** A Desktop package root, with the official bundle as a dependency and its provider installed unless omitted. */
function desktop(options: { bundle?: boolean; provider?: boolean } = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-cua-native-')))
  roots.push(root)
  const bundle = options.bundle ?? true
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-desktop-beta', dependencies: bundle ? { [BUNDLE]: '0.2.2-alpha.3' } : {} }))
  for (const [name, installed] of [[BUNDLE, bundle], [PROVIDER, bundle && (options.provider ?? true)]] as const) {
    if (!installed) continue
    mkdirSync(join(root, 'node_modules', name), { recursive: true })
    writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name }))
  }
  return root
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Publish an application generation and select it, as the provider's build script does. */
function publish(directory: string, executable: string): string {
  const generation = digest(executable)
  mkdirSync(join(directory, generation, ...EXECUTABLE.slice(0, -1)), { recursive: true })
  writeFileSync(join(directory, generation, ...EXECUTABLE), executable, { mode: 0o644 })
  writeFileSync(join(directory, 'current.json'), `${JSON.stringify({ bundle: generation })}\n`)
  return join(directory, generation, ...EXECUTABLE)
}

/** Stands in for `native/build_app.py`: records each build and publishes the application where `--output-directory` puts it. */
function buildApp(product: (arch: string) => string) {
  return vi.fn<RunXcrun>((args) => {
    publish(args[args.indexOf('--output-directory') + 1]!, product(args.at(-1)!))
  })
}

it('builds each CPU application into the provider package with the provider\'s own build script', () => {
  const root = desktop()
  const run = buildApp(arch => `helper ${arch}`)
  const provider = join(root, 'node_modules', PROVIDER)
  const helpers = prepareCuaNative(root, ['arm64', 'x64'], run)
  expect(helpers).toEqual([
    join(provider, 'native', 'bin', 'darwin-arm64', digest('helper arm64'), ...EXECUTABLE),
    join(provider, 'native', 'bin', 'darwin-x64', digest('helper x86_64'), ...EXECUTABLE),
  ])
  expect(run.mock.calls.map(([args]) => args)).toEqual(['arm64', 'x64'].map(arch => ['python3',
    join(provider, 'native', 'build_app.py'), '--scratch-path', join(root, '.desktop-build', 'cua-native', arch),
    '--output-directory', join(provider, 'native', 'bin', `darwin-${arch}`), '--arch', arch === 'x64' ? 'x86_64' : 'arm64']))
  for (const helper of helpers) expect(statSync(helper).mode & 0o777).toBe(0o755)
  expect(cuaNativeEntries(root)).toEqual([
    { arch: 'arm64', path: `node_modules/${PROVIDER}/native/bin/darwin-arm64/${digest('helper arm64')}/${EXECUTABLE.join('/')}` },
    { arch: 'x86_64', path: `node_modules/${PROVIDER}/native/bin/darwin-x64/${digest('helper x86_64')}/${EXECUTABLE.join('/')}` },
  ])
})

it('rebuilds an application Desktop selected when its sources change, keeping one generation and its record outside the package', () => {
  const root = desktop()
  let bytes = 'first'
  const run = buildApp(() => bytes)
  const directory = join(root, 'node_modules', PROVIDER, 'native', 'bin', 'darwin-arm64')
  const [first] = prepareCuaNative(root, ['arm64'], run)
  expect(prepareCuaNative(root, ['arm64'], run)).toEqual([first])
  expect(run).toHaveBeenCalledTimes(2)
  bytes = 'second'
  const [second] = prepareCuaNative(root, ['arm64'], run)
  expect(run).toHaveBeenCalledTimes(3)
  expect(readFileSync(second!, 'utf8')).toBe('second')
  expect(existsSync(first!)).toBe(false)
  // The package directory holds the receipt and the selected generation; the record of what Desktop selected stays in the build directory.
  expect(readdirSync(directory).sort()).toEqual([digest('second'), 'current.json'])
  expect(readFileSync(join(root, '.desktop-build', 'cua-native', 'arm64', 'written-application'), 'utf8')).toBe(digest('second'))
})

it('uses the application the official release ships without building or rewriting it', () => {
  const root = desktop()
  const run = buildApp(arch => `desktop ${arch}`)
  const official = publish(join(root, 'node_modules', PROVIDER, 'native', 'bin', 'darwin-arm64'), 'official arm64')
  expect(prepareCuaNative(root, ['arm64'], run)).toEqual([official])
  expect(run).not.toHaveBeenCalled()
  expect(readFileSync(official, 'utf8')).toBe('official arm64')
  expect(statSync(official).mode & 0o777).toBe(0o755)
  // A release that starts shipping the application replaces the receipt Desktop recorded, which no longer matches it.
  const [built] = prepareCuaNative(root, ['x64'], run)
  const shipped = publish(join(root, 'node_modules', PROVIDER, 'native', 'bin', 'darwin-x64'), 'official x64')
  expect(prepareCuaNative(root, ['x64'], run)).toEqual([shipped])
  expect(run).toHaveBeenCalledTimes(1)
  expect(readFileSync(built!, 'utf8')).toBe('desktop x86_64')
})

it('builds nothing for a package that does not ship the official bundle', () => {
  const root = desktop({ bundle: false })
  const run = buildApp(() => 'unused')
  expect(prepareCuaNative(root, ['arm64', 'x64'], run)).toEqual([])
  expect(run).not.toHaveBeenCalled()
  expect(cuaNativeEntries(root)).toEqual([])
})

it('fails when the package ships the bundle but its macOS provider is not installed', () => {
  const root = desktop({ provider: false })
  const run = buildApp(() => 'unused')
  expect(() => prepareCuaNative(root, ['arm64'], run)).toThrow(PROVIDER)
  expect(run).not.toHaveBeenCalled()
})

it('refuses an inventory for a CPU whose application was never prepared', () => {
  const root = desktop()
  prepareCuaNative(root, ['arm64'], buildApp(arch => `helper ${arch}`))
  expect(() => cuaNativeEntries(root)).toThrow('no x64 helper application')
})
