import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDesktopProfileName,
  beginDesktopProfileStartup,
  canDeleteDesktopProfile,
  createDesktopWebProfile,
  deleteDesktopProfile,
  listDesktopProfiles,
  readDesktopProfileState,
  selectDesktopProfile,
} from '../src/profile-manager.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-manager-'))
  roots.push(root)
  return root
}

function writeProfile(home: string, name: string, bundles: unknown): string {
  const dir = join(home, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dsh: { profile: { bundles } },
  }, undefined, 2) + '\n')
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop profile discovery', () => {
  it('accepts safe human profile names while rejecting path and control characters', () => {
    expect(() => assertDesktopProfileName('团队 profile')).not.toThrow()
    expect(() => assertDesktopProfileName('profile\nname')).toThrow('invalid desktop profile name')
    expect(() => assertDesktopProfileName('../outside')).toThrow()
    expect(() => assertDesktopProfileName('CON.txt')).toThrow('invalid desktop profile name')
    expect(() => assertDesktopProfileName('name.')).toThrow('invalid desktop profile name')
    expect(() => assertDesktopProfileName('name ')).toThrow('invalid desktop profile name')
    expect(() => assertDesktopProfileName('.web.creating-123-12345678-1234-4123-8123-123456789abc'))
      .toThrow('invalid desktop profile name')
    expect(() => assertDesktopProfileName('é'.repeat(128))).toThrow('invalid desktop profile name')
  })

  it('creates a Web profile from the shipped template and publishes all files together', () => {
    const home = temporaryRoot()

    expect(createDesktopWebProfile(home, 'work')).toEqual(expect.objectContaining({
      name: 'work',
      dir: join(home, 'profiles', 'work'),
      exists: true,
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      webCapable: true,
    }))
    expect(readFileSync(join(home, 'profiles', 'work', 'package.json'), 'utf8'))
      .toContain('"name": "dsh-profile-work"')
    expect(existsSync(join(home, 'profiles', 'work', 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(join(home, 'profiles', 'work', 'pnpm-workspace.yaml'))).toBe(true)
    expect(readdirSync(join(home, 'profiles')).filter(name => name.includes('.work.creating-'))).toEqual([])
  })

  it('does not overwrite an existing profile or leave a target after failure', () => {
    const home = temporaryRoot()
    const existing = writeProfile(home, 'work', ['@deepseek-ai/dsh-base'])
    const before = readFileSync(join(existing, 'package.json'), 'utf8')

    expect(() => createDesktopWebProfile(home, 'work')).toThrow('already exists')
    expect(readFileSync(join(existing, 'package.json'), 'utf8')).toBe(before)
    expect(readdirSync(join(home, 'profiles')).filter(name => name.includes('.work.creating-'))).toEqual([])

    const blockedHome = join(home, 'blocked-home')
    mkdirSync(blockedHome, { recursive: true })
    writeFileSync(join(blockedHome, 'profiles'), 'not a directory')
    expect(() => createDesktopWebProfile(blockedHome, 'work')).toThrow()
    expect(existsSync(join(blockedHome, 'profiles', 'work'))).toBe(false)
  })

  it('lists only profiles with real manifests without creating missing defaults', () => {
    const home = temporaryRoot()
    const webDir = writeProfile(home, 'work', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'third-party-plugin',
    ])
    writeProfile(home, 'headless', ['@deepseek-ai/dsh-base'])
    writeProfile(home, 'wrong-order', ['@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-base'])
    writeProfile(home, 'embedded-desktop', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-plugin-desktop',
    ])
    writeProfile(home, 'broken', 'not-an-array')
    mkdirSync(join(home, 'profiles', 'node_modules'), { recursive: true })
    const before = readFileSync(join(webDir, 'package.json'), 'utf8')

    expect(listDesktopProfiles(home)).toEqual([
      expect.objectContaining({ name: 'broken', exists: true, webCapable: false, problem: expect.any(String) }),
      expect.objectContaining({
        name: 'embedded-desktop',
        exists: true,
        webCapable: false,
        problem: expect.stringContaining('launcher-owned'),
      }),
      expect.objectContaining({ name: 'headless', exists: true, webCapable: false, bundles: ['@deepseek-ai/dsh-base'] }),
      expect.objectContaining({
        name: 'work',
        exists: true,
        webCapable: true,
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'third-party-plugin'],
      }),
      expect.objectContaining({ name: 'wrong-order', exists: true, webCapable: false }),
    ])
    expect(listDesktopProfiles(temporaryRoot())).toEqual([])
    expect(readFileSync(join(webDir, 'package.json'), 'utf8')).toBe(before)
    expect(readdirSync(join(home, 'profiles')).sort()).toEqual([
      'broken',
      'embedded-desktop',
      'headless',
      'node_modules',
      'work',
      'wrong-order',
    ])
  })

  it('treats an existing repairable desktop profile as managed but rejects malformed metadata', () => {
    const home = temporaryRoot()
    writeProfile(home, 'desktop', ['@deepseek-ai/dsh-base'])
    expect(listDesktopProfiles(home)[0]).toEqual(expect.objectContaining({
      name: 'desktop',
      exists: true,
      webCapable: true,
    }))

    writeProfile(home, 'desktop', 'broken')
    expect(listDesktopProfiles(home)[0]).toEqual(expect.objectContaining({
      name: 'desktop',
      webCapable: false,
      problem: expect.any(String),
    }))
  })
})

describe('desktop profile deletion', () => {
  function writeSelection(home: string, statePath: string, state: Record<string, unknown> = {
    version: 2,
    active: 'desktop',
  }): void {
    mkdirSync(join(home, 'profiles'), { recursive: true })
    mkdirSync(join(statePath, '..'), { recursive: true })
    writeFileSync(statePath, `${JSON.stringify(state)}\n`)
  }

  it('protects only the current, missing, and unsafe profiles', () => {
    const home = temporaryRoot()
    const statePath = join(home, 'state', 'profiles.json')
    writeSelection(home, statePath)
    writeProfile(home, 'desktop', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    writeProfile(home, 'web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    const link = join(home, 'profiles', 'link')
    let linked = false
    try {
      symlinkSync(join(home, 'profiles', 'work'), link, 'dir')
      linked = true
    } catch { /* Windows may require an elevated symlink privilege. */ }
    const options = { home, selectionStatePath: statePath, currentProfileName: 'desktop' }

    expect(canDeleteDesktopProfile(options, 'desktop')).toBe(false)
    expect(canDeleteDesktopProfile(options, 'web')).toBe(true)
    expect(canDeleteDesktopProfile(options, 'missing')).toBe(false)
    if (linked) expect(canDeleteDesktopProfile(options, 'link')).toBe(false)
    expect(canDeleteDesktopProfile(options, 'work')).toBe(true)
  })

  it('allows inactive desktop and web profiles to be deleted', async () => {
    const home = temporaryRoot()
    const statePath = join(home, 'state', 'profiles.json')
    writeSelection(home, statePath, {
      version: 2,
      active: 'work',
    })
    writeProfile(home, 'desktop', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    writeProfile(home, 'web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    const options = { home, selectionStatePath: statePath, currentProfileName: 'work' }

    expect(canDeleteDesktopProfile(options, 'work')).toBe(false)
    expect(canDeleteDesktopProfile(options, 'desktop')).toBe(true)
    expect(canDeleteDesktopProfile(options, 'web')).toBe(true)
    await deleteDesktopProfile(options, 'desktop')
    await deleteDesktopProfile(options, 'web')
    expect(existsSync(join(home, 'profiles', 'desktop'))).toBe(false)
    expect(existsSync(join(home, 'profiles', 'web'))).toBe(false)
  })

  it('renames, cleans, and removes an inactive profile', async () => {
    const home = temporaryRoot()
    const statePath = join(home, 'state', 'profiles.json')
    writeSelection(home, statePath)
    writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    const clearDisabledState = vi.fn(async () => {})
    const clearCheckpoint = vi.fn(() => {})

    await deleteDesktopProfile({
      home,
      selectionStatePath: statePath,
      currentProfileName: 'desktop',
      clearDisabledState,
      clearCheckpoint,
    }, 'work')

    expect(existsSync(join(home, 'profiles', 'work'))).toBe(false)
    expect(readdirSync(join(home, 'profiles')).some(name => name.includes('.work.deleting-'))).toBe(false)
    expect(clearDisabledState).toHaveBeenCalledOnce()
    expect(clearCheckpoint).toHaveBeenCalledOnce()
  })

  it('restores the directory after cleanup failure', async () => {
    const home = temporaryRoot()
    const statePath = join(home, 'state', 'profiles.json')
    writeSelection(home, statePath)
    const profileDir = writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    await expect(deleteDesktopProfile({
      home,
      selectionStatePath: statePath,
      currentProfileName: 'desktop',
      clearDisabledState: () => { throw new Error('state locked') },
    }, 'work')).rejects.toThrow('state locked')
    expect(existsSync(profileDir)).toBe(true)
    expect(readdirSync(join(home, 'profiles')).some(name => name.includes('.work.deleting-'))).toBe(false)
  })
})

describe('desktop profile selection state', () => {
  it('materializes one real desktop profile when no profiles exist', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'private', 'state.json')

    expect(listDesktopProfiles(home)).toEqual([])
    expect(beginDesktopProfileStartup(statePath, home)).toEqual({
      profileName: 'desktop',
      state: { version: 2, active: 'desktop' },
      recoveredState: false,
    })
    expect(listDesktopProfiles(home)).toEqual([
      expect.objectContaining({ name: 'desktop', exists: true, webCapable: true }),
    ])
    expect(existsSync(join(home, 'profiles', 'desktop', 'package.json'))).toBe(true)
    expect(existsSync(join(home, 'profiles', 'desktop', 'pnpm-workspace.yaml'))).toBe(true)
  })

  it('ignores interrupted staging profiles when deciding that no real profile exists', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'private', 'state.json')
    const stagingName = '.web.creating-123-12345678-1234-4123-8123-123456789abc'
    writeProfile(home, stagingName, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

    expect(listDesktopProfiles(home)).toEqual([])
    expect(beginDesktopProfileStartup(statePath, home).profileName).toBe('desktop')
    expect(listDesktopProfiles(home).map(profile => profile.name)).toEqual(['desktop'])
    expect(existsSync(join(home, 'profiles', stagingName, 'package.json'))).toBe(true)
  })

  it('preserves an incomplete default directory while materializing the real desktop profile', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'private', 'state.json')
    const partial = join(home, 'profiles', 'desktop')
    mkdirSync(partial, { recursive: true })
    writeFileSync(join(partial, 'keep.txt'), 'recoverable\n')

    expect(beginDesktopProfileStartup(statePath, home).profileName).toBe('desktop')
    expect(existsSync(join(partial, 'package.json'))).toBe(true)
    const incomplete = readdirSync(join(home, 'profiles')).find(name => name.startsWith('.desktop.incomplete-'))
    expect(incomplete).toBeDefined()
    expect(readFileSync(join(home, 'profiles', incomplete!, 'keep.txt'), 'utf8')).toBe('recoverable\n')
    expect(listDesktopProfiles(home).map(profile => profile.name)).toEqual(['desktop'])
  })

  it('defaults to desktop and queues only a directly Web-capable profile', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'desktop-private', 'profile-selection', 'state.json')
    writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    writeProfile(home, 'headless', ['@deepseek-ai/dsh-base'])
    writeProfile(home, 'wrong-order', ['@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-base'])
    writeProfile(home, 'embedded-desktop', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-plugin-desktop',
    ])

    expect(readDesktopProfileState(statePath)).toEqual({
      version: 2,
      active: 'desktop',
    })
    expect(selectDesktopProfile(statePath, home, 'work')).toEqual({
      version: 2,
      active: 'work',
    })
    expect(() => selectDesktopProfile(statePath, home, 'headless')).toThrow(
      'must directly include @deepseek-ai/dsh-base before @deepseek-ai/dsh-web-app',
    )
    expect(() => selectDesktopProfile(statePath, home, 'wrong-order')).toThrow(
      'must directly include @deepseek-ai/dsh-base before @deepseek-ai/dsh-web-app',
    )
    expect(() => selectDesktopProfile(statePath, home, 'embedded-desktop')).toThrow('launcher-owned')
    expect(() => selectDesktopProfile(statePath, home, '../outside')).toThrow()
    if (process.platform !== 'win32') {
      expect(statSync(statePath).mode & 0o777).toBe(0o600)
      expect(statSync(join(root, 'desktop-private', 'profile-selection')).mode & 0o777).toBe(0o700)
    }
  })

  it('keeps the exact selected profile across repeated startup attempts', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'private', 'state.json')
    writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    selectDesktopProfile(statePath, home, 'work')

    expect(beginDesktopProfileStartup(statePath, home)).toEqual({
      profileName: 'work',
      state: { version: 2, active: 'work' },
      recoveredState: false,
    })
    expect(beginDesktopProfileStartup(statePath, home)).toEqual({
      profileName: 'work',
      state: { version: 2, active: 'work' },
      recoveredState: false,
    })
  })

  it('does not accept or migrate the removed v1 last-known-good state', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'private', 'state.json')
    writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    mkdirSync(join(statePath, '..'), { recursive: true })
    writeFileSync(statePath, JSON.stringify({ version: 1, active: 'work', lastKnownGood: 'work' }))
    expect(beginDesktopProfileStartup(statePath, home)).toEqual({
      profileName: 'desktop',
      state: { version: 2, active: 'desktop' },
      recoveredState: true,
    })
    expect(existsSync(join(home, 'profiles', 'desktop', 'pnpm-workspace.yaml'))).toBe(true)
  })

  it('recovers malformed state by materializing the real default profile', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const stateDir = join(root, 'private')
    const statePath = join(stateDir, 'state.json')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(statePath, '{broken')

    expect(beginDesktopProfileStartup(statePath, home)).toEqual({
      profileName: 'desktop',
      state: { version: 2, active: 'desktop' },
      recoveredState: true,
    })
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
      version: 2,
      active: 'desktop',
    })
    expect(lstatSync(statePath).isSymbolicLink()).toBe(false)
    expect(existsSync(join(home, 'profiles', 'desktop', 'package.json'))).toBe(true)
    expect(existsSync(join(home, 'profiles', 'desktop', 'pnpm-workspace.yaml'))).toBe(true)
  })

  it('recovers to a real desktop profile when the last selected profile disappears', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'private', 'state.json')
    const profileDir = writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    selectDesktopProfile(statePath, home, 'work')
    rmSync(profileDir, { recursive: true })

    expect(beginDesktopProfileStartup(statePath, home)).toEqual({
      profileName: 'desktop',
      state: { version: 2, active: 'desktop' },
      recoveredState: true,
    })
    expect(readDesktopProfileState(statePath)).toEqual({ version: 2, active: 'desktop' })
  })

  it('does not recreate a missing selected profile while another profile exists', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'private', 'state.json')
    const workDir = writeProfile(home, 'work', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    writeProfile(home, 'other', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    selectDesktopProfile(statePath, home, 'work')
    rmSync(workDir, { recursive: true })

    expect(() => beginDesktopProfileStartup(statePath, home)).toThrow('does not exist')
    expect(listDesktopProfiles(home).map(profile => profile.name)).toEqual(['other'])
    expect(readDesktopProfileState(statePath)).toEqual({ version: 2, active: 'work' })
  })

  it('does not recreate deleted inactive web or desktop profiles', () => {
    const root = temporaryRoot()
    const home = join(root, 'harness')
    const statePath = join(root, 'private', 'state.json')
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
    const desktopDir = writeProfile(home, 'desktop', bundles)
    const webDir = writeProfile(home, 'web', bundles)
    writeProfile(home, 'work', bundles)
    selectDesktopProfile(statePath, home, 'work')
    rmSync(desktopDir, { recursive: true })
    rmSync(webDir, { recursive: true })

    expect(beginDesktopProfileStartup(statePath, home).profileName).toBe('work')
    expect(listDesktopProfiles(home).map(profile => profile.name)).toEqual(['work'])
    expect(existsSync(desktopDir)).toBe(false)
    expect(existsSync(webDir)).toBe(false)
  })
})
