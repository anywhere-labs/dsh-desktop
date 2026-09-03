import { describe, expect, it, vi } from 'vitest'
import {
  parseWindowsTaskbarUsesLightTheme,
  readWindowsTaskbarUsesLightTheme,
  WINDOWS_PERSONALIZE_KEY,
} from '../src/windows-taskbar-theme.ts'

function personalizeQuery(system?: string, apps?: string): string {
  const rows: string[] = []
  if (system !== undefined) rows.push(`    SystemUsesLightTheme    REG_DWORD    ${system}`)
  if (apps !== undefined) rows.push(`    AppsUseLightTheme    REG_DWORD    ${apps}`)
  return [WINDOWS_PERSONALIZE_KEY, ...rows].join('\r\n')
}

describe('windows taskbar theme', () => {
  it('prefers the taskbar-specific system flag over the app flag', () => {
    expect(parseWindowsTaskbarUsesLightTheme(personalizeQuery('0x0', '0x1'))).toBe(false)
    expect(parseWindowsTaskbarUsesLightTheme(personalizeQuery('0x1', '0x0'))).toBe(true)
  })

  it('falls back to the app flag when the system flag is absent', () => {
    expect(parseWindowsTaskbarUsesLightTheme(personalizeQuery(undefined, '0x1'))).toBe(true)
    expect(parseWindowsTaskbarUsesLightTheme(personalizeQuery(undefined, '0x0'))).toBe(false)
  })

  it('keeps the dark-taskbar default when both flags are absent', () => {
    expect(parseWindowsTaskbarUsesLightTheme(personalizeQuery())).toBe(false)
    expect(parseWindowsTaskbarUsesLightTheme('unexpected reg output')).toBe(false)
  })

  it('issues exactly one query per read and defaults to dark taskbar on failure', async () => {
    const query = vi.fn(async () => personalizeQuery('0x1'))

    await expect(readWindowsTaskbarUsesLightTheme(query)).resolves.toBe(true)
    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith(WINDOWS_PERSONALIZE_KEY)

    await expect(readWindowsTaskbarUsesLightTheme(async () => {
      throw new Error('reg query unavailable')
    })).resolves.toBe(false)
  })
})
