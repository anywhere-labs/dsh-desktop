import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDesktopSetupWizardState,
  completeOrSkipDesktopSetupWizard,
  desktopSetupWizardProfileHash,
  desktopSetupWizardStateConstants,
  desktopSetupWizardStatePath,
  readDesktopSetupWizardState,
} from '../src/setup-wizard-state.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), label))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Desktop Setup Wizard state', () => {
  it('isolates explicit completion and skip markers by sha256(Profile directory)', async () => {
    const userData = temporaryDirectory('dsh-setup-state-user-')
    const profiles = temporaryDirectory('dsh-setup-state-profiles-')
    const work = join(profiles, 'work')
    const personal = join(profiles, 'personal')
    mkdirSync(work)
    mkdirSync(personal)

    const expectedHash = createHash('sha256').update(resolve(work)).digest('hex')
    expect(desktopSetupWizardProfileHash(work)).toBe(expectedHash)
    expect(desktopSetupWizardStatePath(userData, work)).toBe(
      join(userData, 'profile-setup', expectedHash, 'state.json'),
    )
    expect(readDesktopSetupWizardState(userData, work)).toBeUndefined()

    await expect(completeOrSkipDesktopSetupWizard(userData, work, 'completed')).resolves.toEqual({
      version: 1,
      profileHash: expectedHash,
      outcome: 'completed',
    })
    await completeOrSkipDesktopSetupWizard(userData, personal, 'skipped')

    expect(readDesktopSetupWizardState(userData, work)?.outcome).toBe('completed')
    expect(readDesktopSetupWizardState(userData, personal)?.outcome).toBe('skipped')

    await clearDesktopSetupWizardState(userData, work)
    expect(readDesktopSetupWizardState(userData, work)).toBeUndefined()
    expect(readDesktopSetupWizardState(userData, personal)?.outcome).toBe('skipped')
  })

  it('writes one private atomic marker without leftover lock or temp files', async () => {
    const userData = temporaryDirectory('dsh-setup-state-user-')
    const profile = temporaryDirectory('dsh-setup-state-profile-')

    await completeOrSkipDesktopSetupWizard(userData, profile, 'completed')
    const statePath = desktopSetupWizardStatePath(userData, profile)
    const directory = join(userData, 'profile-setup', desktopSetupWizardProfileHash(profile))

    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
      version: 1,
      profileHash: desktopSetupWizardProfileHash(profile),
      outcome: 'completed',
    })
    expect(readdirSync(directory)).toEqual(['state.json'])
    if (process.platform !== 'win32') {
      expect(statSync(join(userData, 'profile-setup')).mode & 0o777).toBe(0o700)
      expect(statSync(directory).mode & 0o777).toBe(0o700)
      expect(statSync(statePath).mode & 0o777).toBe(0o600)
    }
  })

  it('records Setup after an interrupted older run stranded lock and temp siblings', async () => {
    const userData = temporaryDirectory('dsh-setup-state-user-')
    const profile = temporaryDirectory('dsh-setup-state-profile-')
    const statePath = desktopSetupWizardStatePath(userData, profile)
    const directory = join(userData, 'profile-setup', desktopSetupWizardProfileHash(profile))
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(`${statePath}.lock`, '12345\n', { mode: 0o600 })
    writeFileSync(`${statePath}.interrupted.tmp`, '', { mode: 0o600 })

    await expect(completeOrSkipDesktopSetupWizard(userData, profile, 'skipped')).resolves.toMatchObject({
      outcome: 'skipped',
    })
    expect(readDesktopSetupWizardState(userData, profile)?.outcome).toBe('skipped')
    expect(readdirSync(directory).sort()).toEqual([
      'state.json',
      'state.json.interrupted.tmp',
      'state.json.lock',
    ])
  })

  it('rejects corrupted, oversized, and mismatched markers', async () => {
    const userData = temporaryDirectory('dsh-setup-state-user-')
    const profile = temporaryDirectory('dsh-setup-state-profile-')
    const statePath = desktopSetupWizardStatePath(userData, profile)
    mkdirSync(join(userData, 'profile-setup', desktopSetupWizardProfileHash(profile)), {
      recursive: true,
      mode: 0o700,
    })

    writeFileSync(statePath, '{not-json}\n', { mode: 0o600 })
    expect(() => readDesktopSetupWizardState(userData, profile)).toThrow('valid JSON')
    await expect(completeOrSkipDesktopSetupWizard(userData, profile, 'completed')).rejects.toThrow('valid JSON')

    writeFileSync(statePath, `${JSON.stringify({
      version: 1,
      profileHash: '0'.repeat(64),
      outcome: 'completed',
    })}\n`, { mode: 0o600 })
    expect(() => readDesktopSetupWizardState(userData, profile)).toThrow('identity does not match')

    writeFileSync(statePath, 'x'.repeat(desktopSetupWizardStateConstants.maxBytes + 1), { mode: 0o600 })
    expect(() => readDesktopSetupWizardState(userData, profile)).toThrow('exceeds')
    await expect(clearDesktopSetupWizardState(userData, profile)).rejects.toThrow('exceeds')
  })

  it('rejects marker bytes that are not valid UTF-8', () => {
    const userData = temporaryDirectory('dsh-setup-state-user-')
    const profile = temporaryDirectory('dsh-setup-state-profile-')
    const statePath = desktopSetupWizardStatePath(userData, profile)
    mkdirSync(join(userData, 'profile-setup', desktopSetupWizardProfileHash(profile)), {
      recursive: true,
      mode: 0o700,
    })
    writeFileSync(statePath, Buffer.from([0xff]), { mode: 0o600 })

    expect(() => readDesktopSetupWizardState(userData, profile)).toThrow('valid UTF-8')
  })

  it.runIf(process.platform !== 'win32')('rejects public marker and state-directory permissions', async () => {
    const userData = temporaryDirectory('dsh-setup-state-user-')
    const profile = temporaryDirectory('dsh-setup-state-profile-')
    await completeOrSkipDesktopSetupWizard(userData, profile, 'completed')
    const statePath = desktopSetupWizardStatePath(userData, profile)

    chmodSync(statePath, 0o644)
    expect(() => readDesktopSetupWizardState(userData, profile)).toThrow('permissions must be 600')
    await expect(clearDesktopSetupWizardState(userData, profile)).rejects.toThrow('permissions must be 600')

    chmodSync(statePath, 0o600)
    chmodSync(join(userData, 'profile-setup'), 0o755)
    expect(() => readDesktopSetupWizardState(userData, profile)).toThrow('permissions must be 700')
  })

  it('never follows a marker symlink for read, replacement, or clear', async () => {
    const userData = temporaryDirectory('dsh-setup-state-user-')
    const profile = temporaryDirectory('dsh-setup-state-profile-')
    const outside = join(temporaryDirectory('dsh-setup-state-outside-'), 'outside.json')
    const statePath = desktopSetupWizardStatePath(userData, profile)
    mkdirSync(join(userData, 'profile-setup', desktopSetupWizardProfileHash(profile)), {
      recursive: true,
      mode: 0o700,
    })
    writeFileSync(outside, 'outside\n', { mode: 0o600 })
    symlinkSync(outside, statePath)

    expect(() => readDesktopSetupWizardState(userData, profile)).toThrow('regular file')
    await expect(completeOrSkipDesktopSetupWizard(userData, profile, 'completed')).rejects.toThrow('regular file')
    await expect(clearDesktopSetupWizardState(userData, profile)).rejects.toThrow('regular file')
    expect(readFileSync(outside, 'utf8')).toBe('outside\n')
  })
})
