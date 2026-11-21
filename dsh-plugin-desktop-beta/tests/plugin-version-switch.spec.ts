import { expect, it, vi } from 'vitest'
import type { BundleInfo, ChangeResult, PluginSpecInspection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  changeReason, switchBundleVersion, versionSwitchTarget, type VersionSwitchManager,
} from '../src/client/plugin-version-switch.ts'

const bundle = (overrides: Partial<BundleInfo> = {}): BundleInfo => ({
  name: 'dsh-plugin-sample', official: false, availability: 'profile', version: '1.0.0',
  enabled: true, installed: true, optional: false, removable: true, rows: [], overrides: [],
  source: 'github:owner/sample#main', ...overrides,
})

const applied = (overrides: Partial<ChangeResult> = {}): ChangeResult =>
  ({ changed: true, application: 'applied', stage: 'install', target: 'dsh-plugin-sample', bundle: 'dsh-plugin-sample', ...overrides })

const refusedChange = (overrides: Partial<ChangeResult> = {}): ChangeResult =>
  ({ changed: false, application: 'failed', stage: 'install', target: 'dsh-plugin-sample', ...overrides })

const accepted = (overrides: Partial<Extract<PluginSpecInspection, { status: 'accepted' }>> = {}) =>
  ({ status: 'accepted' as const, kind: 'git' as const, bundle: null, registry: null, ...overrides })

/** The manager's Remote with a passing default, and the mocks a test asserts on. */
interface Fixture {
  readonly remote: VersionSwitchManager
  readonly inspect: ReturnType<typeof vi.fn<VersionSwitchManager['inspect']>>
  readonly removeBundle: ReturnType<typeof vi.fn<VersionSwitchManager['removeBundle']>>
  readonly installBundle: ReturnType<typeof vi.fn<VersionSwitchManager['installBundle']>>
}

const fixture = (overrides: Partial<VersionSwitchManager> = {}): Fixture => {
  const inspect = vi.fn<VersionSwitchManager['inspect']>(async () => ({ ok: true, value: accepted() }))
  const removeBundle = vi.fn<VersionSwitchManager['removeBundle']>(async () => ({ ok: true, value: applied({ stage: 'remove', bundle: undefined }) }))
  const installBundle = vi.fn<VersionSwitchManager['installBundle']>(async () => ({ ok: true, value: applied() }))
  return { remote: { inspect, removeBundle, installBundle, ...overrides }, inspect, removeBundle, installBundle }
}

it('offers itself only for a third-party bundle the official page cannot update or remove', () => {
  expect(versionSwitchTarget(bundle())).toEqual({ name: 'dsh-plugin-sample', source: 'github:owner/sample#main', enabled: true, version: '1.0.0' })
  expect(versionSwitchTarget(bundle({ version: undefined }))).toEqual({ name: 'dsh-plugin-sample', source: 'github:owner/sample#main', enabled: true })
  // The page itself updates these: a registry copy, and a Git copy pinned to a full commit.
  expect(versionSwitchTarget(bundle({ update: 'registry', source: 'dsh-plugin-sample@^1.0.0' }))).toBeUndefined()
  expect(versionSwitchTarget(bundle({ update: 'git' }))).toBeUndefined()
  expect(versionSwitchTarget(bundle({ official: true }))).toBeUndefined()
  expect(versionSwitchTarget(bundle({ installed: false }))).toBeUndefined()
  expect(versionSwitchTarget(bundle({ availability: 'installation' }))).toBeUndefined()
  expect(versionSwitchTarget(bundle({ availability: 'missing' }))).toBeUndefined()
  expect(versionSwitchTarget(bundle({ source: undefined }))).toBeUndefined()
  expect(versionSwitchTarget(undefined)).toBeUndefined()
})

it('keeps a bundle carrying plugin management out of the replacement', () => {
  expect(versionSwitchTarget(bundle({ removable: false }))).toBeUndefined()
  // The listed row can carry the reason without clearing the flag; either one refuses.
  expect(versionSwitchTarget(bundle({ readOnlyReason: 'management-required' }))).toBeUndefined()
})

it('replaces the installed copy: check, remove, install with the bundle switch kept', async () => {
  const steps: string[] = []
  const { remote, inspect, removeBundle, installBundle } = fixture()
  const target = versionSwitchTarget(bundle())!
  const outcome = await switchBundleVersion(remote, target, 'github:owner/sample#next', step => { steps.push(step) })
  expect(outcome.status).toBe('installed')
  expect(steps).toEqual(['checking', 'removing', 'installing'])
  expect(inspect).toHaveBeenCalledExactlyOnceWith('github:owner/sample#next', {})
  expect(removeBundle).toHaveBeenCalledExactlyOnceWith('dsh-plugin-sample')
  expect(installBundle).toHaveBeenCalledExactlyOnceWith('github:owner/sample#next', { enabled: true })
})

it('saves a registry target exactly and keeps a disabled bundle switched off', async () => {
  const { remote, installBundle } = fixture({
    inspect: vi.fn<VersionSwitchManager['inspect']>(async () => ({ ok: true, value: accepted({ kind: 'registry', name: 'dsh-plugin-sample', version: '1.2.0', bundle: true }) })),
  })
  await switchBundleVersion(remote, versionSwitchTarget(bundle({ enabled: false }))!, 'dsh-plugin-sample@1.2.0')
  expect(installBundle).toHaveBeenCalledExactlyOnceWith('dsh-plugin-sample@1.2.0', { enabled: false, saveExact: true })
})

it('refuses a target the manager will not install before anything is removed', async () => {
  const { remote, removeBundle, installBundle } = fixture({
    inspect: vi.fn<VersionSwitchManager['inspect']>(async () => ({ ok: true, value: { status: 'refused', problem: 'not-a-bundle', reason: 'declares no dsh.bundle' } })),
  })
  const outcome = await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'D:\\plugins\\other')
  expect(outcome).toEqual({ status: 'refused', reason: 'declares no dsh.bundle' })
  expect(removeBundle).not.toHaveBeenCalled()
  expect(installBundle).not.toHaveBeenCalled()
})

it('refuses a target that names another package, which would install beside the removed one', async () => {
  const { remote, removeBundle, installBundle } = fixture({
    inspect: vi.fn<VersionSwitchManager['inspect']>(async () => ({ ok: true, value: accepted({ kind: 'path', name: 'dsh-plugin-other', bundle: true }) })),
  })
  expect(await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'D:\\plugins\\other'))
    .toEqual({ status: 'refused', reason: 'D:\\plugins\\other is the package dsh-plugin-other, not dsh-plugin-sample' })
  expect(removeBundle).not.toHaveBeenCalled()
  expect(installBundle).not.toHaveBeenCalled()
})

it('stops when the installed copy cannot be removed', async () => {
  const { remote, installBundle } = fixture({
    removeBundle: vi.fn<VersionSwitchManager['removeBundle']>(async () => ({ ok: true, value: refusedChange({ stage: 'remove', error: { code: 'bundle-in-use', diagnostic: 'the bundle is in use' } }) })),
  })
  expect(await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'github:owner/sample#next'))
    .toEqual({ status: 'not-removed', reason: 'the bundle is in use' })
  expect(installBundle).not.toHaveBeenCalled()
})

it('installs the previous source again when the target fails without installing', async () => {
  const { remote, removeBundle, installBundle } = fixture({
    installBundle: vi.fn<VersionSwitchManager['installBundle']>(async spec => ({ ok: true, value: spec === 'github:owner/sample#next'
      ? refusedChange({ target: spec, error: { code: 'invalid-spec', diagnostic: 'no such branch' } })
      : applied({ target: spec }) })),
  })
  const outcome = await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'github:owner/sample#next')
  expect(outcome).toMatchObject({ status: 'restored', reason: 'no such branch' })
  // A run that never installed anything leaves nothing to remove before the reinstallation.
  expect(removeBundle).toHaveBeenCalledExactlyOnceWith('dsh-plugin-sample')
  expect(installBundle).toHaveBeenLastCalledWith('github:owner/sample#main', { enabled: true })
})

it('removes a target that installed and failed to start before the previous source returns', async () => {
  const { remote, removeBundle, installBundle } = fixture({
    installBundle: vi.fn<VersionSwitchManager['installBundle']>(async spec => ({ ok: true, value: spec === 'github:owner/sample#next'
      ? refusedChange({ stage: 'enable', target: spec, bundle: 'dsh-plugin-sample', error: { code: 'operation-error', diagnostic: 'the row did not start' } })
      : applied({ target: spec }) })),
  })
  const outcome = await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'github:owner/sample#next')
  expect(outcome).toMatchObject({ status: 'restored', reason: 'the row did not start' })
  expect(removeBundle.mock.calls).toEqual([['dsh-plugin-sample'], ['dsh-plugin-sample']])
})

it('removes a target that installed another package before the previous source returns', async () => {
  const { remote, removeBundle, installBundle } = fixture({
    installBundle: vi.fn<VersionSwitchManager['installBundle']>(async spec => ({ ok: true, value: spec === 'github:owner/sample#next'
      ? applied({ bundle: 'dsh-plugin-other' }) : applied({ target: spec }) })),
  })
  const outcome = await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'github:owner/sample#next')
  expect(outcome).toMatchObject({ status: 'restored', reason: 'github:owner/sample#next installed dsh-plugin-other, not dsh-plugin-sample' })
  expect(removeBundle.mock.calls).toEqual([['dsh-plugin-sample'], ['dsh-plugin-other']])
})

it('names the source to install by hand when the reinstallation fails too', async () => {
  const { remote } = fixture({
    installBundle: vi.fn<VersionSwitchManager['installBundle']>(async spec => ({ ok: true, value: refusedChange({
      target: spec, error: { code: 'operation-error', diagnostic: spec === 'github:owner/sample#next' ? 'no such branch' : 'github is unreachable' },
    }) })),
  })
  expect(await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'github:owner/sample#next'))
    .toEqual({ status: 'lost', reason: 'no such branch', restoreReason: 'github is unreachable', previous: 'github:owner/sample#main' })
})

it('reads a transport failure as the failed step it is', async () => {
  const { remote } = fixture({
    installBundle: vi.fn<VersionSwitchManager['installBundle']>(async spec => spec === 'github:owner/sample#next'
      ? { ok: false, error: { message: 'connection reset' } }
      : { ok: true, value: applied({ target: spec }) }),
  })
  expect(await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'github:owner/sample#next'))
    .toMatchObject({ status: 'restored', reason: 'connection reset' })
})

it('refuses an empty spec, and replaces with a directory the manager refuses as already installed', async () => {
  expect(await switchBundleVersion(fixture().remote, versionSwitchTarget(bundle())!, '   '))
    .toEqual({ status: 'refused', reason: 'the package spec must not be empty' })
  // A directory naming the installed package is refused as already installed, which is this replacement's own case.
  const { remote, removeBundle, installBundle } = fixture({
    inspect: vi.fn<VersionSwitchManager['inspect']>(async () => ({ ok: true, value: { status: 'refused', problem: 'already-installed', reason: 'dsh-plugin-sample is already installed' } })),
  })
  expect(await switchBundleVersion(remote, versionSwitchTarget(bundle())!, 'D:\\plugins\\sample')).toMatchObject({ status: 'installed' })
  expect(removeBundle).toHaveBeenCalledExactlyOnceWith('dsh-plugin-sample')
  // A local path carries its own exactness, so no registry-only save flag travels with it.
  expect(installBundle).toHaveBeenCalledExactlyOnceWith('D:\\plugins\\sample', { enabled: true })
})

it('words a failed change from its diagnostic, its last output lines, or its code', () => {
  expect(changeReason(refusedChange({ error: { code: 'operation-error', diagnostic: ' offline ' } }))).toBe('offline')
  expect(changeReason(refusedChange({ packageResult: { exitCode: 1, output: 'a\nb\n', truncated: false, logPath: 'x' } }))).toBe('a\nb')
  expect(changeReason(refusedChange({ error: { code: 'bundle-in-use' } }))).toBe('bundle-in-use')
})
