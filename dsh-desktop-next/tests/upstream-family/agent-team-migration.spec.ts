/** Upgrade an existing profile with retired upstream bundles without changing user patches or sessions. */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NextProfiles } from '../../src/profiles.ts'

it('backs up retired Team and worktree selections, preserves unrelated choices, and migrates only once', () => {
  const home = mkdtempSync(join(tmpdir(), 'desktop-team-upgrade-'))
  try {
    const profiles = new NextProfiles(home)
    const directory = profiles.ensure('desktop')
    const path = join(directory, 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    const originalBundles = [...manifest.dsh.profile.bundles]
    manifest.dsh.profile.bundles.push(
      '@deepseek-ai/dsh-experimental-agent-team-profile',
      '@deepseek-ai/dsh-experimental-agent-team-web-profile',
      '@deepseek-ai/dsh-experimental-tool-worktree',
      'third-party-plugin',
    )
    const original = JSON.stringify(manifest)
    writeFileSync(path, original)
    const patch = '# User configuration remains unchanged\n[]\n'
    writeFileSync(join(directory, 'cordis.patch.yml'), patch)
    profiles.ensure('desktop')
    expect(JSON.parse(readFileSync(path, 'utf8')).dsh.profile.bundles).toEqual(
      [...originalBundles, 'third-party-plugin'])
    expect(readFileSync(join(directory, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    const backupRoot = join(home, 'recovery')
    const backups = readdirSync(backupRoot)
    const backup = backups.find(name => JSON.parse(readFileSync(join(backupRoot, name, 'snapshot.json'), 'utf8')).reason === 'before-upstream-bundle-retirement')
    expect(backup).toBeDefined()
    expect(readFileSync(join(backupRoot, backup!, 'package.json'), 'utf8')).toBe(original)
    profiles.ensure('desktop')
    expect(readdirSync(backupRoot).sort()).toEqual(backups.sort())
  } finally { rmSync(home, { recursive: true, force: true }) }
})
