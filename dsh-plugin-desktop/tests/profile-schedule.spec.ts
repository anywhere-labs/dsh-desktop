import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ensureDesktopProfile, prepareDesktopProfile } from '../src/profile.ts'
import { RETIRED_SCHEDULE_BUNDLE, SCHEDULE_RETIREMENT_MARKER } from '../src/profile-schedule.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Manifest {
  dsh: { profile: { bundles: string[] }, [key: string]: unknown }
  [key: string]: unknown
}

/** A Desktop Profile as 0.2.0-rc.2 left it after Scheduled Tasks was enabled. */
function earlierProfile(patch: string): { home: string, dir: string, read: () => { manifest: Manifest, patch: string } } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-schedule-'))
  roots.push(root)
  const home = join(root, 'dsh-home')
  const dir = ensureDesktopProfile(home)
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  manifest.dsh.profile.bundles.push(RETIRED_SCHEDULE_BUNDLE)
  delete manifest.dsh[SCHEDULE_RETIREMENT_MARKER]
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  return {
    home,
    dir,
    read: () => ({
      manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest,
      patch: readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'),
    }),
  }
}

function prepare(home: string): void {
  prepareDesktopProfile(undefined, home, 'darwin', 'desktop')
}

it('boots a Profile that still lists the retired Scheduled Tasks bundle and drops stale clock overrides', () => {
  const { home, read } = earlierProfile([
    '# keep me',
    '- id: ui-sidebar-browser',
    '  disabled: true',
    '- id: time-context',
    '  disabled: true',
    '- id: schedule',
    '  disabled: false',
    '',
  ].join('\n'))

  expect(() => prepare(home)).not.toThrow()
  const after = read()
  expect(after.manifest.dsh.profile.bundles).not.toContain(RETIRED_SCHEDULE_BUNDLE)
  expect(after.manifest.dsh[SCHEDULE_RETIREMENT_MARKER]).toBe(true)
  expect(after.patch).toBe('# keep me\n- id: ui-sidebar-browser\n  disabled: true\n- id: schedule\n  disabled: false\n')
})

it('prunes the bundle again when a health snapshot restores the older manifest', () => {
  const { home, dir, read } = earlierProfile('[]\n')
  prepare(home)
  const restored = read().manifest
  restored.dsh.profile.bundles.push(RETIRED_SCHEDULE_BUNDLE)
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(restored, undefined, 2)}\n`)

  expect(() => prepare(home)).not.toThrow()
  expect(read().manifest.dsh.profile.bundles).not.toContain(RETIRED_SCHEDULE_BUNDLE)
})

it('leaves clock overrides written after the retirement alone', () => {
  const { home, dir, read } = earlierProfile('[]\n')
  prepare(home)
  const userPatch = '- id: time-context\n  disabled: true\n'
  writeFileSync(join(dir, 'cordis.patch.yml'), userPatch)

  prepare(home)
  expect(read().patch).toBe(userPatch)
})
