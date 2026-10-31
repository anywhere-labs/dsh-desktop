import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()
const execFileMock = vi.fn()
vi.mock('node:child_process', () => {
  const fn = (...args: unknown[]) => execFileMock(...args)
  ;(fn as unknown as Record<symbol, unknown>)[promisify.custom] = (file: string, args: string[], opts: unknown) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFileMock(file, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  return {
    spawn: (...args: unknown[]) => spawnMock(...args),
    execFile: fn,
  }
})

import { assertNextMacBundle, assertNextWindowsInstaller, NextUpdateInstaller } from '../src/update-installer.ts'

const roots: string[] = []
afterEach(async () => {
  spawnMock.mockReset()
  execFileMock.mockReset()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function mockSpawnSuccess() {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = vi.fn()
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
}

it('rejects Stable installers and an unexpected release even when the archive is valid', () => {
  expect(() => assertNextMacBundle('ai.deepseek.dsh.desktop.next', { name: 'dsh-desktop-next', version: '2.0.14-next' }, '2.0.14-next')).not.toThrow()
  expect(() => assertNextMacBundle('ai.deepseek.dsh.desktop', { name: 'dsh-desktop-next', version: '2.0.14-next' }, '2.0.14-next')).toThrow()
  expect(() => assertNextMacBundle('ai.deepseek.dsh.desktop.next', { name: 'dsh-desktop-next', version: '2.0.13-next' }, '2.0.14-next')).toThrow()
  expect(() => assertNextWindowsInstaller({ ProductName: 'DSH NEXT', ProductVersion: '2.0.14-next' }, '2.0.14-next')).not.toThrow()
  expect(() => assertNextWindowsInstaller({ ProductName: 'DSH Desktop', ProductVersion: '2.0.14-next' }, '2.0.14-next')).toThrow()
})

it('launches the Windows NSIS installer visibly without /S so progress is shown before auto-restarting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'next-win-update-')); roots.push(root)
  const exe = join(root, 'DSH-NEXT-Setup-2.0.18-next.1.exe')
  await writeFile(exe, 'installer')
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, JSON.stringify({
      ProductName: 'DSH NEXT',
      ProductVersion: '2.0.18-next.1',
    }), '')
  })
  mockSpawnSuccess()
  const installer = new NextUpdateInstaller({
    platform: 'win32',
    executable: 'C:\\Users\\user\\AppData\\Local\\Programs\\DSH NEXT\\DSH NEXT.exe',
    log: vi.fn(),
  })
  await installer.prepare(exe, '2.0.18-next.1', root, new AbortController().signal)
  await installer.stage()
  await installer.launch()
  expect(spawnMock).toHaveBeenCalledOnce()
  expect(spawnMock).toHaveBeenCalledWith(
    exe,
    ['--updated', '--force-run'],
    expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: false }),
  )
})

it('stages the verified macOS app bundle and launches the detached progress updater script', async () => {
  const root = await mkdtemp(join(tmpdir(), 'next-mac-update-')); roots.push(root)
  const applications = join(root, 'Applications')
  const installedBundle = join(applications, 'DSH NEXT.app')
  const installedExecutable = join(installedBundle, 'Contents', 'MacOS', 'DSH NEXT')
  await mkdir(join(installedBundle, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(installedExecutable, 'binary')
  const staging = join(root, 'staging')
  await mkdir(staging, { recursive: true })
  const dmg = join(staging, 'DSH-NEXT-2.0.18-next.1.dmg')
  await writeFile(dmg, 'dmg')

  execFileMock.mockImplementation((file: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (file === '/usr/bin/hdiutil' && args[0] === 'attach') {
      const mountPoint = args[args.indexOf('-mountpoint') + 1]!
      const mountedBundle = join(mountPoint, 'DSH NEXT.app')
      mkdir(join(mountedBundle, 'Contents', 'Resources', 'app'), { recursive: true })
        .then(() => writeFile(join(mountedBundle, 'Contents', 'Resources', 'app', 'package.json'), JSON.stringify({
          name: 'dsh-desktop-next',
          version: '2.0.18-next.1',
        })))
        .then(() => callback(null, '', ''), err => callback(err as Error, '', ''))
      return
    }
    if (file === '/usr/libexec/PlistBuddy') {
      callback(null, 'ai.deepseek.dsh.desktop.next\n', '')
      return
    }
    if (file === '/usr/bin/codesign' && args[0] === '--verify') {
      callback(null, '', '')
      return
    }
    if (file === '/usr/bin/codesign' && args[0] === '-dv') {
      callback(null, '', 'TeamIdentifier=742992243H\n')
      return
    }
    if (file === '/usr/bin/ditto') {
      const destination = args[1]!
      mkdir(destination, { recursive: true }).then(() => callback(null, '', ''), err => callback(err as Error, '', ''))
      return
    }
    if (file === '/usr/bin/hdiutil' && args[0] === 'detach') {
      callback(null, '', '')
      return
    }
    callback(new Error(`Unexpected execFile: ${file} ${args.join(' ')}`), '', '')
  })
  mockSpawnSuccess()

  const installer = new NextUpdateInstaller({
    platform: 'darwin',
    executable: installedExecutable,
    language: () => 'zh-CN',
    log: vi.fn(),
  })
  await installer.prepare(dmg, '2.0.18-next.1', staging, new AbortController().signal)
  await installer.stage()
  await installer.launch()

  expect(spawnMock).toHaveBeenCalledOnce()
  const [command, args, spawnOptions] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string>; detached: boolean }]
  expect(command).toBe('/bin/sh')
  expect(args[0]).toBe('-c')
  expect(spawnOptions.detached).toBe(true)
  expect(spawnOptions.env.DSH_UPDATE_STAGED).toBe(join(staging, 'DSH NEXT.app'))
  expect(spawnOptions.env.DSH_UPDATE_INSTALLED).toBe(installedBundle)
  expect(spawnOptions.env.DSH_UPDATE_MESSAGE).toContain('2.0.18-next.1')
})
