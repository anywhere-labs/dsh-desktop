import { describe, expect, it } from 'vitest'
import { taskbarUsesLightThemeFromDwords } from '../src/windows-taskbar-theme.ts'

describe('windows taskbar theme', () => {
  it('prefers SystemUsesLightTheme over AppsUseLightTheme', () => {
    expect(taskbarUsesLightThemeFromDwords(1, 0)).toBe(true)
    expect(taskbarUsesLightThemeFromDwords(0, 1)).toBe(false)
  })

  it('falls back to AppsUseLightTheme when SystemUsesLightTheme is missing', () => {
    expect(taskbarUsesLightThemeFromDwords(undefined, 1)).toBe(true)
    expect(taskbarUsesLightThemeFromDwords(undefined, 0)).toBe(false)
  })

  it('defaults to dark taskbar when both DWORDs are missing', () => {
    expect(taskbarUsesLightThemeFromDwords(undefined, undefined)).toBe(false)
  })
})
