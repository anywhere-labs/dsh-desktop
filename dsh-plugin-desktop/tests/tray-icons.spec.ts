import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopPlatform, DesktopTrayIcons } from '../src/runtime.ts'

const electron = vi.hoisted(() => {
  const template = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const blue = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const winDark = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const createFromPath = vi.fn((path: string) => {
    if (path.endsWith('Template.png')) return template
    if (path.endsWith('win-dark-taskbar.png')) return winDark
    if (path.endsWith('blue.png')) return blue
    throw new Error(`unexpected image path ${path}`)
  })
  return { blue, createFromPath, template, winDark }
})

const theme = vi.hoisted(() => ({
  readWindowsTaskbarUsesLightTheme: vi.fn(() => true),
}))

vi.mock('electron', () => ({
  nativeImage: { createFromPath: electron.createFromPath },
}))

vi.mock('../src/windows-taskbar-theme.ts', () => theme)

import { prepareTrayIcon, resolveTrayIconPath } from '../src/tray-icons.ts'

const assets: DesktopTrayIcons = {
  templatePath: '/tmp/tray-iconTemplate.png',
  bluePath: '/tmp/tray-icon-blue.png',
  winDarkTaskbarPath: '/tmp/tray-icon-win-dark-taskbar.png',
}

describe('platform tray icons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electron.template.isEmpty.mockReturnValue(false)
    electron.blue.isEmpty.mockReturnValue(false)
    electron.winDark.isEmpty.mockReturnValue(false)
    theme.readWindowsTaskbarUsesLightTheme.mockReturnValue(true)
  })

  it('marks the macOS image as a native template', () => {
    expect(prepareTrayIcon(assets, 'darwin')).toBe(electron.template)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.templatePath)
    expect(electron.template.setTemplateImage).toHaveBeenCalledWith(true)
  })

  it('uses the brand-blue image on Linux', () => {
    expect(prepareTrayIcon(assets, 'linux')).toBe(electron.blue)
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.bluePath)
  })

  it('uses the brand-blue image on Windows light taskbars', () => {
    theme.readWindowsTaskbarUsesLightTheme.mockReturnValue(true)

    expect(prepareTrayIcon(assets, 'win32')).toBe(electron.blue)
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.bluePath)
  })

  it('uses the white glyph on Windows dark taskbars', () => {
    theme.readWindowsTaskbarUsesLightTheme.mockReturnValue(false)

    expect(prepareTrayIcon(assets, 'win32')).toBe(electron.winDark)
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.winDarkTaskbarPath)
  })

  it('honors an explicit Windows taskbar override', () => {
    expect(resolveTrayIconPath(assets, 'win32', false)).toBe(assets.winDarkTaskbarPath)
    expect(resolveTrayIconPath(assets, 'win32', true)).toBe(assets.bluePath)
  })

  it.each([
    ['darwin', 'templatePath', electron.template],
    ['win32', 'bluePath', electron.blue],
  ] as const)('rejects an empty %s tray image', (platform, pathKey, image) => {
    image.isEmpty.mockReturnValueOnce(true)

    expect(() => prepareTrayIcon(assets, platform)).toThrow(
      `failed to load tray icon ${assets[pathKey]}`,
    )
  })
})
