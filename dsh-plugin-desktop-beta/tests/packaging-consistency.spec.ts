import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Packaging-chain consistency gate.
//
// Root cause of "the EXE is always missing something": the runtime is wired by a
// cordis.patch.yml row -> a package.json "exports" subpath -> a built lib/**/*.js.
// Historically no stage cross-checked those planes, so a missing tsdown entry kept
// the build green yet crashed the packaged app with `Cannot find module`.
//
// This test derives all three planes from source-of-truth config and asserts every
// mountable plugin row resolves to a producer, and every export resolves to a build
// entry (tsdown, or vite for the client face). Package-identity agnostic: the same
// file guards both dsh-plugin-desktop-beta and dsh-plugin-desktop (stable).

const packageRoot = new URL('../', import.meta.url)
const pkgName = (JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as { name: string }).name

const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  name: string
  exports: Record<string, { types?: string; default?: string } | string>
  build?: { files?: string[] }
  dsh?: { bundle?: { patch?: string } }
}

const tsdownSource = readFileSync(new URL('tsdown.config.ts', packageRoot), 'utf8')
const patchSource = readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')

// Keys the bundler emits into lib/<key>.js (or lib/<key>/index.js for nested keys).
const tsdownEntryKeys = new Set<string>()
for (const m of tsdownSource.matchAll(/['"]([\w][\w/.-]*)['"]\s*:\s*['"](src\/[\w/.-]+\.ts)['"]/g)) {
  tsdownEntryKeys.add(m[1] as string)
}
for (const m of tsdownSource.matchAll(/^\s*(\w+)\s*:\s*['"](src\/[\w/.-]+\.ts)['"]/gm)) {
  tsdownEntryKeys.add(m[1] as string)
}

// vite.client.config.ts builds the client face to lib/client.js (not a tsdown entry).
const viteBuiltKeys = new Set<string>(['client'])

const producerKeys = new Set<string>([...tsdownEntryKeys, ...viteBuiltKeys])

function libKeyFromDefault(defaultPath: string): string | undefined {
  if (!defaultPath.startsWith('./lib/')) return undefined
  if (defaultPath.endsWith('.js')) return defaultPath.slice('./lib/'.length, -'.js'.length)
  return undefined
}

describe('desktop packaging chain consistency', () => {
  it('has tsdown entries beyond the obvious minimum', () => {
    // Sanity: guard against a config-parse regression producing an empty set.
    expect(tsdownEntryKeys.size).toBeGreaterThan(20)
  })

  it('every export whose default is a lib/**/*.js has a matching build producer', () => {
    const unsatisfied: string[] = []
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const def = typeof target === 'string' ? undefined : target.default
      if (def === undefined) continue
      const key = libKeyFromDefault(def)
      if (key === undefined) continue // non-JS export (e.g. ./package.json) or bundled asset
      if (!producerKeys.has(key)) unsatisfied.push(`${subpath} -> ${def} (no tsdown/vite entry for '${key}')`)
    }
    expect(unsatisfied, `unbuilt export targets:\n${unsatisfied.join('\n')}`).toEqual([])
  })

  it('every package-owned cordis.patch row resolves to an exports subpath that is built', () => {
    const missingExports: string[] = []
    const missingProducers: string[] = []
    for (const m of patchSource.matchAll(/^\s*name:\s*['"]?([^\s'"]+)['"]?\s*$/gm)) {
      const rowName = m[1] as string
      if (!rowName.startsWith(`${pkgName}/`)) continue // skip bare shell row + upstream-owned rows
      const subpath = `./${rowName.slice(pkgName.length + 1)}`
      const target = manifest.exports[subpath]
      if (target === undefined) {
        missingExports.push(`${rowName} (exports key '${subpath}' absent)`)
        continue
      }
      const def = typeof target === 'string' ? undefined : target.default
      const key = def === undefined ? undefined : libKeyFromDefault(def)
      if (key !== undefined && !producerKeys.has(key)) missingProducers.push(`${rowName} -> ${subpath} -> ${def} (unbuilt)`)
    }
    expect(missingExports, `patch rows without an exports key:\n${missingExports.join('\n')}`).toEqual([])
    expect(missingProducers, `patch rows whose target is never built:\n${missingProducers.join('\n')}`).toEqual([])
  })

  it('ships the runtime entry files inside the electron-builder bundle', () => {
    const files = manifest.build?.files ?? []
    expect(files).toContain('lib/**')
    expect(files).toContain('cordis.patch.yml')
    expect(files).toContain('package.json')
    // The preload/native-ui planes are produced into lib/ (covered by `lib/**`);
    // the npm publish `files` must additionally cover the .cjs preload outputs.
    const publishFiles = (manifest as { files?: string[] }).files ?? []
    expect(publishFiles).toContain('lib/**/*.cjs')
  })
})
