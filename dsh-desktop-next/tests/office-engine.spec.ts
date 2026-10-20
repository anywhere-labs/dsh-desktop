import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { installOfficeEngineResolution, runtimeArchivePath } from '../src/host/office-engine.ts'

const roots: string[] = []
const hooks: ModuleHooks[] = []
afterEach(() => {
  for (const hook of hooks.splice(0)) hook.deregister()
  const cache = createRequire(import.meta.url).cache
  for (const path of Object.keys(cache)) {
    if (roots.some(root => path.startsWith(root + sep))) Reflect.deleteProperty(cache, path)
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const manifest = 'node_modules/@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'

/** An archived runtime: Next's application is the archive itself unless a nested runtime name is given. */
function fixture(runtimeName?: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-office-resolution-')))
  roots.push(root)
  const runtime = runtimeName === undefined ? join(root, 'app.asar') : join(root, 'app.asar', runtimeName)
  const unpacked = runtimeName === undefined ? join(root, 'app.asar.unpacked') : join(root, 'app.asar.unpacked', runtimeName)
  for (const base of [runtime, unpacked]) {
    const path = join(base, manifest)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ name: '@deepseek-ai/libreoffice-kit-darwin-arm64', path: realpathSync(dirname(path)) }))
  }
  const api = join(runtime, 'node_modules/@deepseek-ai/libreoffice-kit/package.json')
  mkdirSync(dirname(api), { recursive: true })
  writeFileSync(api, '{"name":"@deepseek-ai/libreoffice-kit"}')
  const require: (specifier: string) => unknown = createRequire(join(runtime, 'package.json'))
  const hook = installOfficeEngineResolution(runtime)!
  hooks.push(hook)
  return { root, runtime, unpacked, require }
}

it('locates the archive for the application root and for a nested runtime, and none for a prepared tree', () => {
  expect(runtimeArchivePath(join('/x', 'app.asar'))).toBe(join('/x', 'app.asar'))
  expect(runtimeArchivePath(join('/x', 'app.asar', 'dsh'))).toBe(join('/x', 'app.asar'))
  expect(runtimeArchivePath(join('/x', 'app.asar.unpacked', 'dsh'))).toBeUndefined()
  expect(runtimeArchivePath(join('/x', 'dsh'))).toBeUndefined()
})

it('resolves engine manifests to physical directories and leaves unrelated modules alone', () => {
  const f = fixture()
  // Node 24.13 require.resolve bypasses hooks; Electron's require.resolve is covered by the packaged Host smoke.
  expect(f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ path: realpathSync(dirname(join(f.unpacked, manifest))) })
  expect((f.require('node:fs') as typeof import('node:fs')).realpathSync).toBe(realpathSync)
  expect(f.require('@deepseek-ai/libreoffice-kit/package.json')).toEqual({ name: '@deepseek-ai/libreoffice-kit' })
})

it('resolves an absolute engine manifest to its unpacked copy', () => {
  const f = fixture()
  expect(f.require(join(f.runtime, manifest))).toMatchObject({ path: realpathSync(dirname(join(f.unpacked, manifest))) })
})

it('rejects an engine missing from the unpacked tree instead of using its archived copy', () => {
  const f = fixture()
  rmSync(join(f.root, 'app.asar.unpacked'), { recursive: true })
  expect(() => { f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json') }).toThrow()
})

it('leaves a prepared runtime without an archive unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-office-prepared-'))
  roots.push(root)
  expect(installOfficeEngineResolution(join(root, 'dsh'))).toBeUndefined()
})

it('preserves a nested runtime directory when locating the unpacked engine', () => {
  const f = fixture('alternate-runtime')
  expect(f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ path: realpathSync(dirname(join(f.unpacked, manifest))) })
})

it('resolves an engine through a directory alias', () => {
  const f = fixture()
  const alias = join(f.root, 'alias')
  symlinkSync(join(f.root, 'app.asar'), alias, 'junction')
  const require: (specifier: string) => unknown = createRequire(join(alias, 'package.json'))
  expect(require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ path: realpathSync(dirname(join(f.unpacked, manifest))) })
})

it('rejects an engine resolved elsewhere inside the archive', () => {
  const f = fixture('dsh')
  const other = join(f.root, 'app.asar', 'other', manifest)
  mkdirSync(dirname(other), { recursive: true })
  writeFileSync(other, '{}')
  const require = createRequire(join(f.root, 'app.asar', 'other', 'package.json'))
  expect(() => { require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json') })
    .toThrow('outside the runtime package directory')
})

it('leaves external engines and the archived WASM engine at their own locations', () => {
  const f = fixture()
  const external = join(f.root, 'external', manifest)
  const wasm = join(f.runtime, 'node_modules/@deepseek-ai/libreoffice-kit-wasm/package.json')
  for (const path of [external, wasm]) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ path: realpathSync(dirname(path)) }))
  }
  const require: (specifier: string) => unknown = createRequire(join(f.root, 'external', 'package.json'))
  expect(require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ path: realpathSync(dirname(external)) })
  expect(f.require('@deepseek-ai/libreoffice-kit-wasm/package.json'))
    .toMatchObject({ path: realpathSync(dirname(wasm)) })
})
