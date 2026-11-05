/**
 * Installer selection for unsigned smoke builds. Every check of the packaged application runs either way:
 * the archive against the sealed payload, the interpreter payloads, the fuses and the packaged Host boot.
 * Only the installer containers, whose own checks read their headers, are optional.
 */
import type { LinuxPackageTarget } from '../../dsh-plugin-desktop/scripts/package-linux.ts'
import type { MacSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'

const LINUX_TARGETS: readonly LinuxPackageTarget[] = ['AppImage', 'deb']

/**
 * Read `DSH_MAC_SMOKE_TARGET`: `dmg`, the default, builds and verifies the DMG; `dir` packages the
 * application directory only, and the verifier checks that directory in place.
 * @param env - Environment of the packaging or verification process.
 * @returns The electron-builder macOS target.
 */
export function macSmokeTarget(env: NodeJS.ProcessEnv): 'dmg' | 'dir' {
  const value = env.DSH_MAC_SMOKE_TARGET
  if (value === undefined || value === '' || value === 'dmg') return 'dmg'
  if (value === 'dir') return 'dir'
  throw new Error(`DSH_MAC_SMOKE_TARGET must be dmg or dir; received ${JSON.stringify(value)}`)
}

/**
 * The directory electron-builder writes one macOS application to below its output directory.
 * @param architecture - Smoke architecture being packaged.
 * @returns `mac` for the default x64 build, otherwise `mac-<architecture>`.
 */
export function macApplicationDirectory(architecture: MacSmokeArchitecture): string {
  return architecture === 'x64' ? 'mac' : `mac-${architecture}`
}

/**
 * Read `DSH_LINUX_PACKAGE_TARGETS`, a comma-separated subset of `AppImage` and `deb`; both by default.
 * @param env - Environment of the packaging or verification process.
 * @returns The selected targets in build order.
 */
export function linuxPackageTargets(env: NodeJS.ProcessEnv): readonly LinuxPackageTarget[] {
  const value = env.DSH_LINUX_PACKAGE_TARGETS
  if (value === undefined || value === '') return LINUX_TARGETS
  const requested = value.split(',').map(entry => entry.trim())
  if (requested.some(entry => !(LINUX_TARGETS as readonly string[]).includes(entry)) || new Set(requested).size !== requested.length) {
    throw new Error(`DSH_LINUX_PACKAGE_TARGETS must list AppImage and/or deb once each; received ${JSON.stringify(value)}`)
  }
  return LINUX_TARGETS.filter(target => requested.includes(target))
}
