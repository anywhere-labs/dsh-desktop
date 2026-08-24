import { describe, expect, it, vi } from 'vitest'
import {
  dsh1024StoreAdapter,
  DSH_1024STORE_ADAPTER_ID,
  DSH_1024STORE_ENDPOINT,
  DSH_1024STORE_KEY,
  DSH_1024STORE_PROVIDER_ID,
} from '../src/adapters/dsh-1024store.js'
import type { CatalogHttpClient, LocalSourceRecord } from '../src/contracts/index.js'

const source = (): LocalSourceRecord => ({
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'built-in',
  adapterId: DSH_1024STORE_ADAPTER_ID,
  providerId: DSH_1024STORE_PROVIDER_ID,
  builtInProviderKey: DSH_1024STORE_KEY,
  enabled: true,
  order: 0,
})

const appshotCatalog = {
  meta: { total: 1 },
  packages: [{
    id: 'TaurusWood/dsh-plugin-appshot',
    name: 'dsh-plugin-appshot',
    owner: 'TaurusWood',
    url: 'https://github.com/TaurusWood/dsh-plugin-appshot',
    category: 'tools',
    description: { en: 'Context screenshot capture for DeepSeek Harness', zh: 'DeepSeek Harness 上下文截图插件' },
    stars: 0,
  }],
}

const media = { register: () => 'mktimg_QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ' }

describe('1024Store provider search', () => {
  it('forwards the keyword to the provider before applying local filtering', async () => {
    const getJson = vi.fn(async (url: string) => ({ value: appshotCatalog, finalUrl: url }))
    const http: CatalogHttpClient = { getJson }

    const snapshot = await dsh1024StoreAdapter.fetch(
      { q: 'appshot', locale: 'en-US' },
      { source: source(), signal: new AbortController().signal, http, media },
    )

    expect(getJson.mock.calls[0]?.[0]).toBe(`${DSH_1024STORE_ENDPOINT}?q=appshot`)
    expect(snapshot.items.map(item => item.id)).toEqual(['TaurusWood/dsh-plugin-appshot'])
  })

  it('keeps complete catalog scans on the unfiltered provider endpoint', async () => {
    const getJson = vi.fn(async (url: string) => ({ value: appshotCatalog, finalUrl: url }))
    const http: CatalogHttpClient = { getJson }

    await dsh1024StoreAdapter.scanCatalog!(
      { q: 'appshot', locale: 'en-US' },
      { source: source(), signal: new AbortController().signal, http, media },
    )

    expect(getJson.mock.calls[0]?.[0]).toBe(DSH_1024STORE_ENDPOINT)
  })
})
