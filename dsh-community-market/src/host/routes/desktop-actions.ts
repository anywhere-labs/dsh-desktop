/** Desktop action routes, registered only when the embedding Desktop offers them. */

import { ROUTE_OPEN_TERMINAL } from '../route-paths.js'
import { mutationAllowed } from '../request-authority.js'
import { abortOnDisconnect, readOperationJson, sendInstallError, sendJson } from '../http.js'
import { asEmptyDesktopAction } from '../request-validation.js'
import type { MarketRouteContext, MarketDesktopActionsProvider } from './context.js'

/**
 * Register desktop action routes, registered only when the embedding Desktop offers them.
 * @param context - what every route group of one registration shares.
 * @param desktopActionsProvider - the embedding Desktop's actions.
 * @returns the disposers of the registered routes.
 */
export function registerDesktopActionRoutes(context: MarketRouteContext, desktopActionsProvider: MarketDesktopActionsProvider): (() => void)[] {
  const { ctx, expectedPort, generationController } = context
  return [
    ctx.webServer.register({ kind: 'exact', path: ROUTE_OPEN_TERMINAL, handler: async (req, res) => {
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'opening DSH Terminal requires a local same-origin POST' })
        return
      }
      const actions = desktopActionsProvider.get()
      if (actions?.openTerminal === undefined) {
        sendJson(res, 503, { error: 'desktop actions are unavailable' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        asEmptyDesktopAction(await readOperationJson(req, signal))
        signal.throwIfAborted()
        actions.openTerminal()
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, { ok: true })
      } catch (cause) {
        if (!signal.aborted && !res.destroyed) sendInstallError(res, cause)
      } finally {
        stopWatching()
      }
    }}),
  ]
}
