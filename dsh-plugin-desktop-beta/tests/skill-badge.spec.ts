import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { SKILL_BADGE_PACKAGE, installSkillBadgeResolution } from '../src/host/skill-badge.ts'

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

const PACKAGE = `node_modules/${SKILL_BADGE_PACKAGE}`
/** An ES module's own directory. */
const HERE = 'import { dirname } from "node:path"\nimport { fileURLToPath } from "node:url"\nconst here = dirname(fileURLToPath(import.meta.url))'
const REGISTRY = 'node_modules/@deepseek-ai/dsh-skill'

/** What the badge package reports about where it ran and what it imported. */
interface Loaded { entry: string; body: string; assets: string; registry: string }

/**
 * An archived application with the badge package and the skill registry it imports in the archive and, unless
 * omitted, the badge package's unpacked copy beside it. The registry has no unpacked copy, as in the real payload.
 */
function fixture(options: { unpacked?: boolean; runtimeName?: string; format?: 'commonjs' | 'module' } = {}) {
  const format = options.format ?? 'commonjs'
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-badge-resolution-')))
  roots.push(root)
  const runtime = options.runtimeName === undefined ? join(root, 'app.asar') : join(root, 'app.asar', options.runtimeName)
  const unpacked = options.runtimeName === undefined ? join(root, 'app.asar.unpacked') : join(root, 'app.asar.unpacked', options.runtimeName)
  for (const base of options.unpacked === false ? [runtime] : [runtime, unpacked]) writeBadgePackage(join(base, PACKAGE), format)
  mkdirSync(join(runtime, REGISTRY, 'lib'), { recursive: true })
  writeFileSync(join(runtime, REGISTRY, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-skill', type: format, main: 'lib/index.js' }))
  writeFileSync(join(runtime, REGISTRY, 'lib', 'index.js'), format === 'module' ? `${HERE}\nexport const registry = here\n` : 'module.exports = { registry: __dirname }\n')
  writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: 'dsh-plugin-desktop-beta' }))
  // The loader imports the provider by name from the application root.
  const require: (specifier: string) => unknown = createRequire(join(runtime, 'package.json'))
  const hook = installSkillBadgeResolution(runtime)!
  hooks.push(hook)
  return { root, runtime, unpacked, require }
}

/** The badge package's shape: an entry importing the registry and a sibling, beside an `assets/` directory holding the PNG. */
function writeBadgePackage(directory: string, format: 'commonjs' | 'module') {
  mkdirSync(join(directory, 'lib'), { recursive: true })
  mkdirSync(join(directory, 'assets'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: SKILL_BADGE_PACKAGE, type: format, main: 'lib/index.js' }))
  writeFileSync(join(directory, 'lib', 'index.js'), (format === 'module' ? [
    'import { registry } from "@deepseek-ai/dsh-skill"',
    'import { body } from "./body.js"',
    'import { join } from "node:path"',
    HERE,
    'export const entry = here',
    'export const assets = join(entry, "..", "assets")',
    'export { body, registry }',
  ] : [
    'const { registry } = require("@deepseek-ai/dsh-skill")',
    'const { body } = require("./body.js")',
    'module.exports = { entry: __dirname, body, assets: require("node:path").join(__dirname, "..", "assets"), registry }',
  ]).join('\n') + '\n')
  writeFileSync(join(directory, 'lib', 'body.js'), format === 'module' ? `${HERE}\nexport const body = here\n` : 'module.exports = { body: __dirname }\n')
  writeFileSync(join(directory, 'assets', 'dsh-badge.png'), 'png\n')
}

/** Load the package through the hook in a fresh Node, as the ES module the real package is; vitest's own loader does not run hooks for ES modules. */
function loadModuleInChild(runtime: string, entry: string): Loaded {
  const script = [
    `import { installSkillBadgeResolution } from ${JSON.stringify(new URL('../src/host/skill-badge.ts', import.meta.url).href)}`,
    `installSkillBadgeResolution(${JSON.stringify(runtime)})`,
    `console.log(JSON.stringify(await import(${JSON.stringify(pathToFileURL(entry).href)})))`,
  ].join('\n')
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout) as Loaded
}

it('runs the package from its unpacked copy while its imports resolve as from the archive', () => {
  const f = fixture()
  // Node's require.resolve bypasses hooks in some releases; Electron's honours them, as the packaged build shows.
  const loaded = f.require(SKILL_BADGE_PACKAGE) as Loaded
  const copy = realpathSync(join(f.unpacked, PACKAGE))
  expect(loaded.entry).toBe(join(copy, 'lib'))
  // The announced directory is physical and holds the PNG.
  expect(loaded.assets).toBe(join(copy, 'assets'))
  expect(existsSync(join(loaded.assets, 'dsh-badge.png'))).toBe(true)
  // A bare import from the copy finds the archive's registry, which has no unpacked copy; a relative one stays in the copy.
  expect(loaded.registry).toBe(join(realpathSync(join(f.runtime, REGISTRY)), 'lib'))
  expect(loaded.body).toBe(join(copy, 'lib'))
  expect(createRequire(join(f.runtime, 'package.json'))('@deepseek-ai/dsh-skill')).toEqual({ registry: loaded.registry })
  expect((f.require('node:path') as typeof import('node:path')).join).toBe(join)
})

it('runs an ES module package from its unpacked copy while its imports resolve as from the archive', () => {
  const f = fixture({ format: 'module' })
  const loaded = loadModuleInChild(f.runtime, join(f.runtime, PACKAGE, 'lib', 'index.js'))
  const copy = realpathSync(join(f.unpacked, PACKAGE))
  expect(loaded.entry).toBe(join(copy, 'lib'))
  expect(loaded.assets).toBe(join(copy, 'assets'))
  expect(loaded.body).toBe(join(copy, 'lib'))
  expect(loaded.registry).toBe(join(realpathSync(join(f.runtime, REGISTRY)), 'lib'))
})

it('rejects a package missing from the unpacked tree instead of using its archived copy', () => {
  const f = fixture({ unpacked: false })
  expect(() => { f.require(SKILL_BADGE_PACKAGE) }).toThrow()
})

it('leaves a prepared runtime without an archive unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-badge-prepared-'))
  roots.push(root)
  expect(installSkillBadgeResolution(join(root, 'dsh'))).toBeUndefined()
})

it('preserves a nested runtime directory when locating the unpacked package', () => {
  const f = fixture({ runtimeName: 'dsh' })
  const loaded = f.require(SKILL_BADGE_PACKAGE) as Loaded
  expect(loaded.entry).toBe(join(realpathSync(join(f.unpacked, PACKAGE)), 'lib'))
  expect(loaded.registry).toBe(join(realpathSync(join(f.runtime, REGISTRY)), 'lib'))
})

it('rejects a package resolved elsewhere inside the archive and leaves external packages alone', () => {
  const f = fixture({ runtimeName: 'dsh' })
  const other = join(f.root, 'app.asar', 'other', PACKAGE, 'package.json')
  mkdirSync(dirname(other), { recursive: true })
  writeFileSync(other, '{}')
  expect(() => { createRequire(join(f.root, 'app.asar', 'other', 'package.json'))(`${SKILL_BADGE_PACKAGE}/package.json`) })
    .toThrow('outside the runtime package directory')
  const external = join(f.root, 'external', PACKAGE, 'package.json')
  mkdirSync(dirname(external), { recursive: true })
  writeFileSync(external, JSON.stringify({ path: realpathSync(dirname(external)) }))
  expect(createRequire(join(f.root, 'external', 'package.json'))(`${SKILL_BADGE_PACKAGE}/package.json`))
    .toMatchObject({ path: realpathSync(dirname(external)) })
})
