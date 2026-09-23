/** Physical-filesystem policy for Electron processes that serve user workspaces. */

import { fileURLToPath } from 'node:url'

/** A path segment Electron would open as an archive, or its unpacked sibling. */
const ARCHIVE_SEGMENT = /(?:^|[\\/])[^\\/]*\.asar(?:\.unpacked)?(?:[\\/]|$)/iu

/** The one Electron process flag this policy owns. */
export interface AsarArchiveProcess {
  noAsar?: boolean
}

/**
 * Turn off Electron's transparent `.asar` archive view for this process.
 *
 * Electron patches `fs` in its main process, utility processes and
 * ELECTRON_RUN_AS_NODE children so that any path ending in `.asar` reads as a
 * directory. A workspace file named `*.asar` then stats as a directory whose
 * fields are numbers even under `{ bigint: true }` (dsh-fs-local fails with
 * "Cannot mix BigInt and other types"), and a `*.asar` file that is not an
 * archive throws "Invalid package", so one such file breaks listing its whole
 * directory. Desktop ships its own code unpacked (`asar: false`), so processes
 * that read user files need the physical filesystem instead.
 *
 * The view stays on when the code about to run was itself loaded from an
 * archive: turning it off there would make the application unloadable.
 * @param moduleUrl - URL of the code this process runs.
 * @param proc - process whose flag is set.
 * @returns whether the archive view was turned off.
 */
export function disableAsarArchiveView(moduleUrl: string, proc: AsarArchiveProcess = process): boolean {
  if (ARCHIVE_SEGMENT.test(fileURLToPath(moduleUrl))) return false
  proc.noAsar = true
  return true
}
