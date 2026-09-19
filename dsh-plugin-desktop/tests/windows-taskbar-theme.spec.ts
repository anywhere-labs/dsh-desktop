import { describe, expect, it } from 'vitest'
import {
  parsePersonalizeRegistryOutput,
  taskbarUsesLightThemeFromDwords,
  WINDOWS_TASKBAR_THEME_POLL_MS,
} from '../src/windows-taskbar-theme.ts'

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

  it('parses both DWORDs from one reg query output', () => {
    const sample = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize
    SystemUsesLightTheme    REG_DWORD    0x0
    AppsUseLightTheme       REG_DWORD    0x1
`
    expect(parsePersonalizeRegistryOutput(sample)).toEqual({
      systemUsesLightTheme: 0,
      appsUseLightTheme: 1,
    })
  })

  it('uses a slow background poll interval', () => {
    expect(WINDOWS_TASKBAR_THEME_POLL_MS).toBeGreaterThanOrEqual(10_000)
  })
})
