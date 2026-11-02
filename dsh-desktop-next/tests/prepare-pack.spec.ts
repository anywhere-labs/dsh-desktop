import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { applyOfficeUnpack } from '../scripts/prepare-pack.ts'

const roots: string[] = []
const universal = { platform: 'darwin' as const, archs: ['arm64', 'x64'] }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function writeManifest(root: string, name: string, fields: Record<string, unknown> = {}): void {
  mkdirSync(join(root, 'node_modules', name), { recursive: true })
  writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...fields }))
}

it('adds the Office closure of every CPU to the unpack patterns exactly once', () => {
  const payload = mkdtempSync(join(tmpdir(), 'desktop-office-unpack-'))
  roots.push(payload)
  writeManifest(payload, '@deepseek-ai/libreoffice-kit', { dependencies: { fflate: '*' },
    optionalDependencies: { '@deepseek-ai/libreoffice-kit-darwin-arm64': '*', '@deepseek-ai/libreoffice-kit-darwin-x64': '*' } })
  writeManifest(payload, 'fflate')
  writeManifest(payload, '@deepseek-ai/libreoffice-kit-darwin-arm64', { os: ['darwin'], cpu: ['arm64'] })
  writeManifest(payload, '@deepseek-ai/libreoffice-kit-darwin-x64', { os: ['darwin'], cpu: ['x64'] })
  const config: { asarUnpack?: unknown } = { asarUnpack: ['**/*.node', '.desktop-build/payload/assets/**/*'] }
  // Sorted by package directory, so the kit precedes its engines.
  const expected = ['**/node_modules/@deepseek-ai/libreoffice-kit/**/*', '**/node_modules/@deepseek-ai/libreoffice-kit-darwin-arm64/**/*',
    '**/node_modules/@deepseek-ai/libreoffice-kit-darwin-x64/**/*', '**/node_modules/fflate/**/*']
  expect(applyOfficeUnpack(config, payload, universal)).toEqual(expected)
  expect(config.asarUnpack).toEqual(['**/*.node', '.desktop-build/payload/assets/**/*', ...expected])
  // A universal build packs each CPU in turn; the second pass adds nothing.
  expect(applyOfficeUnpack(config, payload, universal)).toEqual([])
  expect(config.asarUnpack).toHaveLength(6)
  // A single pattern string is kept as the first entry.
  const single: { asarUnpack?: unknown } = { asarUnpack: '**/*.node' }
  expect(applyOfficeUnpack(single, payload, universal)).toEqual(expected)
  expect(single.asarUnpack).toEqual(['**/*.node', ...expected])
})
it('unpacks only the Office engine of the CPU a single-CPU package carries', () => {
  const payload = mkdtempSync(join(tmpdir(), 'desktop-office-unpack-'))
  roots.push(payload)
  writeManifest(payload, '@deepseek-ai/libreoffice-kit', { dependencies: { fflate: '*' },
    optionalDependencies: { '@deepseek-ai/libreoffice-kit-darwin-arm64': '*', '@deepseek-ai/libreoffice-kit-darwin-x64': '*' } })
  writeManifest(payload, 'fflate')
  // The prepared payload of an Apple silicon package holds no Intel engine.
  writeManifest(payload, '@deepseek-ai/libreoffice-kit-darwin-arm64', { os: ['darwin'], cpu: ['arm64'] })
  const config: { asarUnpack?: unknown } = { asarUnpack: [] }
  expect(applyOfficeUnpack(config, payload, { platform: 'darwin', archs: ['arm64'] })).toEqual(['**/node_modules/@deepseek-ai/libreoffice-kit/**/*',
    '**/node_modules/@deepseek-ai/libreoffice-kit-darwin-arm64/**/*', '**/node_modules/fflate/**/*'])
  expect(() => applyOfficeUnpack({ asarUnpack: [] }, payload, universal)).toThrow('libreoffice-kit-darwin-x64')
})
