import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopTrayIcons } from '../src/runtime.ts'

const electron = vi.hoisted(() => {
  const template = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const blue = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const darkTaskbar = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const lightTaskbar = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const createFromPath = vi.fn((path: string) => {
    if (path.endsWith('Template.png')) return template
    if (path.endsWith('blue.png')) return blue
    if (path.endsWith('dark-taskbar.png')) return darkTaskbar
    if (path.endsWith('light-taskbar.png')) return lightTaskbar
    throw new Error(`unexpected image path ${path}`)
  })
  return { blue, createFromPath, darkTaskbar, lightTaskbar, template }
})

vi.mock('electron', () => ({
  nativeImage: { createFromPath: electron.createFromPath },
}))

import { prepareTrayIcon } from '../src/tray-icons.ts'

const assets: DesktopTrayIcons = {
  templatePath: '/tmp/tray-iconTemplate.png',
  bluePath: '/tmp/tray-icon-blue.png',
  darkTaskbarPath: '/tmp/tray-icon-win-dark-taskbar.png',
  lightTaskbarPath: '/tmp/tray-icon-win-light-taskbar.png',
}

describe('platform tray icons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electron.template.isEmpty.mockReturnValue(false)
    electron.blue.isEmpty.mockReturnValue(false)
    electron.darkTaskbar.isEmpty.mockReturnValue(false)
    electron.lightTaskbar.isEmpty.mockReturnValue(false)
  })

  it('marks the macOS image as a native template', () => {
    expect(prepareTrayIcon(assets, 'darwin')).toBe(electron.template)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.templatePath)
    expect(electron.template.setTemplateImage).toHaveBeenCalledWith(true)
  })

  it('defaults Windows to the light glyph for dark taskbars', () => {
    expect(prepareTrayIcon(assets, 'win32')).toBe(electron.darkTaskbar)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.darkTaskbarPath)
    expect(electron.template.setTemplateImage).not.toHaveBeenCalled()
  })

  it('keeps the light glyph when Windows explicitly reports a dark taskbar', () => {
    expect(prepareTrayIcon(assets, 'win32', { taskbarUsesLightTheme: false })).toBe(electron.darkTaskbar)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.darkTaskbarPath)
  })

  it('switches Windows to the dark glyph on light taskbars', () => {
    expect(prepareTrayIcon(assets, 'win32', { taskbarUsesLightTheme: true })).toBe(electron.lightTaskbar)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.lightTaskbarPath)
  })

  it('keeps the fixed brand-blue image on Linux', () => {
    expect(prepareTrayIcon(assets, 'linux')).toBe(electron.blue)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.bluePath)
    expect(electron.template.setTemplateImage).not.toHaveBeenCalled()
  })

  it.each([
    ['darwin', 'templatePath', electron.template],
    ['win32', 'darkTaskbarPath', electron.darkTaskbar],
    ['win32', 'lightTaskbarPath', electron.lightTaskbar],
    ['linux', 'bluePath', electron.blue],
  ] as const)('rejects an empty %s tray image from %s', (platform, pathKey, image) => {
    image.isEmpty.mockReturnValueOnce(true)
    const theme = pathKey === 'lightTaskbarPath' ? { taskbarUsesLightTheme: true } : undefined

    expect(() => prepareTrayIcon(assets, platform, theme)).toThrow(
      `failed to load tray icon ${assets[pathKey]}`,
    )
  })
})
