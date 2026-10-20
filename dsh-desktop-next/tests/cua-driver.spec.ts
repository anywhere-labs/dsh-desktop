import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CUA_DRIVER_PLATFORM_PACKAGES, installCuaDriverResolution } from '../src/host/cua-driver.ts'

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

const PLATFORM = `${CUA_DRIVER_PLATFORM_PACKAGES}darwin-arm64`
const manifest = `node_modules/${PLATFORM}/package.json`
const DRIVER = 'node_modules/@trycua/cua-driver'

/** An archived application with the driver and its platform package in the archive and, unless omitted, the platform package's unpacked copy beside it. */
function fixture(options: { unpacked?: boolean; runtimeName?: string } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-driver-resolution-')))
  roots.push(root)
  const runtime = options.runtimeName === undefined ? join(root, 'app.asar') : join(root, 'app.asar', options.runtimeName)
  const unpacked = options.runtimeName === undefined ? join(root, 'app.asar.unpacked') : join(root, 'app.asar.unpacked', options.runtimeName)
  for (const base of options.unpacked === false ? [runtime] : [runtime, unpacked]) {
    const path = join(base, manifest)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ name: PLATFORM, path: realpathSync(dirname(path)) }))
    writeFileSync(join(dirname(path), 'libcua_driver_sdk.dylib'), 'library\n')
  }
  // The driver's Node runtime module is where the platform package is resolved from.
  const native = join(runtime, DRIVER, 'dist', 'native')
  mkdirSync(native, { recursive: true })
  writeFileSync(join(runtime, DRIVER, 'package.json'), JSON.stringify({ name: '@trycua/cua-driver', main: 'dist/index.js' }))
  writeFileSync(join(runtime, DRIVER, 'dist', 'index.js'), 'module.exports = { entry: __dirname }\n')
  const require: (specifier: string) => unknown = createRequire(join(native, 'node-runtime.js'))
  const hook = installCuaDriverResolution(runtime)!
  hooks.push(hook)
  return { root, runtime, unpacked, require }
}

it('answers platform package requests with the unpacked copy and leaves the driver package archived', () => {
  const f = fixture()
  // Node's require.resolve bypasses hooks in some releases; Electron's honours them, as the packaged build shows.
  const directory = realpathSync(dirname(join(f.unpacked, manifest)))
  expect(f.require(`${PLATFORM}/package.json`)).toMatchObject({ path: directory })
  expect(existsSync(join(directory, 'libcua_driver_sdk.dylib'))).toBe(true)
  expect(createRequire(join(f.runtime, 'package.json'))('@trycua/cua-driver')).toEqual({ entry: join(f.runtime, DRIVER, 'dist') })
  expect((f.require('node:path') as typeof import('node:path')).join).toBe(join)
})

it('rejects a platform package missing from the unpacked tree instead of using its archived copy', () => {
  const f = fixture({ unpacked: false })
  expect(() => { f.require(`${PLATFORM}/package.json`) }).toThrow()
})

it('leaves a prepared runtime without an archive unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-driver-prepared-'))
  roots.push(root)
  expect(installCuaDriverResolution(join(root, 'dsh'))).toBeUndefined()
})

it('preserves a nested runtime directory when locating the unpacked package', () => {
  const f = fixture({ runtimeName: 'dsh' })
  expect(f.require(`${PLATFORM}/package.json`)).toMatchObject({ path: realpathSync(dirname(join(f.unpacked, manifest))) })
})

it('rejects a platform package resolved elsewhere inside the archive and leaves external packages alone', () => {
  const f = fixture({ runtimeName: 'dsh' })
  const other = join(f.root, 'app.asar', 'other', manifest)
  mkdirSync(dirname(other), { recursive: true })
  writeFileSync(other, '{}')
  expect(() => { createRequire(join(f.root, 'app.asar', 'other', 'package.json'))(`${PLATFORM}/package.json`) })
    .toThrow('outside the runtime package directory')
  const external = join(f.root, 'external', manifest)
  mkdirSync(dirname(external), { recursive: true })
  writeFileSync(external, JSON.stringify({ path: realpathSync(dirname(external)) }))
  expect(createRequire(join(f.root, 'external', 'package.json'))(`${PLATFORM}/package.json`))
    .toMatchObject({ path: realpathSync(dirname(external)) })
})
