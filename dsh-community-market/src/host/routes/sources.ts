/** Source routes: the market state and changes to the configured catalog sources. */

import { ROUTE_SOURCES, ROUTE_STATE } from '../route-paths.js'
import { mutationAllowed, requestAllowed } from '../request-authority.js'
import { abortOnDisconnect, readJson, sendJson } from '../http.js'
import type { MarketStateResponse } from '../../api-types.js'
import { viewBuiltIns } from '../source-mutations.js'
import { asMutation } from '../request-validation.js'
import type { MarketRouteContext } from './context.js'

/**
 * Register source routes: the market state and changes to the configured catalog sources.
 * @param context - what every route group of one registration shares.
 * @returns the disposers of the registered routes.
 */
export function registerSourceRoutes(context: MarketRouteContext): (() => void)[] {
  const { ctx, expectedPort, generationController, service, mutateSource, desktopActionsProvider } = context
  return [
    ctx.webServer.register({ kind: 'exact', path: ROUTE_STATE, handler: async (_req, res) => {
      if (generationController.signal.aborted) return
      if (!requestAllowed(_req, expectedPort)) {
        sendJson(res, 403, { error: 'market request authority rejected' })
        return
      }
      try {
        const desktopActions = desktopActionsProvider?.get()
        const response: MarketStateResponse = {
          sources: await service.listSources(),
          builtIns: viewBuiltIns(),
          desktopActions: {
            openTerminal: typeof desktopActions?.openTerminal === 'function',
          },
        }
        if (!generationController.signal.aborted && !res.destroyed) sendJson(res, 200, response)
      } catch {
        if (!generationController.signal.aborted && !res.destroyed) sendJson(res, 500, { error: 'market state unavailable' })
      }
    }}),
    ctx.webServer.register({ kind: 'exact', path: ROUTE_SOURCES, handler: async (req, res) => {
      if (req.method !== 'POST' || !mutationAllowed(req, expectedPort)) {
        sendJson(res, 405, { error: 'source changes require a local same-origin POST' })
        return
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, generationController.signal])
      const stopWatching = abortOnDisconnect(req, res, controller)
      try {
        const mutation = asMutation(await readJson(req, signal))
        await mutateSource(mutation, signal)
        if (!signal.aborted && !res.destroyed) sendJson(res, 200, { sources: await service.listSources() })
      } catch (cause) {
        if (!signal.aborted && !res.destroyed) {
          sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'source change failed' })
        }
      } finally {
        stopWatching()
      }
    }}),
  ]
}
