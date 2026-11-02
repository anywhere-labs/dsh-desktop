/** Build the official Computer Use helpers for the Desktop packages that ship the official bundle, and only for them. */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { cuaNativeEntries, prepareCuaNative, type RunXcrun } from '../../scripts/upstream-family/cua-native.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const BUNDLE = '@deepseek-ai/dsh-cua-bundle'
const PROVIDER = '@deepseek-ai/dsh-experimental-cua-macos'

/** A Desktop package root, with the official bundle as a dependency and its provider installed unless omitted. */
function desktop(options: { bundle?: boolean; provider?: boolean } = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-cua-native-')))
  roots.push(root)
  const bundle = options.bundle ?? true
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-desktop-beta', dependencies: bundle ? { [BUNDLE]: '0.2.2-alpha.2' } : {} }))
  for (const [name, installed] of [[BUNDLE, bundle], [PROVIDER, bundle && (options.provider ?? true)]] as const) {
    if (!installed) continue
    mkdirSync(join(root, 'node_modules', name), { recursive: true })
    writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name }))
  }
  return root
}

/** Stands in for SwiftPM: records each build and leaves the product where `--scratch-path` puts it. */
function swift(product: (arch: string) => string) {
  return vi.fn<RunXcrun>((args) => {
    const scratch = args[args.indexOf('--scratch-path') + 1]!
    mkdirSync(join(scratch, 'release'), { recursive: true })
    writeFileSync(join(scratch, 'release', 'dsh-cua-native'), product(args.at(-1)!))
  })
}

it('builds each CPU helper into the provider package with the arguments the provider uses itself', () => {
  const root = desktop()
  const run = swift(arch => `helper ${arch}`)
  const provider = join(root, 'node_modules', PROVIDER)
  const helpers = prepareCuaNative(root, ['arm64', 'x64'], run)
  expect(helpers).toEqual([join(provider, 'native', 'bin', 'darwin-arm64', 'dsh-cua-native'), join(provider, 'native', 'bin', 'darwin-x64', 'dsh-cua-native')])
  expect(run.mock.calls.map(([args]) => args)).toEqual(['arm64', 'x64'].map(arch => ['swift', 'build',
    '--package-path', join(provider, 'native'), '--scratch-path', join(root, '.desktop-build', 'cua-native', arch),
    '--configuration', 'release', '--product', 'dsh-cua-native', '--arch', arch === 'x64' ? 'x86_64' : 'arm64']))
  expect(readFileSync(helpers[0]!, 'utf8')).toBe('helper arm64')
  expect(readFileSync(helpers[1]!, 'utf8')).toBe('helper x86_64')
  for (const helper of helpers) expect(statSync(helper).mode & 0o777).toBe(0o755)
  expect(cuaNativeEntries(root)).toEqual([
    { arch: 'arm64', path: `node_modules/${PROVIDER}/native/bin/darwin-arm64/dsh-cua-native` },
    { arch: 'x86_64', path: `node_modules/${PROVIDER}/native/bin/darwin-x64/dsh-cua-native` },
  ])
})

it('rebuilds a helper Desktop wrote when its sources change, keeping its record outside the package', () => {
  const root = desktop()
  let bytes = 'first'
  const run = swift(() => bytes)
  const [helper] = prepareCuaNative(root, ['arm64'], run)
  const first = statSync(helper!).ino
  prepareCuaNative(root, ['arm64'], run)
  expect(run).toHaveBeenCalledTimes(2)
  expect(statSync(helper!).ino).toBe(first)
  bytes = 'second'
  prepareCuaNative(root, ['arm64'], run)
  expect(run).toHaveBeenCalledTimes(3)
  expect(readFileSync(helper!, 'utf8')).toBe('second')
  expect(statSync(helper!).ino).not.toBe(first)
  // The package directory holds the helper alone; the record of what Desktop wrote stays in the build directory.
  expect(readdirSync(dirname(helper!))).toEqual(['dsh-cua-native'])
  expect(readFileSync(join(root, '.desktop-build', 'cua-native', 'arm64', 'written-helper.sha256'), 'utf8'))
    .toBe(createHash('sha256').update('second').digest('hex'))
})

it('uses the helper the official release ships without compiling or rewriting it', () => {
  const root = desktop()
  const run = swift(arch => `desktop ${arch}`)
  const official = join(root, 'node_modules', PROVIDER, 'native', 'bin', 'darwin-arm64', 'dsh-cua-native')
  mkdirSync(dirname(official), { recursive: true })
  writeFileSync(official, 'official arm64', { mode: 0o644 })
  expect(prepareCuaNative(root, ['arm64'], run)).toEqual([official])
  expect(run).not.toHaveBeenCalled()
  expect(readFileSync(official, 'utf8')).toBe('official arm64')
  expect(statSync(official).mode & 0o777).toBe(0o755)
  // A release that starts shipping the helper replaces the one Desktop recorded; the record no longer matches it.
  const [built] = prepareCuaNative(root, ['x64'], run)
  writeFileSync(built!, 'official x64')
  prepareCuaNative(root, ['x64'], run)
  expect(run).toHaveBeenCalledTimes(1)
  expect(readFileSync(built!, 'utf8')).toBe('official x64')
})

it('builds nothing for a package that does not ship the official bundle', () => {
  const root = desktop({ bundle: false })
  const run = swift(() => 'unused')
  expect(prepareCuaNative(root, ['arm64', 'x64'], run)).toEqual([])
  expect(run).not.toHaveBeenCalled()
  expect(cuaNativeEntries(root)).toEqual([])
})

it('fails when the package ships the bundle but its macOS provider is not installed', () => {
  const root = desktop({ provider: false })
  const run = swift(() => 'unused')
  expect(() => prepareCuaNative(root, ['arm64'], run)).toThrow(PROVIDER)
  expect(run).not.toHaveBeenCalled()
})
