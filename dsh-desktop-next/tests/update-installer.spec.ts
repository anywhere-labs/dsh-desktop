import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ autoUpdater: { on: vi.fn() } }))
import { assertNextMacBundle, assertNextWindowsInstaller } from '../src/update-installer.ts'

it('rejects Stable/Beta installers and an unexpected release even when the archive is valid', () => {
  expect(() => assertNextMacBundle('ai.deepseek.dsh.desktop.next', { name: 'dsh-desktop-next', version: '2.0.14-next' }, '2.0.14-next')).not.toThrow()
  expect(() => assertNextMacBundle('ai.deepseek.dsh.desktop.beta', { name: 'dsh-desktop-next', version: '2.0.14-next' }, '2.0.14-next')).toThrow()
  expect(() => assertNextMacBundle('ai.deepseek.dsh.desktop.next', { name: 'dsh-desktop-next', version: '2.0.13-next' }, '2.0.14-next')).toThrow()
  expect(() => assertNextWindowsInstaller({ ProductName: 'DSH NEXT', ProductVersion: '2.0.14-next' }, '2.0.14-next')).not.toThrow()
  expect(() => assertNextWindowsInstaller({ ProductName: 'DSH Desktop Beta', ProductVersion: '2.0.14-next' }, '2.0.14-next')).toThrow()
})
