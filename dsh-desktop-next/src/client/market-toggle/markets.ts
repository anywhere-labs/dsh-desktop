/** The plugin markets Desktop knows: their bundle names, built-in market keys and each built-in market's source endpoints. */

import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import { OFFICIAL_PLUGIN_INDEX } from '../../upstream-family-labels.ts'

export const COMMUNITY_MARKET = 'dsh-community-market'
export const DSH_MARKET = 'dshmarket'
export const OFFICIAL_MARKET = '@deepseek-ai/dsh-experimental-plugin-market-bundle'
export type MarketName = typeof COMMUNITY_MARKET | typeof DSH_MARKET
export type BuiltInMarketKey = 'dsh-1024store' | 'dshfind' | 'dshmarket'

export type MarketState = Pick<BundleInfo, 'name' | 'enabled' | 'readOnlyReason' | 'error'>

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
