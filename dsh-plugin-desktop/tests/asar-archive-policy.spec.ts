import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { disableAsarArchiveView, type AsarArchiveProcess } from '../src/asar-archive-policy.ts'

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
