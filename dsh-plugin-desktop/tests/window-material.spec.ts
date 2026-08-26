import { describe, expect, it } from 'vitest'
import {
  effectiveDesktopWindowMaterial,
  parseMacosWindowMaterial,
  parseWindowsWindowMaterial,
  windowsBuildNumber,
  windowsSupportsAcrylic,
  windowsSupportsMica,
  windowsSupportsRoundedCorners,
  windowsSupportsSystemBackdrop,
  windowsUsesLegacyAcrylic,
} from '../src/window-material.ts'

describe('desktop window material capabilities', () => {
  it('parses Windows build numbers and gates the two backdrop families', () => {
    expect(windowsBuildNumber('10.0.19045')).toBe(19_045)
    expect(windowsBuildNumber('10.0.22621.4317')).toBe(22_621)
    expect(windowsBuildNumber('Darwin Kernel Version 25.0.0')).toBeUndefined()
    expect(windowsSupportsAcrylic(17_763)).toBe(true)
    expect(windowsSupportsRoundedCorners(21_999)).toBe(false)
    expect(windowsSupportsRoundedCorners(22_000)).toBe(true)
    expect(windowsSupportsSystemBackdrop(22_000)).toBe(false)
    expect(windowsSupportsSystemBackdrop(22_621)).toBe(true)
    expect(windowsUsesLegacyAcrylic(19_045)).toBe(true)
    expect(windowsUsesLegacyAcrylic(22_000)).toBe(false)
    expect(windowsSupportsMica(19_045)).toBe(false)
    expect(windowsSupportsMica(22_621)).toBe(true)
  })

  it('keeps platform preferences portable while capability-gating the generation', () => {
    expect(effectiveDesktopWindowMaterial(
      'compatibility', 'win32', 'transparent', 'mica', 22_631,
    )).toBe('mica')
    expect(effectiveDesktopWindowMaterial(
      'compatibility', 'darwin', 'transparent', 'mica', undefined,
    )).toBe('transparent')
    expect(effectiveDesktopWindowMaterial(
      'extended', 'darwin', 'transparent', 'mica', undefined,
    )).toBe('transparent')
    expect(effectiveDesktopWindowMaterial(
      'extended', 'win32', 'transparent', 'mica', 19_045,
    )).toBe('acrylic')
    expect(effectiveDesktopWindowMaterial(
      'extended', 'win32', 'transparent', 'mica', 22_000,
    )).toBe('off')
    expect(effectiveDesktopWindowMaterial(
      'extended', 'win32', 'transparent', 'acrylic', 22_000,
    )).toBe('off')
    expect(effectiveDesktopWindowMaterial(
      'extended', 'win32', 'transparent', 'mica', 22_631,
    )).toBe('mica')
    expect(effectiveDesktopWindowMaterial(
      'extended', 'win32', 'transparent', 'acrylic', 22_631,
    )).toBe('acrylic')
    expect(effectiveDesktopWindowMaterial(
      'extended', 'win32', 'transparent', 'acrylic', 10_240,
    )).toBe('off')
  })

  it('validates persisted material values independently for each platform', () => {
    expect(parseMacosWindowMaterial(undefined)).toBe('transparent')
    expect(parseWindowsWindowMaterial(undefined)).toBe('acrylic')
    expect(() => parseMacosWindowMaterial('mica')).toThrow('macosMaterial')
    expect(() => parseWindowsWindowMaterial('transparent')).toThrow('windowsMaterial')
  })
})
