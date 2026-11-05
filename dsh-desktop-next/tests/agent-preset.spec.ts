import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AGENT_PRESET_PACKAGE, installAgentPresetResolution } from '../src/host/agent-preset.ts'

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

const manifest = `node_modules/${AGENT_PRESET_PACKAGE}/package.json`

/** An archived application with the preset package in the archive and, unless omitted, its unpacked copy beside it. */
function fixture(options: { unpacked?: boolean; runtimeName?: string } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-preset-resolution-')))
  roots.push(root)
  const runtime = options.runtimeName === undefined ? join(root, 'app.asar') : join(root, 'app.asar', options.runtimeName)
  const unpacked = options.runtimeName === undefined ? join(root, 'app.asar.unpacked') : join(root, 'app.asar.unpacked', options.runtimeName)
  for (const base of options.unpacked === false ? [runtime] : [runtime, unpacked]) {
    const path = join(base, manifest)
    mkdirSync(join(dirname(path), 'lib'), { recursive: true })
    mkdirSync(join(dirname(path), 'skills', 'agent-experience'), { recursive: true })
    writeFileSync(path, JSON.stringify({ name: AGENT_PRESET_PACKAGE, main: 'lib/index.js', path: realpathSync(dirname(path)) }))
    writeFileSync(join(dirname(path), 'lib', 'index.js'), 'module.exports = { entry: __dirname }\n')
    writeFileSync(join(dirname(path), 'skills', 'agent-experience', 'SKILL.md'), '---\nname: agent-experience\n---\n')
  }
  // The web-app bundle's presets patch is where the Creator preset resolves the package from.
  const presets = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets')
  mkdirSync(presets, { recursive: true })
  const require: (specifier: string) => unknown = createRequire(join(presets, 'cordis.patch.yml'))
  const hook = installAgentPresetResolution(runtime)!
  hooks.push(hook)
  return { root, runtime, unpacked, require }
}

it('answers the preset manifest request with the unpacked copy and leaves the package entry archived', () => {
  const f = fixture()
  // Node's require.resolve bypasses hooks in some releases; Electron's honours them, as the packaged build shows.
  expect(f.require(`${AGENT_PRESET_PACKAGE}/package.json`)).toMatchObject({ path: realpathSync(dirname(join(f.unpacked, manifest))) })
  expect(f.require(AGENT_PRESET_PACKAGE)).toEqual({ entry: join(realpathSync(dirname(join(f.runtime, manifest))), 'lib') })
  expect((f.require('node:path') as typeof import('node:path')).join).toBe(join)
})

it('rejects a package missing from the unpacked tree instead of using its archived copy', () => {
  const f = fixture({ unpacked: false })
  expect(() => { f.require(`${AGENT_PRESET_PACKAGE}/package.json`) }).toThrow()
})

it('leaves a prepared runtime without an archive unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-preset-prepared-'))
  roots.push(root)
  expect(installAgentPresetResolution(join(root, 'dsh'))).toBeUndefined()
})

it('preserves a nested runtime directory when locating the unpacked package', () => {
  const f = fixture({ runtimeName: 'dsh' })
  expect(f.require(`${AGENT_PRESET_PACKAGE}/package.json`)).toMatchObject({ path: realpathSync(dirname(join(f.unpacked, manifest))) })
})

it('rejects a manifest resolved elsewhere inside the archive and leaves external packages alone', () => {
  const f = fixture({ runtimeName: 'dsh' })
  const other = join(f.root, 'app.asar', 'other', manifest)
  mkdirSync(dirname(other), { recursive: true })
  writeFileSync(other, '{}')
  expect(() => { createRequire(join(f.root, 'app.asar', 'other', 'package.json'))(`${AGENT_PRESET_PACKAGE}/package.json`) })
    .toThrow('outside the runtime package directory')
  const external = join(f.root, 'external', manifest)
  mkdirSync(dirname(external), { recursive: true })
  writeFileSync(external, JSON.stringify({ path: realpathSync(dirname(external)) }))
  expect(createRequire(join(f.root, 'external', 'package.json'))(`${AGENT_PRESET_PACKAGE}/package.json`))
    .toMatchObject({ path: realpathSync(dirname(external)) })
})
