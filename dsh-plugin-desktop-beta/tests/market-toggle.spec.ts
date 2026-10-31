import { expect, it, vi } from 'vitest'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import {
  BUILT_IN_MARKET_SOURCES,
  COMMUNITY_MARKET,
  configureSingleMarketToOfficial,
  DSH_MARKET,
  importMarketSourcesToOfficial,
  marketToggleTargets,
  OFFICIAL_CONFIGURABLE_MARKET_SOURCES,
  OFFICIAL_MARKET,
  orderedMarketSourceUrls,
  prefetchMarketIndexes,
  removeMarketSourcesFromOfficial,
  resolveActiveMarketSource,
  resolveMarketSourceByKey,
  toggleMarketEndpointInOfficial,
  type MarketName,
  type MarketRuntimeState,
} from '../src/client/market-toggle.ts'

const row = (name: string, enabled: boolean, readOnlyReason?: string) =>
  ({ name, enabled, readOnlyReason }) as BundleInfo

it('enables the preferred market, falling back to the available provider', () => {
  const markets = [row(COMMUNITY_MARKET, false), row(DSH_MARKET, false)]
  expect(marketToggleTargets(markets, COMMUNITY_MARKET, true)).toEqual([COMMUNITY_MARKET])
  expect(marketToggleTargets(markets, DSH_MARKET, true)).toEqual([DSH_MARKET])
  expect(marketToggleTargets([row(COMMUNITY_MARKET, false, 'locked'), markets[1]!], COMMUNITY_MARKET, true)).toEqual([DSH_MARKET])
})

it('disables whichever market is active, including both in a legacy Profile', () => {
  const markets = [row(COMMUNITY_MARKET, true), row(DSH_MARKET, true)]
  expect(marketToggleTargets(markets, COMMUNITY_MARKET, false)).toEqual([COMMUNITY_MARKET, DSH_MARKET])
  expect(marketToggleTargets([markets[0]!, row(DSH_MARKET, false)], DSH_MARKET, false)).toEqual([COMMUNITY_MARKET])
  expect(marketToggleTargets([row(COMMUNITY_MARKET, false), row(DSH_MARKET, false)], COMMUNITY_MARKET, false)).toEqual([])
  expect(marketToggleTargets([row(COMMUNITY_MARKET, true, 'locked'), markets[1]!], DSH_MARKET, false)).toEqual([])
})

it('declares all three built-in plugin markets while exposing only their format 1 indexes for official configuration', () => {
  expect(BUILT_IN_MARKET_SOURCES.map(item => item.key)).toEqual(['dsh-1024store', 'dshfind', 'dshmarket'])
  expect(OFFICIAL_CONFIGURABLE_MARKET_SOURCES.map(item => [item.key, item.sources.map(source => source.url)])).toEqual([
    ['dshmarket', [
      'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
      'https://realguan.github.io/dsh-plugin-market/dsh-index.json',
    ]],
    ['dshfind', ['https://api.dshfind.com/market/dsh-index.json']],
  ])
  const urls = BUILT_IN_MARKET_SOURCES.flatMap(item => item.sources.map(source => source.url))
  expect(urls).toEqual([
    'https://deepseek1024.com/api/v2/plugins',
    'https://deepseek1024.com/api/v1/registry',
    'https://api.dshfind.com/market/v1/plugins',
    'https://api.dshfind.com/market/manifest.json',
    'https://api.dshfind.com/v1/catalog',
    'https://api.dshfind.com/market/dsh-index.json',
    'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
    'https://realguan.github.io/dsh-plugin-market/dsh-index.json',
  ])
})

it('resolves the active market source across Community Market providers and dshmarket regions', () => {
  const communityActive = [row(COMMUNITY_MARKET, true), row(DSH_MARKET, false)]
  expect(resolveActiveMarketSource(communityActive, COMMUNITY_MARKET, {
    communitySources: [
      { builtInProviderKey: 'dsh-1024store', enabled: false, endpoint: 'https://deepseek1024.com/api/v2/plugins' },
      { builtInProviderKey: 'dshfind', enabled: true, endpoint: 'https://api.dshfind.com/market/v1/plugins' },
    ],
  })).toEqual({
    enabled: true,
    bundle: COMMUNITY_MARKET,
    marketKey: 'dshfind',
    desktopActiveUrl: 'https://api.dshfind.com/market/v1/plugins',
    syncUrl: 'https://api.dshfind.com/market/dsh-index.json',
  })

  const dshMarketActive = [row(COMMUNITY_MARKET, false), row(DSH_MARKET, true)]
  expect(resolveActiveMarketSource(dshMarketActive, DSH_MARKET, { dshMarketRegion: 'global' })).toEqual({
    enabled: true,
    bundle: DSH_MARKET,
    marketKey: 'dshmarket',
    desktopActiveUrl: 'https://awesome-dsh-plugin.com/plugins.json',
    syncUrl: 'https://realguan.github.io/dsh-plugin-market/dsh-index.json',
    region: 'global',
  })
  expect(resolveActiveMarketSource(dshMarketActive, DSH_MARKET, { dshMarketRegion: 'china' })).toEqual({
    enabled: true,
    bundle: DSH_MARKET,
    marketKey: 'dshmarket',
    desktopActiveUrl: 'https://mirrors.cloud.tencent.com/npm/dsh-plugin-catalog/latest',
    syncUrl: 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
    region: 'china',
  })
})

it('quick configuration enables the official plugin index bundle, configures each market default with the market in use selected first, and preloads them', async () => {
  const setBundleEnabled = vi.fn(async () => ({ ok: true as const, value: { application: 'applied' } }))
  const listIndexes = vi.fn(async () => ({
    ok: true as const,
    value: [{ url: 'https://custom.example.com/index.json' }],
  }))
  const setIndexes = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const search = vi.fn(async (url: string) => ({ ok: true as const, value: { url, title: 'Loaded' } }))
  const runtime = {
    communitySources: [{ builtInProviderKey: 'dshfind', enabled: true, endpoint: 'https://api.dshfind.com/market/v1/plugins' }],
  }
  const resolution = resolveActiveMarketSource(
    [row(COMMUNITY_MARKET, true), row(DSH_MARKET, false)],
    COMMUNITY_MARKET,
    runtime,
  )

  const result = await importMarketSourcesToOfficial(
    { pluginManager: { setBundleEnabled }, pluginMarket: { listIndexes, setIndexes, search } },
    resolution,
    false,
    runtime,
  )

  expect(setBundleEnabled).toHaveBeenCalledWith(OFFICIAL_MARKET, true)
  expect(setIndexes).toHaveBeenCalledTimes(2)
  expect(setIndexes).toHaveBeenNthCalledWith(1, ['https://api.dshfind.com/market/dsh-index.json'])
  expect(result.syncedUrl).toBe('https://api.dshfind.com/market/dsh-index.json')
  expect(result.configuredUrls).toEqual([
    'https://api.dshfind.com/market/dsh-index.json',
    'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
    'https://custom.example.com/index.json',
  ])
  expect(result.configuredUrls).toEqual(orderedMarketSourceUrls(resolution, ['https://custom.example.com/index.json'], runtime))
  expect(search).toHaveBeenCalledTimes(3)
  for (const url of result.configuredUrls) {
    expect(search).toHaveBeenCalledWith(url, { sort: { kind: 'index' }, offset: 0, limit: 1 })
  }
})

it('quick configuration selects the source of the market in use and falls back to the dshmarket default', () => {
  const china = 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json'
  const global = 'https://realguan.github.io/dsh-plugin-market/dsh-index.json'
  const dshfind = 'https://api.dshfind.com/market/dsh-index.json'
  const quick = (rows: BundleInfo[], preferred: MarketName, runtime: MarketRuntimeState) =>
    orderedMarketSourceUrls(resolveActiveMarketSource(rows, preferred, runtime), [], runtime)
  const neither = [row(COMMUNITY_MARKET, false), row(DSH_MARKET, false)]
  const community = [row(COMMUNITY_MARKET, true), row(DSH_MARKET, false)]
  const dshMarket = [row(COMMUNITY_MARKET, false), row(DSH_MARKET, true)]
  const usingDshfind = { communitySources: [{ builtInProviderKey: 'dshfind', enabled: true }] }

  expect(quick(neither, COMMUNITY_MARKET, {})).toEqual([china, dshfind])
  expect(quick(neither, DSH_MARKET, {})).toEqual([china, dshfind])
  // A remembered dshfind source does not count while the Community Market itself is off.
  expect(quick(neither, COMMUNITY_MARKET, usingDshfind)).toEqual([china, dshfind])
  expect(quick(dshMarket, DSH_MARKET, { dshMarketRegion: 'global' })).toEqual([global, dshfind])
  expect(quick(community, COMMUNITY_MARKET, usingDshfind)).toEqual([dshfind, china])
  // 1024Store, or a Community Market without a selected source, publishes no format 1 index.
  expect(quick(community, COMMUNITY_MARKET, { communitySources: [{ builtInProviderKey: 'dsh-1024store', enabled: true }] }))
    .toEqual([china, dshfind])
  expect(quick(community, COMMUNITY_MARKET, {})).toEqual([china, dshfind])
})

it('configures and unconfigures a single built-in market and individual sub-source endpoints', async () => {
  expect(resolveMarketSourceByKey('dshmarket', { dshMarketRegion: 'global' }).syncUrl)
    .toBe('https://realguan.github.io/dsh-plugin-market/dsh-index.json')
  expect(resolveMarketSourceByKey('dsh-1024store').syncUrl)
    .toBe('https://deepseek1024.com/api/v2/plugins')

  const setBundleEnabled = vi.fn(async () => ({ ok: true as const, value: { application: 'applied' } }))
  const listIndexes = vi.fn(async () => ({
    ok: true as const,
    value: [{ url: 'https://deepseek1024.com/api/v2/plugins' }],
  }))
  const setIndexes = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const search = vi.fn(async () => ({ ok: true as const, value: {} }))

  const result = await configureSingleMarketToOfficial(
    { pluginManager: { setBundleEnabled }, pluginMarket: { listIndexes, setIndexes, search } },
    'dshmarket',
    { dshMarketRegion: 'china' },
    true,
  )

  expect(setBundleEnabled).not.toHaveBeenCalled()
  expect(setIndexes).toHaveBeenNthCalledWith(1, ['https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json'])
  expect(result.syncedUrl).toBe('https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json')
  expect(result.configuredUrls).toEqual([
    'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
    'https://realguan.github.io/dsh-plugin-market/dsh-index.json',
    'https://deepseek1024.com/api/v2/plugins',
  ])
  expect(search).toHaveBeenCalledTimes(3)

  listIndexes.mockResolvedValueOnce({
    ok: true as const,
    value: [
      { url: 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json' },
      { url: 'https://realguan.github.io/dsh-plugin-market/dsh-index.json' },
      { url: 'https://deepseek1024.com/api/v2/plugins' },
    ],
  })
  const afterRemove = await removeMarketSourcesFromOfficial(
    { pluginManager: { setBundleEnabled }, pluginMarket: { listIndexes, setIndexes, search } },
    'dshmarket',
  )
  expect(afterRemove).toEqual(['https://deepseek1024.com/api/v2/plugins'])

  listIndexes.mockResolvedValueOnce({
    ok: true as const,
    value: [{ url: 'https://deepseek1024.com/api/v2/plugins' }],
  })
  const toggledOn = await toggleMarketEndpointInOfficial(
    { pluginManager: { setBundleEnabled }, pluginMarket: { listIndexes, setIndexes, search } },
    'https://api.dshfind.com/market/manifest.json',
    true,
    true,
  )
  expect(toggledOn.configuredUrls).toEqual([
    'https://api.dshfind.com/market/manifest.json',
    'https://deepseek1024.com/api/v2/plugins',
  ])

  listIndexes.mockResolvedValueOnce({
    ok: true as const,
    value: [
      { url: 'https://api.dshfind.com/market/manifest.json' },
      { url: 'https://deepseek1024.com/api/v2/plugins' },
    ],
  })
  const toggledOff = await toggleMarketEndpointInOfficial(
    { pluginManager: { setBundleEnabled }, pluginMarket: { listIndexes, setIndexes, search } },
    'https://api.dshfind.com/market/manifest.json',
    false,
    true,
  )
  expect(toggledOff.configuredUrls).toEqual(['https://deepseek1024.com/api/v2/plugins'])
})

it('configures only the dshfind format 1 index while its Community Market catalog stays the Desktop source', async () => {
  const runtime = {
    communitySources: [{ builtInProviderKey: 'dshfind', enabled: true, endpoint: 'https://api.dshfind.com/market/v1/plugins' }],
  }
  expect(resolveMarketSourceByKey('dshfind', runtime)).toEqual({
    marketKey: 'dshfind',
    desktopActiveUrl: 'https://api.dshfind.com/market/v1/plugins',
    syncUrl: 'https://api.dshfind.com/market/dsh-index.json',
  })

  const setBundleEnabled = vi.fn(async () => ({ ok: true as const, value: { application: 'applied' } }))
  const listIndexes = vi.fn(async () => ({
    ok: true as const,
    value: [{ url: 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json' }],
  }))
  const setIndexes = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const search = vi.fn(async () => ({ ok: true as const, value: {} }))

  const result = await configureSingleMarketToOfficial(
    { pluginManager: { setBundleEnabled }, pluginMarket: { listIndexes, setIndexes, search } },
    'dshfind',
    runtime,
    true,
  )

  expect(setIndexes).toHaveBeenNthCalledWith(1, ['https://api.dshfind.com/market/dsh-index.json'])
  expect(result.syncedUrl).toBe('https://api.dshfind.com/market/dsh-index.json')
  expect(result.configuredUrls).toEqual([
    'https://api.dshfind.com/market/dsh-index.json',
    'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
  ])

  // Resetting dshfind also drops catalog endpoints that older builds wrote into the official list.
  listIndexes.mockResolvedValueOnce({
    ok: true as const,
    value: [
      { url: 'https://api.dshfind.com/market/dsh-index.json' },
      { url: 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json' },
      { url: 'https://api.dshfind.com/market/v1/plugins' },
    ],
  })
  const afterRemove = await removeMarketSourcesFromOfficial(
    { pluginManager: { setBundleEnabled }, pluginMarket: { listIndexes, setIndexes, search } },
    'dshfind',
  )
  expect(afterRemove).toEqual(['https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json'])
})

it('preloads configured index URLs on explicit configuration actions and bounds slow endpoints by timeout', async () => {
  const search = vi.fn().mockResolvedValue({ ok: true })
  await prefetchMarketIndexes(
    {
      listIndexes: async () => ({ ok: true, value: [] }),
      setIndexes: async () => ({ ok: true, value: undefined }),
      search,
    },
    [
      'https://deepseek1024.com/api/v2/plugins',
      'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json',
    ],
    0,
  )
  expect(search).toHaveBeenCalledTimes(2)
  expect(search).toHaveBeenCalledWith('https://deepseek1024.com/api/v2/plugins', {
    sort: { kind: 'index' },
    offset: 0,
    limit: 1,
  })

  await prefetchMarketIndexes(
    {
      listIndexes: async () => ({ ok: true, value: [] }),
      setIndexes: async () => ({ ok: true, value: undefined }),
      search: async () => new Promise(() => {}),
    },
    ['https://slow.example.com/index.json'],
    10,
  )
})
