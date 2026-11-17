/** Catalog routes: catalog queries across enabled sources and their media assets. */

import { ROUTE_ASSETS, ROUTE_CATALOG } from '../route-paths.js'
import { requestAllowed } from '../request-authority.js'
import { abortOnDisconnect, sendCatalogFailure, sendJson } from '../http.js'
import type { CatalogFetchScope, CatalogFullIndex } from '../../catalog/service.js'
import { DSHFIND_ADAPTER_ID } from '../../adapters/dshfind.js'
import { isDsh1024StoreAdapterId } from '../../adapters/dsh-1024store.js'
import type { MarketCatalogResponse, MarketCatalogSourceResult } from '../../api-types.js'
import { cachedCatalogResponse, catalogManualInstall } from '../catalog-responses.js'
import { MARKET_MEDIA_ASSET_REF_PATTERN } from '../../media/ref.js'
import type { MarketRouteContext } from './context.js'

/**
 * Register catalog routes: catalog queries across enabled sources and their media assets.
 * @param context - what every route group of one registration shares.
 * @returns the disposers of the registered routes.
 */
export function registerCatalogRoutes(context: MarketRouteContext): (() => void)[] {
  const { ctx, state, expectedPort, generationController, media, service, servedCatalogPreviews, catalogPreviewKey, buildCatalogResponse, persistCatalogResponse } = context
  return [
    ctx.webServer.register({ kind: 'exact', path: ROUTE_CATALOG, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'market request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'market catalog requires GET' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      let refreshPreviewKey: string | undefined
      try {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost')
        const query: Record<string, unknown> = {}
        const q = requestUrl.searchParams.get('q')?.trim() || undefined
        if (q !== undefined) query.q = q
        const categories = requestUrl.searchParams.getAll('category')
        if (categories.length) query.category = categories
        const limit = Number(requestUrl.searchParams.get('limit') ?? 50)
        if (Number.isInteger(limit)) query.limit = limit
        const sort = requestUrl.searchParams.get('sort')
        if (sort) query.sort = sort
        const locale = requestUrl.searchParams.get('locale')
        if (locale) query.locale = locale
        const refreshValues = requestUrl.searchParams.getAll('refresh')
        if (refreshValues.length > 1 || refreshValues.length === 1 && refreshValues[0] !== '1') {
          throw new Error('invalid catalog refresh flag')
        }
        const force = refreshValues.length === 1

        const sourceRecordIds = requestUrl.searchParams.getAll('sourceRecordId')
        const cursors = requestUrl.searchParams.getAll('cursor')
        if (sourceRecordIds.length > 1 || cursors.length > 1 || cursors.length > sourceRecordIds.length) {
          throw new Error('catalog cursor requires exactly one source record')
        }
        const scope: CatalogFetchScope | undefined = sourceRecordIds.length === 0
          ? undefined
          : {
              sourceRecordId: sourceRecordIds[0]!,
              ...(cursors.length === 0 ? {} : { cursor: cursors[0]! }),
            }
        const activeSource = (await service.listSources()).find(source => source.enabled)
        if (scope !== undefined && activeSource?.sourceRecordId !== scope.sourceRecordId) {
          throw new Error('catalog source is not active')
        }
        const providerQuery = activeSource?.adapterId === DSHFIND_ADAPTER_ID
          || isDsh1024StoreAdapterId(activeSource?.adapterId)
        if (providerQuery) {
          let results: readonly MarketCatalogSourceResult[]
          try {
            results = await service.fetchProvider(query, signal, scope, { force })
          } catch (cause) {
            if (!signal.aborted && !res.destroyed) sendCatalogFailure(res, cause)
            return
          }
          signal.throwIfAborted()
          const responseQuery = scope === undefined
            ? query
            : {
                ...query,
                sourceRecordId: scope.sourceRecordId,
                ...(scope.cursor === undefined ? {} : { cursor: scope.cursor }),
              }
          const response: MarketCatalogResponse = {
            query: responseQuery,
            results,
            categories: [...new Set(results.flatMap(result => (
              result.categories
                ?? result.snapshot?.items.flatMap(item => item.categories ?? [])
                ?? []
            )))].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })),
            manualInstall: catalogManualInstall(results),
            fetchedAt: new Date().toISOString(),
          }
          if (!signal.aborted && !res.destroyed) sendJson(res, 200, response)
          return
        }
        const localeKey = locale ?? ''
        const previewSourceRecordId = q === undefined
          && categories.length === 0
          && sort === null
          && limit === 50
          && scope !== undefined
          && scope.cursor === undefined
          ? scope.sourceRecordId
          : undefined
        const previewKey = previewSourceRecordId === undefined
          ? undefined
          : catalogPreviewKey(previewSourceRecordId, localeKey)
        if (force) refreshPreviewKey = previewKey
        if (!force && previewKey !== undefined && !servedCatalogPreviews.has(previewKey)) {
          const cached = activeSource === undefined
            ? undefined
            : cachedCatalogResponse(state.getCatalogCache(), activeSource, localeKey)
          if (cached !== undefined) {
            servedCatalogPreviews.add(previewKey)
            if (!signal.aborted && !res.destroyed) sendJson(res, 200, cached)
            return
          }
        }
        let index: CatalogFullIndex | undefined
        try {
          index = await service.scanCatalog(signal, {
            force,
            ...(locale === null || locale === '' ? {} : { locale }),
            ...(scope === undefined ? {} : { expectedSourceRecordId: scope.sourceRecordId }),
          })
        } catch (cause) {
          if (!signal.aborted && !res.destroyed) sendCatalogFailure(res, cause)
          return
        }
        signal.throwIfAborted()
        const response = buildCatalogResponse(index, query, scope)
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, response)
        if (previewKey !== undefined && previewSourceRecordId !== undefined
          && index !== undefined && !generationController.signal.aborted) {
          servedCatalogPreviews.add(previewKey)
          void persistCatalogResponse(response, previewSourceRecordId, localeKey)
        }
      } catch {
        if (refreshPreviewKey !== undefined) servedCatalogPreviews.delete(refreshPreviewKey)
        if (!signal.aborted && !res.destroyed) sendJson(res, 400, { error: 'invalid catalog query' })
      } finally {
        stopWatching()
      }
    }}),
    ctx.webServer.register({ kind: 'exact', path: ROUTE_ASSETS, handler: async (req, res) => {
      if (!requestAllowed(req, expectedPort)) {
        sendJson(res, 403, { error: 'market request authority rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'market media requires GET' })
        return
      }
      const requestUrl = new URL(req.url ?? '/', 'http://localhost')
      const refs = requestUrl.searchParams.getAll('ref')
      const assetRef = refs.length === 1 ? refs[0] : undefined
      if (assetRef === undefined || !MARKET_MEDIA_ASSET_REF_PATTERN.test(assetRef)) {
        sendJson(res, 404, { error: 'market media unavailable' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        const asset = await media.resolve(assetRef, signal)
        if (signal.aborted || res.destroyed) return
        if (asset === undefined) {
          sendJson(res, 404, { error: 'market media unavailable' })
          return
        }
        res.setHeader('cache-control', 'private, max-age=3600')
        res.setHeader('content-type', asset.contentType)
        res.setHeader('content-length', String(asset.body.byteLength))
        res.setHeader('content-disposition', 'inline')
        res.setHeader('etag', asset.etag)
        res.setHeader('x-content-type-options', 'nosniff')
        res.setHeader('cross-origin-resource-policy', 'same-origin')
        res.setHeader('content-security-policy', "default-src 'none'; sandbox")
        res.setHeader('referrer-policy', 'no-referrer')
        if (req.headers['if-none-match'] === asset.etag) {
          res.statusCode = 304
          res.removeHeader('content-length')
          res.end()
          return
        }
        res.statusCode = 200
        res.end(asset.body)
      } catch {
        if (!signal.aborted && !res.destroyed) sendJson(res, 404, { error: 'market media unavailable' })
      } finally {
        stopWatching()
      }
    }}),
  ]
}
