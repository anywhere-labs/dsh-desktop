import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_INSTALLER_QUIT_FLAG,
  isDesktopBackgroundNodeRequest,
  isDesktopInstallerQuitRequest,
} from '../src/desktop-installer-quit.ts'

describe('Desktop installer quit request', () => {
  it('accepts only the dedicated flag on Windows', () => {
    expect(DESKTOP_INSTALLER_QUIT_FLAG).toBe('--dsh-installer-quit')
    expect(isDesktopInstallerQuitRequest(
      ['DSH Desktop.exe', DESKTOP_INSTALLER_QUIT_FLAG],
      'win32',
    )).toBe(true)
    expect(isDesktopInstallerQuitRequest(['DSH Desktop.exe', '--quit'], 'win32')).toBe(false)
    expect(isDesktopInstallerQuitRequest(
      ['DSH Desktop', DESKTOP_INSTALLER_QUIT_FLAG],
      'darwin',
    )).toBe(false)
  })

  it('distinguishes background Node re-entry from an explicit application launch', () => {
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe'])).toBe(false)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', '--profile', 'desktop'])).toBe(false)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', 'C:\\app\\pnpm\\bin\\pnpm.mjs', 'install'])).toBe(true)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', '--require', 'C:\\runtime\\clear-env.cjs'])).toBe(true)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', '--import=file:///runtime/clear-env.mjs'])).toBe(true)
    expect(isDesktopBackgroundNodeRequest(['DSH Desktop.exe', '--expose-internals', 'desktop-cli.js'])).toBe(true)
  })

  it('handles first- and second-instance requests without showing a window', () => {
    const main = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8')
    const lock = main.indexOf('if (!app.requestSingleInstanceLock())')
    const earlyQuit = main.indexOf(
      'if (isDesktopInstallerQuitRequest(process.argv, process.platform))',
    )
    const startup = main.indexOf('let shutdown: DesktopShutdown')
    const secondInstance = main.indexOf("app.on('second-instance', (_event, argv) => {")
    const secondQuit = main.indexOf(
      'if (isDesktopInstallerQuitRequest(argv, process.platform))',
      secondInstance,
    )
    const backgroundNode = main.indexOf('if (isDesktopBackgroundNodeRequest(argv))', secondInstance)
    const show = main.indexOf('if (!showPreHostSurface()) runtime.show()', secondInstance)

    expect(lock).toBeGreaterThanOrEqual(0)
    expect(earlyQuit).toBeGreaterThan(lock)
    expect(earlyQuit).toBeLessThan(startup)
    expect(secondInstance).toBeGreaterThan(startup)
    expect(secondQuit).toBeGreaterThan(secondInstance)
    expect(backgroundNode).toBeGreaterThan(secondQuit)
    expect(show).toBeGreaterThan(backgroundNode)
    expect(main.slice(secondQuit, backgroundNode)).toContain('requestQuit(0)')
    expect(main.slice(backgroundNode, show)).toContain('return')
  })
})
