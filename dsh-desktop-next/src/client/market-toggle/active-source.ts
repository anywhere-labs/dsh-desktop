/** Resolve the market source in use and the index URLs that quick configuration syncs for it. */

import {
  type BuiltInMarketKey,
  COMMUNITY_MARKET,
  DSH_MARKET,
  type MarketName,
  type MarketState,
  OFFICIAL_CONFIGURABLE_MARKET_SOURCES,
} from './markets.ts'

export interface CommunitySourceLike {
  readonly providerId?: string
  readonly builtInProviderKey?: string
  readonly enabled?: boolean
  readonly endpoint?: string
}

export interface MarketRuntimeState {
  readonly communitySources?: readonly CommunitySourceLike[]
  readonly dshMarketRegion?: 'global' | 'china'
}

export interface ActiveMarketResolution {
  readonly enabled: boolean
  readonly bundle: MarketName | null
  readonly marketKey: BuiltInMarketKey
  /** URL currently used by the Desktop market plugin itself, when enabled. */
  readonly desktopActiveUrl: string | null
  /** URL synced as the active/first index in the official plugin index bundle. */
  readonly syncUrl: string
  readonly region?: 'global' | 'china'
}

/** Resolve which of the 3 built-in markets and source endpoints is currently active on Desktop. */
export function resolveActiveMarketSource(
  rows: readonly MarketState[],
  preferred: MarketName = COMMUNITY_MARKET,
  runtime: MarketRuntimeState = {},
): ActiveMarketResolution {
  const community = rows.find(row => row.name === COMMUNITY_MARKET)
  const dshMarket = rows.find(row => row.name === DSH_MARKET)
  const enabledBundle: MarketName | null = dshMarket?.enabled && !community?.enabled
    ? DSH_MARKET
    : community?.enabled
      ? COMMUNITY_MARKET
      : dshMarket?.enabled
        ? DSH_MARKET
        : null
  const targetBundle = enabledBundle ?? preferred
  if (targetBundle === DSH_MARKET) {
    const region = runtime.dshMarketRegion ?? 'china'
    const desktopActiveUrl = region === 'global'
      ? 'https://awesome-dsh-plugin.com/plugins.json'
      : 'https://mirrors.cloud.tencent.com/npm/dsh-plugin-catalog/latest'
    const syncUrl = region === 'global'
      ? 'https://realguan.github.io/dsh-plugin-market/dsh-index.json'
      : 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json'
    return {
      enabled: enabledBundle !== null,
      bundle: enabledBundle,
      marketKey: 'dshmarket',
      desktopActiveUrl: enabledBundle ? desktopActiveUrl : null,
      syncUrl,
      region,
    }
  }
  const enabledCommunity = runtime.communitySources?.find(source => source.enabled)
  const isDshfind = enabledCommunity?.builtInProviderKey === 'dshfind'
    || enabledCommunity?.providerId === 'com.dshfind.catalog'
  const marketKey: BuiltInMarketKey = isDshfind ? 'dshfind' : 'dsh-1024store'
  const defaultUrl = isDshfind
    ? 'https://api.dshfind.com/market/v1/plugins'
    : 'https://deepseek1024.com/api/v2/plugins'
  const endpoint = enabledCommunity?.endpoint?.trim()
  const activeUrl = endpoint && URL.canParse(endpoint) ? endpoint : defaultUrl
  return {
    enabled: enabledBundle !== null,
    bundle: enabledBundle,
    marketKey,
    desktopActiveUrl: enabledBundle ? activeUrl : null,
    // dshfind publishes a separate format-1 index; 1024Store has none, so its catalog URL stays the sync URL.
    syncUrl: isDshfind ? 'https://api.dshfind.com/market/dsh-index.json' : activeUrl,
  }
}

/** Resolve the primary sync URL and endpoints for a specific built-in market key. */
export function resolveMarketSourceByKey(
  marketKey: BuiltInMarketKey,
  runtime: MarketRuntimeState = {},
): Pick<ActiveMarketResolution, 'marketKey' | 'syncUrl' | 'desktopActiveUrl' | 'region'> {
  if (marketKey === 'dshmarket') {
    const region = runtime.dshMarketRegion ?? 'china'
    return {
      marketKey: 'dshmarket',
      desktopActiveUrl: region === 'global'
        ? 'https://awesome-dsh-plugin.com/plugins.json'
        : 'https://mirrors.cloud.tencent.com/npm/dsh-plugin-catalog/latest',
      syncUrl: region === 'global'
        ? 'https://realguan.github.io/dsh-plugin-market/dsh-index.json'
        : 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
      region,
    }
  }
  const providerId = marketKey === 'dshfind' ? 'com.dshfind.catalog' : 'com.deepseek1024.catalog'
  const matched = runtime.communitySources?.find(source =>
    source.builtInProviderKey === marketKey || source.providerId === providerId)
  const defaultUrl = marketKey === 'dshfind'
    ? 'https://api.dshfind.com/market/v1/plugins'
    : 'https://deepseek1024.com/api/v2/plugins'
  const endpoint = matched?.endpoint?.trim()
  const url = endpoint && URL.canParse(endpoint) ? endpoint : defaultUrl
  return {
    marketKey,
    desktopActiveUrl: url,
    syncUrl: marketKey === 'dshfind' ? 'https://api.dshfind.com/market/dsh-index.json' : url,
  }
}

export function deduplicateUrls(candidates: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of candidates) {
    const trimmed = raw.trim()
    if (!trimmed || !URL.canParse(trimmed)) continue
    const key = new URL(trimmed).href
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/**
 * Quick configuration selects the index of the market in use when that market publishes one, and otherwise
 * (no market enabled, or 1024Store) the `dshmarket` index for the current region.
 */
export function quickConfigurationUrl(
  resolution: Pick<ActiveMarketResolution, 'enabled' | 'marketKey' | 'syncUrl'>,
  runtime: MarketRuntimeState,
): string {
  return resolution.enabled && OFFICIAL_CONFIGURABLE_MARKET_SOURCES.some(item => item.key === resolution.marketKey)
    ? resolution.syncUrl
    : resolveMarketSourceByKey('dshmarket', runtime).syncUrl
}

/**
 * Build the deduplicated list of index URLs for "Quick configuration" (`pluginMarket.setIndexes`): the selected source
 * first, then the default source of every official-configurable market, followed by any existing user URLs.
 */
export function orderedMarketSourceUrls(
  resolution: Pick<ActiveMarketResolution, 'enabled' | 'marketKey' | 'syncUrl' | 'desktopActiveUrl'>,
  existingUrls: readonly string[] = [],
  runtime: MarketRuntimeState = {},
): string[] {
  const defaultUrls = OFFICIAL_CONFIGURABLE_MARKET_SOURCES.map(item =>
    item.key === resolution.marketKey
      ? resolution.syncUrl
      : resolveMarketSourceByKey(item.key, runtime).syncUrl)
  return deduplicateUrls([
    quickConfigurationUrl(resolution, runtime),
    ...defaultUrls,
    ...existingUrls,
  ])
}
