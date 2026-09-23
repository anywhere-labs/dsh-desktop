/** Electron single-instance ownership before any Desktop profile lifecycle begins. */
import { isDesktopInstallerQuitRequest } from '../../dsh-plugin-desktop-beta/src/desktop-installer-quit.ts'

/** Minimal Electron application operations needed for instance ownership. */
export interface DesktopSingleInstanceApplication {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: (event?: unknown, argv?: string[]) => void): unknown
}

/**
 * Claim the process-lifetime Desktop lock and route later launches to the owner.
 * @param application - Electron application singleton.
 * @param focusOwner - focus or recreate the primary window after a later launch.
 * @returns true only in the process that may access the Desktop profile.
 */
export function claimDesktopSingleInstance(
  application: DesktopSingleInstanceApplication,
  focusOwner: () => void,
  invocation = { platform: process.platform, argv: process.argv },
): boolean {
  if (!application.requestSingleInstanceLock()) {
    application.quit()
    return false
  }
  if (isDesktopInstallerQuitRequest(invocation.argv, invocation.platform)) { application.quit(); return false }
  application.on('second-instance', (_event, argv = []) => {
    if (isDesktopInstallerQuitRequest(argv, invocation.platform)) application.quit()
    else focusOwner()
  })
  return true
}
