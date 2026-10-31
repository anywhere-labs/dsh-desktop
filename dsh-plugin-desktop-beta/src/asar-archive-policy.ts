/** Physical-filesystem policy for Electron processes that serve user workspaces or hand payload files to other programs. */

import { fileURLToPath } from 'node:url'

/** A path segment Electron would open as an archive, or its unpacked sibling. */
const ARCHIVE_SEGMENT = /(?:^|[\\/])[^\\/]*\.asar(?:\.unpacked)?(?:[\\/]|$)/iu

/** The archive segment alone; `app.asar.unpacked` is a real directory and does not match. */
const PACKED_SEGMENT = /(^|[\\/])([^\\/]*\.asar)(?=[\\/]|$)/iu

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
 * directory. Processes that read user files from an unpacked tree need the
 * physical filesystem instead.
 *
 * The view stays on when the code about to run was itself loaded from an
 * archive: turning it off there would make the application unloadable. A
 * packaged Next runs its Host from `app.asar` and keeps the view, as upstream
 * Desktop does; development launches run from the source tree and turn it off.
 * @param moduleUrl - URL of the code this process runs.
 * @param proc - process whose flag is set.
 * @returns whether the archive view was turned off.
 */
export function disableAsarArchiveView(moduleUrl: string, proc: AsarArchiveProcess = process): boolean {
  if (ARCHIVE_SEGMENT.test(fileURLToPath(moduleUrl))) return false
  proc.noAsar = true
  return true
}

/**
 * Whether a path runs through an archive Electron mounts virtually.
 * @param path - Absolute path.
 * @returns true inside `app.asar`; false for the physical `app.asar.unpacked` sibling and ordinary directories.
 */
export function insideArchive(path: string): boolean {
  return PACKED_SEGMENT.test(path)
}

/**
 * Physical location of a payload file Electron Builder unpacked beside the archive.
 * Only Electron's own `fs` sees files inside `app.asar`; a child process, a shell PATH
 * entry and `nativeImage` need the `app.asar.unpacked` copy that `asarUnpack` produced.
 * @param path - Absolute path that may run through `app.asar`.
 * @returns The same path under `app.asar.unpacked`, or the path unchanged outside an archive.
 */
export function unpackedPath(path: string): string {
  return path.replace(PACKED_SEGMENT, (_match, prefix: string, archive: string) => `${prefix}${archive}.unpacked`)
}
