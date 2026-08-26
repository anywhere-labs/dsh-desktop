import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultDesktopSetupWizardSettings,
  migrateDesktopBrowserAccessSettings,
  readDesktopSetupWizardSettings,
  updateDesktopSetupWizardSettings,
  type DesktopSetupWizardSettings,
} from '../src/setup-wizard-settings.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-setup-settings-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function values(overrides: Partial<DesktopSetupWizardSettings> = {}): DesktopSetupWizardSettings {
  return {
    mode: 'compatibility',
    macosMaterial: 'transparent',
    windowsMaterial: 'mica',
    openBrowser: true,
    networkExposure: 'lan',
    notifications: {
      enabled: true,
      notifyOnTurnCompletion: false,
      notifyOnTurnFailure: true,
      notifyOnJobCompletion: false,
      notifyOnJobFailure: true,
    },
    ...overrides,
  }
}

describe('Desktop Setup Wizard settings document', () => {
  it('returns platform defaults for an absent exact settings document', () => {
    const root = temporaryDirectory()
    expect(readDesktopSetupWizardSettings(join(root, 'settings.yaml')))
      .toEqual(defaultDesktopSetupWizardSettings())
    expect(readDesktopSetupWizardSettings(join(root, 'settings.json')))
      .toEqual(defaultDesktopSetupWizardSettings())
    expect(defaultDesktopSetupWizardSettings()).toMatchObject({
      mode: 'compatibility',
      macosMaterial: 'transparent',
      windowsMaterial: 'acrylic',
      openBrowser: false,
      networkExposure: 'loopback',
    })
  })

  it('updates YAML leaves while preserving comments, unknown fields, and inactive-platform material', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'settings.yaml')
    writeFileSync(path, [
      '# settings owner comment',
      'other-plugin:',
      '  token: keep-me',
      'dsh-desktop:',
      '  # presentation comment',
      '  mode: compatibility',
      '  macosMaterial: transparent',
      '  windowsMaterial: acrylic',
      '  port: 61201',
      '  logLevel: warn',
      '  futureField: preserved',
      'dsh-desktop-notifications:',
      '  enabled: false',
      '  notifyOnTurnCompletion: true',
      '  futureNotification: keep',
      '',
    ].join('\n'), { mode: 0o600 })

    const next = values()
    await expect(updateDesktopSetupWizardSettings(path, next)).resolves.toEqual(next)

    const text = readFileSync(path, 'utf8')
    expect(text).toContain('# settings owner comment')
    expect(text).toContain('# presentation comment')
    const document = parseDocument(text).toJS() as Record<string, Record<string, unknown>>
    expect(document['other-plugin']).toEqual({ token: 'keep-me' })
    expect(document['dsh-desktop']).toMatchObject({
      mode: 'compatibility',
      macosMaterial: 'transparent',
      windowsMaterial: 'mica',
      port: 61201,
      logLevel: 'warn',
      futureField: 'preserved',
      openBrowser: true,
      networkExposure: 'lan',
    })
    expect(document['dsh-desktop-notifications']).toEqual({
      enabled: true,
      notifyOnTurnCompletion: false,
      notifyOnTurnFailure: true,
      notifyOnJobCompletion: false,
      notifyOnJobFailure: true,
      futureNotification: 'keep',
    })
    expect(readDesktopSetupWizardSettings(path)).toEqual(next)
    expect(readdirSync(root)).toEqual(['settings.yaml'])
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('creates and updates JSON without dropping unrelated namespaces or unknown leaves', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'custom-settings.json')
    writeFileSync(path, `${JSON.stringify({
      custom: { retained: ['a', 'b'] },
      'dsh-desktop': {
        mode: 'extended',
        macosMaterial: 'off',
        windowsMaterial: 'acrylic',
        future: 42,
      },
      'dsh-desktop-notifications': { future: 'yes' },
    }, undefined, 2)}\n`, { mode: 0o600 })
    const next = values({
      mode: 'compatibility',
      macosMaterial: 'transparent',
      windowsMaterial: 'acrylic',
    })

    await updateDesktopSetupWizardSettings(path, next)

    const output = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, unknown>>
    expect(output.custom).toEqual({ retained: ['a', 'b'] })
    expect(output['dsh-desktop']).toMatchObject({
      mode: 'compatibility',
      macosMaterial: 'transparent',
      windowsMaterial: 'acrylic',
      future: 42,
      openBrowser: true,
      networkExposure: 'lan',
    })
    expect(output['dsh-desktop-notifications']).toMatchObject({ future: 'yes' })
    expect(readDesktopSetupWizardSettings(path)).toEqual(next)
  })

  it('creates an absent YAML document with every supported field', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'nested', 'settings.yml')
    const next = values({
      mode: 'extended',
      macosMaterial: 'transparent',
      openBrowser: false,
      networkExposure: 'loopback',
    })

    await updateDesktopSetupWizardSettings(path, next)

    expect(lstatSync(path).isFile()).toBe(true)
    expect(readDesktopSetupWizardSettings(path)).toEqual(next)
  })

  it('does not overwrite malformed syntax, invalid roots, or invalid known values', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'settings.yaml')
    for (const text of [
      'dsh-desktop: [unterminated\n',
      '- not\n- a namespace map\n',
      'dsh-desktop:\n  mode: impossible\n',
      'dsh-desktop-notifications:\n  enabled: sometimes\n',
    ]) {
      writeFileSync(path, text, { mode: 0o600 })
      await expect(updateDesktopSetupWizardSettings(path, values())).rejects.toThrow()
      expect(readFileSync(path, 'utf8')).toBe(text)
      expect(readdirSync(root)).toEqual(['settings.yaml'])
    }
  })

  it('does not overwrite empty, malformed, or non-UTF-8 JSON', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'settings.json')
    const invalidDocuments = [
      Buffer.from(''),
      Buffer.from('{not-json}\n'),
      Buffer.from([0xff]),
    ]
    for (const contents of invalidDocuments) {
      writeFileSync(path, contents, { mode: 0o600 })
      await expect(updateDesktopSetupWizardSettings(path, values())).rejects.toThrow()
      expect(readFileSync(path)).toEqual(contents)
    }
  })

  it('requires a complete update and withdraws LAN exposure with browser access', async () => {
    const path = join(temporaryDirectory(), 'settings.json')
    const incomplete = values({
      openBrowser: false,
      networkExposure: 'lan',
      notifications: { enabled: true } as DesktopSetupWizardSettings['notifications'],
    })
    await expect(updateDesktopSetupWizardSettings(path, incomplete))
      .rejects.toThrow('all five notification booleans')

    const next = values({ openBrowser: false, networkExposure: 'lan' })
    await expect(updateDesktopSetupWizardSettings(path, next)).resolves.toMatchObject({
      openBrowser: false,
      networkExposure: 'loopback',
    })
    expect(readDesktopSetupWizardSettings(path)).toMatchObject({
      openBrowser: false,
      networkExposure: 'loopback',
    })

    const incompatible = values({ mode: 'advanced', openBrowser: true, networkExposure: 'lan' })
    await expect(updateDesktopSetupWizardSettings(path, incompatible)).resolves.toMatchObject({
      mode: 'advanced',
      openBrowser: false,
      networkExposure: 'loopback',
    })
    expect(readDesktopSetupWizardSettings(path)).toMatchObject({
      mode: 'advanced',
      openBrowser: false,
      networkExposure: 'loopback',
    })
  })

  it('projects legacy LAN exposure as explicit compatibility browser access', () => {
    const path = join(temporaryDirectory(), 'settings.yaml')
    writeFileSync(path, [
      'dsh-desktop:',
      '  openBrowser: false',
      '  networkExposure: lan',
      '',
    ].join('\n'))

    expect(readDesktopSetupWizardSettings(path)).toMatchObject({
      mode: 'compatibility',
      openBrowser: true,
      networkExposure: 'lan',
    })
  })

  it('atomically withdraws legacy browser handoff and LAN from custom modes', async () => {
    const root = temporaryDirectory()
    const yamlPath = join(root, 'legacy.yaml')
    writeFileSync(yamlPath, [
      '# preserve browser migration comments',
      'dsh-desktop:',
      '  mode: advanced',
      '  openBrowser: false',
      '  networkExposure: lan',
      '  future: keep',
      '',
    ].join('\n'))

    await expect(migrateDesktopBrowserAccessSettings(yamlPath)).resolves.toBe(true)
    await expect(migrateDesktopBrowserAccessSettings(yamlPath)).resolves.toBe(false)
    const migrated = readFileSync(yamlPath, 'utf8')
    expect(migrated).toContain('# preserve browser migration comments')
    expect(parseDocument(migrated).toJS()).toMatchObject({
      'dsh-desktop': {
        mode: 'advanced',
        openBrowser: false,
        networkExposure: 'loopback',
        future: 'keep',
      },
    })

    const jsonPath = join(root, 'legacy.json')
    writeFileSync(jsonPath, `${JSON.stringify({
      'dsh-desktop': {
        mode: 'extended',
        openBrowser: true,
        networkExposure: 'loopback',
      },
      untouched: { value: 1 },
    })}\n`)
    await expect(migrateDesktopBrowserAccessSettings(jsonPath)).resolves.toBe(true)
    expect(JSON.parse(readFileSync(jsonPath, 'utf8'))).toMatchObject({
      'dsh-desktop': {
        mode: 'extended',
        openBrowser: false,
        networkExposure: 'loopback',
      },
      untouched: { value: 1 },
    })
  })

  it('migrates legacy LAN to explicit browser access only in compatibility mode', async () => {
    const path = join(temporaryDirectory(), 'legacy.yaml')
    writeFileSync(path, [
      'dsh-desktop:',
      '  mode: compatibility',
      '  openBrowser: false',
      '  networkExposure: lan',
      '',
    ].join('\n'))

    await expect(migrateDesktopBrowserAccessSettings(path)).resolves.toBe(true)
    expect(parseDocument(readFileSync(path, 'utf8')).toJS()).toMatchObject({
      'dsh-desktop': {
        mode: 'compatibility',
        openBrowser: true,
        networkExposure: 'lan',
      },
    })
  })

  it('does not acquire a writer lock when browser access settings are already normalized', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'settings.yaml')
    const lockPath = `${path}.lock`
    const contents = 'dsh-desktop:\n  mode: compatibility\n  macosMaterial: transparent\n'
    writeFileSync(path, contents)
    writeFileSync(lockPath, 'owner\n')

    await expect(migrateDesktopBrowserAccessSettings(path)).resolves.toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(contents)
    expect(readFileSync(lockPath, 'utf8')).toBe('owner\n')
  })

  it('does not acquire a writer lock for an unchanged Setup selection', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'settings.yaml')
    const lockPath = `${path}.lock`
    const contents = 'dsh-desktop:\n  mode: compatibility\n  macosMaterial: transparent\n'
    writeFileSync(path, contents)
    writeFileSync(lockPath, 'owner\n')

    await expect(updateDesktopSetupWizardSettings(path, defaultDesktopSetupWizardSettings()))
      .resolves.toEqual(defaultDesktopSetupWizardSettings())
    expect(readFileSync(path, 'utf8')).toBe(contents)
    expect(readFileSync(lockPath, 'utf8')).toBe('owner\n')
  })

  it('writes a changed Setup selection without waiting for a settings lock', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'settings.yaml')
    const lockPath = `${path}.lock`
    writeFileSync(path, 'dsh-desktop:\n  mode: compatibility\n')
    writeFileSync(lockPath, 'owner\n')
    const next = values({
      mode: 'advanced',
      openBrowser: false,
      networkExposure: 'loopback',
    })

    await expect(updateDesktopSetupWizardSettings(path, next)).resolves.toEqual(next)
    expect(readDesktopSetupWizardSettings(path)).toEqual(next)
    expect(readFileSync(lockPath, 'utf8')).toBe('owner\n')
  })

  it('does not wait for a settings lock when a browser migration is needed', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'settings.yaml')
    const lockPath = `${path}.lock`
    const contents = 'dsh-desktop:\n  mode: advanced\n  openBrowser: true\n'
    writeFileSync(path, contents)
    writeFileSync(lockPath, 'owner\n')

    await expect(migrateDesktopBrowserAccessSettings(path)).resolves.toBe(true)
    expect(readFileSync(path, 'utf8')).not.toBe(contents)
    expect(readFileSync(lockPath, 'utf8')).toBe('owner\n')
    expect(readDesktopSetupWizardSettings(path)).toMatchObject({
      mode: 'advanced',
      openBrowser: false,
      networkExposure: 'loopback',
    })
  })

  it('never follows an existing settings-document symlink', async () => {
    const root = temporaryDirectory()
    const outside = join(temporaryDirectory(), 'outside.yaml')
    const path = join(root, 'settings.yaml')
    writeFileSync(outside, 'outside: true\n', { mode: 0o600 })
    symlinkSync(outside, path)

    expect(() => readDesktopSetupWizardSettings(path)).toThrow('regular file')
    await expect(updateDesktopSetupWizardSettings(path, values())).rejects.toThrow('regular file')
    expect(readFileSync(outside, 'utf8')).toBe('outside: true\n')
  })

  it('serializes concurrent complete updates without producing a torn document', async () => {
    const root = temporaryDirectory()
    const path = join(root, 'settings.yaml')
    writeFileSync(path, 'unrelated:\n  keep: true\n', { mode: 0o600 })
    const first = values({ mode: 'extended', windowsMaterial: 'acrylic', openBrowser: false, networkExposure: 'loopback' })
    const second = values({ mode: 'compatibility', windowsMaterial: 'mica', networkExposure: 'loopback' })

    await Promise.all([
      updateDesktopSetupWizardSettings(path, first),
      updateDesktopSetupWizardSettings(path, second),
    ])

    const result = readDesktopSetupWizardSettings(path)
    expect([first, second]).toContainEqual(result)
    expect(parseDocument(readFileSync(path, 'utf8')).toJS()).toMatchObject({
      unrelated: { keep: true },
    })
    expect(readdirSync(root)).toEqual(['settings.yaml'])
  })
})
