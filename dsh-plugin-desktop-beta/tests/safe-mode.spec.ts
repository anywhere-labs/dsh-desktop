import * as fileSystem from 'node:fs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupDesktopSafeModeEnvironment,
  DESKTOP_SAFE_MODE_DEFAULTS,
  DESKTOP_SAFE_MODE_PROFILE_NAME,
  desktopSafeModePaths,
  ensureDesktopSafeModeEnvironment,
  resetDesktopSafeModeEnvironment,
} from '../src/safe-mode.ts'

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
}))

describe('Desktop Safe Mode environment', () => {
  const roots: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(roots.splice(0).map(async root => { await rm(root, { recursive: true, force: true }) }))
  })

  async function userData(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-safe-mode-'))
    roots.push(root)
    return root
  }

  it('uses a visible Safe Mode label for its disposable Profile', () => {
    expect(DESKTOP_SAFE_MODE_PROFILE_NAME).toBe('desktop-safe-mode')
  })

  it('uses fixed non-interactive defaults for the disposable Profile', () => {
    expect(DESKTOP_SAFE_MODE_DEFAULTS).toEqual({
      market: 'disabled',
      settings: {
        mode: 'compatibility',
        macosMaterial: 'off',
        windowsMaterial: 'off',
        openBrowser: false,
        networkExposure: 'loopback',
        notifications: {
          enabled: false,
          notifyOnTurnCompletion: false,
          notifyOnTurnFailure: false,
          notifyOnJobCompletion: false,
          notifyOnJobFailure: false,
        },
      },
    })
  })

  it('creates an isolated DSH home and Desktop state outside the normal Harness home', async () => {
    const root = await userData()
    const paths = resetDesktopSafeModeEnvironment(root, () => new Date('2026-09-03T00:00:00.000Z'))

    expect(paths).toEqual(desktopSafeModePaths(root))
    expect(paths.homeDir).toBe(join(root, 'safe-mode', 'dsh-home'))
    expect(paths.userDataDir).toBe(join(root, 'safe-mode', 'desktop-state'))
    expect(JSON.parse(readFileSync(join(paths.rootDir, 'environment.json'), 'utf8'))).toEqual({
      version: 1,
      createdAt: '2026-09-03T00:00:00.000Z',
    })
  })

  it('creates a usable environment even when directory renames are denied on Windows', async () => {
    const root = await userData()
    const rename = vi.spyOn(fileSystem, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
    })

    const paths = resetDesktopSafeModeEnvironment(root)

    expect(rename).not.toHaveBeenCalled()
    expect(existsSync(join(paths.rootDir, 'environment.json'))).toBe(true)
    expect(ensureDesktopSafeModeEnvironment(root)).toEqual(paths)
  })

  it('publishes the completion marker only after directories and permissions are ready', async () => {
    const root = await userData()
    const paths = desktopSafeModePaths(root)
    const permissions = vi.spyOn(fileSystem, 'chmodSync')

    resetDesktopSafeModeEnvironment(root, () => {
      expect(existsSync(paths.homeDir)).toBe(true)
      expect(existsSync(paths.userDataDir)).toBe(true)
      expect(permissions).toHaveBeenCalledWith(paths.rootDir, 0o700)
      expect(permissions).toHaveBeenCalledWith(paths.homeDir, 0o700)
      expect(permissions).toHaveBeenCalledWith(paths.userDataDir, 0o700)
      expect(existsSync(join(paths.rootDir, 'environment.json'))).toBe(false)
      return new Date('2026-09-03T00:00:00.000Z')
    })

    expect(existsSync(join(paths.rootDir, 'environment.json'))).toBe(true)
  })

  it('cleans an incomplete environment when writing the completion marker fails', async () => {
    const root = await userData()
    const paths = desktopSafeModePaths(root)
    const failure = Object.assign(new Error('ENOSPC: cannot write completion marker'), { code: 'ENOSPC' })
    vi.spyOn(fileSystem, 'writeFileSync').mockImplementationOnce(() => { throw failure })

    expect(() => resetDesktopSafeModeEnvironment(root)).toThrow(failure)
    expect(existsSync(paths.rootDir)).toBe(false)
    expect(ensureDesktopSafeModeEnvironment(root)).toEqual(paths)
    expect(existsSync(join(paths.rootDir, 'environment.json'))).toBe(true)
  })

  it('replaces an interrupted generation that has directories but no completion marker', async () => {
    const root = await userData()
    const paths = desktopSafeModePaths(root)
    mkdirSync(paths.homeDir, { recursive: true })
    mkdirSync(paths.userDataDir, { recursive: true })
    writeFileSync(join(paths.homeDir, 'incomplete-session'), 'discard')

    expect(ensureDesktopSafeModeEnvironment(root)).toEqual(paths)
    expect(existsSync(join(paths.homeDir, 'incomplete-session'))).toBe(false)
    expect(existsSync(join(paths.rootDir, 'environment.json'))).toBe(true)
  })

  it('adopts one prepared Safe Mode generation but resets an invalid environment', async () => {
    const root = await userData()
    const paths = resetDesktopSafeModeEnvironment(root)
    writeFileSync(join(paths.homeDir, 'session-data'), 'keep while active')

    expect(ensureDesktopSafeModeEnvironment(root)).toEqual(paths)
    expect(readFileSync(join(paths.homeDir, 'session-data'), 'utf8')).toBe('keep while active')

    writeFileSync(join(paths.rootDir, 'environment.json'), '{broken')
    const repaired = ensureDesktopSafeModeEnvironment(root)
    expect(repaired).toEqual(paths)
    expect(() => readFileSync(join(paths.homeDir, 'session-data'), 'utf8')).toThrow()
  })

  it('removes all disposable data on the next normal launch', async () => {
    const root = await userData()
    const paths = resetDesktopSafeModeEnvironment(root)
    mkdirSync(join(paths.homeDir, 'profiles', DESKTOP_SAFE_MODE_PROFILE_NAME), { recursive: true })
    writeFileSync(join(paths.homeDir, 'profiles', DESKTOP_SAFE_MODE_PROFILE_NAME, 'session.json'), '{}')
    writeFileSync(join(paths.userDataDir, 'selection.json'), '{}')

    expect(cleanupDesktopSafeModeEnvironment(root)).toBe(true)
    expect(cleanupDesktopSafeModeEnvironment(root)).toBe(false)
    expect(() => readFileSync(join(paths.homeDir, 'profiles', DESKTOP_SAFE_MODE_PROFILE_NAME, 'session.json'))).toThrow()
  })

  it('rejects relative or NUL-bearing userData paths', () => {
    expect(() => desktopSafeModePaths('relative')).toThrow(/absolute path/u)
    expect(() => desktopSafeModePaths('/tmp/bad\0path')).toThrow(/absolute path/u)
  })
})
