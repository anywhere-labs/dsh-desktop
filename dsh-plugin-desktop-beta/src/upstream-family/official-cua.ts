/** Run the official Computer Use providers' helpers from physical files: the macOS provider from its unpacked copy, the Windows helper from beside the archive. */
import type { ModuleHooks } from 'node:module'
import { join } from 'node:path'
import { installUnpackedPackageResolution } from '../host/unpacked-package.ts'

/** The macOS provider of the official Computer Use bundle, `@deepseek-ai/dsh-cua-bundle`. */
export const OFFICIAL_CUA_PROVIDER_PACKAGE = '@deepseek-ai/dsh-cua-macos'
/** The Windows provider of the official Computer Use bundle, which dsh 0.2.3 publishes without its helper. */
export const OFFICIAL_CUA_WINDOWS_PROVIDER_PACKAGE = '@deepseek-ai/dsh-cua-windows'
/** File name of the helper the Windows provider starts. */
export const OFFICIAL_CUA_WINDOWS_EXECUTABLE = 'dsh-cua-windows.exe'

/**
 * Keep the official Computer Use helper startable.
 *
 * The provider looks up `native/bin/darwin-<arch>/current.json` and its selected application below its own package directory, which it
 * derives from `import.meta.url`, and starts it as a child process; Desktop packaging compiles that helper
 * (scripts/cua-native.ts). A child process reads no archive, so packaging keeps the whole package unpacked
 * beside the archive, and the provider runs from that copy.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-archived runtime.
 */
export function installOfficialCuaResolution(runtimeDir: string): ModuleHooks | undefined {
  return installUnpackedPackageResolution(runtimeDir, OFFICIAL_CUA_PROVIDER_PACKAGE, 'official Computer Use provider')
}

/**
 * The helper the official Windows provider starts for a Host of one CPU: `native/bin/win-<cpu>/dsh-cua-windows.exe` below
 * its package directory, which the provider reads beside an Electron archive (`app.asar.unpacked`) when it runs from one,
 * so packaging keeps that directory unpacked (scripts/upstream-family/cua-windows-native.ts).
 * @param packageDir - The provider's package directory, inside or outside an archive.
 * @param arch - CPU of the Host process.
 * @returns Absolute path of the helper executable.
 */
export function officialCuaWindowsHelper(packageDir: string, arch: string): string {
  const physical = packageDir.replace(/([\\/])app\.asar(?=[\\/])/u, '$1app.asar.unpacked')
  return join(physical, 'native', 'bin', `win-${arch}`, OFFICIAL_CUA_WINDOWS_EXECUTABLE)
}
