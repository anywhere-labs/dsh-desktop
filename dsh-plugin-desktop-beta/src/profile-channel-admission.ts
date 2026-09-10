/** Read-only Stable/Beta Profile usage detection backed by each edition's private state. */

import { isAbsolute, join, resolve } from 'node:path'
import {
  clearDesktopProfileCheckpoint,
  inspectLatestDesktopProfileCheckpointUsage,
  type DesktopProfileCheckpointReleaseChannel,
} from './profile-checkpoint.ts'
import {
  clearDesktopSetupWizardStateSync,
  readDesktopSetupWizardState,
} from './setup-wizard-state.ts'
import {
  DESKTOP_PRODUCT_IDENTITY,
  OTHER_DESKTOP_PRODUCT_IDENTITY,
  type DesktopProductIdentity,
} from './product-identity.ts'

export interface DesktopReleaseUserData {
  readonly identity: DesktopProductIdentity
  readonly userDataDir: string
}

export interface DesktopReleaseUserDataLocations {
  readonly current: DesktopReleaseUserData
  readonly other: DesktopReleaseUserData
  readonly all: readonly DesktopReleaseUserData[]
}

export interface DesktopProfileUsageEvidence {
  readonly source: 'checkpoint' | 'setup'
  readonly recordedAt: string
  readonly desktopPackageName: string
  readonly productName: string
  readonly releaseChannel: DesktopProfileCheckpointReleaseChannel
  readonly desktopVersion: string
  readonly dshVersion?: string
}

export type DesktopProfileUsageProbe =
  | { readonly status: 'none' }
  | { readonly status: 'valid', readonly evidence: DesktopProfileUsageEvidence }
  | { readonly status: 'invalid', readonly problem: string }

export type DesktopProfileChannelAdmission =
  | { readonly status: 'allow', readonly reason: 'new-profile' | 'current-channel-latest' }
  | { readonly status: 'warn', readonly reason: 'other-channel-latest', readonly previous: DesktopProfileUsageEvidence }
  | { readonly status: 'warn', readonly reason: 'uncertain' }

function absolute(label: string, value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
    throw new TypeError(`dsh-plugin-desktop: ${label} must be an absolute path without NUL`)
  }
  return resolve(value)
}

/** Resolve the current real userData and the other edition's canonical userData. */
export function desktopReleaseUserDataLocations(
  appDataDir: string,
  currentUserDataDir: string,
): DesktopReleaseUserDataLocations {
  const appData = absolute('application data directory', appDataDir)
  const current = Object.freeze({
    identity: DESKTOP_PRODUCT_IDENTITY,
    userDataDir: absolute('current user-data directory', currentUserDataDir),
  })
  const other = Object.freeze({
    identity: OTHER_DESKTOP_PRODUCT_IDENTITY,
    userDataDir: join(appData, OTHER_DESKTOP_PRODUCT_IDENTITY.productName),
  })
  return Object.freeze({ current, other, all: Object.freeze([current, other]) })
}

/** Prefer one healthy checkpoint; use Setup completion only when no checkpoint exists. */
export function inspectDesktopReleaseProfileUsage(
  release: DesktopReleaseUserData,
  profileDir: string,
  profileName: string,
): DesktopProfileUsageProbe {
  const checkpoint = inspectLatestDesktopProfileCheckpointUsage({
    userDataDir: release.userDataDir,
    profileDir,
    profileName,
    legacyDesktopPackageName: release.identity.packageName,
    legacyReleaseChannel: release.identity.releaseChannel,
  })
  if (checkpoint.status === 'invalid') return checkpoint
  if (checkpoint.status === 'valid') {
    return {
      status: 'valid',
      evidence: Object.freeze({
        ...checkpoint.evidence,
        productName: release.identity.productName,
      }),
    }
  }

  try {
    const setup = readDesktopSetupWizardState(release.userDataDir, profileDir)
    if (setup === undefined) return { status: 'none' }
    if (setup.version === 1) {
      return { status: 'invalid', problem: 'legacy Setup state has no recorded version or timestamp' }
    }
    return {
      status: 'valid',
      evidence: Object.freeze({
        source: 'setup',
        recordedAt: setup.recordedAt,
        desktopPackageName: release.identity.packageName,
        productName: release.identity.productName,
        releaseChannel: release.identity.releaseChannel,
        desktopVersion: setup.desktopVersion,
        dshVersion: setup.dshVersion,
      }),
    }
  } catch (cause) {
    return { status: 'invalid', problem: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Setup is shared by Profile identity across editions, unlike channel admission.
 * Read legacy completion/skip markers too; their missing version is irrelevant
 * here. Never stamp a new usage time merely because another edition was used.
 */
export function hasDesktopProfileUsageHistory(
  locations: DesktopReleaseUserDataLocations,
  profileDir: string,
  profileName: string,
): boolean {
  let problem: Error | undefined
  for (const release of locations.all) {
    try {
      if (readDesktopSetupWizardState(release.userDataDir, profileDir) !== undefined) return true
    } catch (cause) {
      problem ??= cause instanceof Error ? cause : new Error(String(cause))
    }
    const checkpoint = inspectLatestDesktopProfileCheckpointUsage({
      userDataDir: release.userDataDir,
      profileDir,
      profileName,
      legacyDesktopPackageName: release.identity.packageName,
      legacyReleaseChannel: release.identity.releaseChannel,
    })
    if (checkpoint.status === 'valid') return true
    if (checkpoint.status === 'invalid') problem ??= new Error(checkpoint.problem)
  }
  // Corruption is not proof that a Profile is new; keep the recovery path.
  if (problem !== undefined) throw problem
  return false
}

/** Decide whether the other Desktop package has the newest trustworthy evidence. */
export function inspectDesktopProfileChannelAdmission(
  locations: DesktopReleaseUserDataLocations,
  profileDir: string,
  profileName: string,
): DesktopProfileChannelAdmission {
  const current = inspectDesktopReleaseProfileUsage(locations.current, profileDir, profileName)
  const other = inspectDesktopReleaseProfileUsage(locations.other, profileDir, profileName)
  if (other.status === 'invalid') {
    return current.status === 'valid'
      ? { status: 'allow', reason: 'current-channel-latest' }
      : { status: 'warn', reason: 'uncertain' }
  }
  if (current.status === 'invalid') {
    // A damaged record in this package alone is not evidence of a channel
    // switch. The other package must have some record before startup warns.
    return other.status === 'none'
      ? { status: 'allow', reason: 'current-channel-latest' }
      : { status: 'warn', reason: 'uncertain' }
  }
  if (current.status === 'none' && other.status === 'none') {
    return { status: 'allow', reason: 'new-profile' }
  }
  if (other.status === 'none') return { status: 'allow', reason: 'current-channel-latest' }
  if (current.status === 'none') {
    return { status: 'warn', reason: 'other-channel-latest', previous: other.evidence }
  }
  const currentTime = Date.parse(current.evidence.recordedAt)
  const otherTime = Date.parse(other.evidence.recordedAt)
  if (currentTime > otherTime) return { status: 'allow', reason: 'current-channel-latest' }
  if (otherTime > currentTime) {
    return { status: 'warn', reason: 'other-channel-latest', previous: other.evidence }
  }
  return { status: 'warn', reason: 'uncertain' }
}

/** Clear only this Profile's cross-channel evidence after deletion or fresh creation. */
export function clearDesktopProfileUsageHistory(
  locations: DesktopReleaseUserDataLocations,
  profileDir: string,
): void {
  const visited = new Set<string>()
  for (const release of locations.all) {
    if (visited.has(release.userDataDir)) continue
    visited.add(release.userDataDir)
    clearDesktopProfileCheckpoint(release.userDataDir, profileDir)
    clearDesktopSetupWizardStateSync(release.userDataDir, profileDir)
  }
}
