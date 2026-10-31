import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { disableAsarArchiveView, insideArchive, unpackedPath, type AsarArchiveProcess } from '../src/asar-archive-policy.ts'

const root = join(tmpdir(), 'DSH Desktop', 'resources')
const moduleIn = (...segments: string[]): string => pathToFileURL(join(root, ...segments)).href

describe('Electron asar archive view', () => {
  it('turns the archive view off for code shipped unpacked', () => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn('app', 'lib', 'host-process-entry.js'), proc)).toBe(true)
    expect(proc.noAsar).toBe(true)
  })

  it('treats a directory that merely mentions asar as unpacked code', () => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn('app', 'node_modules', 'asar-helper', 'lib', 'index.js'), proc)).toBe(true)
    expect(proc.noAsar).toBe(true)
  })

  it.each([
    ['app.asar', 'lib', 'host-process-entry.js'],
    ['app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'],
    ['APP.ASAR', 'lib', 'desktop-cli.js'],
  ])('keeps the archive view for code loaded from %s', (...segments) => {
    const proc: AsarArchiveProcess = {}
    expect(disableAsarArchiveView(moduleIn(...segments), proc)).toBe(false)
    expect(proc.noAsar).toBeUndefined()
  })
})

describe('archive path mapping', () => {
  it('maps a path inside app.asar to its unpacked sibling and leaves every other path alone', () => {
    expect(unpackedPath('/Applications/DSH Desktop Beta.app/Contents/Resources/app.asar/node_modules/pnpm/bin/pnpm.mjs'))
      .toBe('/Applications/DSH Desktop Beta.app/Contents/Resources/app.asar.unpacked/node_modules/pnpm/bin/pnpm.mjs')
    expect(unpackedPath('C:\\Program Files\\DSH Desktop Beta\\resources\\app.asar\\scripts\\node-bin'))
      .toBe('C:\\Program Files\\DSH Desktop Beta\\resources\\app.asar.unpacked\\scripts\\node-bin')
    expect(unpackedPath('/x/app.asar')).toBe('/x/app.asar.unpacked')
    for (const path of ['/x/app.asar.unpacked/lib/a.js', '/repo/dsh-plugin-desktop-beta/lib/host.js', '/x/node_modules/asar-helper/lib/index.js']) {
      expect(unpackedPath(path)).toBe(path)
    }
  })

  it('recognizes only paths that run through the archive itself', () => {
    expect(insideArchive('/Applications/DSH Desktop Beta.app/Contents/Resources/app.asar/package.json')).toBe(true)
    expect(insideArchive('C:\\DSH\\resources\\APP.ASAR\\lib\\main.js')).toBe(true)
    expect(insideArchive('/x/app.asar.unpacked/node_modules/pnpm/bin/pnpm.mjs')).toBe(false)
    expect(insideArchive('/repo/dsh-plugin-desktop-beta/package.json')).toBe(false)
    expect(insideArchive('/x/node_modules/asar-helper/lib/index.js')).toBe(false)
  })
})
