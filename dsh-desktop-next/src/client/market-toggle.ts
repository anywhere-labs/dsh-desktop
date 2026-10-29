/** Map the Plugins-page switch and source configuration to official bundle-manager and plugin-market operations. */
import type { BundleInfo, MarketIndexSummary, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { OFFICIAL_PLUGIN_INDEX } from '../upstream-family-labels.ts'

export const COMMUNITY_MARKET = 'dsh-community-market'
export const DSH_MARKET = 'dshmarket'
export const OFFICIAL_MARKET = '@deepseek-ai/dsh-experimental-plugin-market-bundle'
export type MarketName = typeof COMMUNITY_MARKET | typeof DSH_MARKET
export type BuiltInMarketKey = 'dsh-1024store' | 'dshfind' | 'dshmarket'

type MarketState = Pick<BundleInfo, 'name' | 'enabled' | 'readOnlyReason' | 'error'>

export interface BilingualText {
  readonly zh: string
  readonly en: string
}

export interface MarketSourceEndpoint {
  readonly url: string
  readonly label: BilingualText
  readonly tags: readonly BilingualText[]
  /** Whether this endpoint serves an official DSH format-1 index document. */
  readonly format1?: boolean
  /** Region this endpoint is tailored for when the market has regional mirrors. */
  readonly region?: 'global' | 'china'
}

export interface BuiltInMarketDefinition {
  readonly key: BuiltInMarketKey
  readonly bundle: MarketName
  readonly providerId?: string
  readonly title: BilingualText
  readonly description: BilingualText
  readonly homepage: string
  /** Primary index URL synced to the official plugin index bundle by default. */
  readonly defaultSyncUrl: string
  readonly sources: readonly MarketSourceEndpoint[]
}

export const BUILT_IN_MARKET_SOURCES: readonly BuiltInMarketDefinition[] = [
  {
    key: 'dsh-1024store',
    bundle: COMMUNITY_MARKET,
    providerId: 'com.deepseek1024.catalog',
    title: { zh: 'DSH 1024Store（社区插件市场）', en: 'DSH 1024Store (Community Market)' },
    description: {
      zh: '社区插件市场内置源，提供经过策展的插件目录与版本索引。',
      en: 'Built-in Community Market provider with curated plugin listings and version metadata.',
    },
    homepage: 'https://deepseek1024.com',
    defaultSyncUrl: 'https://deepseek1024.com/api/v2/plugins',
    sources: [
      {
        url: 'https://deepseek1024.com/api/v2/plugins',
        label: { zh: '1024Store V2 插件目录源', en: '1024Store V2 catalog endpoint' },
        tags: [
          { zh: '默认源', en: 'Default' },
          { zh: '社区市场 V2', en: 'Community V2' },
        ],
      },
      {
        url: 'https://deepseek1024.com/api/v1/registry',
        label: { zh: '1024Store V1 注册表源', en: '1024Store V1 registry endpoint' },
        tags: [
          { zh: '备用源', en: 'Mirror' },
          { zh: 'Registry V1', en: 'Registry V1' },
        ],
      },
    ],
  },
  {
    key: 'dshfind',
    bundle: COMMUNITY_MARKET,
    providerId: 'com.dshfind.catalog',
    title: { zh: 'dshfind（社区插件市场）', en: 'dshfind (Community Market)' },
    description: {
      zh: `社区插件市场内置源，提供已适配“${OFFICIAL_PLUGIN_INDEX.title.zh}”格式（format 1）的插件目录索引源。`,
      en: `Built-in Community Market provider with a plugin directory index source adapted for the "${OFFICIAL_PLUGIN_INDEX.title.en}" format (format 1).`,
    },
    homepage: 'https://dshfind.com',
    defaultSyncUrl: 'https://api.dshfind.com/market/dsh-index.json',
    sources: [
      {
        url: 'https://api.dshfind.com/market/v1/plugins',
        label: { zh: 'dshfind 市场目录源', en: 'dshfind market catalog endpoint' },
        tags: [
          { zh: '默认源', en: 'Default' },
          { zh: 'Market V1', en: 'Market V1' },
        ],
      },
      {
        url: 'https://api.dshfind.com/market/manifest.json',
        label: { zh: 'dshfind 市场 Manifest 源', en: 'dshfind market manifest endpoint' },
        tags: [
          { zh: 'Manifest 源', en: 'Manifest' },
        ],
      },
      {
        url: 'https://api.dshfind.com/v1/catalog',
        label: { zh: 'dshfind 全量快照目录源', en: 'dshfind full catalog snapshot' },
        tags: [
          { zh: '快照源', en: 'Snapshot' },
          { zh: 'Catalog V1', en: 'Catalog V1' },
        ],
      },
      {
        url: 'https://api.dshfind.com/market/dsh-index.json',
        label: { zh: 'dshfind 索引源（DSH 插件目录）', en: 'dshfind index source (DSH Plugin Directory)' },
        tags: [
          { zh: '全量索引', en: 'Full index' },
          { zh: 'format 1', en: 'format 1' },
        ],
        format1: true,
      },
    ],
  },
  {
    key: 'dshmarket',
    bundle: DSH_MARKET,
    title: { zh: 'dsh-market（Awesome DSH Plugin）', en: 'dsh-market (Awesome DSH Plugin)' },
    description: {
      zh: `第三方插件市场，提供已适配“${OFFICIAL_PLUGIN_INDEX.title.zh}”格式（format 1）的国内 CDN 与 GitHub Pages 索引源。`,
      en: `Third-party plugin market with China CDN and GitHub Pages index sources adapted for the "${OFFICIAL_PLUGIN_INDEX.title.en}" format (format 1).`,
    },
    homepage: 'https://awesome-dsh-plugin.com',
    defaultSyncUrl: 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
    sources: [
      {
        url: 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
        label: { zh: 'dsh-market 索引源（jsDelivr CDN 国内加速）', en: 'dsh-market index source (jsDelivr CDN China mirror)' },
        tags: [
          { zh: '国内推荐', en: 'China CDN' },
          { zh: 'format 1', en: 'format 1' },
        ],
        format1: true,
        region: 'china',
      },
      {
        url: 'https://realguan.github.io/dsh-plugin-market/dsh-index.json',
        label: { zh: 'dsh-market 索引源（GitHub Pages 国际源）', en: 'dsh-market index source (GitHub Pages Global)' },
        tags: [
          { zh: '国际源 Global', en: 'Global' },
          { zh: 'format 1', en: 'format 1' },
        ],
        format1: true,
        region: 'global',
      },
    ],
  },
]

/**
 * Built-in markets currently displayed and configurable for the official plugin index bundle
 * (`@deepseek-ai/dsh-experimental-plugin-market-bundle`), narrowed to the `format: 1` `dsh-index.json` endpoints they publish.
 * Quick configuration adds the default source of each; `dshmarket` stays first because it is the fallback selection.
 */
export const OFFICIAL_CONFIGURABLE_MARKET_SOURCES: readonly BuiltInMarketDefinition[] = (['dshmarket', 'dshfind'] as const)
  .flatMap(key => BUILT_IN_MARKET_SOURCES.filter(item => item.key === key))
  .map(item => ({ ...item, sources: item.sources.filter(source => source.format1 === true) }))

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

function editable(row: MarketState): boolean {
  return row.readOnlyReason === undefined && row.error === undefined
}

/** Disabling both handles older Profiles with two selected markets; enabling prefers the last choice. */
export function marketToggleTargets(rows: readonly MarketState[], preferred: MarketName, enable: boolean): MarketName[] {
  const markets = rows.filter((row): row is MarketState & { name: MarketName } =>
    row.name === COMMUNITY_MARKET || row.name === DSH_MARKET)
  if (!enable) {
    const active = markets.filter(row => row.enabled)
    return active.every(editable) ? active.map(row => row.name) : []
  }
  const preferredRow = markets.find(row => row.name === preferred && editable(row))
  const fallback = markets.find(row => editable(row))
  return preferredRow ? [preferredRow.name] : fallback ? [fallback.name] : []
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

function deduplicateUrls(candidates: readonly string[]): string[] {
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
function quickConfigurationUrl(
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



