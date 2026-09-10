import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProfileCheckpointSlot, RestoreResult } from '../src/profile-checkpoint.ts'
import {
  DesktopStartupRecoveryController,
  DesktopStartupRecoveryControllerError,
  type DesktopStartupRecoveryControllerOptions,
} from '../src/startup-recovery-controller.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-startup-recovery-'))
  roots.push(root)
  return root
}

function writeManifest(root: string): string {
  const path = join(root, 'dsh-home', 'profiles', 'desktop', 'package.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({
    name: 'dsh-profile-desktop',
    dependencies: { 'direct-plugin': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-plugin-desktop', 'direct-plugin', 'detached-bundle'] } },
  }, undefined, 2)}\n`)
  return path
}

function slots(root: string): readonly ProfileCheckpointSlot[] {
  return [1, 2, 3].map(index => index === 3
    ? { slotId: 'slot-3', snapshotExists: false, snapshotDirectory: join(root, 'private', 'slot-3') }
    : {
        slotId: `slot-${index}` as 'slot-1' | 'slot-2',
        snapshotExists: true,
        snapshotDirectory: join(root, 'private', `slot-${index}`),
        manifest: {
          version: 2,
          snapshotId: `snapshot-${index}`,
          capturedAt: `2026-08-2${index}T00:00:00.000Z`,
          profileIdentity: 'private-profile-identity',
          profileName: 'desktop',
          provider: 'desktop-profile',
          slotId: `slot-${index}` as 'slot-1' | 'slot-2',
          reason: 'healthy-startup',
          appVersion: '2.0.3',
          files: [{ name: 'package.json', present: true, sha256: 'a'.repeat(64), size: 20, mode: 0o600 }],
        },
        pluginCount: index + 2,
        totalBytes: 20,
      })
}

function createHarness(root: string, options: {
  now?: () => number
  afterCheckpointRestore?: DesktopStartupRecoveryControllerOptions['afterCheckpointRestore']
  uninstallPlugin?: DesktopStartupRecoveryControllerOptions['uninstallPlugin']
} = {}) {
  const manifestPath = writeManifest(root)
  const generation = { profileName: 'desktop', generationId: 'current-generation-0001' }
  const restoreSlot = vi.fn((slotId: 'slot-1' | 'slot-2' | 'slot-3'): RestoreResult => ({
    status: 'restored',
    slotId,
    changedFiles: ['package.json'],
    dependencyMaterializationRequired: true,
    snapshotDirectory: join(root, 'private', slotId),
  }))
  const completeDependencyMaterialization = vi.fn()
  const openCheckpointDirectory = vi.fn(async () => {})
  const uninstallPlugin = vi.fn(options.uninstallPlugin ?? (async (packageName: string) => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    delete manifest.dependencies[packageName]
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(bundle => bundle !== packageName)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  }))
  const controller = new DesktopStartupRecoveryController({
    pluginState: {
      profileName: 'desktop',
      homeDir: join(root, 'dsh-home'),
      statePath: join(root, 'user-data', 'plugin-management', 'state.json'),
    },
    generationId: generation.generationId,
    currentGeneration: () => generation,
    uninstallPlugin,
    checkpoints: { listSlots: () => slots(root), restoreSlot, completeDependencyMaterialization },
    openCheckpointDirectory,
    ...(options.afterCheckpointRestore === undefined ? {} : { afterCheckpointRestore: options.afterCheckpointRestore }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return {
    controller,
    generation,
    manifestPath,
    restoreSlot,
    completeDependencyMaterialization,
    openCheckpointDirectory,
    uninstallPlugin,
  }
}

function errorCode(cause: unknown): string | undefined {
  return cause instanceof DesktopStartupRecoveryControllerError ? cause.code : undefined
}

describe('pre-Host Desktop startup recovery controller', () => {
  it('projects direct dependency uninstallability and browseable checkpoint metadata without paths or hashes', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    const snapshot = await target.controller.snapshot()
    expect(snapshot.bundles.find(item => item.packageName === 'direct-plugin')).toMatchObject({ owner: 'profile', action: 'uninstall' })
    expect(snapshot.bundles.find(item => item.packageName === 'detached-bundle')).toMatchObject({ owner: 'external', action: null })
    expect(snapshot.bundles.find(item => item.packageName === 'dsh-plugin-desktop')).toMatchObject({ owner: 'core', action: null })
    expect(snapshot.checkpoints).toEqual([
      { slotId: 'slot-1', status: 'available', capturedAt: '2026-08-21T00:00:00.000Z', appVersion: '2.0.3', provider: 'desktop-profile', fileCount: 1, pluginCount: 3, totalBytes: 20 },
      { slotId: 'slot-2', status: 'available', capturedAt: '2026-08-22T00:00:00.000Z', appVersion: '2.0.3', provider: 'desktop-profile', fileCount: 1, pluginCount: 4, totalBytes: 20 },
      { slotId: 'slot-3', status: 'empty' },
    ])
    const exported = JSON.stringify(snapshot)
    expect(exported).not.toContain(root)
    expect(exported).not.toContain('private-profile-identity')
    expect(exported).not.toContain('a'.repeat(64))
  })

  it('uninstalls a direct Profile dependency with a one-shot preview', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    const bundle = (await target.controller.snapshot()).bundles.find(item => item.packageName === 'direct-plugin')!
    const preview = await target.controller.previewUninstall(bundle.bundleId)
    await expect(target.controller.executeUninstall(preview.previewId)).resolves.toEqual({ action: 'uninstall', packageName: 'direct-plugin' })
    await expect(target.controller.executeUninstall(preview.previewId)).rejects.toSatisfy(cause => errorCode(cause) === 'preview-expired')
    expect(target.uninstallPlugin).toHaveBeenCalledWith('direct-plugin')
    expect(readFileSync(target.manifestPath, 'utf8')).not.toContain('direct-plugin')
    expect((await target.controller.snapshot()).bundles.find(item => item.packageName === 'direct-plugin')).toBeUndefined()
  })

  it('does not offer removal for built-in or non-dependency bundle layers', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    const snapshot = await target.controller.snapshot()
    for (const packageName of ['dsh-plugin-desktop', 'detached-bundle']) {
      const bundle = snapshot.bundles.find(item => item.packageName === packageName)!
      await expect(target.controller.previewUninstall(bundle.bundleId)).rejects.toSatisfy(
        cause => errorCode(cause) === 'immutable-target',
      )
    }
    expect(target.uninstallPlugin).not.toHaveBeenCalled()
  })

  it('restores one exact slot, synchronizes it, and consumes the preview once', async () => {
    const root = temporaryRoot()
    const synchronize = vi.fn(async () => {})
    const target = createHarness(root, { afterCheckpointRestore: synchronize })
    const preview = await target.controller.previewCheckpointRestore('slot-2')
    await expect(target.controller.executeCheckpointRestore(preview.previewId)).resolves.toEqual({
      action: 'restore-checkpoint',
      slotId: 'slot-2',
      changedFiles: ['package.json'],
    })
    expect(target.restoreSlot).toHaveBeenCalledWith('slot-2')
    expect(synchronize).toHaveBeenCalledOnce()
    expect(target.completeDependencyMaterialization).toHaveBeenCalledWith('slot-2')
    await expect(target.controller.executeCheckpointRestore(preview.previewId)).rejects.toSatisfy(
      cause => errorCode(cause) === 'preview-expired',
    )
    await expect(target.controller.previewCheckpointRestore('slot-3')).rejects.toSatisfy(
      cause => errorCode(cause) === 'invalid-target',
    )
  })

  it('retries dependency materialization after a restored checkpoint reports a failure', async () => {
    const root = temporaryRoot()
    const synchronize = vi.fn()
      .mockRejectedValueOnce(new Error('pnpm install failed with code 1'))
      .mockResolvedValueOnce(undefined)
    const target = createHarness(root, { afterCheckpointRestore: synchronize })

    const firstPreview = await target.controller.previewCheckpointRestore('slot-1')
    await expect(target.controller.executeCheckpointRestore(firstPreview.previewId)).rejects.toMatchObject({
      code: 'operation-failed',
      operationStage: 'dependency-materialization',
      diagnosticDetail: expect.stringContaining('pnpm install failed with code 1'),
    })
    expect(target.completeDependencyMaterialization).not.toHaveBeenCalled()

    const retryPreview = await target.controller.previewCheckpointRestore('slot-1')
    await expect(target.controller.executeCheckpointRestore(retryPreview.previewId)).resolves.toMatchObject({
      action: 'restore-checkpoint',
      slotId: 'slot-1',
    })
    expect(synchronize).toHaveBeenCalledTimes(2)
    expect(target.completeDependencyMaterialization).toHaveBeenCalledOnce()
  })

  it('opens only the exact available checkpoint directory', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    await target.controller.openCheckpoint('slot-1')
    expect(target.openCheckpointDirectory).toHaveBeenCalledWith(join(root, 'private', 'slot-1'))
    await expect(target.controller.openCheckpoint('slot-3')).rejects.toSatisfy(
      cause => errorCode(cause) === 'invalid-target',
    )
  })

  it('invalidates actions when the active generation changes', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    const preview = await target.controller.previewCheckpointRestore('slot-1')
    target.generation.profileName = 'other'
    await expect(target.controller.executeCheckpointRestore(preview.previewId)).rejects.toSatisfy(
      cause => errorCode(cause) === 'generation-changed',
    )
  })
})
