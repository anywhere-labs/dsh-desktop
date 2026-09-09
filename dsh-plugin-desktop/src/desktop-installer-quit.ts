import { statSync } from 'node:fs'
import { resolve } from 'node:path'

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
 * Desktop accepts directories, including names ending in .js, but does not
 * accept JavaScript documents or Node loader flags as GUI launch arguments. Suppressing these requests therefore preserves explicit
 * application launches while preventing an internal command from focusing the
 * existing window if its RunAsNode environment is ever lost.
 */
export function isDesktopBackgroundNodeRequest(argv: readonly string[], cwd?: string): boolean {
  const args = argv[1] === '--' ? argv.slice(2) : argv.slice(1)
  // Only structured Desktop launch arguments supply cwd. A script-looking directory
  // is a workspace; actual scripts and loader flags retain the background guard.
  if (cwd !== undefined && args.length === 1 && NODE_ENTRY.test(args[0]!)) {
    try { if (statSync(resolve(cwd, args[0]!)).isDirectory()) return false } catch { /* Keep the Node guard. */ }
  }
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
