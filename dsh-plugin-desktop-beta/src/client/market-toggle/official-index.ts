/** Configure market indexes in the official plugin index bundle: quick configuration, single markets and sub-source endpoints. */

import type { MarketIndexSummary, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { OFFICIAL_PLUGIN_INDEX } from '../../upstream-family-labels.ts'
import {
  BUILT_IN_MARKET_SOURCES,
  type BuiltInMarketKey,
  OFFICIAL_CONFIGURABLE_MARKET_SOURCES,
  OFFICIAL_MARKET,
} from './markets.ts'
import {
  type ActiveMarketResolution,
  deduplicateUrls,
  type MarketRuntimeState,
  orderedMarketSourceUrls,
  quickConfigurationUrl,
  resolveMarketSourceByKey,
} from './active-source.ts'

export interface OfficialMarketImportClient {
  readonly pluginManager: {
    setBundleEnabled(
      name: string,
      enabled: boolean,
    ): Promise<RemoteResult<{ readonly application: string; readonly error?: { readonly diagnostic?: string } }>>
  }
  readonly pluginMarket: {
    listIndexes(): Promise<RemoteResult<MarketIndexSummary[]>>
    setIndexes(urls: string[]): Promise<RemoteResult<void>>
    search?(
      url: string,
      query: { readonly sort: { readonly kind: 'index' }; readonly offset: number; readonly limit: number },
    ): Promise<unknown>
  }
}

export interface OfficialMarketImportResult {
  readonly application: string
  readonly syncedUrl: string
  readonly configuredUrls: readonly string[]
}

const PREFETCH_WAIT_TIMEOUT_MS = 2500

/**
 * Preload configured market index URLs into the Host `PluginMarket` cache so their titles
 * are immediately available in the Discover source dropdown without selecting each source first.
 */
export async function prefetchMarketIndexes(
  pluginMarket: OfficialMarketImportClient['pluginMarket'],
  urls: readonly string[],
  timeoutMs: number = PREFETCH_WAIT_TIMEOUT_MS,
): Promise<void> {
  if (typeof pluginMarket.search !== 'function' || urls.length === 0) return
  const preloadAll = Promise.allSettled(
    urls.map(url => pluginMarket.search!(url, { sort: { kind: 'index' }, offset: 0, limit: 1 })),
  )
  if (timeoutMs <= 0) {
    await preloadAll
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      preloadAll,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function applyOfficialIndexes(
  remote: OfficialMarketImportClient,
  syncedUrl: string,
  configuredUrls: string[],
  existingUrls: readonly string[],
  officialBundleEnabled: boolean,
): Promise<OfficialMarketImportResult> {
  let application = 'applied'
  if (!officialBundleEnabled) {
    const enableResult = await remote.pluginManager.setBundleEnabled(OFFICIAL_MARKET, true)
    if (!enableResult.ok) throw new Error(enableResult.error.message)
    application = enableResult.value.application
    if (application === 'failed' || application === 'cancelled') {
      throw new Error(enableResult.value.error?.diagnostic ?? `Could not enable the official "${OFFICIAL_PLUGIN_INDEX.title.en}".`)
    }
  }
  // Selecting `[syncedUrl]` first forces DiscoverController to drop any previously selected URL before the full list is saved.
  if (existingUrls.length > 0 && existingUrls[0] !== syncedUrl) {
    const primeResult = await remote.pluginMarket.setIndexes([syncedUrl])
    if (!primeResult.ok) throw new Error(primeResult.error.message)
  }
  const saveResult = await remote.pluginMarket.setIndexes(configuredUrls)
  if (!saveResult.ok) throw new Error(saveResult.error.message)
  await prefetchMarketIndexes(remote.pluginMarket, configuredUrls)
  return {
    application,
    syncedUrl,
    configuredUrls,
  }
}

/**
 * Quick-configure the default source of every official-configurable built-in market into the official plugin index
 * bundle (`@deepseek-ai/dsh-experimental-plugin-market-bundle`), selecting the source of the market in use as the active index.
 */
export async function importMarketSourcesToOfficial(
  remote: OfficialMarketImportClient,
  resolution: Pick<ActiveMarketResolution, 'enabled' | 'marketKey' | 'syncUrl' | 'desktopActiveUrl'>,
  officialBundleEnabled: boolean,
  runtime: MarketRuntimeState = {},
): Promise<OfficialMarketImportResult> {
  const existingResult = await remote.pluginMarket.listIndexes()
  const existingUrls = existingResult.ok ? existingResult.value.map(item => item.url) : []
  const configuredUrls = orderedMarketSourceUrls(resolution, existingUrls, runtime)
  const syncedUrl = quickConfigurationUrl(resolution, runtime)
  return await applyOfficialIndexes(remote, syncedUrl, configuredUrls, existingUrls, officialBundleEnabled)
}

/**
 * Enable the official plugin index bundle (`@deepseek-ai/dsh-experimental-plugin-market-bundle`),
 * configure the `format: 1` sources of a single built-in market, and select its default source as the active index.
 */
export async function configureSingleMarketToOfficial(
  remote: OfficialMarketImportClient,
  marketKey: BuiltInMarketKey,
  runtime: MarketRuntimeState,
  officialBundleEnabled: boolean,
): Promise<OfficialMarketImportResult> {
  const target = resolveMarketSourceByKey(marketKey, runtime)
  const marketDef = OFFICIAL_CONFIGURABLE_MARKET_SOURCES.find(item => item.key === marketKey)
  const marketUrls = marketDef ? marketDef.sources.map(source => source.url) : []
  const existingResult = await remote.pluginMarket.listIndexes()
  const existingUrls = existingResult.ok ? existingResult.value.map(item => item.url) : []
  const configuredUrls = deduplicateUrls([
    target.syncUrl,
    ...marketUrls,
    ...existingUrls,
  ])
  return await applyOfficialIndexes(remote, target.syncUrl, configuredUrls, existingUrls, officialBundleEnabled)
}

/**
 * Remove all configured sources belonging to a single built-in market from the official plugin index bundle.
 */
export async function removeMarketSourcesFromOfficial(
  remote: OfficialMarketImportClient,
  marketKey: BuiltInMarketKey,
): Promise<readonly string[]> {
  const marketDef = BUILT_IN_MARKET_SOURCES.find(item => item.key === marketKey)
  const urlsToRemove = new Set(marketDef ? marketDef.sources.map(source => source.url) : [])
  const existingResult = await remote.pluginMarket.listIndexes()
  const existingUrls = existingResult.ok ? existingResult.value.map(item => item.url) : []
  const remainingUrls = existingUrls.filter(url => !urlsToRemove.has(url))
  const saveResult = await remote.pluginMarket.setIndexes(remainingUrls)
  if (!saveResult.ok) throw new Error(saveResult.error.message)
  return remainingUrls
}

/**
 * Configure or unconfigure a specific sub-source endpoint URL in the official plugin index bundle.
 */
export async function toggleMarketEndpointInOfficial(
  remote: OfficialMarketImportClient,
  endpointUrl: string,
  enable: boolean,
  officialBundleEnabled: boolean,
): Promise<OfficialMarketImportResult> {
  const existingResult = await remote.pluginMarket.listIndexes()
  const existingUrls = existingResult.ok ? existingResult.value.map(item => item.url) : []
  if (!enable) {
    const remainingUrls = existingUrls.filter(url => url !== endpointUrl)
    const saveResult = await remote.pluginMarket.setIndexes(remainingUrls)
    if (!saveResult.ok) throw new Error(saveResult.error.message)
    return {
      application: 'applied',
      syncedUrl: remainingUrls[0] ?? '',
      configuredUrls: remainingUrls,
    }
  }
  const configuredUrls = deduplicateUrls([
    endpointUrl,
    ...existingUrls,
  ])
  return await applyOfficialIndexes(remote, endpointUrl, configuredUrls, existingUrls, officialBundleEnabled)
}
