/** Operation routes: previewing and executing an install, update or uninstall. */

import { ROUTE_OPERATION_EXECUTE, ROUTE_OPERATION_PREVIEW } from '../route-paths.js'
import { mutationAllowed } from '../request-authority.js'
import { abortOnDisconnect, readOperationJson, sendInstallError, sendJson } from '../http.js'
import { asOperationExecute, asOperationPreview } from '../request-validation.js'
import { MarketInstallError } from '../../install/service.js'
import type { MarketRouteContext, MarketInstallServiceProvider } from './context.js'

/**
 * Register operation routes: previewing and executing an install, update or uninstall.
 * @param context - what every route group of one registration shares.
 * @param installProvider - the embedding Desktop's install service.
 * @returns the disposers of the registered routes.
 */
export function registerOperationRoutes(context: MarketRouteContext, installProvider: MarketInstallServiceProvider): (() => void)[] {
  const { ctx, expectedPort, generationController } = context
  return [
    ctx.webServer.register({ kind: 'exact', path: ROUTE_OPERATION_PREVIEW, handler: async (req, res) => {
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'market package previews require a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        const request = asOperationPreview(await readOperationJson(req, signal))
        const install = installProvider.get()
        if (install === undefined) {
          throw new MarketInstallError('not-available', 'Market package operations are unavailable.')
        }
        const preview = request.action === 'install'
          ? await install.previewInstall(request.sourceRecordId, request.itemId, signal)
          : request.action === 'uninstall'
            ? await install.previewUninstallPackage(request.packageName, signal)
            : await install.previewUpdatePackage(request.packageName, signal)
        const { intent, ...summary } = preview
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, { ...summary, previewId: intent })
      } catch (cause) {
        if (!signal.aborted && !res.destroyed) sendInstallError(res, cause)
      } finally {
        stopWatching()
      }
    }}),
    ctx.webServer.register({ kind: 'exact', path: ROUTE_OPERATION_EXECUTE, handler: async (req, res) => {
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'market package execution requires a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        const previewId = asOperationExecute(await readOperationJson(req, signal))
        const install = installProvider.get()
        if (install === undefined) {
          throw new MarketInstallError('not-available', 'Market package operations are unavailable.')
        }
        // Once accepted, the Host owns the profile mutation even if the
        // renderer closes before receiving the response.
        const result = await install.executePreview(previewId, generationController.signal)
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, result)
      } catch (cause) {
        if (!signal.aborted && !res.destroyed) sendInstallError(res, cause)
      } finally {
        stopWatching()
      }
    }}),
  ]
}
