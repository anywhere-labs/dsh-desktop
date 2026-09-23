import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z, type ZodType } from 'zod'
import type { LocalSourceRecord } from '../contracts/types.js'
import { readLegacyMarketSources } from './legacy-settings.js'
import type { DeferredMarketStateStore, MarketCatalogCache, MarketStateStore } from './state-store.js'

/**
 * This module is the only place market touches `@deepseek-ai/dsh-storage-domain`
 * at runtime, and it is imported dynamically. The package is an optional peer
 * dependency: a market installed without it must still load and serve its
 * routes, which a top-level import would make impossible.
 */

/** The whole ordered source registry, stored as one document. */
export interface MarketSourcesRecord {
  readonly records: readonly LocalSourceRecord[]
}

/** Domain-wide bookkeeping that belongs to no table. */
export interface MarketDomainGlobal {
  /** ISO timestamp of the one-time pre-0.1.7 settings import; absent until it ran. */
  readonly legacySettingsImportedAt?: string
}

/** Sole key of the `sources` table. */
export const MARKET_SOURCES_KEY = 'registry'
/** Sole key of the `catalog_cache` table. */
export const MARKET_CATALOG_CACHE_KEY = 'current'

const localSourceRecordSchema = z.object({
  sourceRecordId: z.string(),
  registrationKind: z.union([z.literal('user-added'), z.literal('built-in')]),
  adapterId: z.string(),
  providerId: z.string(),
  manifestUrl: z.string().optional(),
  // The registration-time manifest has its own contract validator
  // (`parseCatalogSource`); re-stating its shape here would fork the contract.
  manifest: z.unknown().optional(),
  builtInProviderKey: z.string().optional(),
  enabled: z.boolean(),
  order: z.number(),
})

const sourcesRecordSchema = z.object({
  records: z.array(localSourceRecordSchema),
})

const catalogCacheSchema = z.object({
  version: z.literal(1),
  sourceRecordId: z.string(),
  locale: z.string(),
  savedAt: z.string(),
  // Re-parsed by `parseCatalogSnapshot` on every read, which distrusts it far
  // more thoroughly than a structural schema could.
  snapshot: z.unknown(),
  categories: z.array(z.string()),
  scannedAt: z.string(),
  expiresAt: z.string(),
  providerRevision: z.string().optional(),
})

const globalSchema = z.object({
  legacySettingsImportedAt: z.string().optional(),
})

/*
 * zod models an optional property as `T | undefined`, which
 * `exactOptionalPropertyTypes` refuses to unify with market's `readonly x?: T`
 * declarations. The assertions below only restate each schema's result in
 * market's own vocabulary — the runtime check is the schema itself.
 */
const sourcesValueSchema = sourcesRecordSchema as unknown as ZodType<MarketSourcesRecord>
const catalogCacheValueSchema = catalogCacheSchema as unknown as ZodType<MarketCatalogCache>
const globalValueSchema = globalSchema as unknown as ZodType<MarketDomainGlobal>

/**
 * Market's durable state.
 *
 * Both payloads are tables rather than the global slot, and the layout is
 * `per-record`, for reasons that are specific to this data:
 *
 * - The two payloads have different durability classes. The registry is
 *   authoritative user intent; the cache is disposable derived data with a
 *   24-hour life. `invalidRecords: 'backup-and-skip'` only applies to table
 *   records — the global slot always rejects — so a catalogue cache corrupted
 *   on the medium is moved aside and the domain still opens. In the global slot
 *   the same byte would fail `open` and take the registry down with it.
 * - `backup-and-skip` further requires a backend that can move a document
 *   aside, which is the `per-record` layout; the `single` layout has no
 *   `backupRecord` and silently falls back to rejecting.
 * - Writes are independent. The two payloads have two independent writers (the
 *   serialized source mutator and the fail-soft cache writer), and on separate
 *   keys their writes are separate links of the domain write chain. One global
 *   blob would force a read-modify-write, where the later writer clobbers the
 *   other's field.
 * - The registry is one document rather than one record per source on purpose:
 *   ordering and the single-active-source invariant are properties of the whole
 *   list, so it has to be replaced atomically.
 *
 * The global slot carries only the migration marker: a fixed-shape singleton
 * written at most once, where a whole-value `set` is exactly right.
 */
export const marketDomainSpec = defineDomain({
  name: 'community_market',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  global: {
    schema: globalValueSchema,
    initial: {} as MarketDomainGlobal,
  },
  tables: {
    sources: domainTable<typeof MARKET_SOURCES_KEY, MarketSourcesRecord>(sourcesValueSchema),
    catalog_cache: domainTable<typeof MARKET_CATALOG_CACHE_KEY, MarketCatalogCache>(catalogCacheValueSchema),
  },
})

/** Market's domain handle type, for callers that hold one. */
export type MarketDomain = Domain<typeof marketDomainSpec>

/** Durable {@link MarketStateStore} over an open market domain. */
export class DomainMarketStateStore implements MarketStateStore {
  private readonly sources
  private readonly catalogCache

  constructor(private readonly domain: MarketDomain) {
    this.sources = domain.table('sources')
    this.catalogCache = domain.table('catalog_cache')
  }

  getSources(): readonly LocalSourceRecord[] {
    return this.sources.get(MARKET_SOURCES_KEY)?.records ?? []
  }

  async setSources(records: readonly LocalSourceRecord[]): Promise<void> {
    await this.sources.put(MARKET_SOURCES_KEY, { records })
  }

  getCatalogCache(): MarketCatalogCache | undefined {
    return this.catalogCache.get(MARKET_CATALOG_CACHE_KEY)
  }

  async setCatalogCache(cache: MarketCatalogCache): Promise<void> {
    await this.catalogCache.put(MARKET_CATALOG_CACHE_KEY, cache)
  }

  /** Whether the migration marker has been stamped. */
  get legacyImportDone(): boolean {
    return this.domain.global.get().legacySettingsImportedAt !== undefined
  }

  /** Stamp the migration marker so the import never runs twice. */
  async markLegacyImportDone(at = new Date()): Promise<void> {
    await this.domain.global.set({ legacySettingsImportedAt: at.toISOString() })
  }
}

/** Minimal shape of `ctx.profileContext`; read structurally so market keeps no boot dependency. */
interface MarketProfileHome {
  readonly home: string
}

function profileHome(ctx: Context): string | undefined {
  let profile: unknown
  try {
    profile = ctx.get('profileContext')
  } catch {
    return undefined
  }
  if (typeof profile !== 'object' || profile === null) return undefined
  const home = (profile as Partial<MarketProfileHome>).home
  return typeof home === 'string' && home.length > 0 ? home : undefined
}

/**
 * Run the one-time pre-0.1.7 import, if it is still owed.
 *
 * Idempotent (the domain global records that it ran) and fail-soft (every
 * failure is logged and swallowed). A durable registry that already holds
 * sources is never overwritten — that state is newer than anything a legacy
 * document could hold.
 * @param ctx - context used for logging and for locating the harness home.
 * @param store - the durable store to import into.
 */
export async function importLegacyMarketSettings(ctx: Context, store: DomainMarketStateStore): Promise<void> {
  if (store.legacyImportDone) return
  const home = profileHome(ctx)
  // No profile home means no legacy document to find. Leave the marker unset so
  // a later boot inside a profile can still migrate.
  if (home === undefined) return
  const warn = (message: string) => { ctx.logger.warn(message) }
  const legacy = await readLegacyMarketSources(home, warn)
  if (legacy !== undefined && store.getSources().length === 0) {
    await store.setSources(legacy.records)
    ctx.logger.info(
      `dsh-community-market: migrated ${legacy.records.length} source(s) from ${legacy.from} into durable storage`,
    )
  }
  await store.markLegacyImportDone()
}

/**
 * Open market's domain, run the owed migration, and hand the durable store to
 * the routes' deferred store.
 *
 * The caller owns the returned closer and must run it from its own
 * `ctx.effect` disposer; the domain facility only sweeps handles that were
 * never closed.
 * @param ctx - a context with `storageDomain` resolved.
 * @param target - the deferred store market's routes already hold.
 * @returns the closer for the opened domain.
 */
export async function activateMarketDurableState(
  ctx: Context,
  target: DeferredMarketStateStore,
): Promise<() => Promise<void>> {
  const domain = await ctx.storageDomain.open(marketDomainSpec)
  try {
    const store = new DomainMarketStateStore(domain)
    try {
      await importLegacyMarketSettings(ctx, store)
    } catch (cause) {
      ctx.logger.warn(`dsh-community-market: the one-time settings migration failed and was skipped: ${
        cause instanceof Error ? cause.message : String(cause)
      }`)
    }
    await target.adopt(store)
  } catch (cause) {
    await domain.close()
    throw cause
  }
  return async () => {
    target.release()
    await domain.close()
  }
}
