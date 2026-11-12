/** Build the official Computer Use helpers for the Desktop packages that ship the official bundle, and only for them. */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { prepareCuaNative, type RunXcrun } from '../../scripts/upstream-family/cua-native.ts'

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
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-desktop-next', dependencies: bundle ? { [BUNDLE]: '0.2.2-rc.2' } : {} }))
  for (const [name, installed] of [[BUNDLE, bundle], [PROVIDER, bundle && (options.provider ?? true)]] as const) {
    if (!installed) continue
    mkdirSync(join(root, 'node_modules', name), { recursive: true })
    writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name }))
  }
  return root
}

/** Model the official builder's immutable application and receipt. */
function application(directory: string, bytes: string): string {
  const bundle = createHash('sha256').update(bytes).digest('hex')
  const executable = join(directory, bundle, 'DSH Computer Use.app', 'Contents', 'MacOS', 'dsh-cua-native')
  mkdirSync(dirname(executable), { recursive: true })
  writeFileSync(executable, bytes, { mode: 0o755 })
  writeFileSync(join(directory, 'current.json'), JSON.stringify({ bundle }))
  return executable
}
function applicationBuilder(product: (arch: string) => string) {
  return vi.fn<RunXcrun>((args) => {
    application(args[args.indexOf('--output-directory') + 1]!, product(args[args.indexOf('--arch') + 1]!))
  })
}

it('uses the official application builder for both CPUs and inventories the receipt-selected executable', () => {
  const root = desktop()
  const run = applicationBuilder(arch => `helper ${arch}`)
  const helpers = prepareCuaNative(root, ['arm64', 'x64'], run)
  expect(helpers.map(path => readFileSync(path, 'utf8'))).toEqual(['helper arm64', 'helper x86_64'])
  for (const [args] of run.mock.calls) {
    expect(args[0]).toBe('python3')
    expect(args[1]).toBe(join(root, 'node_modules', PROVIDER, 'native', 'build_app.py'))
    expect(args.slice(-4)).toEqual(['--variant', 'release', '--identity', '-'])
  }
})

it('rebuilds locally built applications but preserves an official replacement', () => {
  const root = desktop()
  let bytes = 'first'
  const run = applicationBuilder(() => bytes)
  const [first] = prepareCuaNative(root, ['arm64'], run)
  bytes = 'second'
  const [second] = prepareCuaNative(root, ['arm64'], run)
  expect(first).not.toBe(second)
  expect(readFileSync(first!, 'utf8')).toBe('first')
  const official = application(join(root, 'node_modules', PROVIDER, 'native', 'bin', 'darwin-arm64'), 'official')
  expect(prepareCuaNative(root, ['arm64'], run)).toEqual([official])
  expect(run).toHaveBeenCalledTimes(2)
})

it('uses a published application without invoking the builder', () => {
  const root = desktop()
  const directory = join(root, 'node_modules', PROVIDER, 'native', 'bin', 'darwin-arm64')
  const official = application(directory, 'official')
  const run = applicationBuilder(() => 'unexpected')
  expect(prepareCuaNative(root, ['arm64'], run)).toEqual([official])
  expect(run).not.toHaveBeenCalled()

})

it.each(['../escape', '', 'not-a-digest'])('rejects an invalid application receipt (%j) without rebuilding', bundle => {
  const root = desktop()
  const directory = join(root, 'node_modules', PROVIDER, 'native', 'bin', 'darwin-arm64')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'current.json'), JSON.stringify({ bundle }))
  const run = applicationBuilder(() => 'unexpected')
  expect(() => prepareCuaNative(root, ['arm64'], run)).toThrow('Invalid official CUA application receipt')
  expect(run).not.toHaveBeenCalled()
})

it('builds nothing for a package that does not ship the official bundle', () => {
  const root = desktop({ bundle: false })
  const run = applicationBuilder(() => 'unused')
  expect(prepareCuaNative(root, ['arm64', 'x64'], run)).toEqual([])
  expect(run).not.toHaveBeenCalled()
})

it('fails when the package ships the bundle but its macOS provider is not installed', () => {
  const root = desktop({ provider: false })
  const run = applicationBuilder(() => 'unused')
  expect(() => prepareCuaNative(root, ['arm64'], run)).toThrow(PROVIDER)
  expect(run).not.toHaveBeenCalled()
})
