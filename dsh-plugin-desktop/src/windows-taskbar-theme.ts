/** Windows taskbar theme detection for the tray glyph, from one registry query. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Single HKCU key that holds the taskbar (system) and app light-theme flags. */
export const WINDOWS_PERSONALIZE_KEY
  = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

/** Query runner consumed by tests; the default shells out to `reg query` once. */
export type WindowsTaskbarQuery = (key: string) => Promise<string>

function parseLightFlag(output: string, valueName: string): boolean | undefined {
  const match = output.match(new RegExp(`${valueName}\\s+REG_DWORD\\s+0x([0-9a-fA-F]+)`, 'u'))
  if (match === null || match[1] === undefined) return undefined
  return (Number.parseInt(match[1], 16) & 1) === 1
}

/**
 * Decide whether the Windows taskbar uses the light theme.
 * `SystemUsesLightTheme` wins; `AppsUseLightTheme` covers builds that omit it;
 * a missing key keeps the dark-taskbar default so the glyph stays visible.
 */
export function parseWindowsTaskbarUsesLightTheme(output: string): boolean {
  return parseLightFlag(output, 'SystemUsesLightTheme')
    ?? parseLightFlag(output, 'AppsUseLightTheme')
    ?? false
}

export const defaultWindowsTaskbarQuery: WindowsTaskbarQuery = async (key) => {
  const { stdout } = await execFileAsync('reg', ['query', key], {
    timeout: 3000,
    windowsHide: true,
  })
  return stdout
}

/**
 * Read the live Windows taskbar light-theme flag with exactly one registry query.
 * @returns true when the taskbar uses the light theme; false for dark taskbars and all failures.
 */
export async function readWindowsTaskbarUsesLightTheme(
  query: WindowsTaskbarQuery = defaultWindowsTaskbarQuery,
): Promise<boolean> {
  try {
    return parseWindowsTaskbarUsesLightTheme(await query(WINDOWS_PERSONALIZE_KEY))
  } catch {
    return false
  }
}
