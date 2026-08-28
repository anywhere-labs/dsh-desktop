import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DSH_1024STORE_ADAPTER_ID, DSH_1024STORE_PROVIDER_ID } from '../src/adapters/dsh-1024store.js'
import type { MarketSettingsDocument } from '../src/catalog/source-store.js'
import type { CatalogHttpClient, CatalogSnapshot } from '../src/contracts/index.js'
import { marketRoutes, registerMarketRoutes } from '../src/host/routes.js'
import {
  createNpmRegistryVerifier,
  MarketInstallService,
  type MarketDesktopPnpm,
} from '../src/install/service.js'

const packageName = 'dsh-plugin-safe'
const version = '1.2.3'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async path => await rm(path, { recursive: true, force: true })))
})

function memoryScope(): SettingsScope<MarketSettingsDocument> {
  let document: MarketSettingsDocument = { sources: [] }
  return {
    get: () => document,
    watch: () => () => {},
    update: vi.fn(async patch => { document = { ...document, ...patch } as MarketSettingsDocument }),
    replace: vi.fn(async section => { document = section as MarketSettingsDocument }),
  }
}

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

async function createProfile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'market-install-'))
  temporaryDirectories.push(dir)
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'fixture-profile',
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }))
  return dir
}

async function writeInstalledProfile(profileDir: string, target = packageName, targetVersion = version): Promise<void> {
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'fixture-profile',
    dependencies: { [target]: targetVersion },
    dsh: { profile: { bundles: [target] } },
  }))
}

async function writeEmptyProfile(profileDir: string): Promise<void> {
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'fixture-profile',
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }))
}

function runner(profileDir: string, calls: string[][]): MarketDesktopPnpm {
  return {
    run(argv) {
      calls.push([...argv])
      return {
        stdout: Readable.from([]),
        stderr: Readable.from([]),
        done: (async () => {
          if (argv[0] === 'add') await writeInstalledProfile(profileDir)
          if (argv[0] === 'remove') await writeEmptyProfile(profileDir)
          return { exitCode: 0, signal: null }
        })(),
        cancel: vi.fn(),
      }
    },
  }
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

describe('simplified Profile package operations', () => {
  it('derives install candidates from one provider page and preserves its next cursor', async () => {
    const profileDir = await createProfile()
    const service = new MarketInstallService(
      () => ({ name: 'desktop', dir: profileDir }),
      runner(profileDir, []),
      { verify: vi.fn() },
    )
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

  it('installs npm latest with one pnpm add and does not persist a market receipt', async () => {
    const profileDir = await createProfile()
    const calls: string[][] = []
    const scope = memoryScope()
    const verify = vi.fn(async () => ({ version }))
    const service = new MarketInstallService(
      () => ({ name: 'desktop', dir: profileDir }),
      runner(profileDir, calls),
      { verify },
    )
    service.observeCatalog(snapshot())

    const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)
    expect(preview).toMatchObject({ packageName, version, action: 'install' })
    const result = await service.executePreview(preview.intent, new AbortController().signal)

    expect(result).toMatchObject({ action: 'install', packageName, version })
    expect(result).not.toHaveProperty('receipt')
    expect(calls).toEqual([[
      'add',
      '--save-exact',
      '--registry=https://registry.npmjs.org/',
      `${packageName}@${version}`,
    ]])
    expect(scope.get()).toEqual({ sources: [] })
    expect(JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))).toMatchObject({
      dependencies: { [packageName]: version },
      dsh: { profile: { bundles: [packageName] } },
    })
    expect(verify).toHaveBeenCalledOnce()
  })

  it('returns bounded pnpm output and writes the same failure to the Desktop log', async () => {
    const profileDir = await createProfile()
    const logFailure = vi.fn()
    const service = new MarketInstallService(
      () => ({ name: 'desktop', dir: profileDir }),
      {
        run() {
          return {
            stdout: Readable.from(['resolved 42 packages\n']),
            stderr: Readable.from(['ERR_PNPM_BUILD_SCRIPT_FAILURE native dependency failed\n']),
            done: new Promise(resolve => setImmediate(() => resolve({ exitCode: 1, signal: null }))),
            cancel: vi.fn(),
          }
        },
      },
      { verify: vi.fn(async () => ({ version })) },
      { logFailure },
    )
    service.observeCatalog(snapshot())
    const preview = await service.previewInstall('source-1', 'example/dsh-plugin-safe', new AbortController().signal)

    await expect(service.executePreview(preview.intent, new AbortController().signal)).rejects.toMatchObject({
      code: 'operation-failed',
      details: expect.stringContaining('ERR_PNPM_BUILD_SCRIPT_FAILURE native dependency failed'),
    })
    expect(logFailure).toHaveBeenCalledWith(expect.stringContaining('resolved 42 packages'))
    expect(logFailure).toHaveBeenCalledWith(expect.stringContaining('exitCode: 1'))
  })

  it('uninstalls a direct Profile plugin regardless of which market installed it', async () => {
    const profileDir = await createProfile()
    const otherMarketPackage = 'dsh-plugin-from-another-market'
    await writeInstalledProfile(profileDir, otherMarketPackage, '4.5.6')
    const calls: string[][] = []
    const service = new MarketInstallService(
      () => ({ name: 'desktop', dir: profileDir }),
      runner(profileDir, calls),
      { verify: vi.fn() },
    )

    const preview = await service.previewUninstallPackage(otherMarketPackage, new AbortController().signal)
    expect(preview).toMatchObject({
      action: 'uninstall',
      packageName: otherMarketPackage,
      version: '4.5.6',
    })
    await expect(service.executePreview(preview.intent, new AbortController().signal)).resolves.toMatchObject({
      action: 'uninstall',
      packageName: otherMarketPackage,
    })
    expect(calls).toEqual([['remove', otherMarketPackage]])
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

  it('shows all direct bundles and exposes only uninstall or no action', async () => {
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
    const desktopPlugins = {
      list: vi.fn(() => [
        { bundleId: 'bundle_other_market', packageName: 'dsh-other-market', status: 'active' as const, mutable: true, uninstallable: true },
        { bundleId: 'bundle_builtin', packageName: '@deepseek-ai/dsh-base', status: 'active' as const, mutable: false, uninstallable: false },
      ]),
    }
    const previewUninstallPackage = vi.fn(async (target: string) => ({
      intent: 'uninstall-preview',
      action: 'uninstall' as const,
      profileName: 'desktop',
      packageName: target,
      version: '1.0.0',
      displayName: target,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }))
    const install = {
      previewUninstallPackage,
      observeCatalog: vi.fn(),
      invalidateSource: vi.fn(),
    } as unknown as MarketInstallService
    const dispose = registerMarketRoutes(
      ctx as never,
      memoryScope(),
      { get: () => install },
      undefined,
      { get: () => desktopPlugins },
    )

    await expect(request(handlers, marketRoutes.installations, 'GET')).resolves.toMatchObject({
      status: 200,
      body: {
        installations: [
          { kind: 'profile', packageName: 'dsh-other-market', action: 'uninstall' },
          { kind: 'profile', packageName: '@deepseek-ai/dsh-base', action: 'none' },
        ],
      },
    })
    await expect(request(handlers, marketRoutes.operationPreview, 'POST', {
      action: 'uninstall',
      bundleId: 'bundle_other_market',
    })).resolves.toMatchObject({
      status: 200,
      body: { action: 'uninstall', packageName: 'dsh-other-market', previewId: 'uninstall-preview' },
    })
    expect(previewUninstallPackage).toHaveBeenCalledWith('dsh-other-market', expect.any(AbortSignal))
    await expect(request(handlers, marketRoutes.operationPreview, 'POST', {
      action: 'disable',
      bundleId: 'bundle_other_market',
    })).resolves.toMatchObject({ status: 400, body: { code: 'invalid-request' } })
    dispose()
  })
})
