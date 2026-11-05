import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { SHARP_WASM_PACKAGE, installSharpWasmResolution } from '../src/host/sharp-wasm.ts'

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

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const missing = expect.objectContaining({ code: 'MODULE_NOT_FOUND' })

function writeManifest(directory: string, manifest: Record<string, unknown>) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
}

/** The WebAssembly build as `@img/sharp-wasm32` publishes it, with the entry that sharp requests. */
function writeSharpWasmPackage(directory: string, version: string) {
  writeManifest(directory, {
    name: SHARP_WASM_PACKAGE, version, type: 'commonjs',
    exports: { './sharp.node': './index.cjs', './package': './package.json', './versions': './versions.json' },
  })
  writeFileSync(join(directory, 'index.cjs'), 'module.exports = { wasm: __dirname }\n')
  writeFileSync(join(directory, 'versions.json'), '{"vips":"8.18.7"}\n')
}

function writeNativeLinuxPackage(directory: string) {
  writeManifest(directory, { name: directory.split('node_modules/')[1], exports: { './sharp.node': './index.js', './versions': './index.js' } })
  writeFileSync(join(directory, 'index.js'), 'module.exports = { native: true }\n')
}

/** A runtime that installed sharp with both its native Linux backend and its WebAssembly build. */
function runtimeFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-sharp-wasm-')))
  roots.push(root)
  const runtime = join(root, 'runtime')
  writeManifest(runtime, { name: 'dsh-desktop-next' })
  writeSharpWasmPackage(join(runtime, 'node_modules', SHARP_WASM_PACKAGE), '0.35.5')
  for (const name of ['sharp-linux-x64', 'sharp-libvips-linux-x64', 'sharp-linuxmusl-arm64']) writeNativeLinuxPackage(join(runtime, 'node_modules', '@img', name))
  const hook = installSharpWasmResolution(runtime, 'linux')!
  hooks.push(hook)
  return { root, runtime }
}

/** A Profile's own sharp at one release, with its native Linux backend and no WebAssembly build. */
function profileSharp(root: string, name: string, version: string): (specifier: string) => unknown {
  const profile = join(root, `profile-${version}`, 'node_modules')
  writeManifest(join(profile, name), { name, version })
  mkdirSync(join(profile, name, 'dist'), { recursive: true })
  writeFileSync(join(profile, name, 'dist', 'sharp.cjs'), '')
  writeNativeLinuxPackage(join(profile, '@img', 'sharp-linux-x64'))
  return createRequire(join(profile, name, 'dist', 'sharp.cjs'))
}

it('stays out of the way off Linux', () => {
  expect(installSharpWasmResolution(desktopRoot, 'darwin')).toBeUndefined()
  expect(installSharpWasmResolution(desktopRoot, 'win32')).toBeUndefined()
})

it('refuses the native Linux packages, so sharp falls back to its WebAssembly build', () => {
  const { runtime } = runtimeFixture()
  const require = createRequire(join(runtime, 'package.json'))
  expect(() => require('@img/sharp-linux-x64/sharp.node')).toThrow(missing)
  expect(() => require('@img/sharp-linuxmusl-arm64/sharp.node')).toThrow(missing)
  expect(() => require('@img/sharp-libvips-linux-x64/versions')).toThrow(missing)
  expect(require(`${SHARP_WASM_PACKAGE}/sharp.node`)).toEqual({ wasm: join(runtime, 'node_modules', SHARP_WASM_PACKAGE) })
})

it('gives a Profile sharp without a WebAssembly build the runtime copy only from the same release', () => {
  const { root, runtime } = runtimeFixture()
  const sameRelease = profileSharp(root, 'sharp', '0.35.5')
  expect(() => sameRelease('@img/sharp-linux-x64/sharp.node')).toThrow(missing)
  expect(sameRelease(`${SHARP_WASM_PACKAGE}/sharp.node`)).toEqual({ wasm: join(runtime, 'node_modules', SHARP_WASM_PACKAGE) })
  expect(sameRelease(`${SHARP_WASM_PACKAGE}/versions`)).toEqual({ vips: '8.18.7' })
  // Another release's binding does not match its JavaScript, so sharp reports the missing backend itself.
  expect(() => profileSharp(root, 'sharp', '0.34.5')(`${SHARP_WASM_PACKAGE}/sharp.node`)).toThrow(missing)
  expect(() => profileSharp(root, 'not-sharp', '0.35.5')(`${SHARP_WASM_PACKAGE}/sharp.node`)).toThrow(missing)
})

it('pins the WebAssembly build to the sharp release the runtime installs', () => {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { optionalDependencies?: Record<string, string> }
  const require = createRequire(join(desktopRoot, 'package.json'))
  const sharp = JSON.parse(readFileSync(join(dirname(require.resolve('sharp')), '..', 'package.json'), 'utf8')) as { version: string }
  expect(manifest.optionalDependencies?.[SHARP_WASM_PACKAGE]).toBe(sharp.version)
  expect((require(`${SHARP_WASM_PACKAGE}/package`) as { version: string }).version).toBe(sharp.version)
})

it('loads real sharp through @img/sharp-wasm32 and encodes PNG images when platform is linux', () => {
  const script = [
    'Object.defineProperty(process, "platform", { value: "linux" })',
    `const { installSharpWasmResolution } = await import(${JSON.stringify(new URL('../src/host/sharp-wasm.ts', import.meta.url).href)})`,
    `installSharpWasmResolution(${JSON.stringify(desktopRoot)}, "linux")`,
    'const { createRequire } = await import("node:module")',
    `const require = createRequire(${JSON.stringify(join(desktopRoot, 'package.json'))})`,
    'const sharp = require("sharp")',
    'const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 12, g: 34, b: 56 } } }).png().toBuffer()',
    'const meta = await sharp(png).metadata()',
    `const wasm = Object.keys(require.cache).some(path => path.includes(${JSON.stringify(`${SHARP_WASM_PACKAGE}/`)}))`,
    'console.log(JSON.stringify({ format: meta.format, width: meta.width, height: meta.height, wasm }))',
  ].join('\n')
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  expect(JSON.parse(result.stdout)).toEqual({ format: 'png', width: 2, height: 2, wasm: true })
})
