/** Recoverable factory reset for the active Desktop-owned DSH data directory. */

import { lstatSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { DESKTOP_PACKAGE_NAME } from './product-identity.ts'
import { clearDesktopProfilePreferences } from './profile-preferences.ts'
import { clearDesktopProfileCheckpoint } from './profile-checkpoint.ts'
import { clearDesktopSetupWizardState } from './setup-wizard-state.ts'
import { selectDesktopMarketProvider } from './desktop-market.ts'
import { clearDesktopProfilePluginState } from './desktop-plugins.ts'
import { assertDesktopProfileName } from './profile-manager.ts'

const DIRECTORY_MODE = 0o700
const MAX_PATH_BYTES = 32 * 1024

export interface DesktopFactoryResetOptions {
  /** Exact active DSH Home selected by the launcher. */
  readonly homeDir: string
  /** Current edition's Electron user-data directory containing external preferences. */
  readonly userDataDir: string
  /** Directories that must never be reset or be descendants of the reset root. */
  readonly protectedPaths: readonly string[]
  /** Electron shell.trashItem adapter; injected so the safety boundary is testable. */
  readonly trashItem: (path: string) => Promise<void>
  /** Clear this exact Profile's first-use evidence in both Desktop editions. */
  readonly clearProfileUsageHistory?: (profileDir: string) => void
}

function canonicalPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || !isAbsolute(value) || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) {
    throw new Error(`${DESKTOP_PACKAGE_NAME}: ${label} must be a bounded absolute path without NUL`)
  }
  return resolve(value)
}

function comparisonKey(path: string, platform: NodeJS.Platform): string {
  const normalized = resolve(path)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function contains(parent: string, child: string, platform: NodeJS.Platform): boolean {
  const suffix = relative(comparisonKey(parent, platform), comparisonKey(child, platform))
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}

/** Fail closed before handing an exact path to the operating-system trash. */
export function assertDesktopFactoryResetTarget(
  homeDir: string,
  protectedPaths: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const target = canonicalPath(homeDir, 'factory-reset data directory')
  if (comparisonKey(target, platform) === comparisonKey(parse(target).root, platform)) {
    throw new Error(`${DESKTOP_PACKAGE_NAME}: refusing to reset a filesystem root`)
  }
  const info = lstatSync(target)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${DESKTOP_PACKAGE_NAME}: factory-reset data directory must be a real directory`)
  }
  for (const candidate of protectedPaths) {
    const protectedPath = canonicalPath(candidate, 'protected path')
    if (contains(target, protectedPath, platform)) {
      throw new Error(`${DESKTOP_PACKAGE_NAME}: refusing to reset a directory that contains protected Desktop or user files`)
    }
  }
  const profilesPath = join(target, 'profiles')
  let profiles
  try {
    profiles = lstatSync(profilesPath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${DESKTOP_PACKAGE_NAME}: factory-reset target is not an initialized DSH Home`)
    }
    throw cause
  }
  if (!profiles.isDirectory() || profiles.isSymbolicLink()) {
    throw new Error(`${DESKTOP_PACKAGE_NAME}: factory-reset target is not an initialized DSH Home`)
  }
  return target
}

/** Move the exact DSH Home to trash, then recreate only its empty root for clean startup. */
export async function resetDesktopDataDirectory(
  options: DesktopFactoryResetOptions,
): Promise<string> {
  const userDataDir = canonicalPath(options.userDataDir, 'factory-reset user-data directory')
  const target = assertDesktopFactoryResetTarget(options.homeDir, [...options.protectedPaths, userDataDir])
  // Startup always recreates desktop, even when it was removed before reset.
  const profiles = new Set(['desktop', ...await readdir(join(target, 'profiles'))])
  await options.trashItem(target)
  // Profile identity is path-based, so rebuilding the same Home would otherwise
  // restore preferences from before reset into the clean settings document.
  for (const name of profiles) {
    const profileDir = join(target, 'profiles', name)
    await clearDesktopProfilePreferences(userDataDir, profileDir)
    await clearDesktopSetupWizardState(userDataDir, profileDir)
    clearDesktopProfileCheckpoint(userDataDir, profileDir)
    // Staging/dependency entries can exist here but cannot own plugin state.
    try { assertDesktopProfileName(name) } catch { continue }
    options.clearProfileUsageHistory?.(profileDir)
    await clearDesktopProfilePluginState(join(userDataDir, 'plugin-management', 'state.json'), name)
  }
  // A fresh Profile imports this legacy machine-level selection on first boot.
  await selectDesktopMarketProvider(userDataDir, 'disabled')
  await mkdir(target, { recursive: false, mode: DIRECTORY_MODE })
  const recreated = lstatSync(target)
  if (!recreated.isDirectory() || recreated.isSymbolicLink()) {
    throw new Error(`${DESKTOP_PACKAGE_NAME}: factory-reset data directory could not be recreated safely`)
  }
  return target
}
