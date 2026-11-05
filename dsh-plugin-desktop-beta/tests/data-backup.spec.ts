import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { assertBackupLocation, backupDirectoryName, copyDataDirectory } from '../src/data-backup.ts'

const directories: string[] = []
function directory() { const path = mkdtempSync(join(tmpdir(), 'next-data-backup-')); directories.push(path); return path }
afterEach(() => directories.splice(0).forEach(path => { chmodTree(path); rmSync(path, { recursive: true, force: true }) }))
function chmodTree(path: string): void { try { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) chmodTree(join(path, entry.name)); else if (entry.isFile()) chmodSync(join(path, entry.name), 0o600) } catch { /* Best-effort cleanup. */ } }

it('names a backup after the data directory and the local time', () => {
  const at = new Date(2026, 9, 26, 17, 30, 5)
  expect(backupDirectoryName(join('/users', 'me', '.dsh'), at)).toBe('dsh-backup-20261026-173005')
  expect(backupDirectoryName(join('/data', 'DSH Data'), at)).toBe('DSH Data-backup-20261026-173005')
})

it('copies the data without Chromium state or a former choice file, keeping links inside the copy', async () => {
  const source = directory(), parent = directory(), outside = directory()
  const modules = join(source, 'profiles', 'desktop', 'node_modules')
  mkdirSync(join(modules, '.pnpm', 'package'), { recursive: true })
  writeFileSync(join(source, 'profiles', 'desktop', 'package.json'), '{}')
  writeFileSync(join(modules, '.pnpm', 'package', 'index.js'), 'export {}\n')
  writeFileSync(join(source, '.credentials.yaml'), 'kept: true\n')
  mkdirSync(join(source, 'electron-user-data', 'Partitions'), { recursive: true })
  writeFileSync(join(source, 'electron-user-data', 'Cookies'), 'live')
  writeFileSync(join(source, 'desktop-next-location.json'), JSON.stringify({ home: outside }))
  // pnpm on Windows links packages with absolute junctions into the same Profile.
  symlinkSync(join(modules, '.pnpm', 'package'), join(modules, 'absolute'), 'junction')
  // Projections of an installed application point outside every data directory.
  symlinkSync(outside, join(modules, 'external'), 'junction')
  if (process.platform !== 'win32') symlinkSync(join('.pnpm', 'package'), join(modules, 'relative'))
  const destination = join(parent, 'backup')

  await copyDataDirectory(source, destination)

  expect(readdirSync(parent)).toEqual(['backup'])
  expect(readFileSync(join(destination, '.credentials.yaml'), 'utf8')).toBe('kept: true\n')
  expect(readFileSync(join(destination, 'profiles', 'desktop', 'package.json'), 'utf8')).toBe('{}')
  expect(existsSync(join(destination, 'electron-user-data'))).toBe(false)
  expect(existsSync(join(destination, 'desktop-next-location.json'))).toBe(false)
  const copied = join(destination, 'profiles', 'desktop', 'node_modules')
  expect(realpathSync(join(copied, 'absolute'))).toBe(realpathSync(join(copied, '.pnpm', 'package')))
  expect(realpathSync(join(copied, 'external'))).toBe(realpathSync(outside))
  if (process.platform !== 'win32') expect(readlinkSync(join(copied, 'relative'))).toBe(join('.pnpm', 'package'))
  // The copy stands on its own once the original is gone.
  rmSync(source, { recursive: true })
  expect(readFileSync(join(copied, 'absolute', 'index.js'), 'utf8')).toBe('export {}\n')
})

it('refuses a destination inside the data directory or one that exists', async () => {
  const source = directory(), parent = directory()
  expect(() => assertBackupLocation(source, join(source, 'backup'))).toThrow('outside')
  expect(() => assertBackupLocation(source, resolve(parent, 'backup'))).not.toThrow()
  await expect(copyDataDirectory(source, join(source, 'backup'))).rejects.toThrow('outside')
  mkdirSync(join(parent, 'backup'))
  await expect(copyDataDirectory(source, join(parent, 'backup'))).rejects.toThrow('already exists')
  expect(readdirSync(source)).toEqual([])
})

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('removes an interrupted copy so it is never taken for a whole backup', async () => {
  const source = directory(), parent = directory()
  writeFileSync(join(source, 'settings.yaml'), 'kept: true\n')
  mkdirSync(join(source, 'sessions'))
  writeFileSync(join(source, 'sessions', 'unreadable.jsonl'), '{}\n')
  chmodSync(join(source, 'sessions', 'unreadable.jsonl'), 0o000)
  await expect(copyDataDirectory(source, join(parent, 'backup'))).rejects.toThrow()
  expect(readdirSync(parent)).toEqual([])
  expect(readFileSync(join(source, 'settings.yaml'), 'utf8')).toBe('kept: true\n')
})
