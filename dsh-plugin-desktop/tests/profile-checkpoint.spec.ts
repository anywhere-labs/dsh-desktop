import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DesktopProfileCheckpoint,
  type ProfileCheckpointOptions,
} from '../src/profile-checkpoint.ts'

const roots: string[] = []

function fixture(options: Partial<ProfileCheckpointOptions> = {}): {
  root: string
  home: string
  profile: string
  userData: string
  checkpoint: DesktopProfileCheckpoint
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-profile-checkpoint-'))
  roots.push(root)
  const home = join(root, 'home')
  const profile = join(home, 'profiles', 'work')
  const userData = join(root, 'user-data')
  mkdirSync(profile, { recursive: true })
  mkdirSync(userData)
  writeFileSync(join(home, 'settings.yaml'), 'dsh-desktop:\n  mode: advanced\n')
  writeFileSync(join(home, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profile, 'package.json'), '{"name":"healthy-0"}\n')
  writeFileSync(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages: []\n')
  writeFileSync(join(profile, 'cordis.patch.yml'), 'patch: []\n')
  const checkpoint = new DesktopProfileCheckpoint({
    userDataDir: userData,
    profileDir: profile,
    homeDir: home,
    profileIdentity: 'profile-identity',
    profileName: 'work',
    provider: 'dsh-market',
    appVersion: '2.0.3',
    ...options,
  })
  return { root, home, profile, userData, checkpoint }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Desktop profile health checkpoints', () => {
  it('captures browseable metadata and keeps all three stable slots visible', () => {
    const target = fixture({ now: () => Date.parse('2026-08-25T01:02:03.000Z') })
    writeFileSync(join(target.profile, 'package.json'), `${JSON.stringify({
      name: 'healthy-0',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'example-plugin'] } },
    })}\n`)
    const result = target.checkpoint.captureHealthy()
    expect(result).toMatchObject({
      status: 'captured',
      slotId: 'slot-1',
      manifest: {
        version: 3,
        capturedAt: '2026-08-25T01:02:03.000Z',
        profileName: 'work',
        provider: 'dsh-market',
        appVersion: '2.0.3',
        reason: 'healthy-startup',
      },
    })
    const slots = target.checkpoint.listSlots()
    expect(slots).toHaveLength(3)
    expect(slots.map(slot => [slot.slotId, slot.snapshotExists])).toEqual([
      ['slot-1', true],
      ['slot-2', false],
      ['slot-3', false],
    ])
    expect(slots[0]!.snapshotDirectory).toBe((result as { snapshotDirectory: string }).snapshotDirectory)
    expect(slots[0]).toMatchObject({ pluginCount: 3, totalBytes: expect.any(Number) })
    expect(slots[0]!.totalBytes).toBe(
      slots[0]!.manifest!.files.reduce((total, file) => total + (file.present ? (file.size ?? 0) : 0), 0),
    )
    expect(slots[0]!.manifest!.files.map(file => file.name)).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'cordis.patch.yml',
      '.dsh-market/state.json',
      'home/settings.yaml',
      'home/cordis.patch.yml',
    ])
    expect(readFileSync(join(slots[0]!.snapshotDirectory, 'home', 'settings.yaml'), 'utf8'))
      .toBe('dsh-desktop:\n  mode: advanced\n')
    expect(existsSync(join(slots[0]!.snapshotDirectory, 'manifest.json'))).toBe(true)
    if (process.platform !== 'win32') {
      expect(lstatSync(join(slots[0]!.snapshotDirectory, 'manifest.json')).mode & 0o777).toBe(0o600)
    }
  })

  it('writes every healthy startup and replaces the oldest slot after three captures', () => {
    let now = Date.parse('2026-08-25T00:00:00.000Z')
    const target = fixture({ now: () => now })
    for (let index = 1; index <= 3; index += 1) {
      writeFileSync(join(target.profile, 'package.json'), `{"name":"healthy-${index}"}\n`)
      expect(target.checkpoint.captureHealthy()).toMatchObject({ status: 'captured', slotId: `slot-${index}` })
      now += 1_000
    }
    writeFileSync(join(target.profile, 'package.json'), '{"name":"healthy-4"}\n')
    expect(target.checkpoint.captureHealthy()).toMatchObject({ status: 'captured', slotId: 'slot-1' })
    const versions = target.checkpoint.listSlots().map(slot => slot.manifest?.capturedAt)
    expect(versions).toEqual([
      '2026-08-25T00:00:03.000Z',
      '2026-08-25T00:00:01.000Z',
      '2026-08-25T00:00:02.000Z',
    ])
  })

  it('restores an explicitly selected slot and skips exactly the next healthy write', () => {
    let now = Date.parse('2026-08-25T00:00:00.000Z')
    const target = fixture({ now: () => now })
    target.checkpoint.captureHealthy()
    now += 1_000
    writeFileSync(join(target.profile, 'package.json'), '{"name":"healthy-1"}\n')
    target.checkpoint.captureHealthy()
    mkdirSync(join(target.profile, '.dsh-market'))
    writeFileSync(join(target.profile, '.dsh-market', 'state.json'), '{}\n')

    expect(target.checkpoint.restoreSlot('slot-1')).toMatchObject({
      status: 'restored',
      slotId: 'slot-1',
      changedFiles: expect.arrayContaining(['package.json', '.dsh-market/state.json']),
    })
    expect(readFileSync(join(target.profile, 'package.json'), 'utf8')).toBe('{"name":"healthy-0"}\n')
    expect(existsSync(join(target.profile, '.dsh-market', 'state.json'))).toBe(false)

    now += 1_000
    expect(target.checkpoint.captureHealthy()).toEqual({
      status: 'skipped-after-restore',
      restoredSlotId: 'slot-1',
    })
    expect(target.checkpoint.listSlots()[2]!.snapshotExists).toBe(false)
    now += 1_000
    expect(target.checkpoint.captureHealthy()).toMatchObject({ status: 'captured', slotId: 'slot-3' })
  })

  it('restores Harness-home settings and patches with the selected Profile slot', () => {
    const target = fixture()
    target.checkpoint.captureHealthy()
    writeFileSync(join(target.home, 'settings.yaml'), 'broken settings\n')
    writeFileSync(join(target.home, 'cordis.patch.yml'), 'broken patch\n')

    expect(target.checkpoint.restoreSlot('slot-1')).toMatchObject({
      changedFiles: expect.arrayContaining(['home/settings.yaml', 'home/cordis.patch.yml']),
    })
    expect(readFileSync(join(target.home, 'settings.yaml'), 'utf8'))
      .toBe('dsh-desktop:\n  mode: advanced\n')
    expect(readFileSync(join(target.home, 'cordis.patch.yml'), 'utf8')).toBe('[]\n')
  })

  it('restores the absence of optional Harness-home configuration files', () => {
    const target = fixture()
    unlinkSync(join(target.home, 'settings.yaml'))
    unlinkSync(join(target.home, 'cordis.patch.yml'))
    target.checkpoint.captureHealthy()
    writeFileSync(join(target.home, 'settings.yaml'), 'created later\n')
    writeFileSync(join(target.home, 'cordis.patch.yml'), 'created later\n')

    target.checkpoint.restoreSlot('slot-1')
    expect(existsSync(join(target.home, 'settings.yaml'))).toBe(false)
    expect(existsSync(join(target.home, 'cordis.patch.yml'))).toBe(false)
  })

  it('keeps version-two slots restorable without overwriting uncaptured global files', () => {
    const target = fixture()
    const captured = target.checkpoint.captureHealthy()
    if (captured.status !== 'captured') throw new Error('expected a captured checkpoint')
    const manifestPath = join(captured.snapshotDirectory, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: number
      files: Array<{ name: string }>
    }
    writeFileSync(manifestPath, `${JSON.stringify({
      ...manifest,
      version: 2,
      files: manifest.files.filter(file => !file.name.startsWith('home/')),
    })}\n`)
    rmSync(join(captured.snapshotDirectory, 'home'), { recursive: true, force: true })
    writeFileSync(join(target.profile, 'package.json'), '{"name":"changed"}\n')
    writeFileSync(join(target.home, 'settings.yaml'), 'new global settings\n')

    expect(target.checkpoint.restoreSlot('slot-1')).toMatchObject({
      changedFiles: expect.arrayContaining(['package.json']),
    })
    expect(readFileSync(join(target.profile, 'package.json'), 'utf8')).toBe('{"name":"healthy-0"}\n')
    expect(readFileSync(join(target.home, 'settings.yaml'), 'utf8')).toBe('new global settings\n')
  })

  it('keeps the post-restore skip marker until a healthy capture actually occurs', () => {
    const target = fixture()
    target.checkpoint.captureHealthy()
    target.checkpoint.restoreSlot('slot-1')
    unlinkSync(join(target.profile, 'package.json'))
    expect(() => target.checkpoint.captureHealthy()).toThrow('package.json is unavailable')
    writeFileSync(join(target.profile, 'package.json'), '{"name":"restored"}\n')
    expect(target.checkpoint.captureHealthy()).toMatchObject({ status: 'skipped-after-restore' })
  })

  it('keeps dependency materialization pending across restore retries until completion', () => {
    const target = fixture()
    target.checkpoint.captureHealthy()
    writeFileSync(join(target.profile, 'package.json'), '{"name":"with-new-plugin"}\n')
    writeFileSync(join(target.profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nnewPlugin: true\n')

    expect(target.checkpoint.restoreSlot('slot-1')).toMatchObject({
      dependencyMaterializationRequired: true,
      changedFiles: expect.arrayContaining(['package.json', 'pnpm-lock.yaml']),
    })
    expect(target.checkpoint.restoreSlot('slot-1')).toMatchObject({
      dependencyMaterializationRequired: true,
      changedFiles: [],
    })

    target.checkpoint.completeDependencyMaterialization('slot-1')
    expect(target.checkpoint.restoreSlot('slot-1')).toMatchObject({
      dependencyMaterializationRequired: false,
      changedFiles: [],
    })
  })

  it('keeps slots browseable when the current Market provider changes', () => {
    const target = fixture()
    target.checkpoint.captureHealthy()
    const reopened = new DesktopProfileCheckpoint({
      userDataDir: target.userData,
      profileDir: target.profile,
      homeDir: target.home,
      profileIdentity: 'profile-identity',
      profileName: 'work',
      provider: 'other-market',
      appVersion: '2.0.3',
    })
    expect(reopened.listSlots()[0]).toMatchObject({
      snapshotExists: true,
      manifest: { provider: 'dsh-market' },
    })
  })

  it('rejects missing package.json, symlinks, oversized files, and empty restore slots', () => {
    const missing = fixture()
    unlinkSync(join(missing.profile, 'package.json'))
    expect(() => missing.checkpoint.captureHealthy()).toThrow('package.json is unavailable')

    const symlink = fixture()
    unlinkSync(join(symlink.profile, 'cordis.patch.yml'))
    writeFileSync(join(symlink.root, 'outside.yml'), 'outside\n')
    symlinkSync(join(symlink.root, 'outside.yml'), join(symlink.profile, 'cordis.patch.yml'))
    expect(() => symlink.checkpoint.captureHealthy()).toThrow('regular file')

    const oversized = fixture({ maxFileBytes: { 'package.json': 4 } })
    expect(() => oversized.checkpoint.captureHealthy()).toThrow('too large')

    const globalSymlink = fixture()
    unlinkSync(join(globalSymlink.home, 'settings.yaml'))
    writeFileSync(join(globalSymlink.root, 'outside-settings.yml'), 'outside\n')
    symlinkSync(join(globalSymlink.root, 'outside-settings.yml'), join(globalSymlink.home, 'settings.yaml'))
    expect(() => globalSymlink.checkpoint.captureHealthy()).toThrow('regular file')

    const oversizedSettings = fixture({ maxFileBytes: { 'home/settings.yaml': 4 } })
    expect(() => oversizedSettings.checkpoint.captureHealthy()).toThrow('too large')
    expect(() => fixture().checkpoint.restoreSlot('slot-3')).toThrow('slot-3 is empty')
  })
})
