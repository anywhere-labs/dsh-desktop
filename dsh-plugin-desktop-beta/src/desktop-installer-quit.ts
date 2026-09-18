/** Windows installer flag that requests an orderly Desktop shutdown. */
export const DESKTOP_INSTALLER_QUIT_FLAG = '--dsh-installer-quit'

/** Return whether one process invocation belongs to the installer quit handoff. */
export function isDesktopInstallerQuitRequest(
  argv: readonly string[],
  platform: NodeJS.Platform,
): boolean {
  return platform === 'win32' && argv.includes(DESKTOP_INSTALLER_QUIT_FLAG)
}

const NODE_ENTRY = /\.(?:c|m)?js$/iu

/**
 * Identify an Electron executable that was accidentally re-entered as a GUI
 * while a background Node command was trying to launch a descendant.
 *
 * Desktop does not accept JavaScript documents or Node loader flags as GUI
 * launch arguments. Suppressing these requests therefore preserves explicit
 * application launches while preventing an internal command from focusing the
 * existing window if its RunAsNode environment is ever lost.
 */
export function isDesktopBackgroundNodeRequest(argv: readonly string[]): boolean {
  return argv.slice(1).some(argument => {
    const normalized = argument.replace(/^file:\/\//iu, '').split(/[?#]/u, 1)[0] ?? ''
    return NODE_ENTRY.test(normalized)
      || argument === '--require'
      || argument.startsWith('--require=')
      || argument === '--import'
      || argument.startsWith('--import=')
      || argument === '--expose-internals'
  })
}
