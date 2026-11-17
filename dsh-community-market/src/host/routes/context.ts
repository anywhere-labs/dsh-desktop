/** What the market's route groups share within one registration, and the services the embedding Desktop provides. */
import type { Context } from '@deepseek-ai/cordis'
import type { MarketCatalogResponse } from '../../api-types.js'
import type { CatalogFetchScope, CatalogFullIndex, DefaultCatalogService } from '../../catalog/service.js'
import type { MarketStateStore } from '../../catalog/state-store.js'
import type { MarketInstallService } from '../../install/service.js'
import type { MarketMediaService } from '../../media/types.js'
import type { createMarketSourceMutator } from '../source-mutations.js'

export interface MarketInstallServiceProvider {
  get(): MarketInstallService | undefined
}

export interface MarketDesktopActions {
  openTerminal?(): void
}

export interface MarketDesktopActionsProvider {
  get(): MarketDesktopActions | undefined
}

/** One registration of the market routes: its services, its lifetime and the catalog response it builds. */
export interface MarketRouteContext {
  readonly ctx: Context
  readonly state: MarketStateStore
  /** The Web server port that requests must name; undefined before it listens. */
  readonly expectedPort: number | undefined
  /** Aborted when this registration is disposed; every request in flight observes it. */
  readonly generationController: AbortController
  readonly media: MarketMediaService
  readonly service: DefaultCatalogService
  /** Catalog previews already answered from the persisted cache, keyed by `catalogPreviewKey`. */
  readonly servedCatalogPreviews: Set<string>
  readonly catalogPreviewKey: (sourceRecordId: string, locale: string) => string
  readonly mutateSource: ReturnType<typeof createMarketSourceMutator>
  readonly buildCatalogResponse: (
    index: CatalogFullIndex | undefined,
    query: Record<string, unknown>,
    fetchScope: CatalogFetchScope | undefined,
  ) => MarketCatalogResponse
  readonly persistCatalogResponse: (response: MarketCatalogResponse, sourceRecordId: string, locale: string) => Promise<void>
  readonly desktopActionsProvider: MarketDesktopActionsProvider | undefined
}
