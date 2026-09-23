import type { CatalogSnapshot } from '../contracts/generated/catalog-snapshot.js'
import type { LocalSourceRecord } from '../contracts/types.js'

/**
 * Disposable browse-time cache of one provider's catalogue page. Never
 * authoritative: every field is re-validated on read, and a miss only costs
 * one network fetch.
 */
export interface MarketCatalogCache {
  readonly version: 1
  readonly sourceRecordId: string
  readonly locale: string
  readonly savedAt: string
  readonly snapshot: CatalogSnapshot
  readonly categories: readonly string[]
  readonly scannedAt: string
  readonly expiresAt: string
  readonly providerRevision?: string
}

/**
 * Market's durable machine state: the authoritative source registry, the
 * disposable catalogue cache, and the optional npm registry origin used for
 * package-manager installs. Reads are synchronous because every backing
 * implementation keeps the whole state in memory; writes are asynchronous
 * because they reach a medium.
 */
export interface MarketStateStore {
  /** Ordered source registry as last written; an unwritten store reads empty. */
  getSources(): readonly LocalSourceRecord[]
  /** Replace the whole ordered registry. */
  setSources(records: readonly LocalSourceRecord[]): Promise<void>
  /** Last persisted catalogue cache, or `undefined` when none was written. */
  getCatalogCache(): MarketCatalogCache | undefined
  /** Replace the catalogue cache. */
  setCatalogCache(cache: MarketCatalogCache): Promise<void>
  /**
   * npm origin used for package-manager installs. Empty means registry.npmjs.org.
   * Package verification does not read this value.
   */
  getNpmRegistry(): string
  /** Replace the npm install origin. Empty keeps the official registry. */
  setNpmRegistry(origin: string): Promise<void>
}

/** Session-scoped store. Market's degraded mode when no storage domain is available. */
export class MemoryMarketStateStore implements MarketStateStore {
  private sources: readonly LocalSourceRecord[] = []
  private catalogCache: MarketCatalogCache | undefined
  private npmRegistry = ''

  constructor(seed?: {
    readonly sources?: readonly LocalSourceRecord[]
    readonly catalogCache?: MarketCatalogCache
    readonly npmRegistry?: string
  }) {
    if (seed?.sources !== undefined) this.sources = seed.sources
    if (seed?.catalogCache !== undefined) this.catalogCache = seed.catalogCache
    if (seed?.npmRegistry !== undefined) this.npmRegistry = seed.npmRegistry
  }

  getSources(): readonly LocalSourceRecord[] {
    return this.sources
  }

  async setSources(records: readonly LocalSourceRecord[]): Promise<void> {
    this.sources = records
  }

  getCatalogCache(): MarketCatalogCache | undefined {
    return this.catalogCache
  }

  async setCatalogCache(cache: MarketCatalogCache): Promise<void> {
    this.catalogCache = cache
  }

  getNpmRegistry(): string {
    return this.npmRegistry
  }

  async setNpmRegistry(origin: string): Promise<void> {
    this.npmRegistry = origin
  }
}

/**
 * The store market's routes hold for their whole lifetime. Market mounts
 * before the storage domain is guaranteed to exist — and keeps running when it
 * never does — so the routes are handed this indirection once and it swaps its
 * delegate underneath them.
 *
 * Adoption is not a blind handover. A durable store that already holds a source
 * registry is authoritative and wins outright; the in-memory placeholder is
 * only flushed into a durable store that has never been written, which is the
 * first-run case where discarding it would silently lose a source the user just
 * added.
 */
export class DeferredMarketStateStore implements MarketStateStore {
  private delegate: MarketStateStore = new MemoryMarketStateStore()
  private durable = false

  /**
   * @param warn - receives one line whenever state is dropped or a durable
   * write is abandoned, so degradation is never silent.
   */
  constructor(private readonly warn: (message: string) => void = () => {}) {}

  getSources(): readonly LocalSourceRecord[] {
    return this.delegate.getSources()
  }

  async setSources(records: readonly LocalSourceRecord[]): Promise<void> {
    await this.delegate.setSources(records)
  }

  getCatalogCache(): MarketCatalogCache | undefined {
    return this.delegate.getCatalogCache()
  }

  async setCatalogCache(cache: MarketCatalogCache): Promise<void> {
    await this.delegate.setCatalogCache(cache)
  }

  getNpmRegistry(): string {
    return this.delegate.getNpmRegistry()
  }

  async setNpmRegistry(origin: string): Promise<void> {
    await this.delegate.setNpmRegistry(origin)
  }

  /** Whether writes currently reach a medium. */
  get isDurable(): boolean {
    return this.durable
  }

  /**
   * Switch to a durable store, reconciling whatever the placeholder collected
   * while the storage domain was still absent.
   * @param store - the durable store to delegate to from now on.
   */
  async adopt(store: MarketStateStore): Promise<void> {
    const pending = this.delegate.getSources()
    const pendingCache = this.delegate.getCatalogCache()
    const pendingRegistry = this.delegate.getNpmRegistry()
    if (!this.durable && pending.length > 0) {
      if (store.getSources().length === 0) {
        await store.setSources(pending)
        if (pendingCache !== undefined) await store.setCatalogCache(pendingCache)
      } else {
        this.warn(
          'dsh-community-market: durable storage already holds a source registry; '
          + `discarding ${pending.length} source(s) added before storage became available`,
        )
      }
    }
    if (!this.durable && pendingRegistry !== '' && store.getNpmRegistry() === '') {
      await store.setNpmRegistry(pendingRegistry)
    }
    this.delegate = store
    this.durable = true
  }

  /**
   * Stop writing to the durable store, keeping its last known contents readable
   * for the rest of the session. Called when the storage domain goes away.
   */
  release(): void {
    if (!this.durable) return
    const cache = this.delegate.getCatalogCache()
    const npmRegistry = this.delegate.getNpmRegistry()
    this.delegate = new MemoryMarketStateStore({
      sources: this.delegate.getSources(),
      ...(cache === undefined ? {} : { catalogCache: cache }),
      ...(npmRegistry === '' ? {} : { npmRegistry }),
    })
    this.durable = false
    this.warn('dsh-community-market: durable storage went away; market state is session-only from here on')
  }
}
