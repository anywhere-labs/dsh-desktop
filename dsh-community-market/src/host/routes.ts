/** The market's Host routes: one registration composes the route groups over shared services and one lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import type { MarketCatalogResponse } from '../api-types.js'
import { restrictedHttpClient } from '../network/restricted-http.js'
import {
  DSH_1024STORE_ADAPTER_ID,
  DSH_1024STORE_HOSTNAME,
  DSH_1024STORE_LEGACY_ADAPTER_ID,
} from '../adapters/dsh-1024store.js'
import { DSHFIND_ADAPTER_ID } from '../adapters/dshfind.js'
import { type CatalogFetchScope, type CatalogFullIndex, DefaultCatalogService } from '../catalog/service.js'
import { PersistentCatalogSourceStore } from '../catalog/source-store.js'
import type { MarketStateStore } from '../catalog/state-store.js'
import { createRestrictedImageFetcher } from '../media/restricted-image.js'
import { createMarketMediaService } from '../media/service.js'
import { dsh1024StoreHttpClient, dshfindHttpClient } from './catalog-clients.js'
import { createMarketSourceMutator } from './source-mutations.js'
import { catalogCacheFromResponse, catalogCategories, catalogManualInstall, catalogMetadata } from './catalog-responses.js'
import {
  ROUTE_ASSETS,
  ROUTE_CATALOG,
  ROUTE_INSTALLABLE,
  ROUTE_INSTALLATION_ENABLED,
  ROUTE_INSTALLATION_UPDATE,
  ROUTE_INSTALLATIONS,
  ROUTE_OPEN_TERMINAL,
  ROUTE_OPERATION_EXECUTE,
  ROUTE_OPERATION_PREVIEW,
  ROUTE_SOURCES,
  ROUTE_STATE,
} from './route-paths.js'
import type { MarketDesktopActionsProvider, MarketInstallServiceProvider, MarketRouteContext } from './routes/context.js'
import { registerCatalogRoutes } from './routes/catalog.js'
import { registerDesktopActionRoutes } from './routes/desktop-actions.js'
import { registerInstallationRoutes } from './routes/installations.js'
import { registerOperationRoutes } from './routes/operations.js'
import { registerSourceRoutes } from './routes/sources.js'

export { marketMutationAllowed, marketRequestAllowed, type MarketRequestContext } from './request-authority.js'

export { createMarketSourceMutator, readStandardSourceManifest } from './source-mutations.js'

export type { MarketDesktopActions, MarketDesktopActionsProvider, MarketInstallServiceProvider } from './routes/context.js'

export function registerMarketRoutes(
  ctx: Context,
  state: MarketStateStore,
  installProvider?: MarketInstallServiceProvider,
  desktopActionsProvider?: MarketDesktopActionsProvider,
): () => void {
  const expectedPort = ctx.webServer.port
  const generationController = new AbortController()
  const store = new PersistentCatalogSourceStore(state)
  const media = createMarketMediaService({
    fetchImage: createRestrictedImageFetcher({
      // These are compiled-in adapter hosts, not names supplied by a remote source.
      syntheticProxyHostnames: [
        DSH_1024STORE_HOSTNAME,
        'github.com',
        'avatars.githubusercontent.com',
      ],
    }),
  })
  const service = new DefaultCatalogService(store, restrictedHttpClient, {
    adapterHttpClients: new Map([
      [DSH_1024STORE_ADAPTER_ID, dsh1024StoreHttpClient],
      [DSH_1024STORE_LEGACY_ADAPTER_ID, dsh1024StoreHttpClient],
      [DSHFIND_ADAPTER_ID, dshfindHttpClient],
    ]),
    media,
    observeSnapshot: snapshot => installProvider?.get()?.observeCatalog(snapshot),
  })
  const servedCatalogPreviews = new Set<string>()
  const catalogPreviewKey = (sourceRecordId: string, locale: string) => `${sourceRecordId}\0${locale}`
  const mutateSource = createMarketSourceMutator(state, sourceRecordId => {
    service.invalidateSource(sourceRecordId)
    for (const key of servedCatalogPreviews) {
      if (key.startsWith(`${sourceRecordId}\0`)) servedCatalogPreviews.delete(key)
    }
    installProvider?.get()?.invalidateSource(sourceRecordId)
  })
  const buildCatalogResponse = (
    index: CatalogFullIndex | undefined,
    query: Record<string, unknown>,
    fetchScope: CatalogFetchScope | undefined,
  ): MarketCatalogResponse => {
    const results = index === undefined ? [] : service.queryCatalog(index, query, fetchScope)
    const responseQuery = fetchScope === undefined
      ? query
      : {
          ...query,
          sourceRecordId: fetchScope.sourceRecordId,
          ...(fetchScope.cursor === undefined ? {} : { cursor: fetchScope.cursor }),
        }
    return {
      query: responseQuery,
      results,
      categories: index === undefined ? [] : catalogCategories(index),
      manualInstall: catalogManualInstall(results),
      ...(index === undefined ? {} : { metadata: catalogMetadata(index) }),
      fetchedAt: new Date().toISOString(),
    }
  }
  const persistCatalogResponse = async (
    response: MarketCatalogResponse,
    sourceRecordId: string,
    locale: string,
  ): Promise<void> => {
    const cache = catalogCacheFromResponse(response, sourceRecordId, locale)
    if (cache === undefined) return
    try {
      await state.setCatalogCache(cache)
    } catch (cause) {
      // Catalog browsing already succeeded; a failed cache write must not
      // escalate into an unhandled rejection that terminates the host.
      ctx.logger.error(`dsh-community-market: failed to persist the catalog cache: ${
        cause instanceof Error ? cause.message : String(cause)
      }`)
    }
  }
  const context: MarketRouteContext = {
    ctx,
    state,
    expectedPort,
    generationController,
    media,
    service,
    servedCatalogPreviews,
    catalogPreviewKey,
    mutateSource,
    buildCatalogResponse,
    persistCatalogResponse,
    desktopActionsProvider,
  }
  const routes = [...registerSourceRoutes(context), ...registerCatalogRoutes(context)]
  if (desktopActionsProvider !== undefined) routes.push(...registerDesktopActionRoutes(context, desktopActionsProvider))
  if (installProvider !== undefined) {
    routes.push(...registerInstallationRoutes(context, installProvider), ...registerOperationRoutes(context, installProvider))
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    generationController.abort(new DOMException('Market plugin generation was disposed', 'AbortError'))
    media.dispose()
    routes.forEach(dispose => dispose())
  }
}

export const marketRoutes = {
  state: ROUTE_STATE,
  sources: ROUTE_SOURCES,
  catalog: ROUTE_CATALOG,
  installable: ROUTE_INSTALLABLE,
  assets: ROUTE_ASSETS,
  installations: ROUTE_INSTALLATIONS,
  installationEnabled: ROUTE_INSTALLATION_ENABLED,
  installationUpdate: ROUTE_INSTALLATION_UPDATE,
  openTerminal: ROUTE_OPEN_TERMINAL,
  operationPreview: ROUTE_OPERATION_PREVIEW,
  operationExecute: ROUTE_OPERATION_EXECUTE,
}
