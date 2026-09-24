import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { composeEntries, loadOverlayPatches, OPTIONAL_BUNDLES, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { AA_PACKAGE, COMMUNITY_MARKET_PACKAGE, DSH_MARKET_PACKAGE, loadNextProfile, NEXT_PACKAGE, NextProfiles, profileName, WEB_BUNDLES } from '../src/profiles.ts'
import * as privateFiles from '../src/private-files.ts'

const roots: string[] = []
function profiles() { const home = mkdtempSync(join(tmpdir(), 'dsh-next-profiles-')); roots.push(home); return new NextProfiles(home) }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it.each(['../outside', 'a/b', 'a\\b', 'node_modules', 'CON', '', 'a'.repeat(65)])('rejects invalid profile name %s', name => {
  expect(() => profileName(name)).toThrow()
})
it('starts fresh homes with desktop and preserves an explicitly selected legacy Profile', () => {
  const manager = profiles()
  expect(manager.active).toBe('desktop')
  const legacy = manager.ensure('default')
  const original = readFileSync(join(legacy, 'package.json'), 'utf8')
  manager.ensure(manager.active)
  expect(manager.list()).toEqual(['default', 'desktop'])
  expect(readFileSync(join(legacy, 'package.json'), 'utf8')).toBe(original)
  manager.select('default')
  expect(new NextProfiles(manager.home).active).toBe('default')
  expect(manager.selectable('desktop')).toBe(true)
})
it('isolates profile configuration and preserves existing files on ensure', () => {
  const manager = profiles()
  const first = manager.ensure('desktop')
  manager.create('work')
  writeFileSync(join(first, 'cordis.patch.yml'), '# user patch\n[]\n')
  manager.ensure('desktop')
  manager.setFeatures('work', { remoteControl: true, market: false })
  manager.select('work')
  expect(new NextProfiles(manager.home).active).toBe('work')
  expect(manager.features('desktop')).toEqual({ remoteControl: false, market: true })
  expect(manager.features('work')).toEqual({ remoteControl: true, market: false })
  expect(readFileSync(join(first, 'cordis.patch.yml'), 'utf8')).toBe('# user patch\n[]\n')
  expect(() => manager.create('work')).toThrow()
})

it('records onboarding per Profile together with its plugin choices and retains unrelated configuration', () => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  manager.create('work')
  const file = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  manifest.dsh.profile.bundles.push('my-plugin')
  manifest.dependencies = { 'my-plugin': '1.0.0' }
  manifest.custom = 'keep'
  writeFileSync(file, JSON.stringify(manifest))
  expect(manager.onboardingRequired('desktop')).toBe(true)
  manager.finishOnboarding('desktop', { features: { market: false, dshMarket: true, remoteControl: true }, computerUse: true })
  const reread = new NextProfiles(manager.home)
  reread.ensure('desktop')
  expect(reread.onboardingRequired('desktop')).toBe(false)
  expect(reread.onboardingRequired('work')).toBe(true)
  expect(reread.features('desktop')).toEqual({ market: false, dshMarket: true, remoteControl: true })
  expect(reread.computerUseEnabled('desktop')).toBe(true)
  expect(reread.computerUseEnabled('work')).toBe(false)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
    custom: 'keep', dependencies: manifest.dependencies,
    dsh: { desktopNextOnboarding: { version: 1, outcome: 'completed' }, profile: { bundles: expect.arrayContaining(['my-plugin']) } },
  })
  manager.select('work'); manager.select('desktop')
  expect(manager.onboardingRequired('desktop')).toBe(false)
})

it('skips onboarding without changing current choices, while a recreated Profile starts fresh', () => {
  const manager = profiles()
  const dir = manager.create('work')
  manager.setFeatures('work', { market: false, dshMarket: true, remoteControl: true })
  const patch = '# existing choice\n- id: computer-use-cua-driver-native\n  disabled: false\n'
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  manager.finishOnboarding('work')
  expect(manager.onboardingRequired('work')).toBe(false)
  expect(manager.features('work')).toEqual({ market: false, dshMarket: true, remoteControl: true })
  expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toBe(patch)
  expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dsh.desktopNextOnboarding.outcome).toBe('skipped')
  rmSync(dir, { recursive: true })
  manager.create('work')
  expect(manager.onboardingRequired('work')).toBe(true)
  expect(manager.computerUseEnabled('work')).toBe(false)
})

it.each([
  { market: true, dshMarket: true, remoteControl: false },
  { market: true, remoteControl: 'yes' },
  { market: false, remoteControl: false, extra: true },
])('leaves onboarding incomplete and configuration untouched on invalid choices %j', value => {
  const manager = profiles()
  const file = join(manager.ensure('desktop'), 'package.json')
  const original = readFileSync(file, 'utf8')
  expect(() => manager.finishOnboarding('desktop', { features: value, computerUse: false })).toThrow()
  expect(readFileSync(file, 'utf8')).toBe(original)
  expect(manager.onboardingRequired('desktop')).toBe(true)
})

it.each([true, false])('saves Computer Use=%s in the official row without losing comments, expressions or other overrides', enabled => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, `# My Profile\n- id: agent\n  config:\n    label: !!js "'keep'"\n- id: computer-use-cua-driver-native\n  disabled: false # first override\n- id: computer-use-cua-driver-native\n  name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'\n  disabled: true # final override\n`)
  expect(manager.computerUseEnabled('desktop')).toBe(false)
  manager.finishOnboarding('desktop', { features: { market: false, remoteControl: false }, computerUse: enabled })
  const saved = readFileSync(patchPath, 'utf8')
  expect(saved).toContain('# My Profile')
  expect(saved).toContain('!!js')
  expect(saved).toContain('# first override')
  expect(saved).toContain('# final override')
  const profile = loadNextProfile(dir, manager.home)
  const rows = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
  expect(rows.find(row => row.id === 'computer-use-cua-driver-native')?.disabled).toBe(!enabled)
  expect(manager.computerUseEnabled('desktop')).toBe(enabled)
  // Subsequent official manager edits own the row; completion never forces it back on.
  writeFileSync(patchPath, '- id: computer-use-cua-driver-native\n  disabled: true\n')
  manager.ensure('desktop')
  expect(manager.computerUseEnabled('desktop')).toBe(false)
  expect(manager.onboardingRequired('desktop')).toBe(false)
})

it.each([undefined, 'yes', 1, null])('rejects an invalid Computer Use choice %j before writing either file', computerUse => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  const manifest = readFileSync(join(dir, 'package.json'), 'utf8')
  const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
  expect(() => manager.finishOnboarding('desktop', { features: { market: false, remoteControl: false }, computerUse })).toThrow('Computer Use')
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(manifest)
  expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toBe(patch)
})

it('reads the saved enablement through later configuration-only and name-mismatched overrides', () => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: computer-use-cua-driver-native\n  disabled: false\n- id: computer-use-cua-driver-native\n  config: {}\n- id: computer-use-cua-driver-native\n  name: another-plugin\n  disabled: true\n')
  expect(manager.computerUseEnabled('desktop')).toBe(true)
})

it.each([': broken: [yaml', 'disabled: false\n'])('does not overwrite an invalid patch while completing onboarding: %s', patch => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  const manifest = readFileSync(join(dir, 'package.json'), 'utf8')
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  expect(() => manager.finishOnboarding('desktop', { features: { market: false, remoteControl: false }, computerUse: true })).toThrow()
  expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(manifest)
  expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toBe(patch)
  expect(manager.onboardingRequired('desktop')).toBe(true)
})

it('restores the original patch and leaves onboarding pending when completion cannot be saved', () => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
  const write = vi.spyOn(privateFiles, 'atomicJson').mockImplementationOnce(() => { throw new Error('Cannot save manifest') })
  try {
    expect(() => manager.finishOnboarding('desktop', { features: { market: false, remoteControl: true }, computerUse: true })).toThrow('Cannot save manifest')
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    expect(manager.onboardingRequired('desktop')).toBe(true)
    expect(manager.features('desktop')).toEqual({ market: true, remoteControl: false })
  } finally { write.mockRestore() }
})
it('refuses a symlinked profile before writing outside Next home', () => {
  const manager = profiles()
  const outside = profiles()
  mkdirSync(join(manager.home, 'profiles'))
  symlinkSync(outside.home, join(manager.home, 'profiles', 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => manager.ensure('escape')).toThrow('real directory')
})
it('recovers without parsing broken patches or deleting plugin packages and home patches', async () => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  manifest.dsh.profile.bundles.push('missing-third-party-plugin')
  manifest.dependencies = { 'missing-third-party-plugin': '1.0.0' }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  const broken = ': invalid: [yaml'
  writeFileSync(join(dir, 'cordis.patch.yml'), broken)
  writeFileSync(join(manager.home, 'cordis.patch.yml'), '# keep home patch\n[]\n')
  mkdirSync(join(dir, 'node_modules', 'missing-third-party-plugin'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'missing-third-party-plugin', 'keep'), 'plugin')
  manager.setFeatures('desktop', { remoteControl: true, market: true })
  manager.finishOnboarding('desktop')
  const backup = await manager.recover('desktop')
  expect(readFileSync(backup!, 'utf8')).toBe(broken)
  expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dsh.profile.bundles).toEqual(WEB_BUNDLES)
  expect(manager.features('desktop')).toEqual({ remoteControl: false, market: false })
  expect(manager.onboardingRequired('desktop')).toBe(false)
  expect(readFileSync(join(dir, 'node_modules', 'missing-third-party-plugin', 'keep'), 'utf8')).toBe('plugin')
  expect(readFileSync(join(manager.home, 'cordis.patch.yml'), 'utf8')).toContain('keep home patch')
})
it.each(['desktop', 'work', 'default'])('offers the Browser in %s without enabling optional bundles or overriding user choices', name => {
  const manager = profiles()
  const dir = manager.ensure(name)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  for (const bundle of OPTIONAL_BUNDLES) expect(manifest.dsh.profile.bundles).not.toContain(bundle)
  const profile = loadNextProfile(dir, manager.home)
  const layers = profile.layers.map(layer => layer.patches)
  const browser = (patches = loadOverlayPatches('next', profile.patchPath)) =>
    composeEntries([...layers, patches]).find(row => row.id === 'ui-sidebar-browser')
  expect(browser()).toMatchObject({ name: '@deepseek-ai/dsh-client-ui-sidebar-browser', disabled: false })
  for (const disabled of [true, false]) {
    writeFileSync(profile.patchPath, `- id: ui-sidebar-browser\n  disabled: ${disabled}\n`)
    expect(browser()?.disabled).toBe(disabled)
  }
})

it('composes optional AA and Market while retaining the official Web layout', () => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  manager.setFeatures('desktop', { remoteControl: true, market: true, dshMarket: true })
  const profile = loadNextProfile(dir, manager.home)
  const rows = composeEntries([...profile.layers.map(layer => layer.patches), loadOverlayPatches('next', join(dir, 'desktop-next.cordis.patch.json'))])
  expect(rows.some(row => row.name === AA_PACKAGE && !row.disabled)).toBe(true)
  expect(rows.some(row => row.name === COMMUNITY_MARKET_PACKAGE && !row.disabled)).toBe(true)
  expect(rows.some(row => row.name === DSH_MARKET_PACKAGE && !row.disabled)).toBe(true)
  expect(rows.some(row => row.id === 'ui-layout' && !row.disabled)).toBe(true)
  expect(rows.some(row => row.name === '@deepseek-ai/dsh-computer-use' && !row.disabled)).toBe(true)
  expect(rows.some(row => row.name === '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native' && row.disabled)).toBe(true)
  // Client module discovery requires a package root, not the previous /extensions subpath.
  expect(rows.find(row => row.id === 'desktop-next-capabilities')?.name).toBe('dsh-desktop-next')
  const reread = readProfilePatches('next', {
    name: 'desktop', dir, patchPath: profile.patchPath, installAnchor: NEXT_PACKAGE,
    cwd: dir, home: manager.home, startedBundles: WEB_BUNDLES, telemetryDisabledEnv: '1',
    overlays: [...loadOverlayPatches('next', fileURLToPath(new URL('../host.cordis.patch.yml', import.meta.url))),
      ...loadOverlayPatches('next', join(dir, 'desktop-next.cordis.patch.json'))],
  })
  const reconciled = composeEntries([reread])
  expect(reconciled.some(row => row.name === 'dsh-community-market' && !row.disabled)).toBe(true)
  expect(reconciled.find(row => row.id === 'webserver')?.disabled).toBe(true)
  expect(reconciled.some(row => row.name === 'dsh-desktop-next/webserver' && !row.disabled)).toBe(true)
  manager.setFeatures('desktop', { remoteControl: false, market: false })
  const disabled = composeEntries([...loadNextProfile(dir, manager.home).layers.map(layer => layer.patches), loadOverlayPatches('next', join(dir, 'desktop-next.cordis.patch.json'))])
  expect(disabled.some(row => !row.disabled && (row.name === AA_PACKAGE || row.name === 'dsh-community-market'))).toBe(false)
})

it('refuses to overwrite an unmanaged bundle fallback', () => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  mkdirSync(join(manager.home, 'profiles', 'node_modules', 'dsh-desktop-next'), { recursive: true })
  expect(() => loadNextProfile(dir, manager.home)).toThrow('unmanaged package')
})

it('marks broken or non-Next Profiles unavailable without modifying or loading them', () => {
  const manager = profiles()
  manager.ensure('desktop')
  const broken = manager.create('broken')
  writeFileSync(join(broken, 'package.json'), '{broken')
  const foreign = manager.create('foreign')
  writeFileSync(join(foreign, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['third-party'] } } }))
  expect(manager.list()).toEqual(['broken', 'desktop', 'foreign'])
  expect(manager.selectable('desktop')).toBe(true)
  expect(manager.selectable('broken')).toBe(false)
  expect(manager.selectable('foreign')).toBe(false)
  expect(() => manager.select('broken')).toThrow('unavailable')
  expect(manager.active).toBe('desktop')
  expect(readFileSync(join(broken, 'package.json'), 'utf8')).toBe('{broken')
})


it('migrates legacy switches once and preserves later official plugin selections across restarts', () => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  const file = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  delete manifest.dsh.desktopNextPlugins
  manifest.dsh.profile.bundles = [...WEB_BUNDLES, DSH_MARKET_PACKAGE]
  manifest.dependencies = { 'my-plugin': '1.0.0' }
  manifest.custom = 'keep'
  writeFileSync(file, JSON.stringify(manifest))
  writeFileSync(join(dir, 'desktop-next.features.json'), JSON.stringify({ market: false, remoteControl: true }))
  manager.ensure('desktop')
  expect(manager.features('desktop')).toEqual({ market: false, remoteControl: true, dshMarket: true })
  const migrated = JSON.parse(readFileSync(file, 'utf8'))
  expect(migrated).toMatchObject({ dependencies: manifest.dependencies, custom: 'keep' })
  // The official manager writes the bundle list, with no shell feature flag write.
  migrated.dsh.profile.bundles = [...WEB_BUNDLES, COMMUNITY_MARKET_PACKAGE, DSH_MARKET_PACKAGE]
  writeFileSync(file, JSON.stringify(migrated))
  manager.ensure('desktop')
  loadNextProfile(dir, manager.home)
  expect(manager.features('desktop')).toEqual({ market: true, remoteControl: false, dshMarket: true })
  const overlay = JSON.parse(readFileSync(join(dir, 'desktop-next.cordis.patch.json'), 'utf8'))
  expect(overlay.every((row: object) => !Object.hasOwn(row, 'disabled'))).toBe(true)
  manager.create('work')
  expect(manager.features('work')).toEqual({ market: true, remoteControl: false })
})

it('keeps the recovery deselection ledger across a feature change and never reselects from it', () => {
  const manager = profiles()
  const dir = manager.ensure('desktop')
  const file = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  manifest.dependencies = { 'my-plugin': '1.0.0' }
  manifest.dsh.desktopNextDeselectedBundles = ['my-plugin']
  writeFileSync(file, JSON.stringify(manifest))

  manager.finishOnboarding('desktop', { features: { market: false, dshMarket: true, remoteControl: true }, computerUse: false })

  const after = JSON.parse(readFileSync(file, 'utf8'))
  expect(after.dsh.desktopNextDeselectedBundles).toEqual(['my-plugin'])
  expect(after.dsh.profile.bundles).not.toContain('my-plugin')
  expect(after.dependencies['my-plugin']).toBe('1.0.0')
  expect(after.dsh.profile.bundles).toContain(DSH_MARKET_PACKAGE)
  expect(after.dsh.profile.bundles).toContain(AA_PACKAGE)
  expect(after.dsh.profile.bundles).not.toContain(COMMUNITY_MARKET_PACKAGE)
})
