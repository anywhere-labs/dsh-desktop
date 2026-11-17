/** Catalog responses and the persisted catalog cache that answers while sources refresh. */

import { parseCatalogSnapshot } from '../contracts/validate.js'
import type { MarketCatalogMetadata, MarketCatalogResponse, MarketManualInstallHint } from '../api-types.js'
import type { CatalogFullIndex } from '../catalog/service.js'
import type { MarketCatalogCache } from '../catalog/state-store.js'
import { manualInstallHints } from '../install/manual.js'

const CATALOG_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function catalogMetadata(index: CatalogFullIndex): MarketCatalogMetadata {
  return {
    scannedAt: index.scannedAt,
    expiresAt: index.expiresAt,
    ...(index.providerRevision === undefined ? {} : { providerRevision: index.providerRevision }),
    cacheStatus: index.cacheStatus,
  }
}

export function catalogCategories(index: CatalogFullIndex): readonly string[] {
  return [...new Set(index.snapshots.flatMap(snapshot => snapshot.items.flatMap(item => item.categories ?? [])))]
    .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
}

export function catalogManualInstall(results: readonly { readonly snapshot?: { readonly items: CatalogFullIndex['snapshots'][number]['items'] } }[]): readonly MarketManualInstallHint[] {
  return manualInstallHints(results.flatMap(result => result.snapshot?.items ?? []))
}

export function cachedCatalogResponse(
  cache: MarketCatalogCache | undefined,
  source: MarketCatalogResponse['results'][number]['source'],
  locale: string,
  now = Date.now(),
): MarketCatalogResponse | undefined {
  if (cache === undefined
    || cache.version !== 1
    || cache.sourceRecordId !== source.sourceRecordId
    || cache.locale !== locale
    || !Number.isFinite(Date.parse(cache.savedAt))
    || now - Date.parse(cache.savedAt) < 0
    || now - Date.parse(cache.savedAt) > CATALOG_CACHE_MAX_AGE_MS
    || !Array.isArray(cache.categories)
    || cache.categories.length > 4_096
    || !cache.categories.every(value => typeof value === 'string')
    || !Number.isFinite(Date.parse(cache.scannedAt))
    || !Number.isFinite(Date.parse(cache.expiresAt))) return undefined
  let snapshot: CatalogFullIndex['snapshots'][number]
  try {
    snapshot = parseCatalogSnapshot(cache.snapshot)
  } catch {
    return undefined
  }
  if (
    snapshot.source.sourceRecordId !== source.sourceRecordId
    || snapshot.source.providerId !== source.providerId
    || snapshot.source.adapterId !== source.adapterId
    || snapshot.source.registrationKind !== source.registrationKind
  ) return undefined
  return {
    query: { limit: 50, locale },
    results: [{ source, stale: true, snapshot }],
    categories: [...cache.categories],
    manualInstall: catalogManualInstall([{ snapshot }]),
    metadata: {
      scannedAt: cache.scannedAt,
      expiresAt: cache.expiresAt,
      ...(cache.providerRevision === undefined ? {} : { providerRevision: cache.providerRevision }),
      cacheStatus: 'cached',
    },
    fetchedAt: new Date(now).toISOString(),
  }
}

export function catalogCacheFromResponse(
  response: MarketCatalogResponse,
  sourceRecordId: string,
  locale: string,
  now = Date.now(),
): MarketCatalogCache | undefined {
  const result = response.results.find(value => value.source.sourceRecordId === sourceRecordId)
  const snapshot = result?.snapshot
  const metadata = response.metadata
  if (snapshot === undefined || metadata === undefined
    || !Number.isFinite(Date.parse(metadata.scannedAt))
    || !Number.isFinite(Date.parse(metadata.expiresAt))
    || !Array.isArray(response.categories)
    || response.categories.length > 4_096
    || !response.categories.every(value => typeof value === 'string')) return undefined
  const { nextCursor: _nextCursor, ...page } = snapshot.page
  let normalizedSnapshot: CatalogFullIndex['snapshots'][number]
  try {
    normalizedSnapshot = parseCatalogSnapshot({ ...snapshot, page })
  } catch {
    return undefined
  }
  return {
    version: 1,
    sourceRecordId,
    locale,
    savedAt: new Date(now).toISOString(),
    snapshot: normalizedSnapshot,
    categories: [...response.categories],
    scannedAt: metadata.scannedAt,
    expiresAt: metadata.expiresAt,
    ...(metadata.providerRevision === undefined ? {} : { providerRevision: metadata.providerRevision }),
  }
}
