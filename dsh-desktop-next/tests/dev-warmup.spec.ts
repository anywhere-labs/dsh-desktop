import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { FIRST_WARMUP_WINDOW_MS, installedPackages, openConcurrently, packageFiles, warmBeforeLaunch, warmChangedPackages, warmupNeeded, warmupRecordPath } from '../scripts/dev-warmup.ts'

const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'next-warmup-'))
  roots.push(path)
  return path
}
function write(path: string, text = ''): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
/** A Yarn project holding one Desktop package with its own node_modules. */
function project(): { readonly state: string; readonly packageRoot: string } {
  const path = root()
  const state = join(path, 'node_modules', '.yarn-state.yml')
  write(state, '__metadata:\n')
  const packageRoot = join(path, 'desktop')
  mkdirSync(join(packageRoot, 'node_modules'), { recursive: true })
  return { state, packageRoot }
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

it('lists scoped and nested installed packages without following links', () => {
  const modules = join(root(), 'node_modules')
  write(join(modules, 'plain', 'package.json'), '{}')
  write(join(modules, 'plain', 'node_modules', 'nested', 'package.json'), '{}')
  write(join(modules, '@scope', 'scoped', 'package.json'), '{}')
  write(join(modules, '.bin', 'tool'), '')
  mkdirSync(join(modules, 'not-a-package'))
  const workspace = join(root(), 'workspace')
  write(join(workspace, 'package.json'), '{}')
  symlinkSync(workspace, join(modules, 'linked'), 'junction')
  const packages = installedPackages(modules)
  expect(packages.map(item => item.dir).sort()).toEqual([
    join(modules, '@scope', 'scoped'), join(modules, 'plain'), join(modules, 'plain', 'node_modules', 'nested'),
  ].sort())
  for (const item of packages) expect(item.changed).toBeGreaterThan(0)
})

it('warms only the files a Host start can open, leaving nested packages to themselves', () => {
  const dir = join(root(), 'package')
  for (const file of ['package.json', 'lib/index.js', 'lib/index.mjs', 'lib/index.cjs', 'build/addon.node', 'lib/codec.wasm', 'data.json']) write(join(dir, file))
  for (const file of ['lib/index.d.ts', 'lib/index.js.map', 'README.md', 'node_modules/dependency/index.js']) write(join(dir, file))
  expect(packageFiles(dir).sort()).toEqual(['package.json', 'lib/index.js', 'lib/index.mjs', 'lib/index.cjs', 'build/addon.node', 'lib/codec.wasm', 'data.json']
    .map(file => join(dir, file)).sort())
})

it('opens files with bounded concurrency and skips files that disappeared', async () => {
  const path = root()
  const files = Array.from({ length: 5 }, (_, index) => join(path, `${index}.js`))
  for (const file of files) write(file)
  await expect(openConcurrently([...files, join(path, 'missing.js')], 2)).resolves.toBe(5)
  await expect(openConcurrently([])).resolves.toBe(0)
})

it('warms packages written after the recorded install and records the new install state', async () => {
  const { state, packageRoot } = project()
  const modules = join(packageRoot, 'node_modules')
  write(join(modules, 'earlier', 'package.json'), '{}')
  write(join(modules, 'earlier', 'index.js'))
  await new Promise(resolve => setTimeout(resolve, 50))
  write(warmupRecordPath(packageRoot), JSON.stringify({ installState: Date.now() }))
  await new Promise(resolve => setTimeout(resolve, 50))
  write(join(modules, 'rewritten', 'package.json'), '{}')
  write(join(modules, 'rewritten', 'index.js'))
  utimesSync(state, new Date(), new Date(Date.now() + 60_000))
  const log: string[] = []
  await expect(warmChangedPackages(packageRoot, message => log.push(message))).resolves.toBe(2)
  expect(log[0]).toContain('2 files from 1 package ')
  expect(JSON.parse(readFileSync(warmupRecordPath(packageRoot), 'utf8'))).toEqual({ installState: statSync(state).mtimeMs })
  expect(warmupNeeded(packageRoot, 'win32')).toBe(false)
})

it('warms the last install the first time, and only on Windows after the install state changes', async () => {
  const { state, packageRoot } = project()
  write(join(packageRoot, 'node_modules', 'first', 'package.json'), '{}')
  expect(warmupNeeded(packageRoot, 'linux')).toBe(false)
  expect(warmupNeeded(packageRoot, 'darwin')).toBe(false)
  expect(warmupNeeded(packageRoot, 'win32')).toBe(true)
  await expect(warmChangedPackages(packageRoot, () => {})).resolves.toBe(1)
  expect(warmupNeeded(packageRoot, 'win32')).toBe(false)
  utimesSync(state, new Date(), new Date(Date.now() + 120_000))
  expect(warmupNeeded(packageRoot, 'win32')).toBe(true)
})

it('leaves packages of earlier installs alone when nothing was recorded yet', async () => {
  const { state, packageRoot } = project()
  write(join(packageRoot, 'node_modules', 'older', 'package.json'), '{}')
  utimesSync(state, new Date(), new Date(Date.now() + FIRST_WARMUP_WINDOW_MS + 60_000))
  await expect(warmChangedPackages(packageRoot, () => {})).resolves.toBe(0)
  expect(warmupNeeded(packageRoot, 'win32')).toBe(false)
})

it('runs the warm-up in a child process and leaves other platforms untouched', () => {
  const { packageRoot } = project()
  write(join(packageRoot, 'node_modules', 'first', 'package.json'), '{}')
  warmBeforeLaunch(packageRoot, 'linux')
  expect(() => readFileSync(warmupRecordPath(packageRoot))).toThrow()
  warmBeforeLaunch(packageRoot, 'win32')
  expect(warmupNeeded(packageRoot, 'win32')).toBe(false)
})
