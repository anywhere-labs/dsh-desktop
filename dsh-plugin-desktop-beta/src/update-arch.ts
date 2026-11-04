/** The CPU this Mac names to the release service, which answers with the installer built for it. */

/** CPUs the macOS packages are built for. */
export type UpdateArch = 'arm64' | 'x64'

/**
 * Request header naming the CPU the installer must run on natively. The release service answers with that CPU's
 * installer, or the universal one; a service that ignores the header serves the universal installer.
 */
export const DESKTOP_ARCH_HEADER = 'X-DSH-Desktop-Arch'

/**
 * The CPU an update for this Mac targets: the hardware's rather than this process's, so an Intel build that Rosetta
 * translates on Apple silicon updates to the Apple silicon build and runs natively from then on.
 * @param processArch - `process.arch` of the running application.
 * @param translated - `app.runningUnderARM64Translation`.
 * @returns The CPU, or undefined for a CPU with no macOS package.
 */
export function macUpdateArch(processArch: string, translated: boolean): UpdateArch | undefined {
  if (processArch === 'arm64') return 'arm64'
  if (processArch === 'x64') return translated ? 'arm64' : 'x64'
  return undefined
}

/**
 * Copy request options with the CPU header added to the headers they already carry.
 * @param init - Options of a version check or installer download.
 * @param arch - CPU the installer must run on.
 * @returns New options; `init` is unchanged.
 */
export function withUpdateArch(init: RequestInit, arch: UpdateArch): RequestInit {
  const headers = new Headers(init.headers)
  headers.set(DESKTOP_ARCH_HEADER, arch)
  return { ...init, headers }
}
