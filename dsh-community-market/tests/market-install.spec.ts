import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { BundleInfo, ChangeResult, PluginInfo } from '@deepseek-ai/dsh-plugin-manager'
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
    const pending = handlers.get(path)!(req, res)
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
})
