import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PersistentCatalogSourceStore } from '../src/catalog/source-store.js'
import { MemoryMarketStateStore, type MarketStateStore } from '../src/catalog/state-store.js'
import type { CatalogSourceManifest, LocalSourceRecord } from '../src/contracts/index.js'

const manifest = JSON.parse(
  readFileSync(new URL('../docs/examples/catalog-source.example.json', import.meta.url), 'utf8'),
) as CatalogSourceManifest

const source: LocalSourceRecord = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'user-added',
  adapterId: 'market.standard-http-v1',
  providerId: 'org.example.community-catalog',
  manifestUrl: 'https://plugins.example.org/catalog-source.json',
  manifest,
  enabled: true,
  order: 0,
}

function observedStore() {
  const inner = new MemoryMarketStateStore()
  const setSources = vi.fn((records: readonly LocalSourceRecord[]) => inner.setSources(records))
  const state: MarketStateStore = {
    getSources: () => inner.getSources(),
    setSources,
    getCatalogCache: () => inner.getCatalogCache(),
    setCatalogCache: cache => inner.setCatalogCache(cache),
  }
  return { state, setSources }
}

describe('storage-backed catalog source store', () => {
  it('persists validated source records through the state store', async () => {
    const { state, setSources } = observedStore()
    const store = new PersistentCatalogSourceStore(state)

    await store.save([source])

    expect(setSources).toHaveBeenCalledWith([source])
    await expect(store.load()).resolves.toEqual([source])
  })

  it('normalizes a legacy multi-enabled registry to one selected source', async () => {
    const secondSource: LocalSourceRecord = {
      ...source,
      sourceRecordId: '028f1f77-a5c4-7b73-a9ae-0242ac120003',
      order: 1,
    }
    const { state, setSources } = observedStore()
    const store = new PersistentCatalogSourceStore(state)

    await store.save([source, secondSource])

    expect(setSources).toHaveBeenCalledWith([source, { ...secondSource, enabled: false }])
    await expect(store.load()).resolves.toEqual([
      source,
      { ...secondSource, enabled: false },
    ])
  })

  it('rejects a persisted registry that no longer satisfies the local-source contract', async () => {
    const state = new MemoryMarketStateStore({
      sources: [{ ...source, sourceRecordId: 'not-a-uuid' }],
    })

    await expect(new PersistentCatalogSourceStore(state).load()).rejects.toThrow(/sourceRecordId/u)
  })
})
