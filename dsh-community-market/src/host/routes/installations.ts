/** Installation routes: what the market can install, what is installed, update checks and switches. */

import {
  ROUTE_INSTALLABLE,
  ROUTE_INSTALLATION_ENABLED,
  ROUTE_INSTALLATION_UPDATE,
  ROUTE_INSTALLATIONS,
} from '../route-paths.js'
import { mutationAllowed, requestAllowed } from '../request-authority.js'
import { abortOnDisconnect, readOperationJson, sendInstallError, sendJson } from '../http.js'
import { MarketInstallError } from '../../install/service.js'
import type { CatalogFetchScope } from '../../catalog/service.js'
import { DSHFIND_ADAPTER_ID } from '../../adapters/dshfind.js'
import { isDsh1024StoreAdapterId } from '../../adapters/dsh-1024store.js'
import type { MarketCatalogMetadata, MarketCatalogSourceResult } from '../../api-types.js'
import { catalogMetadata } from '../catalog-responses.js'
import { asInstallationToggle, asUpdateCheckPackage } from '../request-validation.js'
import type { MarketRouteContext, MarketInstallServiceProvider } from './context.js'

/**
 * Register installation routes: what the market can install, what is installed, update checks and switches.
 * @param context - what every route group of one registration shares.
 * @param installProvider - the embedding Desktop's install service.
 * @returns the disposers of the registered routes.
 */
export function registerInstallationRoutes(context: MarketRouteContext, installProvider: MarketInstallServiceProvider): (() => void)[] {
  const { ctx, expectedPort, generationController, service } = context
  return [
    ctx.webServer.register({ kind: 'exact', path: ROUTE_INSTALLABLE, handler: async (req, res) => {
      if (req.method !== 'GET' || !requestAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'market installable catalog requires a local GET' })
        return
      }
      const install = installProvider.get()
      if (install === undefined) {
        sendJson(res, 503, { error: 'market package operations are unavailable' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost')
        const localeValues = requestUrl.searchParams.getAll('locale')
        const refreshValues = requestUrl.searchParams.getAll('refresh')
        const queryValues = requestUrl.searchParams.getAll('q')
        const sourceRecordIds = requestUrl.searchParams.getAll('sourceRecordId')
        const cursors = requestUrl.searchParams.getAll('cursor')
        const categories = requestUrl.searchParams.getAll('category')
        if (
          localeValues.length > 1
          || queryValues.length > 1
          || sourceRecordIds.length > 1
          || cursors.length > 1
          || cursors.length > sourceRecordIds.length
          || refreshValues.length > 1
          || refreshValues.length === 1 && refreshValues[0] !== '1'
        ) throw new MarketInstallError('invalid-request', 'The installable catalog query was invalid.')
        const force = refreshValues.length === 1
        const localeKey = localeValues[0] ?? ''
        const activeSource = (await service.listSources()).find(source => source.enabled)
        if (activeSource === undefined) {
          throw new MarketInstallError('not-available', 'No catalog source is active.')
        }
        if (sourceRecordIds[0] !== undefined && sourceRecordIds[0] !== activeSource.sourceRecordId) {
          throw new MarketInstallError('invalid-request', 'The installable catalog source is not active.')
        }
        const query = {
          limit: 200,
          ...(queryValues[0]?.trim() ? { q: queryValues[0].trim() } : {}),
          ...(categories.length === 0 ? {} : { category: categories }),
          ...(localeKey === '' ? {} : { locale: localeKey }),
        }
        const scope: CatalogFetchScope = {
          sourceRecordId: activeSource.sourceRecordId,
          ...(cursors[0] === undefined ? {} : { cursor: cursors[0] }),
        }
        const providerQuery = activeSource.adapterId === DSHFIND_ADAPTER_ID
          || isDsh1024StoreAdapterId(activeSource.adapterId)
        let results: readonly MarketCatalogSourceResult[]
        let metadata: MarketCatalogMetadata | undefined
        if (providerQuery) {
          results = await service.fetchProvider(query, signal, scope, { force })
        } else {
          const index = await service.scanCatalog(signal, {
            force,
            ...(localeKey === '' ? {} : { locale: localeKey }),
            expectedSourceRecordId: activeSource.sourceRecordId,
          })
          results = index === undefined ? [] : service.queryCatalog(index, query, scope)
          if (index !== undefined) metadata = catalogMetadata(index)
        }
        const result = results.find(value => value.source.sourceRecordId === activeSource.sourceRecordId)
        if (result?.snapshot === undefined || result.error !== undefined) {
          throw new MarketInstallError('not-available', 'The installable catalog page is unavailable.')
        }
        const response = install.listInstallablePage(
          result.source,
          result.snapshot,
          result.categories ?? [...new Set(result.snapshot.items.flatMap(item => item.categories ?? []))]
            .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })),
          signal,
          metadata,
        )
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, response)
      } catch (cause) {
        if (!signal.aborted && !res.destroyed) sendInstallError(res, cause)
      } finally {
        stopWatching()
      }
    }}),
    ctx.webServer.register({ kind: 'exact', path: ROUTE_INSTALLATIONS, handler: async (req, res) => {
      if (req.method !== 'GET' || !requestAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'market installations require a local GET' })
        return
      }
      const install = installProvider.get()
      if (install === undefined) {
        sendJson(res, 503, { error: 'market package operations are unavailable' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        const installations = await install.listInstallations(signal)
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, { installations })
      } catch (cause) {
        if (!signal.aborted && !res.destroyed) sendInstallError(res, cause)
      } finally {
        stopWatching()
      }
    }}),
    ctx.webServer.register({ kind: 'exact', path: ROUTE_INSTALLATION_UPDATE, handler: async (req, res) => {
      if (req.method !== 'GET' || !requestAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'market update checks require a local GET' })
        return
      }
      const install = installProvider.get()
      if (install === undefined) {
        sendJson(res, 503, { error: 'market package operations are unavailable' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        const packageName = asUpdateCheckPackage(req.url)
        const check = await install.checkUpdate(packageName, signal)
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, { packageName, check })
      } catch (cause) {
        if (!signal.aborted && !res.destroyed) sendInstallError(res, cause)
      } finally {
        stopWatching()
      }
    }}),
    ctx.webServer.register({ kind: 'exact', path: ROUTE_INSTALLATION_ENABLED, handler: async (req, res) => {
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'market plugin toggles require a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        const request = asInstallationToggle(await readOperationJson(req, signal))
        const install = installProvider.get()
        if (install === undefined) {
          throw new MarketInstallError('not-available', 'Market package operations are unavailable.')
        }
        // The selection write is Host-owned once accepted, like every package mutation.
        const result = await install.setEnabled(request.packageName, request.enabled, generationController.signal)
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, result)
      } catch (cause) {
        if (!signal.aborted && !res.destroyed) sendInstallError(res, cause)
      } finally {
        stopWatching()
      }
    }}),
  ]
}
