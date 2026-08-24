import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  launchWindowsUninstaller,
  resolveWindowsUninstallerPath,
  windowsUninstallCopy,
} from '../src/windows-uninstall.ts'

const INSTALLED = {
  platform: 'win32' as const,
  isPackaged: true,
  executablePath: 'C:\\Program Files\\DSH Desktop\\DSH Desktop.exe',
  productName: 'DSH Desktop',
}

describe('Windows installed-app uninstall', () => {
  it('resolves only the Electron Builder uninstaller beside an installed Windows app', () => {
    const exists = vi.fn(() => true)

    expect(resolveWindowsUninstallerPath(INSTALLED, exists)).toBe(
      'C:\\Program Files\\DSH Desktop\\Uninstall DSH Desktop.exe',
    )
    expect(exists).toHaveBeenCalledWith(
      'C:\\Program Files\\DSH Desktop\\Uninstall DSH Desktop.exe',
    )

    for (const value of [
      { ...INSTALLED, platform: 'darwin' as const },
      { ...INSTALLED, platform: 'linux' as const },
      { ...INSTALLED, isPackaged: false },
      { ...INSTALLED, productName: '' },
    ]) {
      expect(resolveWindowsUninstallerPath(value, exists)).toBeUndefined()
    }
    expect(resolveWindowsUninstallerPath(INSTALLED, () => false)).toBeUndefined()
  })

  it('keeps data-preservation and destructive-action copy explicit in both locales', () => {
    expect(windowsUninstallCopy('en')).toMatchObject({
      confirm: 'Uninstall',
      cancel: 'Cancel',
      detail: expect.stringContaining('will be kept'),
    })
    expect(windowsUninstallCopy('zh')).toMatchObject({
      confirm: '卸载',
      cancel: '取消',
      detail: expect.stringContaining('会保留'),
    })
  })

  it('launches the assisted uninstaller detached without a command shell', async () => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = vi.fn()
    const spawnProcess = vi.fn(() => child) as unknown as typeof import('node:child_process').spawn

    const launched = launchWindowsUninstaller(
      'C:\\Program Files\\DSH Desktop\\Uninstall DSH Desktop.exe',
      spawnProcess,
    )
    child.emit('spawn')
    await launched

    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Program Files\\DSH Desktop\\Uninstall DSH Desktop.exe',
      [],
      {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false,
      },
    )
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('reports synchronous and asynchronous launch failures', async () => {
    const synchronous = vi.fn(() => { throw new Error('spawn blocked') }) as unknown as typeof import('node:child_process').spawn
    await expect(launchWindowsUninstaller('C:\\Uninstall DSH Desktop.exe', synchronous))
      .rejects.toThrow('spawn blocked')

    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = vi.fn()
    const asynchronous = vi.fn(() => child) as unknown as typeof import('node:child_process').spawn
    const launched = launchWindowsUninstaller('C:\\Uninstall DSH Desktop.exe', asynchronous)
    child.emit('error', new Error('access denied'))
    await expect(launched).rejects.toThrow('access denied')
    expect(child.unref).not.toHaveBeenCalled()
  })
})
