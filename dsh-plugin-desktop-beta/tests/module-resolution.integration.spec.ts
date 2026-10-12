import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { installProfilePackageResolver } from '../src/module-resolution.ts'

const roots: string[] = []

function writeManifest(directory: string, manifest: Record<string, unknown>): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('real Node Profile package hook', () => {
  it('preserves CJS/ESM conditions, callable identity, exports and manifests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-profile-resolver-integration-'))
    roots.push(root)
    const profileDirectory = join(root, 'profiles', 'smoke')
    const profileManifestPath = join(profileDirectory, 'package.json')
    const modulesDirectory = join(profileDirectory, 'node_modules')
    const cjsDirectory = join(modulesDirectory, 'dsh-resolver-cjs-fixture')
    const esmDirectory = join(modulesDirectory, 'dsh-resolver-esm-fixture')
    const staleSchemaDirectory = join(
      root,
      'profiles',
      'node_modules',
      '@deepseek-ai',
      'schemastery',
    )

    writeManifest(profileDirectory, {
      name: 'dsh-profile-resolver-integration',
      private: true,
      type: 'module',
    })
    writeManifest(staleSchemaDirectory, {
      name: '@deepseek-ai/schemastery',
      version: '999.0.0',
      type: 'commonjs',
      main: './index.cjs',
    })
    writeFileSync(join(staleSchemaDirectory, 'index.cjs'), 'module.exports = { stale: true }\n')

    writeManifest(cjsDirectory, {
      name: 'dsh-resolver-cjs-fixture',
      version: '1.0.0',
      type: 'commonjs',
      exports: {
        '.': { import: './wrong-import.mjs', require: './index.cjs' },
        './features/*': './features/*.cjs',
        './package.json': './package.json',
      },
    })
    mkdirSync(join(cjsDirectory, 'features'))
    writeFileSync(join(cjsDirectory, 'wrong-import.mjs'), 'throw new Error("require selected import")\n')
    writeFileSync(join(cjsDirectory, 'features', 'shape.cjs'), 'module.exports = "wildcard-cjs"\n')
    writeFileSync(join(cjsDirectory, 'index.cjs'), [
      "const Schema = require('@deepseek-ai/schemastery')",
      "const manifest = require('@deepseek-ai/schemastery/package.json')",
      "const yamlUtil = require('yaml/util')",
      "const frontend = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')",
      'function consumer() { return "callable-cjs" }',
      'consumer.Schema = Schema',
      'consumer.manifest = manifest',
      'consumer.yamlUtil = yamlUtil',
      'consumer.frontend = frontend',
      "consumer.loadEsm = () => import('dsh-resolver-esm-fixture')",
      'module.exports = consumer',
      '',
    ].join('\n'))

    writeManifest(esmDirectory, {
      name: 'dsh-resolver-esm-fixture',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { import: './index.mjs', require: './wrong-require.cjs' } },
    })
    writeFileSync(join(esmDirectory, 'wrong-require.cjs'), 'throw new Error("import selected require")\n')
    writeFileSync(join(esmDirectory, 'index.mjs'), [
      "import Schema from '@deepseek-ai/schemastery'",
      "import { parse } from 'yaml'",
      'export { Schema }',
      "export const value = parse('value: 7').value",
      '',
    ].join('\n'))

    const release = installProfilePackageResolver(pathToFileURL(profileManifestPath).href)
    try {
      const profileRequire = createRequire(profileManifestPath)
      const installRequire = createRequire(new URL('../package.json', import.meta.url))
      const consumer = profileRequire('dsh-resolver-cjs-fixture') as {
        (): string
        Schema?: unknown
        manifest?: { name?: unknown }
        yamlUtil?: { createNode?: unknown }
        frontend?: unknown
        loadEsm?: () => Promise<{ Schema?: unknown; value?: unknown }>
      }

      expect(consumer()).toBe('callable-cjs')
      expect(consumer.Schema).toBe(installRequire('@deepseek-ai/schemastery'))
      expect(consumer.manifest?.name).toBe('@deepseek-ai/schemastery')
      expect(typeof consumer.yamlUtil?.createNode).toBe('function')
      expect(consumer.frontend).toEqual(expect.stringContaining(join('dist', 'index.html')))
      expect(profileRequire('dsh-resolver-cjs-fixture/features/shape')).toBe('wildcard-cjs')
      expect(profileRequire('dsh-resolver-cjs-fixture/package.json')).toEqual(expect.objectContaining({
        name: 'dsh-resolver-cjs-fixture',
      }))

      const esm = await consumer.loadEsm?.()
      const installationEsm = await import('@deepseek-ai/schemastery')
      expect(esm?.Schema).toBe(installationEsm.default)
      expect(esm?.value).toBe(7)
    } finally {
      release()
    }
  })

  it('does not treat DSH_HOME node_modules as part of the active Profile overlay', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-profile-resolver-boundary-'))
    roots.push(root)
    const profileDirectory = join(root, 'profiles', 'smoke')
    const profileManifestPath = join(profileDirectory, 'package.json')
    const ancestorYamlDirectory = join(root, 'node_modules', 'yaml')

    writeManifest(profileDirectory, {
      name: 'dsh-profile-resolver-boundary',
      private: true,
      type: 'module',
    })
    writeManifest(ancestorYamlDirectory, {
      name: 'yaml',
      version: '999.0.0',
      type: 'commonjs',
      main: './index.cjs',
    })
    writeFileSync(join(ancestorYamlDirectory, 'index.cjs'), 'module.exports = { rogue: true }\n')

    const release = installProfilePackageResolver(pathToFileURL(profileManifestPath).href)
    try {
      const profileRequire = createRequire(profileManifestPath)
      const installRequire = createRequire(new URL('../package.json', import.meta.url))
      expect(profileRequire('yaml')).toBe(installRequire('yaml'))
      expect(profileRequire('yaml')).not.toEqual({ rogue: true })
    } finally {
      release()
    }
  })
})
