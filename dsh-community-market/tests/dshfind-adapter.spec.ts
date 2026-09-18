import { describe, expect, it, vi } from 'vitest'
import {
  createDshfindAdapter,
  DSHFIND_ADAPTER_ID,
  DSHFIND_CATALOG_ENDPOINT,
  DSHFIND_ENDPOINT,
  DSHFIND_KEY,
  DSHFIND_PROVIDER_ID,
} from '../src/adapters/dshfind.js'
import type { CatalogHttpClient, LocalSourceRecord } from '../src/contracts/index.js'

const DATA_VERSION = `sha256:${'a'.repeat(64)}`
const AS_OF = '2026-08-18T03:30:27Z'

const source = (): LocalSourceRecord => ({
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120003',
  registrationKind: 'built-in',
  adapterId: DSHFIND_ADAPTER_ID,
  providerId: DSHFIND_PROVIDER_ID,
  builtInProviderKey: DSHFIND_KEY,
  enabled: true,
  order: 0,
})

function rawItem(index: number): Record<string, unknown> {
  return {
    full_name: `owner/plugin-${index}`,
    name: `plugin-${index}`,
    owner: 'owner',
    repository_url: `https://github.com/owner/plugin-${index}`,
    url: `https://github.com/owner/plugin-${index}`,
    description: `Plugin ${index} summary`,
    tags: ['memory', 'tools', 'memory'],
    language: 'TypeScript',
    pushed_at: '2026-08-17T12:00:00Z',
    category: 'memory',
    is_plugin: true,
    is_risky: false,
    install: {
      cmd: `unsafe-command-${index}`,
      kind: 'npm',
      pkg_name: `unsafe-package-${index}`,
      npm_published: true,
    },
  }
}

function rawCatalog(data: readonly unknown[]): Record<string, unknown> {
  return {
    data,
    total: data.length,
    data_version: DATA_VERSION,
    as_of: AS_OF,
    generated_at: AS_OF,
  }
}

function providerPage(items: readonly unknown[], page: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    generatedAt: AS_OF,
    revision: DATA_VERSION,
    items,
    page,
  }
}

function providerItem(index: number): Record<string, unknown> {
  return {
    id: `owner/plugin-${index}`,
    name: `plugin-${index}`,
    displayName: `Plugin ${index}`,
    summary: `Plugin ${index} summary`,
    repository: { url: `https://github.com/owner/plugin-${index}` },
    package: { registry: 'npm', name: `dsh-plugin-${index}` },
    latestVersion: '1.2.3',
    categories: ['memory'],
  }
}

describe('dshfind adapter', () => {
  it('uses the bounded full-catalog endpoint once and keeps only confirmed plugins', async () => {
    const unconfirmed = { ...rawItem(1), is_plugin: null }
    const nonPlugin = { ...rawItem(2), is_plugin: false }
    const risky = { ...rawItem(3), is_risky: true }
    const getJson = vi.fn(async (url: string) => ({
      value: rawCatalog([rawItem(0), unconfirmed, nonPlugin, risky]),
      finalUrl: url,
    }))
    const adapter = createDshfindAdapter({ now: () => new Date('2026-08-18T09:30:00Z') })

    const snapshots = await adapter.scanCatalog!({}, {
      source: source(),
      signal: new AbortController().signal,
      http: { getJson },
      media: { register: vi.fn() },
    })

    expect(getJson).toHaveBeenCalledOnce()
    expect(getJson).toHaveBeenCalledWith(
      DSHFIND_CATALOG_ENDPOINT,
      expect.any(AbortSignal),
      { allowedOrigin: 'https://api.dshfind.com' },
    )
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.source).toMatchObject({
      providerRevision: DATA_VERSION,
      providerGeneratedAt: '2026-08-18T03:30:27.000Z',
      fetchedAt: '2026-08-18T09:30:00.000Z',
    })
    expect(snapshots[0]?.items).toEqual([{
      id: 'owner/plugin-0',
      name: 'plugin-0',
      displayName: 'plugin-0',
      summary: 'Plugin 0 summary',
      description: 'Plugin 0 summary',
      categories: ['memory'],
      keywords: ['memory', 'tools', 'TypeScript'],
      repository: { url: 'https://github.com/owner/plugin-0' },
      publisher: { name: 'owner', url: 'https://github.com/owner' },
      updatedAt: '2026-08-17T12:00:00.000Z',
      provenance: {
        sourceRecordId: source().sourceRecordId,
        providerId: DSHFIND_PROVIDER_ID,
        itemId: 'owner/plugin-0',
      },
    }])
    expect(JSON.stringify(snapshots)).not.toContain('unsafe-command')
  })

  it('uses dshfind standard provider paging for browse and search', async () => {
    const getJson = vi.fn(async (url: string) => ({
      value: providerPage([providerItem(0)], { total: 1 }),
      finalUrl: url,
    }))
    const adapter = createDshfindAdapter()
    const snapshot = await adapter.fetch({
      q: 'memory',
      category: ['memory'],
      cursor: 'opaque-cursor',
      limit: 80,
    }, {
      source: source(),
      signal: new AbortController().signal,
      http: { getJson },
      media: { register: vi.fn() },
    })

    const request = new URL(getJson.mock.calls[0]![0])
    expect(`${request.origin}${request.pathname}`).toBe(DSHFIND_ENDPOINT)
    expect(request.searchParams.get('q')).toBe('memory')
    expect(request.searchParams.getAll('category')).toEqual(['memory'])
    expect(request.searchParams.get('cursor')).toBe('opaque-cursor')
    expect(request.searchParams.get('limit')).toBe('80')
    expect(snapshot.items[0]).toMatchObject({
      id: 'owner/plugin-0',
      package: { registry: 'npm', name: 'dsh-plugin-0' },
      provenance: {
        sourceRecordId: source().sourceRecordId,
        providerId: DSHFIND_PROVIDER_ID,
      },
    })
  })

  it('rejects redirects outside the exact reviewed origin', async () => {
    const adapter = createDshfindAdapter()
    const http: CatalogHttpClient = {
      getJson: vi.fn(async () => ({
        value: providerPage([], {}),
        finalUrl: 'https://attacker.example/market/v1/plugins?limit=50',
      })),
    }
    await expect(adapter.fetch({ limit: 50 }, {
      source: source(),
      signal: new AbortController().signal,
      http,
      media: { register: vi.fn() },
    })).rejects.toThrow(/reviewed provider origin/u)
  })

  it('rejects oversized, truncated, and duplicate full catalogs', async () => {
    const adapter = createDshfindAdapter()
    const context = (value: unknown) => ({
      source: source(),
      signal: new AbortController().signal,
      http: { getJson: vi.fn(async () => ({ value, finalUrl: DSHFIND_CATALOG_ENDPOINT })) },
      media: { register: vi.fn() },
    })

    await expect(adapter.scanCatalog!({}, context({
      ...rawCatalog([]),
      total: 20_001,
    }))).rejects.toThrow(/item limit/u)
    await expect(adapter.scanCatalog!({}, context({
      ...rawCatalog([rawItem(0)]),
      total: 2,
    }))).rejects.toThrow(/item count/u)
    await expect(adapter.scanCatalog!({}, context(rawCatalog([rawItem(0), rawItem(0)]))))
      .rejects.toThrow(/duplicate item IDs/u)
  })
})

describe('dshfind install target normalization', () => {
  const reviewedMethod = {
    kind: 'npm',
    verification: 'verified',
    code: 'repository_backlink',
    requiresBuildAllowance: false,
    spec: 'dsh-plugin-0',
    revision: '1.2.3',
  }
  const baseInstall = {
    cmd: 'provider command text',
    kind: 'npm',
    pkg_name: 'dsh-plugin-0',
    npm_published: true,
  }

  async function scanInstall(install: unknown) {
    const adapter = createDshfindAdapter()
    const http: CatalogHttpClient = {
      getJson: vi.fn(async url => ({
        value: rawCatalog([{ ...rawItem(0), install }]),
        finalUrl: url,
      })),
    }
    const snapshots = await adapter.scanCatalog!({}, {
      source: source(),
      signal: new AbortController().signal,
      http,
      media: { register: vi.fn() },
    })
    return snapshots.flatMap(snapshot => snapshot.items)
  }

  it('exposes one reviewed npm identity without exposing the provider command', async () => {
    const items = await scanInstall({
      ...baseInstall,
      methods: [reviewedMethod, { ...reviewedMethod }],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'owner/plugin-0',
      repository: { url: 'https://github.com/owner/plugin-0' },
      package: { registry: 'npm', name: 'dsh-plugin-0' },
      latestVersion: '1.2.3',
    })
    expect(JSON.stringify(items)).not.toContain('provider command text')
  })

  it.each([
    ['missing methods', baseInstall],
    ['a non-object install', 'npm install dsh-plugin-0'],
    ['an unverified method', { ...baseInstall, methods: [{ ...reviewedMethod, verification: 'unverified' }] }],
    ['a wrong verification code', { ...baseInstall, methods: [{ ...reviewedMethod, code: 'unlinked_package' }] }],
    ['a build allowance requirement', { ...baseInstall, methods: [{ ...reviewedMethod, requiresBuildAllowance: true }] }],
    ['a prerelease version', { ...baseInstall, methods: [{ ...reviewedMethod, revision: '1.2.4-rc.1' }] }],
    ['a mutable tag instead of a version', { ...baseInstall, methods: [{ ...reviewedMethod, revision: 'latest' }] }],
    ['an invalid package name', { ...baseInstall, methods: [{ ...reviewedMethod, spec: 'Not A Package!' }] }],
    ['a spec disagreeing with pkg_name', { ...baseInstall, methods: [{ ...reviewedMethod, spec: 'other-package' }] }],
    ['ambiguous reviewed targets', {
      ...baseInstall,
      pkg_name: undefined,
      methods: [reviewedMethod, { ...reviewedMethod, spec: 'another-package', revision: '2.0.0' }],
    }],
  ] as const)('does not expose an install identity for %s', async (_label, install) => {
    const items = await scanInstall(install)

    expect(items).toHaveLength(1)
    expect(items[0]).not.toHaveProperty('package')
    expect(items[0]).not.toHaveProperty('latestVersion')
  })
})
