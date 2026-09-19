/** Windows taskbar / notification-area theme (distinct from in-app Electron theme). */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PERSONALIZE_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

/** Background poll interval when no focus/resume events fire. */
export const WINDOWS_TASKBAR_THEME_POLL_MS = 15_000

/** Interpret Personalize DWORDs (`1` = light). Prefer taskbar over apps theme. */
export function taskbarUsesLightThemeFromDwords(
  systemUsesLightTheme: number | undefined,
  appsUseLightTheme: number | undefined,
): boolean {
  const value = systemUsesLightTheme ?? appsUseLightTheme
  return value !== undefined && value !== 0
}

function readRegistryDword(output: string, valueName: string): number | undefined {
  const hex = output.match(new RegExp(`${valueName}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'iu'))
  if (hex) return Number.parseInt(hex[1]!, 16)
  const decimal = output.match(new RegExp(`${valueName}\\s+REG_DWORD\\s+(\\d+)`, 'iu'))
  if (decimal) return Number.parseInt(decimal[1]!, 10)
  return undefined
}

/** Parse both theme DWORDs from one `reg query` on the Personalize key. */
export function parsePersonalizeRegistryOutput(output: string): {
  systemUsesLightTheme: number | undefined
  appsUseLightTheme: number | undefined
} {
  return {
    systemUsesLightTheme: readRegistryDword(output, 'SystemUsesLightTheme'),
    appsUseLightTheme: readRegistryDword(output, 'AppsUseLightTheme'),
  }
}

function readPersonalizeRegistrySync(): ReturnType<typeof parsePersonalizeRegistryOutput> {
  try {
    const output = execFileSync(
      'reg',
      ['query', PERSONALIZE_KEY],
      { encoding: 'utf8', windowsHide: true },
    )
    return parsePersonalizeRegistryOutput(output)
  } catch {
    return { systemUsesLightTheme: undefined, appsUseLightTheme: undefined }
  }
}

async function readPersonalizeRegistryAsync(): Promise<ReturnType<typeof parsePersonalizeRegistryOutput>> {
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', PERSONALIZE_KEY],
      { encoding: 'utf8', windowsHide: true },
    )
    return parsePersonalizeRegistryOutput(stdout)
  } catch {
    return { systemUsesLightTheme: undefined, appsUseLightTheme: undefined }
  }
}

/** Read whether the Windows taskbar / notification area uses a light theme. */
export function readWindowsTaskbarUsesLightTheme(): boolean {
  const { systemUsesLightTheme, appsUseLightTheme } = readPersonalizeRegistrySync()
  return taskbarUsesLightThemeFromDwords(systemUsesLightTheme, appsUseLightTheme)
}

/** Async variant for background refresh without blocking the main process. */
export async function readWindowsTaskbarUsesLightThemeAsync(): Promise<boolean> {
  const { systemUsesLightTheme, appsUseLightTheme } = await readPersonalizeRegistryAsync()
  return taskbarUsesLightThemeFromDwords(systemUsesLightTheme, appsUseLightTheme)
}
