/** Map the Plugins-page switch and source configuration to official bundle-manager and plugin-market operations. */

import { COMMUNITY_MARKET, DSH_MARKET, type MarketName, type MarketState } from './market-toggle/markets.ts'

export {
  BUILT_IN_MARKET_SOURCES,
  COMMUNITY_MARKET,
  DSH_MARKET,
  OFFICIAL_CONFIGURABLE_MARKET_SOURCES,
  OFFICIAL_MARKET,
} from './market-toggle/markets.ts'
export type {
  BilingualText,
  BuiltInMarketDefinition,
  BuiltInMarketKey,
  MarketName,
  MarketSourceEndpoint,
} from './market-toggle/markets.ts'
export { orderedMarketSourceUrls, readDshMarketRegion, resolveActiveMarketSource, resolveMarketSourceByKey } from './market-toggle/active-source.ts'
export type { ActiveMarketResolution, CommunitySourceLike, MarketRuntimeState } from './market-toggle/active-source.ts'
export {
  configureSingleMarketToOfficial,
  importMarketSourcesToOfficial,
  prefetchMarketIndexes,
  removeMarketSourcesFromOfficial,
  toggleMarketEndpointInOfficial,
} from './market-toggle/official-index.ts'
export type { OfficialMarketImportClient, OfficialMarketImportResult } from './market-toggle/official-index.ts'

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
