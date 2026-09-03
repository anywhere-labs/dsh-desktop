/** Windows taskbar / notification-area theme (distinct from in-app Electron theme). */

import { execFileSync } from 'node:child_process'

const PERSONALIZE_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

/** Interpret Personalize DWORDs (`1` = light). Prefer taskbar over apps theme. */
export function taskbarUsesLightThemeFromDwords(
  systemUsesLightTheme: number | undefined,
  appsUseLightTheme: number | undefined,
): boolean {
  const value = systemUsesLightTheme ?? appsUseLightTheme
  return value !== undefined && value !== 0
}

function readRegistryDword(valueName: string): number | undefined {
  try {
    const output = execFileSync(
      'reg',
      ['query', PERSONALIZE_KEY, '/v', valueName],
      { encoding: 'utf8', windowsHide: true },
    )
    const hex = output.match(new RegExp(`${valueName}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'iu'))
    if (hex) return Number.parseInt(hex[1]!, 16)
    const decimal = output.match(new RegExp(`${valueName}\\s+REG_DWORD\\s+(\\d+)`, 'iu'))
    if (decimal) return Number.parseInt(decimal[1]!, 10)
  } catch {
    // Missing key or `reg` unavailable — treat as dark taskbar (Win11 default).
  }
  return undefined
}

/** Read whether the Windows taskbar / notification area uses a light theme. */
export function readWindowsTaskbarUsesLightTheme(): boolean {
  return taskbarUsesLightThemeFromDwords(
    readRegistryDword('SystemUsesLightTheme'),
    readRegistryDword('AppsUseLightTheme'),
  )
}
