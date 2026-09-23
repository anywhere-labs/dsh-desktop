/** Keep upstream HTTP routing while requiring Host credentials for Market routes. */
import WebServer, { type WebRoute, type WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { decideDesktopBrowserAccess, nextBrowserAccess } from './desktop-browser-access.ts'
import type { Duplex } from 'node:stream'

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

  override register(route: WebRoute): () => void {
    return super.register({ ...route, handler: async (request, response) => {
      if (!this.permits(request)) { response.writeHead(403, { 'cache-control': 'no-store' }); response.end('Browser access is disabled'); return }
      if (route.path !== '/api/community-market' && !route.path.startsWith('/api/community-market/')) {
        await route.handler(request, response); return
      }
      const connection = this.ctx.get('connection')
      const rejection = connection === undefined ? 503 : connection.requestRejection(request)
      if (rejection !== undefined) {
        response.writeHead(rejection, { 'cache-control': 'no-store' })
        response.end('Market request authentication required')
        return
      }
      await route.handler(request, response)
    } })
  }

  override registerFallback(handler: WebRoute['handler']): () => void {
    return super.registerFallback(async (request, response) => {
      if (!this.permits(request)) { response.writeHead(403, { 'cache-control': 'no-store' }); response.end('Browser access is disabled'); return }
      await handler(request, response)
    })
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    return super.registerUpgrade({ ...route, handler: (request, socket, head) => {
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
