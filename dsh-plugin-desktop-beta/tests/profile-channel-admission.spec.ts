import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDesktopProfileUsageHistory,
  desktopReleaseUserDataLocations,
  hasDesktopProfileUsageHistory,
  inspectDesktopProfileChannelAdmission,
  type DesktopReleaseUserData,
} from '../src/profile-channel-admission.ts'
import { DesktopProfileCheckpoint } from '../src/profile-checkpoint.ts'
import {
  completeOrSkipDesktopSetupWizard,
  desktopSetupWizardStatePath,
  readDesktopSetupWizardState,
} from '../src/setup-wizard-state.ts'
import {
  DESKTOP_PRODUCT_IDENTITY,
  OTHER_DESKTOP_PRODUCT_IDENTITY,
} from '../src/product-identity.ts'

const roots: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-profile-channel-'))
  roots.push(root)
  const appData = join(root, 'app-data')
  const currentUserData = join(root, 'current-user-data')
  const home = join(root, '.dsh')
  const profile = join(home, 'profiles', 'work')
  mkdirSync(appData)
  mkdirSync(currentUserData)
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{"name":"work"}\n')
  const locations = desktopReleaseUserDataLocations(appData, currentUserData)
  return { root, appData, currentUserData, home, profile, locations }
}

function capture(
  target: ReturnType<typeof fixture>,
  release: DesktopReleaseUserData,
  recordedAt: string,
  desktopVersion = '2.0.4',
): string {
  mkdirSync(release.userDataDir, { recursive: true })
  const checkpoint = new DesktopProfileCheckpoint({
    userDataDir: release.userDataDir,
    profileDir: target.profile,
    homeDir: target.home,
    profileName: 'work',
    provider: 'dsh-market',
    appVersion: desktopVersion,
    desktopPackageName: release.identity.packageName,
    releaseChannel: release.identity.releaseChannel,
    dshVersion: '0.1.2-rc.1',
    now: () => Date.parse(recordedAt),
  })
  const result = checkpoint.captureHealthy()
  if (result.status !== 'captured') throw new Error('expected a captured checkpoint')
  return join(result.snapshotDirectory, 'manifest.json')
}

async function recordSetup(
  target: ReturnType<typeof fixture>,
  release: DesktopReleaseUserData,
  recordedAt: string,
): Promise<void> {
  await completeOrSkipDesktopSetupWizard(release.userDataDir, target.profile, 'completed', {
    desktopVersion: release.identity.releaseChannel === 'stable' ? '2.0.4' : '2.0.6-beta.1',
    dshVersion: '0.1.2-rc.1',
    setupRevision: 1,
  }, recordedAt)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Desktop Profile release-channel admission', () => {
  it('requires a genuinely unused Profile, not just an existing directory or another Profile history', async () => {
    const target = fixture()
    expect(hasDesktopProfileUsageHistory(target.locations, target.profile, 'work')).toBe(false)
    await completeOrSkipDesktopSetupWizard(target.currentUserData, join(target.home, 'profiles', 'other'), 'completed', {
      desktopVersion: '1.0.0', dshVersion: '0.1.0', setupRevision: 1,
    })
    expect(hasDesktopProfileUsageHistory(target.locations, target.profile, 'work')).toBe(false)
  })

  it.each(['current', 'other'] as const)('honors completed, skipped, and legacy Setup in the %s edition without rewriting evidence', async side => {
    const target = fixture()
    const release = target.locations[side]
    for (const outcome of ['completed', 'skipped'] as const) {
      const state = await completeOrSkipDesktopSetupWizard(release.userDataDir, target.profile, outcome, {
        desktopVersion: '1.0.0-beta.1', dshVersion: '0.1.0', setupRevision: 1,
      })
      const path = desktopSetupWizardStatePath(release.userDataDir, target.profile)
      const original = readFileSync(path, 'utf8')
      expect(hasDesktopProfileUsageHistory(target.locations, target.profile, 'work')).toBe(true)
      expect(readFileSync(path, 'utf8')).toBe(original)
      writeFileSync(path, JSON.stringify({ version: 1, profileHash: state.profileHash, outcome }))
      expect(hasDesktopProfileUsageHistory(target.locations, target.profile, 'work')).toBe(true)
    }
  })

  it.each(['current', 'other'] as const)('recognizes older successful launches without Setup markers in the %s edition', side => {
    const target = fixture()
    capture(target, target.locations[side], '2026-09-02T01:00:00.000Z', '1.0.0')
    expect(readDesktopSetupWizardState(target.locations[side].userDataDir, target.profile)).toBeUndefined()
    expect(hasDesktopProfileUsageHistory(target.locations, target.profile, 'work')).toBe(true)
    clearDesktopProfileUsageHistory(target.locations, target.profile)
    expect(hasDesktopProfileUsageHistory(target.locations, target.profile, 'work')).toBe(false)
  })

  it('does not mistake corrupt history for first use, but accepts valid evidence from the other edition', async () => {
    const target = fixture()
    const path = capture(target, target.locations.current, '2026-09-02T01:00:00.000Z')
    writeFileSync(path, '{broken')
    expect(() => hasDesktopProfileUsageHistory(target.locations, target.profile, 'work')).toThrow()
    await recordSetup(target, target.locations.other, '2026-09-02T01:00:00.000Z')
    expect(hasDesktopProfileUsageHistory(target.locations, target.profile, 'work')).toBe(true)
  })

  it('uses the real current userData and the other product canonical directory', () => {
    const target = fixture()
    expect(target.locations.current).toEqual({
      identity: DESKTOP_PRODUCT_IDENTITY,
      userDataDir: target.currentUserData,
    })
    expect(target.locations.other).toEqual({
      identity: OTHER_DESKTOP_PRODUCT_IDENTITY,
      userDataDir: join(target.appData, OTHER_DESKTOP_PRODUCT_IDENTITY.productName),
    })
  })

  it('allows a first-use Profile and any Profile known only to the current channel', () => {
    const target = fixture()
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toEqual({ status: 'allow', reason: 'new-profile' })

    capture(target, target.locations.current, '2026-09-02T01:00:00.000Z', '99.0.0')
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toEqual({ status: 'allow', reason: 'current-channel-latest' })
  })

  it('warns for Stable to Beta or Beta to Stable until the current app becomes healthy', () => {
    const target = fixture()
    capture(target, target.locations.other, '2026-09-02T01:00:00.000Z')
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toMatchObject({
        status: 'warn',
        reason: 'other-channel-latest',
        previous: {
          productName: OTHER_DESKTOP_PRODUCT_IDENTITY.productName,
          releaseChannel: OTHER_DESKTOP_PRODUCT_IDENTITY.releaseChannel,
        },
      })

    // Choosing “Use Anyway” is deliberately not a write; a failed launch warns again.
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toMatchObject({ status: 'warn', reason: 'other-channel-latest' })
    capture(target, target.locations.current, '2026-09-02T01:00:01.000Z')
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toEqual({ status: 'allow', reason: 'current-channel-latest' })
  })

  it('compares healthy timestamps and treats ties as uncertain', () => {
    const currentLatest = fixture()
    capture(currentLatest, currentLatest.locations.other, '2026-09-02T01:00:00.000Z')
    capture(currentLatest, currentLatest.locations.current, '2026-09-02T01:00:01.000Z')
    expect(inspectDesktopProfileChannelAdmission(currentLatest.locations, currentLatest.profile, 'work'))
      .toEqual({ status: 'allow', reason: 'current-channel-latest' })

    const otherLatest = fixture()
    capture(otherLatest, otherLatest.locations.current, '2026-09-02T01:00:00.000Z')
    capture(otherLatest, otherLatest.locations.other, '2026-09-02T01:00:01.000Z')
    expect(inspectDesktopProfileChannelAdmission(otherLatest.locations, otherLatest.profile, 'work'))
      .toMatchObject({ status: 'warn', reason: 'other-channel-latest' })

    const tie = fixture()
    capture(tie, tie.locations.current, '2026-09-02T01:00:00.000Z')
    capture(tie, tie.locations.other, '2026-09-02T01:00:00.000Z')
    expect(inspectDesktopProfileChannelAdmission(tie.locations, tie.profile, 'work'))
      .toEqual({ status: 'warn', reason: 'uncertain' })
  })

  it('uses Setup state only when that release has no healthy checkpoint', async () => {
    const target = fixture()
    await recordSetup(target, target.locations.current, '2026-09-02T01:00:00.000Z')
    await recordSetup(target, target.locations.other, '2026-09-02T01:00:01.000Z')
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toMatchObject({
        status: 'warn',
        reason: 'other-channel-latest',
        previous: { source: 'setup' },
      })

    await recordSetup(target, target.locations.current, '2026-09-02T02:00:00.000Z')
    capture(target, target.locations.current, '2026-09-02T00:59:00.000Z')
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toMatchObject({ status: 'warn', reason: 'other-channel-latest' })
  })

  it('warns for damaged evidence until the current release becomes healthy', () => {
    const target = fixture()
    const manifestPath = capture(target, target.locations.other, '2026-09-02T01:00:00.000Z')
    writeFileSync(manifestPath, '{broken')
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toEqual({ status: 'warn', reason: 'uncertain' })
    capture(target, target.locations.current, '2026-09-02T01:00:01.000Z')
    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toEqual({ status: 'allow', reason: 'current-channel-latest' })

    const currentOnly = fixture()
    const currentManifest = capture(currentOnly, currentOnly.locations.current, '2026-09-02T01:00:00.000Z')
    writeFileSync(currentManifest, '{broken')
    expect(inspectDesktopProfileChannelAdmission(currentOnly.locations, currentOnly.profile, 'work'))
      .toEqual({ status: 'allow', reason: 'current-channel-latest' })
    capture(currentOnly, currentOnly.locations.other, '2026-09-02T01:00:01.000Z')
    expect(inspectDesktopProfileChannelAdmission(currentOnly.locations, currentOnly.profile, 'work'))
      .toEqual({ status: 'warn', reason: 'uncertain' })
  })

  it('clears only this Profile evidence in both app directories', async () => {
    const target = fixture()
    capture(target, target.locations.current, '2026-09-02T01:00:00.000Z')
    capture(target, target.locations.other, '2026-09-02T01:00:01.000Z')
    await recordSetup(target, target.locations.current, '2026-09-02T01:00:00.000Z')
    await recordSetup(target, target.locations.other, '2026-09-02T01:00:01.000Z')
    const profileManifest = readFileSync(join(target.profile, 'package.json'), 'utf8')

    clearDesktopProfileUsageHistory(target.locations, target.profile)

    expect(inspectDesktopProfileChannelAdmission(target.locations, target.profile, 'work'))
      .toEqual({ status: 'allow', reason: 'new-profile' })
    expect(readDesktopSetupWizardState(target.locations.current.userDataDir, target.profile)).toBeUndefined()
    expect(readDesktopSetupWizardState(target.locations.other.userDataDir, target.profile)).toBeUndefined()
    expect(existsSync(target.profile)).toBe(true)
    expect(readFileSync(join(target.profile, 'package.json'), 'utf8')).toBe(profileManifest)
  })
})
