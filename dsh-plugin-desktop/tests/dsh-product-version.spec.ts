import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { dshProductVersion } from '../src/dsh-product-version.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture(manifest: unknown): { readonly moduleUrl: URL; readonly manifestPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-product-version-'))
  temporaryDirectories.push(root)
  const manifestPath = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  mkdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"private":true}\n')
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
  return {
    moduleUrl: pathToFileURL(join(root, 'entry.mjs')),
    manifestPath,
  }
}

describe('installed DSH product version', () => {
  it('reads the package actually resolvable from the Desktop installation graph', () => {
    const desktopManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(dshProductVersion()).toBe(desktopManifest.dependencies['@deepseek-ai/dsh'])
  })

  it('resolves and validates a canonical prerelease from the caller package graph', () => {
    const { moduleUrl } = fixture({ name: '@deepseek-ai/dsh', version: '0.1.2-alpha.7' })
    expect(dshProductVersion(moduleUrl)).toBe('0.1.2-alpha.7')
  })

  it('rejects the wrong package identity and non-canonical versions', () => {
    const wrongIdentity = fixture({ name: '@deepseek-ai/not-dsh', version: '0.1.2' })
    expect(() => dshProductVersion(wrongIdentity.moduleUrl)).toThrow('invalid identity')

    const invalidVersion = fixture({ name: '@deepseek-ai/dsh', version: 'v0.1.2' })
    expect(() => dshProductVersion(invalidVersion.moduleUrl)).toThrow('not canonical')
  })
})
