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
  const createFromPath = vi.fn((path: string) => {
    if (path.endsWith('Template.png')) return template
    if (path.endsWith('blue.png')) return blue
    throw new Error(`unexpected image path ${path}`)
  })
  return { blue, createFromPath, template }
})

vi.mock('electron', () => ({
  nativeImage: { createFromPath: electron.createFromPath },
}))

import { prepareTrayIcon } from '../src/tray-icons.ts'

const assets: DesktopTrayIcons = {
  templatePath: '/tmp/tray-iconTemplate.png',
  bluePath: '/tmp/tray-icon-blue.png',
}

describe('platform tray icons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electron.template.isEmpty.mockReturnValue(false)
    electron.blue.isEmpty.mockReturnValue(false)
  })

  it('marks the macOS image as a native template', () => {
    expect(prepareTrayIcon(assets, 'darwin')).toBe(electron.template)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.templatePath)
    expect(electron.template.setTemplateImage).toHaveBeenCalledWith(true)
  })

  it.each(['win32', 'linux'] satisfies DesktopPlatform[])('%s uses the fixed brand-blue image', (platform) => {
    expect(prepareTrayIcon(assets, platform)).toBe(electron.blue)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.bluePath)
    expect(electron.template.setTemplateImage).not.toHaveBeenCalled()
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
