import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativeImage } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import {
  auxiliaryWindowChromeOptions,
  auxiliaryWindowHasCustomFrame,
} from '../src/auxiliary-window-options.ts'
import {
  FileMainWindowStateStore,
  fitMainWindowBounds,
} from '../src/main-window-state.ts'
import { desktopFrameIsVisible } from '../src/native-ui/shared/DesktopFrame.tsx'
import type { DesktopShellSpec } from '../src/runtime.ts'
import {
  ADVANCED_MACOS_TRAFFIC_LIGHT_TOP,
  ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
  DESKTOP_FRAME_HEIGHT,
  DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP,
} from '../src/window-chrome.ts'
import {
  effectiveDesktopWindowMaterial,
  parseLinuxWindowMaterial,
  parseMacosWindowMaterial,
  parseWindowsWindowMaterial,
} from '../src/window-material.ts'
import {
  advancedWindowOptions,
  compatibilityWindowOptions,
  DESKTOP_RENDERER_SESSION_PARTITION,
  desktopWindowOptions,
  extendedWindowOptions,
} from '../src/window-options.ts'

const spec: DesktopShellSpec = {
  mode: 'compatibility',
  macosMaterial: 'transparent',
  windowsMaterial: 'off',
  material: 'off',
  width: 1280,
  height: 840,
  minWidth: 900,
  minHeight: 640,
  url: 'http://127.0.0.1:43120/',
  authenticationUrl: 'http://127.0.0.1:43120/?token=test-token',
  rendererAccessHeader: {
    name: 'x-dsh-desktop-renderer',
    value: Buffer.alloc(32, 8).toString('base64url'),
  },
  productName: 'DSH Desktop',
  windowTitle: 'DeepSeek Harness Desktop',
  iconPath: '/tmp/app-icon.png',
  trayIcons: {
    templatePath: '/tmp/tray-iconTemplate.png',
    bluePath: '/tmp/tray-icon-blue.png',
  },
  readLocalePreference: () => undefined,
  readThemeSource: () => 'system',
  requestQuit: () => {},
  requestModeChange: async () => {},
}

const preload = '/tmp/preload.cjs'
const theme = readFileSync(new URL('../src/native-ui/shared/theme.css', import.meta.url), 'utf8')
const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-main-window-state-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('compatibility BrowserWindow options', () => {
  it('uses an independent 36px macOS frame and enables renderer isolation', () => {
    const icon = {} as NativeImage
    const options = compatibilityWindowOptions(spec, icon, 'darwin', preload)

    expect(options).toEqual(expect.objectContaining({
      title: '',
      width: 1280,
      height: 840,
      minWidth: 900,
      minHeight: 640,
      show: false,
      backgroundColor: '#202124',
      icon,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP },
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: DESKTOP_RENDERER_SESSION_PARTITION,
      },
    }))
    expect(options).not.toHaveProperty('titleBarOverlay')
    expect(DESKTOP_FRAME_HEIGHT).toBe(36)
  })

  it('uses an independent Windows frame with native controls on the left-side action layout', () => {
    const options = compatibilityWindowOptions(spec, {} as NativeImage, 'win32', preload)

    expect(options.title).toBe('DeepSeek Harness Desktop')
    expect(options.backgroundColor).toBe('#202124')
    expect(options.autoHideMenuBar).toBe(true)
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toEqual(expect.objectContaining({ height: DESKTOP_FRAME_HEIGHT }))
  })

  it('keeps the ordinary native frame as the Linux compatibility fallback', () => {
    const options = compatibilityWindowOptions(spec, {} as NativeImage, 'linux', preload)

    expect(options).not.toHaveProperty('titleBarStyle')
    expect(options).not.toHaveProperty('titleBarOverlay')
    expect(options).not.toHaveProperty('trafficLightPosition')
  })

  it('reveals transparent material behind the macOS compatibility frame', () => {
    const options = compatibilityWindowOptions(
      { ...spec, material: 'transparent' },
      {} as NativeImage,
      'darwin',
      preload,
    )

    expect(options).toEqual(expect.objectContaining({
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    }))
  })

  it('rejects an advanced spec before BrowserWindow construction', () => {
    expect(() => compatibilityWindowOptions(
      { ...spec, mode: 'advanced' },
      {} as NativeImage,
      'darwin',
      preload,
    )).toThrow('unsupported compatibility window mode advanced')
  })

  it('uses hidden-inset transparent vibrancy on macOS enhanced windows', () => {
    const advanced = { ...spec, mode: 'advanced' as const, material: 'transparent' as const }
    const options = advancedWindowOptions(advanced, {} as NativeImage, 'darwin', preload)

    expect(options).toEqual(expect.objectContaining({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: ADVANCED_MACOS_TRAFFIC_LIGHT_TOP },
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    }))
    expect(desktopWindowOptions(advanced, {} as NativeImage, 'darwin', preload)).toEqual(options)
  })

  it('uses native Windows controls, shadow, and rounded corners on an opaque enhanced window', () => {
    const options = advancedWindowOptions(
      { ...spec, mode: 'advanced', material: 'off' },
      {} as NativeImage,
      'win32',
      preload,
    )

    expect(options).toEqual(expect.objectContaining({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#7f858f',
        height: ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
      },
      backgroundColor: '#202124',
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    }))
    expect(options).not.toHaveProperty('transparent')
    expect(options).not.toHaveProperty('backgroundMaterial')
  })

  it('uses the taller native caption on an opaque extended Windows window', () => {
    const extended = {
      ...spec,
      mode: 'extended' as const,
      material: 'off' as const,
    }
    const options = extendedWindowOptions(extended, {} as NativeImage, 'win32', preload)

    expect(options).toEqual(expect.objectContaining({
      titleBarStyle: 'hidden',
      titleBarOverlay: expect.objectContaining({ height: DESKTOP_FRAME_HEIGHT }),
      backgroundColor: '#202124',
    }))
    expect(options).not.toHaveProperty('transparent')
    expect(options).not.toHaveProperty('backgroundMaterial')
    expect(DESKTOP_FRAME_HEIGHT).toBe(36)
    expect(desktopWindowOptions(extended, {} as NativeImage, 'win32', preload)).toEqual(options)
  })

  it('centers macOS traffic lights in the 36px extended command bar', () => {
    const options = extendedWindowOptions(
      { ...spec, mode: 'extended', material: 'transparent' },
      {} as NativeImage,
      'darwin',
      preload,
    )

    expect(options.trafficLightPosition).toEqual({ x: 16, y: DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP })
    expect(DESKTOP_FRAME_HEIGHT).toBe(36)
  })

  it('rejects enhanced mode on Linux', () => {
    expect(() => advancedWindowOptions(
      { ...spec, mode: 'advanced' },
      {} as NativeImage,
      'linux',
      preload,
    )).toThrow('supported on macOS and Windows')
  })
})

describe('desktop window material capabilities', () => {
  it('keeps platform preferences portable and always renders Windows opaque', () => {
    expect(effectiveDesktopWindowMaterial('compatibility', 'win32', 'transparent')).toBe('off')
    expect(effectiveDesktopWindowMaterial('extended', 'win32', 'transparent')).toBe('off')
    expect(effectiveDesktopWindowMaterial('advanced', 'win32', 'transparent')).toBe('off')
    expect(effectiveDesktopWindowMaterial('compatibility', 'darwin', 'transparent')).toBe('transparent')
    expect(effectiveDesktopWindowMaterial('extended', 'darwin', 'transparent')).toBe('transparent')
    expect(effectiveDesktopWindowMaterial('extended', 'darwin', 'off')).toBe('off')
  })

  it('resolves Linux generations from their own transparent-or-solid preference', () => {
    expect(effectiveDesktopWindowMaterial(
      'compatibility', 'linux', 'transparent', 'off',
    )).toBe('off')
    expect(effectiveDesktopWindowMaterial(
      'compatibility', 'linux', 'transparent', 'transparent',
    )).toBe('transparent')
    expect(effectiveDesktopWindowMaterial(
      'compatibility', 'linux', 'transparent',
    )).toBe('off')
  })

  it('validates persisted material values independently for each platform', () => {
    expect(parseMacosWindowMaterial(undefined)).toBe('transparent')
    expect(parseWindowsWindowMaterial(undefined)).toBe('off')
    expect(parseWindowsWindowMaterial('off')).toBe('off')
    // Removed Windows materials remain readable and fail closed to opaque.
    expect(parseWindowsWindowMaterial('acrylic')).toBe('off')
    expect(parseWindowsWindowMaterial('mica')).toBe('off')
    expect(parseLinuxWindowMaterial(undefined)).toBe('off')
    expect(parseLinuxWindowMaterial('transparent')).toBe('off')
    expect(() => parseLinuxWindowMaterial('mica')).toThrow('linuxMaterial')
    expect(() => parseMacosWindowMaterial('mica')).toThrow('macosMaterial')
    expect(() => parseWindowsWindowMaterial('transparent')).toThrow('windowsMaterial')
  })
})

describe('Desktop auxiliary window chrome', () => {
  it('uses an empty 36px inset frame on macOS', () => {
    expect(auxiliaryWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 12 },
    })
    expect(auxiliaryWindowHasCustomFrame('darwin')).toBe(true)
  })

  it('uses native caption controls over an empty 36px frame on Windows', () => {
    expect(auxiliaryWindowChromeOptions('win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#7f858f',
        height: 36,
      },
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    })
    expect(auxiliaryWindowHasCustomFrame('win32')).toBe(true)
  })

  it('does not fake native controls on Linux', () => {
    expect(auxiliaryWindowChromeOptions('linux')).toEqual({})
    expect(auxiliaryWindowHasCustomFrame('linux')).toBe(false)
  })

  it('removes both native controls and the renderer frame from action-only dialogs', () => {
    expect(auxiliaryWindowChromeOptions('darwin', false)).toEqual({
      frame: false,
      closable: false,
      minimizable: false,
      maximizable: false,
    })
    expect(auxiliaryWindowHasCustomFrame('darwin', false)).toBe(false)
    expect(auxiliaryWindowHasCustomFrame('win32', false)).toBe(false)
  })
})

describe('Desktop-owned native UI frame', () => {
  it('renders only when the BrowserWindow declares visible custom controls', () => {
    expect(desktopFrameIsVisible('?platform=darwin&frame=true')).toBe(true)
    expect(desktopFrameIsVisible('?platform=win32&frame=true')).toBe(true)
    expect(desktopFrameIsVisible('?platform=darwin&frame=false')).toBe(false)
    expect(desktopFrameIsVisible('?platform=linux')).toBe(false)
    expect(desktopFrameIsVisible('')).toBe(false)
  })

  it('reserves the frame inset when fixed window actions sit before the content', () => {
    expect(theme).toContain('.dshNativeFrame ~ .dshNativeContent')
    expect(theme).not.toContain('.dshNativeFrame + .dshNativeContent')
  })

  it('isolates the app root so body-level dialogs cover the high native frame layer', () => {
    expect(theme).toMatch(/#root\s*\{\s*isolation:\s*isolate;/u)
  })
})

describe('main-window state', () => {
  it('atomically round-trips one validated rectangle', () => {
    const store = new FileMainWindowStateStore(temporaryDirectory())
    expect(store.read()).toBeUndefined()

    const bounds = { x: -1200, y: 48, width: 1360, height: 820 }
    store.write(bounds)

    expect(store.read()).toEqual(bounds)
  })

  it('rejects malformed state instead of constructing an invalid BrowserWindow', () => {
    const store = new FileMainWindowStateStore(temporaryDirectory())
    writeFileSync(store.statePath, '{"version":1,"bounds":{"x":0,"y":0,"width":0,"height":800}}\n')

    expect(() => store.read()).toThrow('dimensions must be positive safe integers')
  })

  it('preserves visible bounds and clamps stale monitor geometry to the work area', () => {
    const workArea = { x: -1440, y: 24, width: 1440, height: 876 }
    const minimum = { width: 900, height: 640 }

    expect(fitMainWindowBounds(
      { x: -1320, y: 80, width: 1280, height: 760 },
      workArea,
      minimum,
    )).toEqual({ x: -1320, y: 80, width: 1280, height: 760 })
    expect(fitMainWindowBounds(
      { x: -1448, y: 0, width: 1280, height: 760 },
      workArea,
      minimum,
    )).toEqual({ x: -1448, y: 0, width: 1280, height: 760 })
    expect(fitMainWindowBounds(
      { x: 4200, y: -800, width: 2000, height: 1400 },
      workArea,
      minimum,
    )).toEqual({ x: -1440, y: 24, width: 1440, height: 876 })
  })
})
