import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeEntries, OPTIONAL_BUNDLES } from '@deepseek-ai/dsh-app-boot'
import { desktopInstallAnchor, ensureDesktopProfile, prepareDesktopProfile } from '../src/profile.ts'

const VOICE_INPUT_BUNDLE = '@deepseek-ai/dsh-experimental-voice-input-bundle'
const homes: string[] = []
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as {
  version?: string
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string }, profile?: { bundles?: string[] } }
}

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-optional-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('official optional bundles', {
  timeout: process.platform === 'win32' ? 10_000 : 5_000,
}, () => {
  // The plugin manager offers only the optional bundles its install anchor declares.
  // The Desktop package is that anchor, so a bundle shipped only transitively through
  // `@deepseek-ai/dsh` never reaches the Plugins page.
  it('declares every official optional bundle as a version-aligned installation dependency', () => {
    const anchor = desktopInstallAnchor()
    const desktop = read(anchor)
    const require = createRequire(anchor)
    for (const name of OPTIONAL_BUNDLES) {
      expect(desktop.dependencies?.[name], name).toBe(desktop.dependencies?.['@deepseek-ai/dsh-app-boot'])
      const installed = read(require.resolve(`${name}/package.json`))
      expect(installed.version, name).toBe(desktop.dependencies?.[name])
      expect(installed.dsh?.bundle?.patch, name).toBeTruthy()
    }
  })

  it('offers optional bundles switched off in a new Desktop profile', () => {
    const dir = ensureDesktopProfile(temporaryHome())

    const bundles = read(join(dir, 'package.json')).dsh?.profile?.bundles ?? []
    for (const name of OPTIONAL_BUNDLES) expect(bundles, name).not.toContain(name)
  })

  it('composes voice input from the installation once the user switches it on', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const manifest = read(join(dir, 'package.json'))
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
      ...manifest,
      dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...manifest.dsh?.profile?.bundles ?? [], VOICE_INPUT_BUNDLE] } },
    }, null, 2)}\n`)

    const prepared = prepareDesktopProfile(undefined, home, process.platform)

    expect(prepared.profile.layers.map(layer => layer.packageName)).toContain(VOICE_INPUT_BUNDLE)
    const rows = composeEntries([prepared.patches])
    const require = createRequire(desktopInstallAnchor())
    for (const [id, name] of [
      ['speech-to-text', '@deepseek-ai/dsh-experimental-speech-to-text'],
      ['speech-to-text-sensevoice', '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice'],
      ['api-speech-to-text', '@deepseek-ai/dsh-experimental-api-speech-to-text'],
      ['ui-voice-input', '@deepseek-ai/dsh-experimental-client-ui-voice-input'],
    ] as const) {
      expect(rows, id).toContainEqual(expect.objectContaining({ id, name }))
      expect(() => require.resolve(`${name}/package.json`), name).not.toThrow()
    }
  })
})
