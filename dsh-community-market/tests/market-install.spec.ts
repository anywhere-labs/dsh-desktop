import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type {
  BundleInfo,
  ChangeResult,
  PackageResult,
  PluginInfo,
  PluginUpdateResult,
  PluginVersion,
  PluginVersionList,
} from '@deepseek-ai/dsh-plugin-manager'
import { DSH_1024STORE_ADAPTER_ID, DSH_1024STORE_PROVIDER_ID } from '../src/adapters/dsh-1024store.js'
import { MemoryMarketStateStore } from '../src/catalog/state-store.js'
import type { CatalogHttpClient, CatalogSnapshot } from '../src/contracts/index.js'
import { marketRoutes, registerMarketRoutes } from '../src/host/routes.js'
import {
  createNpmRegistryVerifier,
  MarketInstallService,
  marketInstallationView,
  type MarketPluginManager,
} from '../src/install/service.js'

const packageName = 'dsh-plugin-safe'
const version = '1.2.3'
const profile = () => ({ name: 'desktop', dir: '/fixtures/profiles/desktop' })

function snapshot(): CatalogSnapshot {
  return {
    schemaVersion: '1.0.0',
    source: {
      sourceRecordId: 'source-1',
      providerId: DSH_1024STORE_PROVIDER_ID,
      adapterId: DSH_1024STORE_ADAPTER_ID,
      registrationKind: 'built-in',
      fetchedAt: '2026-08-25T00:00:00.000Z',
      finalUrl: 'https://deepseek1024.com/api/v2/plugins',
    },
    items: [{
      id: 'example/dsh-plugin-safe',
      name: packageName,
      displayName: 'Safe Plugin',
      summary: 'Fixture plugin',
      package: { registry: 'npm', name: packageName },
      provenance: {
        sourceRecordId: 'source-1',
        providerId: DSH_1024STORE_PROVIDER_ID,
        itemId: 'example/dsh-plugin-safe',
      },
    }],
    page: {},
  }
}

/** One profile bundle as the official manager lists it: installed, selected, and removable unless overridden. */
function bundle(name: string, overrides: Partial<BundleInfo> = {}): BundleInfo {
  return {
    name,
    official: false,
    availability: 'profile',
    version: '4.5.6',
    enabled: true,
    installed: true,
    optional: false,
    removable: true,
    updatable: false,
    rows: [],
    overrides: [],
    ...overrides,
  }
}

function applied(stage: ChangeResult['stage'], target: string, extra: Partial<ChangeResult> = {}): ChangeResult {
  return { changed: true, application: 'applied', stage, target, ...extra }
}

/** An in-memory official manager whose inventory the test controls. */
function manager(bundles: readonly BundleInfo[] = [], plugins: readonly PluginInfo[] = []) {
  const state = { bundles: [...bundles], plugins: [...plugins] }
  const fake = {
    state,
    listBundles: vi.fn(async () => [...state.bundles]),
    listPlugins: vi.fn(async () => [...state.plugins]),
    installBundle: vi.fn(async (spec: string) => {
      const name = spec.split('@').slice(0, spec.startsWith('@') ? 2 : 1).join('@')
      const installedVersion = spec.split('@').at(-1) ?? '0.0.0'
      state.bundles.push(bundle(name, { version: installedVersion }))
      return applied('install', spec, { bundle: name, version: installedVersion })
    }),
    setBundleEnabled: vi.fn(async (name: string, enabled: boolean) => {
      state.bundles = state.bundles.map(item => item.name === name ? { ...item, enabled } : item)
      return applied('enable', name, { enabled })
    }),
    removeBundle: vi.fn(async (name: string) => {
      state.bundles = state.bundles.filter(item => item.name !== name)
      return applied('remove', name)
    }),
  }
  const contract: MarketPluginManager = fake
  void contract
  return fake
}

const mirror = 'https://registry.npmmirror.com/'

function published(value: string, overrides: Partial<PluginVersion> = {}): PluginVersion {
  return { version: value, tags: [], prerelease: false, bundle: true, ...overrides }
}

function listed(installed: string, versions: readonly PluginVersion[]): PluginVersionList {
  return { status: 'listed', installed, registry: mirror, attempts: [{ registry: mirror }], versions, omitted: 0 }
}

/** A manager offering the version operations of DSH 0.2.2, listing `list` and updating in place. */
function versioned(bundles: readonly BundleInfo[], list: PluginVersionList) {
  const fake = manager(bundles)
  const withVersions = Object.assign(fake, {
    listVersions: vi.fn(async (_name: string, _options?: object, _signal?: AbortSignal) => list),
    updateBundle: vi.fn(async (name: string, to: string, _options?: object): Promise<PluginUpdateResult> => {
      const from = fake.state.bundles.find(item => item.name === name)?.version ?? ''
      fake.state.bundles = fake.state.bundles.map(item => item.name === name ? { ...item, version: to } : item)
      return { from, to, step: 'install', result: applied('install', `${name}@${to}`, { bundle: name, version: to }) }
    }),
  })
  const contract: MarketPluginManager = withVersions
  void contract
  return withVersions
}

describe('npm latest resolution', () => {
  it('uses npm latest and accepts lifecycle, deprecated, and unrelated repository metadata', async () => {
    const getJson = vi.fn(async () => ({
      finalUrl: `https://registry.npmjs.org/${packageName}/latest`,
      value: {
        name: packageName,
        version,
        deprecated: 'allowed metadata',
        scripts: { prepare: 'node build.js', postinstall: 'node setup.js' },
        repository: 'https://example.invalid/not-used',
        engines: { node: '<1' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
    }))
    const verifier = createNpmRegistryVerifier({ getJson } satisfies CatalogHttpClient)

    await expect(verifier.verify({ packageName }, new AbortController().signal)).resolves.toEqual({ version })
    expect(getJson).toHaveBeenCalledWith(
      `https://registry.npmjs.org/${packageName}/latest`,
      expect.any(AbortSignal),
      { allowedOrigin: 'https://registry.npmjs.org' },
    )
  })

  it('requires a stable latest version and a valid DSH bundle declaration', async () => {
    const http = (value: unknown): CatalogHttpClient => ({
      getJson: vi.fn(async () => ({
        finalUrl: `https://registry.npmjs.org/${packageName}/latest`,
        value,
      })),
    })
    await expect(createNpmRegistryVerifier(http({
      name: packageName,
      version: '2.0.0-beta.1',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })).verify({ packageName }, new AbortController().signal)).rejects.toMatchObject({ code: 'verification-failed' })
    await expect(createNpmRegistryVerifier(http({
      name: packageName,
      version,
    })).verify({ packageName }, new AbortController().signal)).rejects.toMatchObject({ code: 'verification-failed' })
  })
})

describe('official inventory projection', () => {
  it('lists community bundles with the actions the official flags allow', () => {
    expect(marketInstallationView(bundle('dsh-plugin-user'))).toEqual({
      kind: 'profile',
      packageName: 'dsh-plugin-user',
      version: '4.5.6',
      enabled: true,
      installed: true,
      toggleable: true,
      removable: true,
      updatable: false,
    })
    // A bundle the manager protects stays read-only.
    expect(marketInstallationView(bundle('dsh-plugin-locked', {
      removable: false, readOnlyReason: 'management-required',
    }))).toMatchObject({ toggleable: false, removable: false })
    // A selected bundle the Host cannot load can be switched off, not on.
    expect(marketInstallationView(bundle('dsh-plugin-broken', {
      enabled: false, error: { code: 'not-bundle' },
    }))).toMatchObject({ toggleable: false, removable: true, error: 'not-bundle' })
    expect(marketInstallationView(bundle('dsh-plugin-broken', {
      enabled: true, error: { code: 'incompatible-version' },
    }))).toMatchObject({ toggleable: true, error: 'incompatible-version' })
  })

  it('offers updates only for bundles the manager updates, and only from releases with version operations', () => {
    expect(marketInstallationView(bundle('dsh-plugin-user', { updatable: true }), true)).toMatchObject({ updatable: true })
    expect(marketInstallationView(bundle('dsh-plugin-user', { updatable: true }))).toMatchObject({ updatable: false })
    expect(marketInstallationView(bundle('dsh-plugin-git', { updatable: false }), true)).toMatchObject({ updatable: false })
    expect(marketInstallationView(bundle('dsh-plugin-locked', {
      updatable: true, removable: false, readOnlyReason: 'management-required',
    }), true)).toMatchObject({ updatable: false })
    // DSH releases before 0.2.2 report no `updatable` flag at all.
    const { updatable: _, ...legacy } = bundle('dsh-plugin-legacy')
    expect(marketInstallationView(legacy as BundleInfo, true)).toMatchObject({ updatable: false })
  })

  it('lists neither official plugins nor Desktop built-in bundles', () => {
    // Official bundles, whether shipped optional or installed from the on-demand catalog, belong to the official Plugins page.
    expect(marketInstallationView(bundle('dsh-experimental-shipped', { official: true }))).toBeUndefined()
    expect(marketInstallationView(bundle('@deepseek-ai/dsh-experimental-worktree', {
      official: true, availability: 'missing', installed: false, enabled: false, removable: false,
    }))).toBeUndefined()
    // Bundles the installation ships and DeepSeek's own scope are official plugins whatever the catalog flags say.
    expect(marketInstallationView(bundle('@deepseek-ai/dsh', {
      availability: 'installation', installed: false, removable: false, readOnlyReason: 'management-required',
    }))).toBeUndefined()
    expect(marketInstallationView(bundle('@deepseek-ai/dsh-plugin-from-npm'))).toBeUndefined()
    expect(marketInstallationView(bundle('shipped-plugin', { availability: 'installation', installed: false }))).toBeUndefined()
    // Desktop's own bundles, including the markets and the remote-control bridge, never appear in the Market.
    for (const name of ['dsh-community-market', 'dshmarket', '@agents-anywhere/dsh-bridge-next', 'dsh-desktop-next', 'dsh-plugin-desktop', 'dsh-plugin-desktop-beta']) {
      expect(marketInstallationView(bundle(name))).toBeUndefined()
    }
    // A selected bundle without a dependency is still part of the profile; an unselected one is not.
    expect(marketInstallationView(bundle('dsh-plugin-selected-only', { installed: false }))).toMatchObject({ installed: false, enabled: true })
    expect(marketInstallationView(bundle('dsh-plugin-unselected', { installed: false, enabled: false }))).toBeUndefined()
  })
})

describe('Profile package operations through the official manager', () => {
  it('derives install candidates from one provider page and preserves its next cursor', async () => {
    const service = new MarketInstallService(profile, manager(), { verify: vi.fn() })
    const page: CatalogSnapshot = {
      ...snapshot(),
      items: [
        ...snapshot().items,
        {
          id: 'example/browse-only',
          name: 'browse-only',
          displayName: 'Browse only',
          summary: 'No direct npm target',
          provenance: {
            sourceRecordId: 'source-1',
            providerId: DSH_1024STORE_PROVIDER_ID,
            itemId: 'example/browse-only',
          },
        } as CatalogSnapshot['items'][number],
      ],
      page: { total: 10_681, nextCursor: 'host-page-2' },
    }

    const response = service.listInstallablePage({
      sourceRecordId: 'source-1',
      registrationKind: 'built-in',
      adapterId: DSH_1024STORE_ADAPTER_ID,
      providerId: DSH_1024STORE_PROVIDER_ID,
      enabled: true,
      order: 0,
      name: 'DSH 1024Store',
      endpoint: 'https://deepseek1024.com/api/v2/plugins',
      partnership: true,
    }, page, ['dev', 'tools'], new AbortController().signal)

    expect(response.items.map(item => item.id)).toEqual(['example/dsh-plugin-safe'])
    expect(response.categories).toEqual(['dev', 'tools'])
    expect(response.nextCursor).toBe('host-page-2')
    expect(response).toHaveProperty('fetchedAt')
  })

  it('installs npm latest as one exact, activated official installation without a market receipt', async () => {
    const official = manager()
    const state = new MemoryMarketStateStore()
    const verify = vi.fn(async () => ({ version }))
    const service = new MarketInstallService(profile, official, { verify })
    service.observeCatalog(snapshot())

    const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)
    expect(preview).toMatchObject({ packageName, version, action: 'install', profileName: 'desktop' })
    const result = await service.executePreview(preview.intent, new AbortController().signal)

    expect(result).toEqual({ action: 'install', packageName, version, application: 'applied' })
    expect(official.installBundle.mock.calls).toEqual([[`${packageName}@${version}`, { enabled: true, saveExact: true }]])
    expect(official.setBundleEnabled).not.toHaveBeenCalled()
    expect(state.getSources()).toEqual([])
    expect(state.getCatalogCache()).toBeUndefined()
    expect(verify).toHaveBeenCalledOnce()
    await expect(service.listInstallations(new AbortController().signal)).resolves.toMatchObject([
      { packageName, version, enabled: true, installed: true, toggleable: true, removable: true },
    ])
  })

  it('refuses to install a package the official manager already holds', async () => {
    const service = new MarketInstallService(
      profile,
      manager([bundle(packageName, { availability: 'installation', installed: false, enabled: false, removable: false })]),
      { verify: vi.fn(async () => ({ version })) },
    )
    service.observeCatalog(snapshot())

    await expect(service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  it('returns the manager’s bounded pnpm output and writes the same failure to the Desktop log', async () => {
    const logFailure = vi.fn()
    const official = manager()
    official.installBundle.mockResolvedValue({
      changed: false,
      application: 'failed',
      stage: 'install',
      target: `${packageName}@${version}`,
      error: { code: 'operation-error', diagnostic: 'pnpm exited with 1' },
      packageResult: {
        exitCode: 1,
        output: 'resolved 42 packages\nERR_PNPM_BUILD_SCRIPT_FAILURE native dependency failed\n',
        truncated: false,
        logPath: '/fixtures/profiles/desktop/.plugin-manager/logs/add.log',
        kind: 'build-blocked',
      },
      pendingBuilds: ['native-dependency'],
    })
    const service = new MarketInstallService(profile, official, { verify: vi.fn(async () => ({ version })) }, { logFailure })
    service.observeCatalog(snapshot())
    const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)

    await expect(service.executePreview(preview.intent, new AbortController().signal)).rejects.toMatchObject({
      code: 'operation-failed',
      message: 'The plugin could not be installed.',
      details: expect.stringContaining('ERR_PNPM_BUILD_SCRIPT_FAILURE native dependency failed'),
    })
    expect(logFailure).toHaveBeenCalledWith(expect.stringContaining('resolved 42 packages'))
    expect(logFailure).toHaveBeenCalledWith(expect.stringContaining('pending build scripts: native-dependency'))
  })

  it('states a diagnostic that repeats the pnpm output once', async () => {
    const run = 'ERR_PNPM_TARBALL_INTEGRITY Got unexpected checksum\n'
    const official = manager()
    official.installBundle.mockResolvedValue({
      changed: false,
      application: 'failed',
      stage: 'install',
      target: `${packageName}@${version}`,
      error: { code: 'operation-error', diagnostic: run },
      packageResult: { exitCode: 1, output: run, truncated: false, logPath: '/fixtures/profiles/desktop/.plugin-manager/logs/add.log' },
    })
    const service = new MarketInstallService(profile, official, { verify: vi.fn(async () => ({ version })) })
    service.observeCatalog(snapshot())
    const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)

    await expect(service.executePreview(preview.intent, new AbortController().signal)).rejects.toMatchObject({
      details: 'ERR_PNPM_TARBALL_INTEGRITY Got unexpected checksum',
    })
  })

  it('names the official refusal when the manager rejects the package', async () => {
    const official = manager()
    official.installBundle.mockResolvedValue({
      changed: false,
      application: 'failed',
      stage: 'install',
      target: `${packageName}@${version}`,
      error: {
        code: 'incompatible-version',
        incompatible: [{ name: packageName, version, runtimeVersion: '0.2.1', requirements: { '@deepseek-ai/dsh': '^0.3.0' } }],
      },
    })
    const service = new MarketInstallService(profile, official, { verify: vi.fn(async () => ({ version })) })
    service.observeCatalog(snapshot())
    const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)

    await expect(service.executePreview(preview.intent, new AbortController().signal)).rejects.toMatchObject({
      code: 'operation-failed',
      message: `The plugin is not compatible with the running DSH version (${packageName}@${version}).`,
    })
  })

  it('passes a restart-pending application through instead of treating it as a failure', async () => {
    const official = manager()
    official.installBundle.mockResolvedValue(applied('install', `${packageName}@${version}`, {
      application: 'restart-required', bundle: packageName, version,
    }))
    const service = new MarketInstallService(profile, official, { verify: vi.fn(async () => ({ version })) })
    service.observeCatalog(snapshot())
    const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)

    await expect(service.executePreview(preview.intent, new AbortController().signal)).resolves.toEqual({
      action: 'install', packageName, version, application: 'restart-required',
    })
  })

  it('uninstalls a direct Profile plugin regardless of which market installed it', async () => {
    const otherMarketPackage = 'dsh-plugin-from-another-market'
    const official = manager([bundle(otherMarketPackage, { version: '4.5.6' })])
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })

    const preview = await service.previewUninstallPackage(otherMarketPackage, new AbortController().signal)
    expect(preview).toMatchObject({
      action: 'uninstall',
      packageName: otherMarketPackage,
      version: '4.5.6',
    })
    await expect(service.executePreview(preview.intent, new AbortController().signal)).resolves.toEqual({
      action: 'uninstall',
      packageName: otherMarketPackage,
      application: 'applied',
    })
    expect(official.removeBundle.mock.calls).toEqual([[otherMarketPackage]])
    await expect(service.listInstallations(new AbortController().signal)).resolves.toEqual([])
  })

  it('refuses to remove product bundles and bundles the official manager protects', async () => {
    const official = manager([
      bundle('dsh-community-market'),
      bundle('dsh-plugin-locked', { readOnlyReason: 'management-required', removable: false }),
      bundle('dsh-plugin-selected-only', { installed: false }),
    ])
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })

    await expect(service.previewUninstallPackage('dsh-community-market', new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid-request' })
    await expect(service.previewUninstallPackage('dsh-plugin-locked', new AbortController().signal))
      .rejects.toMatchObject({ code: 'conflict' })
    // A selected name without a dependency is removable by the official manager: it is only deselected.
    await expect(service.previewUninstallPackage('dsh-plugin-selected-only', new AbortController().signal))
      .resolves.toMatchObject({ action: 'uninstall', packageName: 'dsh-plugin-selected-only' })
    expect(official.removeBundle).not.toHaveBeenCalled()
  })

  it('enables and disables a community bundle through the official manager', async () => {
    const official = manager([
      bundle('dsh-plugin-user'),
      bundle('@deepseek-ai/dsh-base', { availability: 'installation', installed: false, readOnlyReason: 'management-required', removable: false }),
      bundle('dsh-plugin-locked', { readOnlyReason: 'management-required', removable: false }),
    ])
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })

    await expect(service.setEnabled('dsh-plugin-user', false, new AbortController().signal)).resolves.toEqual({
      packageName: 'dsh-plugin-user', enabled: false, application: 'applied',
    })
    await expect(service.listInstallations(new AbortController().signal)).resolves.toMatchObject([
      { packageName: 'dsh-plugin-user', enabled: false, toggleable: true },
      { packageName: 'dsh-plugin-locked', toggleable: false, removable: false },
    ])
    official.setBundleEnabled.mockResolvedValueOnce(applied('enable', 'dsh-plugin-user', { application: 'overridden', enabled: true }))
    await expect(service.setEnabled('dsh-plugin-user', true, new AbortController().signal)).resolves.toEqual({
      packageName: 'dsh-plugin-user', enabled: true, application: 'overridden',
    })
    expect(official.setBundleEnabled.mock.calls).toEqual([['dsh-plugin-user', false], ['dsh-plugin-user', true]])
    await expect(service.setEnabled('dsh-plugin-locked', false, new AbortController().signal))
      .rejects.toMatchObject({ code: 'not-available' })
    await expect(service.setEnabled('@deepseek-ai/dsh-base', false, new AbortController().signal))
      .rejects.toMatchObject({ code: 'not-available' })
    await expect(service.setEnabled('dsh-community-market', false, new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('reports a failed toggle with the manager’s diagnostic', async () => {
    const official = manager([bundle('dsh-plugin-user')])
    official.setBundleEnabled.mockResolvedValueOnce({
      changed: false, application: 'failed', stage: 'enable', target: 'dsh-plugin-user', enabled: false,
      error: { code: 'operation-error', diagnostic: 'profile lock timed out' },
    })
    const logFailure = vi.fn()
    const service = new MarketInstallService(profile, official, { verify: vi.fn() }, { logFailure })

    await expect(service.setEnabled('dsh-plugin-user', false, new AbortController().signal)).rejects.toMatchObject({
      code: 'operation-failed',
      message: 'The plugin could not be disabled.',
      details: 'profile lock timed out',
    })
    expect(logFailure).toHaveBeenCalledWith(expect.stringContaining('profile lock timed out'))
    expect(official.listPlugins).not.toHaveBeenCalled()
  })

  describe('activation grace after a saved selection the manager reported as failed', () => {
    const entryId = 'include:better-sidebar' as PluginInfo['entryId']
    const pendingDiagnostic = 'dsh: warning: 1 entry did not activate\nbetter-sidebar (dsh-better-sidebar): pending (waiting for service: webRuntime)'
    const plugin = (fiberPhase: PluginInfo['fiberPhase']): PluginInfo => ({
      entryId, moduleName: 'dsh-better-sidebar', enabled: true, fiberPhase, patchId: 'better-sidebar',
    })
    const failedEnable = (): ChangeResult => ({
      changed: true, application: 'failed', stage: 'enable', target: 'dsh-better-sidebar', enabled: true,
      error: { code: 'operation-error', diagnostic: pendingDiagnostic },
    })
    const rows = [{ rowId: 'better-sidebar', moduleName: 'dsh-better-sidebar', entryId }]

    it('accepts the enable once every row the manager judged pending has activated', async () => {
      const official = manager([bundle('dsh-better-sidebar', { enabled: false })])
      official.setBundleEnabled.mockImplementationOnce(async () => {
        // The manager saved the selection and inserted the rows, then judged them before the service they wait for arrived.
        official.state.bundles = [bundle('dsh-better-sidebar', { rows })]
        official.state.plugins = [plugin('pending')]
        return failedEnable()
      })
      official.listPlugins
        .mockImplementationOnce(async () => [plugin('pending')])
        .mockImplementationOnce(async () => { official.state.plugins = [plugin('active')]; return [plugin('loading')] })
      const logFailure = vi.fn()
      const service = new MarketInstallService(profile, official, { verify: vi.fn() }, { logFailure, activationGraceMs: 2000, activationPollMs: 1 })

      await expect(service.setEnabled('dsh-better-sidebar', true, new AbortController().signal)).resolves.toEqual({
        packageName: 'dsh-better-sidebar', enabled: true, application: 'applied',
      })
      expect(official.listPlugins).toHaveBeenCalledTimes(3)
      expect(logFailure).not.toHaveBeenCalled()
    })

    it('keeps the failure when a row fails or the grace period ends while it is still pending', async () => {
      const failing = manager([bundle('dsh-better-sidebar', { rows })], [plugin('failed')])
      failing.setBundleEnabled.mockResolvedValueOnce(failedEnable())
      const service = new MarketInstallService(profile, failing, { verify: vi.fn() }, { activationGraceMs: 2000, activationPollMs: 1 })
      await expect(service.setEnabled('dsh-better-sidebar', true, new AbortController().signal)).rejects.toMatchObject({
        code: 'operation-failed', message: 'The plugin could not be enabled.', details: pendingDiagnostic,
      })

      const stuck = manager([bundle('dsh-better-sidebar', { rows })], [plugin('pending')])
      stuck.setBundleEnabled.mockResolvedValueOnce(failedEnable())
      const bounded = new MarketInstallService(profile, stuck, { verify: vi.fn() }, { activationGraceMs: 20, activationPollMs: 1 })
      await expect(bounded.setEnabled('dsh-better-sidebar', true, new AbortController().signal)).rejects.toMatchObject({
        code: 'operation-failed', details: pendingDiagnostic,
      })
      expect(stuck.listPlugins.mock.calls.length).toBeGreaterThan(1)
    })

    it('does not wait when the manager saved nothing or the selection does not match', async () => {
      const unsaved = manager([bundle('dsh-better-sidebar', { enabled: false, rows: [] })])
      unsaved.setBundleEnabled.mockResolvedValueOnce({ ...failedEnable(), changed: false })
      const service = new MarketInstallService(profile, unsaved, { verify: vi.fn() }, { activationGraceMs: 2000, activationPollMs: 1 })
      await expect(service.setEnabled('dsh-better-sidebar', true, new AbortController().signal)).rejects.toMatchObject({ code: 'operation-failed' })
      expect(unsaved.listPlugins).not.toHaveBeenCalled()

      const reverted = manager([bundle('dsh-better-sidebar', { enabled: false, rows: [] })])
      reverted.setBundleEnabled.mockResolvedValueOnce(failedEnable())
      const other = new MarketInstallService(profile, reverted, { verify: vi.fn() }, { activationGraceMs: 2000, activationPollMs: 1 })
      await expect(other.setEnabled('dsh-better-sidebar', true, new AbortController().signal)).rejects.toMatchObject({ code: 'operation-failed' })
      expect(reverted.listPlugins).not.toHaveBeenCalled()
    })

    it('accepts a disable once the bundle contributes no live row', async () => {
      const official = manager([bundle('dsh-better-sidebar', { enabled: false, rows: [{ rowId: 'better-sidebar', moduleName: 'dsh-better-sidebar' }] })])
      official.setBundleEnabled.mockResolvedValueOnce({
        changed: true, application: 'failed', stage: 'enable', target: 'dsh-better-sidebar', enabled: false,
        error: { code: 'operation-error', diagnostic: 'dsh: warning: 1 entry did not activate' },
      })
      const service = new MarketInstallService(profile, official, { verify: vi.fn() }, { activationGraceMs: 2000, activationPollMs: 1 })
      await expect(service.setEnabled('dsh-better-sidebar', false, new AbortController().signal)).resolves.toEqual({
        packageName: 'dsh-better-sidebar', enabled: false, application: 'applied',
      })
    })

    it('accepts an installation whose new rows were still pending when the manager judged them', async () => {
      const official = manager()
      official.installBundle.mockImplementationOnce(async (spec: string) => {
        official.state.bundles = [bundle(packageName, { version, rows })]
        official.state.plugins = [plugin('loading')]
        return {
          changed: true, application: 'failed', stage: 'enable', target: spec, enabled: true, bundle: packageName, version,
          error: { code: 'operation-error', diagnostic: pendingDiagnostic },
        }
      })
      official.listPlugins.mockImplementationOnce(async () => { official.state.plugins = [plugin('active')]; return [plugin('loading')] })
      const service = new MarketInstallService(profile, official, { verify: vi.fn(async () => ({ version })) }, { activationGraceMs: 2000, activationPollMs: 1 })
      service.observeCatalog(snapshot())
      const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)

      await expect(service.executePreview(preview.intent, new AbortController().signal)).resolves.toEqual({
        action: 'install', packageName, version, application: 'applied',
      })
      expect(official.listPlugins).toHaveBeenCalledTimes(2)
    })

    it('does not wait for an installation that added no bundle', async () => {
      const official = manager()
      official.installBundle.mockResolvedValueOnce({
        changed: true, application: 'failed', stage: 'install', target: `${packageName}@${version}`, enabled: true,
        error: { code: 'operation-error', diagnostic: 'pnpm exited with 1' },
      })
      const service = new MarketInstallService(profile, official, { verify: vi.fn(async () => ({ version })) }, { activationGraceMs: 2000, activationPollMs: 1 })
      service.observeCatalog(snapshot())
      const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)

      await expect(service.executePreview(preview.intent, new AbortController().signal)).rejects.toMatchObject({
        code: 'operation-failed', details: 'pnpm exited with 1',
      })
      expect(official.listPlugins).not.toHaveBeenCalled()
    })
  })
})

describe('community plugin updates through the official manager', () => {
  const signal = () => new AbortController().signal
  const updatable = (version = '1.0.0') => bundle(packageName, { version, updatable: true })
  const incompatible = (version: string) => ({
    name: packageName, version, runtimeVersion: '0.2.2-alpha.2', requirements: { '@deepseek-ai/dsh': '>=0.3.0' },
  })

  it('offers no update while the manager has no version operations', async () => {
    const service = new MarketInstallService(profile, manager([updatable()]), { verify: vi.fn() })

    await expect(service.listInstallations(signal())).resolves.toMatchObject([{ packageName, updatable: false }])
    await expect(service.checkUpdate(packageName, signal())).rejects.toMatchObject({ code: 'not-available' })
    await expect(service.previewUpdatePackage(packageName, signal())).rejects.toMatchObject({ code: 'not-available' })
  })

  it('checks for the version the official Plugins page would offer', async () => {
    const official = versioned([updatable()], listed('1.0.0', [
      published('2.0.0-beta.1', { prerelease: true }),
      published('1.3.0', { deprecated: 'use 1.2.0' }),
      published('1.2.5', { incompatible: incompatible('1.2.5') }),
      published('1.2.1', { bundle: false }),
      published('1.2.0', { publishedAt: '2026-10-20T08:00:00.000Z', tags: ['latest'] }),
      published('1.1.0'),
    ]))
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })

    await expect(service.listInstallations(signal())).resolves.toMatchObject([{ packageName, updatable: true }])
    await expect(service.checkUpdate(packageName, signal())).resolves.toEqual({
      status: 'available', installed: '1.0.0', version: '1.2.0', publishedAt: '2026-10-20T08:00:00.000Z',
    })
    // An empty options object lets the manager ask the registries it plans for the package.
    expect(official.listVersions).toHaveBeenCalledWith(packageName, {}, expect.any(AbortSignal))
  })

  it('says why a listing offers no update', async () => {
    const official = versioned([updatable()], listed('1.0.0', []))
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })
    await expect(service.checkUpdate(packageName, signal())).resolves.toEqual({ status: 'latest', installed: '1.0.0' })

    official.listVersions.mockResolvedValueOnce(listed('1.0.0', [
      published('2.0.0-rc.1', { prerelease: true, incompatible: incompatible('2.0.0-rc.1') }),
      published('1.5.0', { incompatible: incompatible('1.5.0') }),
      published('1.4.0', { deprecated: 'broken' }),
    ]))
    await expect(service.checkUpdate(packageName, signal())).resolves.toEqual({
      status: 'blocked',
      installed: '1.0.0',
      version: '1.5.0',
      requirements: { '@deepseek-ai/dsh': '>=0.3.0' },
      runtimeVersion: '0.2.2-alpha.2',
    })

    official.listVersions.mockResolvedValueOnce(listed('1.0.0', [
      published('1.2.0-beta.1', { prerelease: true }),
      published('1.1.0', { deprecated: 'broken' }),
    ]))
    await expect(service.checkUpdate(packageName, signal())).resolves.toEqual({ status: 'none-installable', installed: '1.0.0' })

    official.listVersions.mockResolvedValueOnce({
      status: 'refused', problem: 'network', reason: 'ETIMEDOUT registry.npmmirror.com', attempts: [{ registry: mirror, problem: 'network' }],
    })
    await expect(service.checkUpdate(packageName, signal())).resolves.toEqual({
      status: 'failed', problem: 'network', reason: 'ETIMEDOUT registry.npmmirror.com',
    })
  })

  it('refuses checks the Installed view does not offer', async () => {
    const official = versioned([
      bundle('dsh-plugin-git', { updatable: false }),
      bundle('dsh-community-market', { updatable: true }),
      updatable(),
    ], listed('1.0.0', []))
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })

    await expect(service.checkUpdate('dsh-plugin-git', signal())).rejects.toMatchObject({ code: 'conflict' })
    await expect(service.checkUpdate('dsh-plugin-missing', signal())).rejects.toMatchObject({ code: 'conflict' })
    await expect(service.checkUpdate('dsh-community-market', signal())).rejects.toMatchObject({ code: 'invalid-request' })
    // The manager stopped updating the package after the inventory was read.
    official.listVersions.mockResolvedValueOnce({ status: 'refused', problem: 'not-updatable', reason: 'not a registry package', attempts: [] })
    await expect(service.checkUpdate(packageName, signal())).rejects.toMatchObject({ code: 'conflict' })
    expect(official.listVersions).toHaveBeenCalledTimes(1)
  })

  it('updates to the previewed target from the registry that listed it', async () => {
    const official = versioned([updatable()], listed('1.0.0', [published('1.2.0')]))
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })

    const preview = await service.previewUpdatePackage(packageName, signal())
    expect(preview).toMatchObject({
      action: 'update', profileName: 'desktop', packageName, fromVersion: '1.0.0', version: '1.2.0', registry: mirror,
    })
    await expect(service.executePreview(preview.intent, signal())).resolves.toEqual({
      action: 'update', packageName, fromVersion: '1.0.0', version: '1.2.0', outcome: 'updated', application: 'applied',
    })
    expect(official.updateBundle.mock.calls).toEqual([[packageName, '1.2.0', { registry: mirror }]])
    await expect(service.executePreview(preview.intent, signal())).rejects.toMatchObject({ code: 'intent-expired' })
    await expect(service.listInstallations(signal())).resolves.toMatchObject([{ packageName, version: '1.2.0' }])
  })

  it('passes a restart-pending update through', async () => {
    const official = versioned([updatable()], listed('1.0.0', [published('1.2.0')]))
    official.updateBundle.mockResolvedValueOnce({
      from: '1.0.0', to: '1.2.0', step: 'install',
      result: applied('install', `${packageName}@1.2.0`, { application: 'restart-required', restartReason: 'no-hmr', bundle: packageName, version: '1.2.0' }),
    })
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })
    const preview = await service.previewUpdatePackage(packageName, signal())

    await expect(service.executePreview(preview.intent, signal())).resolves.toMatchObject({
      action: 'update', outcome: 'updated', application: 'restart-required',
    })
  })

  it('refuses an update without an installable target or after the installed version changed', async () => {
    const official = versioned([updatable()], listed('1.0.0', [published('1.1.0', { deprecated: 'broken' })]))
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })
    await expect(service.previewUpdatePackage(packageName, signal())).rejects.toMatchObject({ code: 'not-available' })

    official.listVersions.mockResolvedValueOnce({ status: 'refused', problem: 'not-found', reason: 'E404', attempts: [{ registry: mirror, problem: 'not-found' }] })
    await expect(service.previewUpdatePackage(packageName, signal())).rejects.toMatchObject({
      code: 'verification-failed', details: 'E404',
    })

    official.listVersions.mockResolvedValueOnce(listed('1.0.0', [published('1.2.0')]))
    const preview = await service.previewUpdatePackage(packageName, signal())
    // Another surface updated the package after the preview.
    official.state.bundles = [updatable('1.1.0')]
    await expect(service.executePreview(preview.intent, signal())).rejects.toMatchObject({ code: 'conflict' })
    expect(official.updateBundle).not.toHaveBeenCalled()
  })

  it('reports how a failed update ended and logs the manager output', async () => {
    const failed = (target: string, extra: Partial<ChangeResult> = {}): ChangeResult => ({
      changed: false, application: 'failed', stage: 'install', target, ...extra,
    })
    const output = (text: string): PackageResult => ({ exitCode: 1, output: text, truncated: false, logPath: '/fixtures/add.log' })
    const official = versioned([updatable()], listed('1.0.0', [published('1.2.0')]))
    const logFailure = vi.fn()
    const service = new MarketInstallService(profile, official, { verify: vi.fn() }, { logFailure })
    const cases: readonly [PluginUpdateResult, string, readonly string[]][] = [
      [{
        from: '1.0.0', to: '1.2.0', step: 'check',
        result: failed(packageName, { error: { code: 'incompatible-version', incompatible: [incompatible('1.2.0')] } }),
      }, 'refused', [`The plugin is not compatible with the running DSH version (${packageName}@1.2.0).`]],
      [{
        from: '1.0.0', to: '1.2.0', step: 'remove',
        result: failed(packageName, { stage: 'remove', error: { code: 'bundle-in-use', diagnostic: 'still running' } }),
      }, 'remove-failed', ['This plugin is still running and could not be unloaded.', 'still running']],
      [{
        from: '1.0.0', to: '1.2.0', step: 'install',
        result: failed(`${packageName}@1.2.0`, { packageResult: output('ERR_PNPM_FETCH_404') }),
      }, 'kept', ['ERR_PNPM_FETCH_404']],
      [{
        from: '1.0.0', to: '1.2.0', step: 'install',
        result: failed(`${packageName}@1.2.0`, { packageResult: output('ERR_PNPM_BUILD_SCRIPT_FAILURE') }),
        restore: applied('install', `${packageName}@1.0.0`, { bundle: packageName, version: '1.0.0' }),
      }, 'restored', ['ERR_PNPM_BUILD_SCRIPT_FAILURE']],
      [{
        from: '1.0.0', to: '1.2.0', step: 'install',
        result: failed(`${packageName}@1.2.0`, { packageResult: output('ERR_PNPM_BUILD_SCRIPT_FAILURE') }),
        restore: failed(`${packageName}@1.0.0`, { packageResult: output('ERR_PNPM_META_FETCH_FAIL') }),
      }, 'broken', ['ERR_PNPM_BUILD_SCRIPT_FAILURE', 'ERR_PNPM_META_FETCH_FAIL']],
    ]
    for (const [update, outcome, details] of cases) {
      official.updateBundle.mockResolvedValueOnce(update)
      const preview = await service.previewUpdatePackage(packageName, signal())
      const result = await service.executePreview(preview.intent, signal())
      expect(result, outcome).toMatchObject({ action: 'update', packageName, fromVersion: '1.0.0', version: '1.2.0', outcome })
      expect(result, outcome).not.toHaveProperty('application')
      for (const text of details) expect(result, outcome).toHaveProperty('details', expect.stringContaining(text))
      expect(logFailure, outcome).toHaveBeenLastCalledWith(expect.stringContaining(`from 1.0.0 to 1.2.0 ended as ${outcome}`))
    }
  })

  it('states repeated manager output once', async () => {
    const run = 'ERR_PNPM_TARBALL_INTEGRITY Got unexpected checksum\n'
    const official = versioned([updatable()], listed('1.0.0', [published('1.2.0')]))
    official.updateBundle.mockResolvedValueOnce({
      from: '1.0.0', to: '1.2.0', step: 'install',
      result: {
        changed: false, application: 'failed', stage: 'install', target: `${packageName}@1.2.0`,
        error: { code: 'operation-error', diagnostic: run },
        packageResult: { exitCode: 1, output: run, truncated: false, logPath: '/fixtures/add.log' },
      },
      restore: applied('install', `${packageName}@1.0.0`, { bundle: packageName, version: '1.0.0' }),
    })
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })
    const preview = await service.previewUpdatePackage(packageName, signal())

    await expect(service.executePreview(preview.intent, signal())).resolves.toMatchObject({
      outcome: 'restored', details: 'ERR_PNPM_TARBALL_INTEGRITY Got unexpected checksum',
    })
  })

  it('reports a manager that throws instead of answering as a failed operation', async () => {
    const official = versioned([updatable()], listed('1.0.0', [published('1.2.0')]))
    official.updateBundle.mockRejectedValueOnce(new Error('profile lock timed out'))
    const service = new MarketInstallService(profile, official, { verify: vi.fn() })
    const preview = await service.previewUpdatePackage(packageName, signal())

    await expect(service.executePreview(preview.intent, signal())).rejects.toMatchObject({
      code: 'operation-failed', details: expect.stringContaining('profile lock timed out'),
    })
  })
})

describe('market Profile inventory routes', () => {
  type Handler = (req: any, res: any) => Promise<void>

  function request(handlers: Map<string, Handler>, path: string, method: string, body?: unknown) {
    const req = Object.assign(new EventEmitter(), {
      method,
      url: path,
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:43120',
        'sec-fetch-site': 'same-origin',
      },
      socket: { remoteAddress: '127.0.0.1' },
      destroy: vi.fn(),
    })
    let responseBody = ''
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      statusCode: 0,
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
      end: vi.fn((value?: string) => {
        responseBody = value ?? ''
        res.writableEnded = true
      }),
    })
    const pending = handlers.get(path.split('?')[0]!)!(req, res)
    if (body !== undefined) queueMicrotask(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
    return pending.then(() => ({
      status: res.statusCode,
      body: responseBody === '' ? undefined : JSON.parse(responseBody) as Record<string, unknown>,
    }))
  }

  it('lists only community bundles and accepts toggles and uninstall previews by package name', async () => {
    const handlers = new Map<string, Handler>()
    const ctx = {
      webServer: {
        port: 43_120,
        register: vi.fn((route: { path: string; handler: Handler }) => {
          handlers.set(route.path, route.handler)
          return vi.fn()
        }),
      },
    }
    const official = manager([
      bundle('@deepseek-ai/dsh-base', { availability: 'installation', installed: false, removable: false, readOnlyReason: 'management-required' }),
      bundle('dsh-other-market', { version: '1.0.0' }),
      bundle('dshmarket', { official: true, availability: 'installation', installed: false, removable: false }),
      bundle('dsh-plugin-locked', { removable: false, readOnlyReason: 'management-required' }),
    ])
    const install = new MarketInstallService(profile, official, { verify: vi.fn() })
    const dispose = registerMarketRoutes(ctx as never, new MemoryMarketStateStore(), { get: () => install })

    await expect(request(handlers, marketRoutes.installations, 'GET')).resolves.toMatchObject({
      status: 200,
      body: {
        installations: [
          { kind: 'profile', packageName: 'dsh-other-market', version: '1.0.0', enabled: true, toggleable: true, removable: true },
          { kind: 'profile', packageName: 'dsh-plugin-locked', enabled: true, toggleable: false, removable: false },
        ],
      },
    })
    await expect(request(handlers, marketRoutes.installationEnabled, 'POST', {
      packageName: 'dsh-other-market',
      enabled: false,
    })).resolves.toMatchObject({
      status: 200,
      body: { packageName: 'dsh-other-market', enabled: false, application: 'applied' },
    })
    expect(official.setBundleEnabled).toHaveBeenCalledWith('dsh-other-market', false)
    await expect(request(handlers, marketRoutes.installationEnabled, 'POST', {
      packageName: 'dsh-plugin-locked',
      enabled: false,
    })).resolves.toMatchObject({ status: 404, body: { code: 'not-available' } })
    await expect(request(handlers, marketRoutes.installationEnabled, 'POST', {
      packageName: '@deepseek-ai/dsh-base',
      enabled: false,
    })).resolves.toMatchObject({ status: 404, body: { code: 'not-available' } })
    await expect(request(handlers, marketRoutes.operationPreview, 'POST', {
      action: 'uninstall',
      packageName: 'dsh-other-market',
    })).resolves.toMatchObject({
      status: 200,
      body: { action: 'uninstall', packageName: 'dsh-other-market', version: '1.0.0', previewId: expect.any(String) },
    })
    await expect(request(handlers, marketRoutes.operationPreview, 'POST', {
      action: 'uninstall',
      bundleId: 'bundle_other_market',
    })).resolves.toMatchObject({ status: 400, body: { code: 'invalid-request' } })
    await expect(request(handlers, marketRoutes.operationPreview, 'POST', {
      action: 'disable',
      packageName: 'dsh-other-market',
    })).resolves.toMatchObject({ status: 400, body: { code: 'invalid-request' } })
    expect(official.removeBundle).not.toHaveBeenCalled()
    dispose()
  })

  it('checks and previews updates by package name only', async () => {
    const handlers = new Map<string, Handler>()
    const ctx = {
      webServer: {
        port: 43_120,
        register: vi.fn((route: { path: string; handler: Handler }) => {
          handlers.set(route.path, route.handler)
          return vi.fn()
        }),
      },
    }
    const official = versioned([bundle('dsh-other-market', { version: '1.0.0', updatable: true })], listed('1.0.0', [published('1.1.0')]))
    const install = new MarketInstallService(profile, official, { verify: vi.fn() })
    const dispose = registerMarketRoutes(ctx as never, new MemoryMarketStateStore(), { get: () => install })

    await expect(request(handlers, marketRoutes.installations, 'GET')).resolves.toMatchObject({
      status: 200,
      body: { installations: [{ packageName: 'dsh-other-market', updatable: true }] },
    })
    await expect(request(handlers, `${marketRoutes.installationUpdate}?packageName=dsh-other-market`, 'GET')).resolves.toEqual({
      status: 200,
      body: { packageName: 'dsh-other-market', check: { status: 'available', installed: '1.0.0', version: '1.1.0' } },
    })
    for (const query of ['', '?packageName=', '?packageName=a&packageName=b', '?packageName=dsh-other-market&version=9.9.9']) {
      await expect(request(handlers, `${marketRoutes.installationUpdate}${query}`, 'GET'), query)
        .resolves.toMatchObject({ status: 400, body: { code: 'invalid-request' } })
    }
    await expect(request(handlers, `${marketRoutes.installationUpdate}?packageName=dsh-other-market`, 'POST'))
      .resolves.toMatchObject({ status: 405 })
    await expect(request(handlers, marketRoutes.operationPreview, 'POST', {
      action: 'update',
      packageName: 'dsh-other-market',
    })).resolves.toMatchObject({
      status: 200,
      body: {
        action: 'update',
        packageName: 'dsh-other-market',
        fromVersion: '1.0.0',
        version: '1.1.0',
        registry: mirror,
        previewId: expect.any(String),
      },
    })
    // The Renderer names the package; the Host alone picks the version and the registry.
    await expect(request(handlers, marketRoutes.operationPreview, 'POST', {
      action: 'update',
      packageName: 'dsh-other-market',
      version: '9.9.9',
    })).resolves.toMatchObject({ status: 400, body: { code: 'invalid-request' } })
    expect(official.updateBundle).not.toHaveBeenCalled()
    dispose()
  })
})
