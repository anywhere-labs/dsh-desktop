import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { crashDumpInventory, startCrashReporting } from '../src/crash-reporting.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('starts Crashpad locally only, annotating the Desktop and dsh versions', () => {
  const start = vi.fn()
  startCrashReporting({ start }, { productName: 'DSH Desktop Beta', version: '2.0.21-beta.1', dsh: '0.2.2-alpha.2' })
  startCrashReporting({ start }, { productName: 'DSH Desktop Beta', version: '2.0.21-beta.1', dsh: undefined })
  expect(start.mock.calls).toEqual([
    [{ productName: 'DSH Desktop Beta', uploadToServer: false, globalExtra: { appVersion: '2.0.21-beta.1', dshVersion: '0.2.2-alpha.2' } }],
    [{ productName: 'DSH Desktop Beta', uploadToServer: false, globalExtra: { appVersion: '2.0.21-beta.1' } }],
  ])
})

it('lists the newest minidumps across Crashpad report folders and tolerates a missing directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'next-crashpad-')); roots.push(root)
  expect(crashDumpInventory(join(root, 'missing'))).toEqual({ count: 0, files: [] })
  for (const [folder, name, seconds] of [['pending', 'old.dmp', 100], ['completed', 'new.dmp', 300], ['reports', 'middle.dmp', 200]] as const) {
    mkdirSync(join(root, folder), { recursive: true })
    writeFileSync(join(root, folder, name), 'x')
    utimesSync(join(root, folder, name), seconds, seconds)
  }
  writeFileSync(join(root, 'pending', 'report.meta'), 'not a dump')
  expect(crashDumpInventory(root, 2)).toEqual({ count: 3, files: [
    { name: 'completed/new.dmp', bytes: 1, modified: new Date(300_000).toISOString() },
    { name: 'reports/middle.dmp', bytes: 1, modified: new Date(200_000).toISOString() },
  ] })
})
