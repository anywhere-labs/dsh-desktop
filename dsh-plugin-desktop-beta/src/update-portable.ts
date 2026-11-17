/** Windows copies run from the portable ZIP, which the in-app installer cannot replace. */
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

/**
 * Setup writes `Uninstall <executable name>.exe` into every installation, and the portable ZIP carries no uninstaller.
 * An in-app update runs Setup with `--updated`, which skips the directory page and replaces the installation Windows
 * recorded, or installs a second copy under %LOCALAPPDATA%\Programs when there is none (#1674). A portable copy
 * therefore updates by hand from the release page.
 * @param platform - Platform the application runs on.
 * @param packaged - Whether the application runs from a package rather than from source.
 * @param executable - Path of the application executable.
 * @param exists - File probe, replaced in tests.
 * @returns Whether this is a packaged Windows copy that Setup did not install.
 */
export function isWindowsPortableCopy(platform: string, packaged: boolean, executable: string,
  exists: (path: string) => boolean = existsSync): boolean {
  if (platform !== 'win32' || !packaged) return false
  const name = win32.basename(executable).replace(/\.exe$/iu, '')
  return !exists(win32.join(win32.dirname(executable), `Uninstall ${name}.exe`))
}
