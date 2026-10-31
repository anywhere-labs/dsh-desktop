/** Keep upstream HTTP routing while requiring Host credentials for Market routes. */
import { hostLog, hostOperation } from './host/logging.ts'
import WebServer, { type WebRoute, type WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { decideDesktopBrowserAccess, nextBrowserAccess } from './desktop-browser-access.ts'
import { wrapFallback, wrapRegistration, type ResponderWrappers, type WebFallback, type WebRegistration } from './upstream-family.ts'
import type { Duplex } from 'node:stream'

const MARKET_ROUTE = '/api/community-market'
const isMarketRoute = (path: string): boolean => path === MARKET_ROUTE || path.startsWith(`${MARKET_ROUTE}/`)

export default class NextWebServer extends WebServer {
  static override Config = WebServer.Config
  private readonly browserSockets = new Set<Duplex>()

  /** Revoke existing browser streams as well as new requests; native streams stay alive. */
  setBrowserAccess(enabled: boolean): void {
    const access = nextBrowserAccess()
    if (!access) throw new Error('Native browser-access policy is unavailable')
    access.setOrdinaryBrowserEnabled(enabled)
    if (!enabled) {
      for (const socket of this.browserSockets) socket.destroy()
      this.browserSockets.clear()
    }
  }

  private permits(request: Parameters<WebRoute['handler']>[0]): boolean {
    const access = nextBrowserAccess()
    return !access || decideDesktopBrowserAccess(access, request) !== 'denied'
  }

  /** The same decision for a Fetch request, which carries the client's headers but no socket. */
  private permitsFetch(request: Request): boolean {
    const access = nextBrowserAccess()
    return !access || decideDesktopBrowserAccess(access, { headers: Object.fromEntries(request.headers), url: request.url }) !== 'denied'
  }

  override register(route: WebRegistration): () => void {
    return super.register(wrapRegistration(route, this.policy(route.path)))
  }

  override registerFallback(fallback: WebFallback): () => void {
    return super.registerFallback(wrapFallback(fallback, this.policy('fallback')))
  }

  private policy(route: string): ResponderWrappers {
    return {
      handler: inner => this.observeHttp(route, async (request, response) => {
        if (!this.permits(request)) { response.writeHead(403, { 'cache-control': 'no-store' }); response.end('Browser access is disabled'); return }
        if (!isMarketRoute(route)) {
          await inner(request, response); return
        }
        const connection = this.ctx.get('connection')
        const rejection = connection === undefined ? 503 : connection.requestRejection(request)
        if (rejection !== undefined) {
          response.writeHead(rejection, { 'cache-control': 'no-store' })
          response.end('Market request authentication required')
          return
        }
        await inner(request, response)
      }),
      resource: (inner) => {
        // Market credentials are checked on the request socket, which only a handler sees.
        if (isMarketRoute(route)) throw new Error(`Market route ${route} must be a handler`)
        return async (request, peer) => {
          const end = hostOperation('host.http', 'request', { route, method: request.method }, true)
          try {
            // An HTTP request arrives without a Peer; an in-process read was admitted by its caller.
            if (peer === undefined && !this.permitsFetch(request)) {
              end(undefined, { status: 403 })
              return new Response('Browser access is disabled', { status: 403, headers: { 'cache-control': 'no-store' } })
            }
            const response = await inner(request, peer)
            end(undefined, { status: response.status })
            return response
          } catch (error) { end(error); throw error }
        }
      },
    }
  }

  private observeHttp(route: string, handler: WebRoute['handler']): WebRoute['handler'] {
    return async (request, response) => {
      const end = hostOperation('host.http', 'request', { route, method: request.method ?? '' }, true)
      const finish = () => { end(undefined, { status: response.statusCode, aborted: !response.writableFinished }); response.off('finish', finish); response.off('close', finish) }
      response.once('finish', finish); response.once('close', finish)
      try { await handler(request, response) } catch (error) { response.off('finish', finish); response.off('close', finish); end(error); throw error }
    }
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    return super.registerUpgrade({ ...route, handler: (request, socket, head) => {
      hostLog({ source: 'host.http', event: 'upgrade', fields: { route: route.path }, developer: true })
      if (!this.permits(request)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return }
      const access = nextBrowserAccess()
      if (access && decideDesktopBrowserAccess(access, request) === 'browser') {
        this.browserSockets.add(socket)
        socket.once('close', () => this.browserSockets.delete(socket))
      }
      return route.handler(request, socket, head)
    } })
  }
}
