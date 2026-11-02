/** The CPU an update targets: which installer this Mac asks for, and whether a downloaded application runs on it. */
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { readMachOArchitectures } from './mach-o.ts'

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

/** A downloaded application that cannot run natively on this Mac; installing it is refused. */
export class UpdateArchError extends Error {
  override readonly name = 'UpdateArchError'
}

/**
 * Check that a downloaded application runs natively on this Mac before it replaces the installed one: its main
 * executable carries a slice for the CPU and it packages that CPU's interpreter payload, which the application
 * selects by `process.arch` at launch. A universal application passes on either CPU.
 * @param bundle - Application bundle, already verified as signed by the installed application's team.
 * @param executable - `CFBundleExecutable` of that bundle.
 * @param arch - CPU of this Mac.
 * @throws {UpdateArchError} When either is missing.
 */
export async function assertMacBundleArch(bundle: string, executable: string, arch: UpdateArch): Promise<void> {
  if (!/^[^/\0]+$/u.test(executable) || executable === '.' || executable === '..') {
    throw new UpdateArchError('The downloaded application names an invalid main executable')
  }
  const slices = await readMachOArchitectures(join(bundle, 'Contents', 'MacOS', executable))
  if (!slices.includes(arch)) {
    throw new UpdateArchError(`The downloaded application runs on ${slices.join('/') || 'no known CPU'}, not on this Mac's ${arch}`)
  }
  const runtime = await lstat(join(bundle, 'Contents', 'Resources', 'runtime', arch)).catch(() => undefined)
  if (runtime?.isDirectory() !== true) throw new UpdateArchError(`The downloaded application carries no ${arch} runtime`)
}
