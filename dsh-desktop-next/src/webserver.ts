/** Keep upstream HTTP routing while requiring Host credentials for Market routes. */
import { hostLog, hostOperation } from './host/logging.ts'
import WebServer, { type Config, type WebRoute, type WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { expireSurplusSessions, surplusSessionExpiries } from './browser-sessions.ts'
import { decideDesktopBrowserAccess, nextBrowserAccess } from './desktop-browser-access.ts'
import { requestRejection, wrapFallback, wrapRegistration, type ResponderWrappers, type WebFallback, type WebRegistration } from './upstream-family.ts'
import type { Duplex } from 'node:stream'

const MARKET_ROUTE = '/api/community-market'
const isMarketRoute = (path: string): boolean => path === MARKET_ROUTE || path.startsWith(`${MARKET_ROUTE}/`)

/** Maximum number of sequential ports tried after a bind collision or a Windows-reserved port. */
const DESKTOP_WEB_PORT_RETRY_LIMIT = 32

/**
 * Bind failures that mean "this port is unavailable", not "binding is broken".
 * Windows reports ports inside Hyper-V/WinNAT excluded ranges as `EACCES` even
 * though no process owns them (`netsh interface ipv4 show excludedportrange`).
 */
function isPortUnavailable(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | null)?.code
  return code === 'EADDRINUSE' || code === 'EACCES'
}

/** Close an unbound server left behind by a failed listen attempt. */
function closeFailedServer(instance: unknown): void {
  const server = (instance as { server?: { close?: (callback?: (error?: Error) => void) => void } } | null)?.server
  if (typeof server?.close !== 'function') return
  try {
    server.close(() => {})
  } catch {
    // The failed server is already unbound; preserve the original bind error.
  }
}

export default class NextWebServer extends WebServer {
  static override Config = WebServer.Config
  private readonly browserSockets = new Set<Duplex>()
  /** The same config object the upstream base class stores as its private `config`. */
  private readonly serverConfig: Config

  constructor(ctx: ConstructorParameters<typeof WebServer>[0], config: Config) {
    super(ctx, config)
    this.serverConfig = config
  }

  /**
   * Bounded bind retry, ported from Stable's `DesktopWebServer` (#1774): the upstream
   * server fails its fiber on the first `EADDRINUSE`, and Windows reports ports inside
   * Hyper-V/WinNAT excluded ranges as `EACCES`, so a fixed port would otherwise send
   * every start into recovery mode. The upstream `origin` reads the bound
   * `listenedPort`, so retried and OS-assigned ports reach the Desktop through
   * `ready.url` unchanged.
   */
  override async [Service.init](): Promise<void> {
    const requestedPort = this.serverConfig.port
    if (requestedPort === 0) {
      await super[Service.init]()
      return
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        await super[Service.init]()
        return
      } catch (cause) {
        if (!isPortUnavailable(cause)) throw cause
        closeFailedServer(this)
        const nextPort = requestedPort + attempt + 1
        if (attempt >= DESKTOP_WEB_PORT_RETRY_LIMIT || nextPort > 65_535) {
          // A Windows excluded range is usually wider than the sequential
          // window, so finish with one OS-assigned port instead of failing
          // startup; the Desktop reads the bound port from `ready.url` either way.
          this.serverConfig.port = 0
          await super[Service.init]()
          return
        }
        this.serverConfig.port = nextPort
      }
    }
  }

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
      // Every responder argument passes through: the Web server may hand a handler the Peer it admitted.
      handler: inner => this.observeHttp(route, async (...args) => {
        const [request, response] = args
        if (!this.permits(request)) { response.writeHead(403, { 'cache-control': 'no-store' }); response.end('Browser access is disabled'); return }
        // A token exchange's own writeHead replaces these; the request its redirect causes expires them instead.
        const expiries = surplusSessionExpiries(request.headers.cookie, request.headers.host)
        if (expiries.length > 0) response.setHeader('set-cookie', expiries)
        if (!isMarketRoute(route)) {
          await inner(...args); return
        }
        const connection = this.ctx.get('connection')
        const rejection = connection === undefined ? 503 : requestRejection(connection, args)
        if (rejection !== undefined) {
          response.writeHead(rejection, { 'cache-control': 'no-store' })
          response.end('Market request authentication required')
          return
        }
        await inner(...args)
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
            return peer === undefined ? expireSurplusSessions(request, response) : response
          } catch (error) { end(error); throw error }
        }
      },
    }
  }

  private observeHttp(route: string, handler: WebRoute['handler']): WebRoute['handler'] {
    return async (...args) => {
      const [request, response] = args
      const end = hostOperation('host.http', 'request', { route, method: request.method ?? '' }, true)
      const finish = () => { end(undefined, { status: response.statusCode, aborted: !response.writableFinished }); response.off('finish', finish); response.off('close', finish) }
      response.once('finish', finish); response.once('close', finish)
      try { await handler(...args) } catch (error) { response.off('finish', finish); response.off('close', finish); end(error); throw error }
    }
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    return super.registerUpgrade({ ...route, handler: (...args) => {
      const [request, socket] = args
      hostLog({ source: 'host.http', event: 'upgrade', fields: { route: route.path }, developer: true })
      if (!this.permits(request)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return }
      const access = nextBrowserAccess()
      if (access && decideDesktopBrowserAccess(access, request) === 'browser') {
        this.browserSockets.add(socket)
        socket.once('close', () => this.browserSockets.delete(socket))
      }
      return route.handler(...args)
    } })
  }
}
