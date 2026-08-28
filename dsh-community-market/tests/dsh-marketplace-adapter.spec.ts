import { describe, expect, it, vi } from 'vitest'
import {
  DSH_MARKETPLACE_ADAPTER_ID,
  DSH_MARKETPLACE_API_ENDPOINT,
  DSH_MARKETPLACE_KEY,
  DSH_MARKETPLACE_MANIFEST_URL,
  DSH_MARKETPLACE_PROVIDER_ID,
  DSH_MARKETPLACE_PUBLIC_ENDPOINT,
  dshMarketplaceAdapter,
  isDshMarketplaceSourceUrl,
} from '../src/adapters/dsh-marketplace.js'
import type { CatalogHttpClient, LocalSourceRecord } from '../src/contracts/index.js'

const source = (): LocalSourceRecord => ({
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120004',
  registrationKind: 'built-in',
  adapterId: DSH_MARKETPLACE_ADAPTER_ID,
  providerId: DSH_MARKETPLACE_PROVIDER_ID,
  builtInProviderKey: DSH_MARKETPLACE_KEY,
  enabled: true,
  order: 0,
})

function rawItem(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: index,
    itemType: 'plugin',
    name: `plugin-${index}`,
    fullName: `owner/plugin-${index}`,
    author: 'owner',
    description: index === 0 ? '' : `Plugin ${index} description`,
    htmlUrl: `https://github.com/owner/plugin-${index}`,
    language: 'TypeScript',
    license: 'MIT',
    topics: ['dsh-plugin', 'tools'],
    githubUpdatedAt: '2026-08-25T12:00:00Z',
    deployCommand: `dsh plugin --profile web add dsh-plugin-${index}`,
    ...overrides,
  }
}

function providerPage(
  records: readonly unknown[],
  current: number,
  total: number,
  size: number,
): Record<string, unknown> {
  return {
    code: 200,
    message: 'success',
    data: {
      total,
      plugins: {
        records,
        total,
        size,
        current,
        pages: total === 0 ? 0 : Math.ceil(total / size),
      },
    },
  }
}

describe('DSH Marketplace compatibility adapter', () => {
  it('maps Desktop catalog queries to the reviewed provider API', async () => {
    const getJson = vi.fn(async (url: string) => ({
      value: providerPage([rawItem(0)], 2, 51, 50),
      finalUrl: url,
    }))
    const snapshot = await dshMarketplaceAdapter.fetch({
      q: 'sidebar',
      category: ['ui-theme'],
      cursor: '2',
      limit: 50,
      sort: 'updated',
    }, {
      source: source(),
      signal: new AbortController().signal,
      http: { getJson },
      media: { register: vi.fn() },
    })

    const request = new URL(getJson.mock.calls[0]![0])
    expect(`${request.origin}${request.pathname}`).toBe(DSH_MARKETPLACE_API_ENDPOINT)
    expect(request.searchParams.get('keyword')).toBe('sidebar')
    expect(request.searchParams.get('category')).toBe('ui-theme')
    expect(request.searchParams.get('page')).toBe('2')
    expect(request.searchParams.get('size')).toBe('50')
    expect(request.searchParams.get('sort')).toBe('updated')
    expect(snapshot.page).toEqual({ total: 51 })
    expect(snapshot.items[0]).toMatchObject({
      id: 'owner/plugin-0',
      summary: 'plugin-0',
      repository: { url: 'https://github.com/owner/plugin-0' },
      package: { registry: 'npm', name: 'dsh-plugin-0' },
      provenance: {
        sourceRecordId: source().sourceRecordId,
        providerId: DSH_MARKETPLACE_PROVIDER_ID,
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain('dsh plugin --profile')
  })

  it('supports small browse pages even when the provider reports more than 100 pages', async () => {
    const getJson = vi.fn(async (url: string) => ({
      value: providerPage([rawItem(0)], 101, 3_053, 5),
      finalUrl: url,
    }))
    const snapshot = await dshMarketplaceAdapter.fetch({ cursor: '101', limit: 5 }, {
      source: source(),
      signal: new AbortController().signal,
      http: { getJson },
      media: { register: vi.fn() },
    })

    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.page).toEqual({ total: 3_053, nextCursor: '102' })
  })

  it('scans sparse provider pages without treating inaccessible rows as normalized items', async () => {
    const getJson = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return {
        value: page === 1
          ? providerPage([rawItem(0), rawItem(1)], 1, 101, 100)
          : providerPage([rawItem(2)], 2, 101, 100),
        finalUrl: url,
      }
    })
    const snapshots = await dshMarketplaceAdapter.scanCatalog!({}, {
      source: source(),
      signal: new AbortController().signal,
      http: { getJson },
      media: { register: vi.fn() },
    })

    expect(getJson).toHaveBeenCalledTimes(2)
    expect(snapshots.flatMap(snapshot => snapshot.items)).toHaveLength(3)
    expect(snapshots[0]?.page.total).toBe(3)
  })

  it('rejects redirects, dataset changes, and provider commands outside the exact grammar', async () => {
    const redirectHttp: CatalogHttpClient = {
      getJson: vi.fn(async () => ({
        value: providerPage([], 1, 0, 50),
        finalUrl: 'https://attacker.example/api/plugins?page=1&size=50',
      })),
    }
    await expect(dshMarketplaceAdapter.fetch({ limit: 50 }, {
      source: source(),
      signal: new AbortController().signal,
      http: redirectHttp,
      media: { register: vi.fn() },
    })).rejects.toThrow(/reviewed provider origin/u)

    const changedHttp: CatalogHttpClient = {
      getJson: vi.fn(async url => {
        const page = Number(new URL(url).searchParams.get('page'))
        return {
          value: page === 1
            ? providerPage([rawItem(0)], 1, 101, 100)
            : providerPage([rawItem(1)], 2, 102, 100),
          finalUrl: url,
        }
      }),
    }
    await expect(dshMarketplaceAdapter.scanCatalog!({}, {
      source: source(),
      signal: new AbortController().signal,
      http: changedHttp,
      media: { register: vi.fn() },
    })).rejects.toThrow(/dataset changed/u)

    const unsafeHttp: CatalogHttpClient = {
      getJson: vi.fn(async url => ({
        value: providerPage([rawItem(0, { deployCommand: 'dsh plugin --profile web add safe && touch bad' })], 1, 1, 50),
        finalUrl: url,
      })),
    }
    const snapshot = await dshMarketplaceAdapter.fetch({ limit: 50 }, {
      source: source(),
      signal: new AbortController().signal,
      http: unsafeHttp,
      media: { register: vi.fn() },
    })
    expect(snapshot.items[0]).not.toHaveProperty('package')
  })

  it('recognizes only the two reviewed source URLs as aliases', () => {
    expect(isDshMarketplaceSourceUrl(DSH_MARKETPLACE_PUBLIC_ENDPOINT)).toBe(true)
    expect(isDshMarketplaceSourceUrl(DSH_MARKETPLACE_MANIFEST_URL)).toBe(true)
    expect(isDshMarketplaceSourceUrl(`${DSH_MARKETPLACE_PUBLIC_ENDPOINT}?token=secret`)).toBe(false)
    expect(isDshMarketplaceSourceUrl('https://attacker.example/v1/plugins')).toBe(false)
  })
})
