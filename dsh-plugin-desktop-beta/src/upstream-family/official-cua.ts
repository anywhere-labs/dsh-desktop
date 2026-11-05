/** Run the official Computer Use provider from its unpacked copy, so it starts its helper from a physical file. */
import type { ModuleHooks } from 'node:module'
import { installUnpackedPackageResolution } from '../host/unpacked-package.ts'

/** The macOS provider of the official Computer Use bundle, `@deepseek-ai/dsh-cua-bundle`. */
export const OFFICIAL_CUA_PROVIDER_PACKAGE = '@deepseek-ai/dsh-experimental-cua-macos'

/**
 * Keep the official Computer Use helper startable.
 *
 * The provider looks up `native/bin/darwin-<arch>/dsh-cua-native` below its own package directory, which it
 * derives from `import.meta.url`, and starts it as a child process; Desktop packaging compiles that helper
 * (scripts/cua-native.ts). A child process reads no archive, so packaging keeps the whole package unpacked
 * beside the archive, and the provider runs from that copy.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-archived runtime.
 */
export function installOfficialCuaResolution(runtimeDir: string): ModuleHooks | undefined {
  return installUnpackedPackageResolution(runtimeDir, OFFICIAL_CUA_PROVIDER_PACKAGE, 'official Computer Use provider')
}
