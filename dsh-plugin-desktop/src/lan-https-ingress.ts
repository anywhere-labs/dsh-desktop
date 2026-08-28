/** Hot-swappable HTTPS/WSS edge for the loopback-only upstream WebServer. */

import { request as requestHttp, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { isIPv4, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { DESKTOP_RENDERER_ACCESS_HEADER } from './desktop-browser-access.ts'

const EDGE_HOST = '0.0.0.0'
const TARGET_HOST = '127.0.0.1'
const FORBIDDEN_REQUEST_HEADER = DESKTOP_RENDERER_ACCESS_HEADER.toLowerCase()

export type LanHttpsIngressState = 'inactive' | 'starting' | 'ready' | 'failed'

export interface LanHttpsIngressOptions {
  /** Loopback HTTP port owned by the upstream DSH WebServer. */
  readonly targetPort: number
  /** Public HTTPS port, or zero to let the operating system choose one. */
  readonly requestedPort: number
  readonly key: string | Buffer
  readonly cert: string | Buffer
  /** Stable identity of the CA shown by the Desktop trust flow. */
  readonly caFingerprint: string
  /** Startup-sampled LAN IPv4 literals accepted in the external Host header. */
  readonly allowedAddresses: readonly string[]
}

export interface LanHttpsIngressSnapshot {
  readonly state: LanHttpsIngressState
  readonly actualPort: number | null
  readonly addresses: readonly string[]
  readonly caFingerprint: string
  readonly errorCode: string | null
}

function exactPort(value: number, allowZero: boolean, label: string): number {
  const minimum = allowZero ? 0 : 1
  if (!Number.isSafeInteger(value) || value < minimum || value > 65_535) {
    throw new TypeError(`dsh-plugin-desktop: ${label} must be an integer from ${String(minimum)} through 65535`)
  }
  return value
}

function canonicalIpv4(value: string): string {
  if (!isIPv4(value)) {
    throw new TypeError(`dsh-plugin-desktop: invalid LAN HTTPS IPv4 address ${JSON.stringify(value)}`)
  }
  const canonical = value.split('.').map(part => String(Number(part))).join('.')
  if (canonical !== value) {
    throw new TypeError(`dsh-plugin-desktop: LAN HTTPS IPv4 address must be canonical: ${JSON.stringify(value)}`)
  }
  return canonical
}

function normalizeAddresses(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.map(canonicalIpv4))].sort((left, right) => left.localeCompare(right)))
}

function copyTlsValue(value: string | Buffer, label: string): string | Buffer {
  if ((typeof value === 'string' && value.length === 0) || (Buffer.isBuffer(value) && value.length === 0)) {
    throw new TypeError(`dsh-plugin-desktop: LAN HTTPS ${label} must not be empty`)
  }
  return Buffer.isBuffer(value) ? Buffer.from(value) : value
}

function errorCode(cause: unknown): string {
  const code = (cause as NodeJS.ErrnoException | null)?.code
  if (typeof code === 'string' && code.length > 0) return code
  if (cause instanceof Error && cause.name.length > 0) return cause.name
  return 'UNKNOWN'
}

function externalHost(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers.host
  if (typeof raw !== 'string') return undefined
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/u.exec(raw)
  if (match === null) return undefined
  const address = match[1]
  if (address === undefined || !isIPv4(address)) return undefined
  if (address.split('.').map(part => String(Number(part))).join('.') !== address) return undefined
  const port = match[2]
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535 || String(Number(port)) !== port)) return undefined
  return address
}

function isCrossSite(headers: IncomingHttpHeaders): boolean {
  const raw = headers['sec-fetch-site']
  const values: readonly string[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  return values.some(value => value
    .split(',')
    .some(item => item.trim().toLowerCase() === 'cross-site'))
}

function permits(headers: IncomingHttpHeaders, allowedAddresses: ReadonlySet<string>): boolean {
  const host = externalHost(headers)
  return host !== undefined && allowedAddresses.has(host) && !isCrossSite(headers)
}

function isForwardingIdentityHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === FORBIDDEN_REQUEST_HEADER || lower === 'forwarded' || lower.startsWith('x-forwarded-')
}

function sanitizedHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const sanitized: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!isForwardingIdentityHeader(name) && value !== undefined) sanitized[name] = value
  }
  return sanitized
}

function reject(res: ServerResponse, statusCode: 403 | 502, body: 'forbidden' | 'bad gateway'): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

function rejectUpgrade(socket: Duplex, statusCode: 403 | 502, reason: 'Forbidden' | 'Bad Gateway', body: 'forbidden' | 'bad gateway'): void {
  socket.end([
    `HTTP/1.1 ${String(statusCode)} ${reason}`,
    'Connection: close',
    'Cache-Control: no-store',
    'Content-Type: text/plain; charset=utf-8',
    'X-Content-Type-Options: nosniff',
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    '',
    body,
  ].join('\r\n'))
}

function secureCookie(cookie: string): string {
  return /(?:^|;)\s*secure\s*(?:;|$)/iu.test(cookie) ? cookie : `${cookie}; Secure`
}

function responseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const copied: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) copied[name] = value
  }
  const cookies = headers['set-cookie']
  if (cookies !== undefined) copied['set-cookie'] = cookies.map(secureCookie)
  return copied
}

function rawUpgradeRequest(request: IncomingMessage, headers: IncomingHttpHeaders): string {
  const lines = [`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}`]
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`)
    } else if (value !== undefined) {
      lines.push(`${name}: ${value}`)
    }
  }
  lines.push('', '')
  return lines.join('\r\n')
}

function frozenSnapshot(
  state: LanHttpsIngressState,
  actualPort: number | null,
  addresses: readonly string[],
  caFingerprint: string,
  failure: string | null,
): LanHttpsIngressSnapshot {
  return Object.freeze({ state, actualPort, addresses, caFingerprint, errorCode: failure })
}

/**
 * HTTPS/WSS ingress that can be enabled and disabled without rebuilding the DSH
 * Host generation. The HTTP target is deliberately fixed to loopback.
 */
export class LanHttpsIngress {
  private readonly targetPort: number
  private readonly requestedPort: number
  private readonly key: string | Buffer
  private readonly cert: string | Buffer
  private readonly caFingerprint: string
  private readonly addresses: readonly string[]
  private readonly allowedAddresses: ReadonlySet<string>
  private readonly sockets = new Set<Duplex>()
  private server: HttpsServer | null = null
  private current: LanHttpsIngressSnapshot
  private serial: Promise<void> = Promise.resolve()

  constructor(options: LanHttpsIngressOptions) {
    this.targetPort = exactPort(options.targetPort, false, 'LAN HTTPS target port')
    this.requestedPort = exactPort(options.requestedPort, true, 'LAN HTTPS requested port')
    this.key = copyTlsValue(options.key, 'private key')
    this.cert = copyTlsValue(options.cert, 'certificate')
    const fingerprint = options.caFingerprint.trim()
    if (fingerprint.length === 0) throw new TypeError('dsh-plugin-desktop: LAN HTTPS CA fingerprint must not be empty')
    this.caFingerprint = fingerprint
    this.addresses = normalizeAddresses(options.allowedAddresses)
    this.allowedAddresses = new Set(this.addresses)
    this.current = frozenSnapshot('inactive', null, this.addresses, this.caFingerprint, null)
  }

  snapshot(): LanHttpsIngressSnapshot {
    return this.current
  }

  setEnabled(enabled: boolean): Promise<LanHttpsIngressSnapshot> {
    const transition = this.serial.then(async () => {
      if (enabled) await this.startInternal()
      else await this.stopInternal()
      return this.current
    })
    this.serial = transition.then(() => undefined, () => undefined)
    return transition
  }

  stop(): Promise<LanHttpsIngressSnapshot> {
    return this.setEnabled(false)
  }

  private track(socket: Duplex): void {
    this.sockets.add(socket)
    socket.once('close', () => this.sockets.delete(socket))
  }

  private proxyHttp(request: IncomingMessage, response: ServerResponse): void {
    if (!permits(request.headers, this.allowedAddresses)) {
      request.resume()
      reject(response, 403, 'forbidden')
      return
    }

    const proxyRequest = requestHttp({
      host: TARGET_HOST,
      port: this.targetPort,
      method: request.method,
      path: request.url,
      headers: sanitizedHeaders(request.headers),
    })
    proxyRequest.once('socket', socket => this.track(socket))
    proxyRequest.once('response', (proxyResponse) => {
      if (response.destroyed) {
        proxyResponse.destroy()
        return
      }
      response.writeHead(proxyResponse.statusCode ?? 502, responseHeaders(proxyResponse.headers))
      proxyResponse.pipe(response)
    })
    proxyRequest.once('error', () => reject(response, 502, 'bad gateway'))
    request.once('aborted', () => proxyRequest.destroy())
    response.once('close', () => {
      if (!response.writableEnded) proxyRequest.destroy()
    })
    request.pipe(proxyRequest)
  }

  private proxyUpgrade(request: IncomingMessage, downstream: Duplex, head: Buffer): void {
    if (!permits(request.headers, this.allowedAddresses)) {
      rejectUpgrade(downstream, 403, 'Forbidden', 'forbidden')
      return
    }

    downstream.pause()
    const upstream = new Socket()
    this.track(upstream)
    let connected = false
    upstream.once('connect', () => {
      connected = true
      upstream.write(rawUpgradeRequest(request, sanitizedHeaders(request.headers)))
      if (head.length > 0) upstream.write(head)
      downstream.pipe(upstream).pipe(downstream)
      downstream.resume()
    })
    upstream.once('error', () => {
      if (!connected) rejectUpgrade(downstream, 502, 'Bad Gateway', 'bad gateway')
      else downstream.destroy()
    })
    downstream.once('error', () => upstream.destroy())
    downstream.once('close', () => upstream.destroy())
    upstream.connect(this.targetPort, TARGET_HOST)
  }

  private async startInternal(): Promise<void> {
    if (this.current.state === 'ready' || this.current.state === 'starting') return
    this.current = frozenSnapshot('starting', null, this.addresses, this.caFingerprint, null)

    let server: HttpsServer
    try {
      server = createHttpsServer({ key: this.key, cert: this.cert, minVersion: 'TLSv1.2' }, (request, response) => {
        this.proxyHttp(request, response)
      })
      this.server = server
      server.on('connection', socket => this.track(socket))
      server.on('upgrade', (request, socket, head) => this.proxyUpgrade(request, socket, head))
      server.on('clientError', (_error, socket) => socket.destroy())
      server.on('tlsClientError', () => {})
      await new Promise<void>((resolve, rejectListen) => {
        const failed = (cause: Error): void => {
          server.off('listening', listening)
          rejectListen(cause)
        }
        const listening = (): void => {
          server.off('error', failed)
          resolve()
        }
        server.once('error', failed)
        server.once('listening', listening)
        server.listen(this.requestedPort, EDGE_HOST)
      })
      const bound = server.address()
      if (bound === null || typeof bound === 'string') throw new Error('LAN HTTPS ingress did not expose a TCP address')
      this.current = frozenSnapshot('ready', bound.port, this.addresses, this.caFingerprint, null)
    } catch (cause) {
      if (this.server !== null) {
        try {
          this.server.close()
        } catch {
          // A synchronous TLS or bind failure can leave an already-closed server.
        }
      }
      this.server = null
      for (const socket of this.sockets) socket.destroy()
      this.sockets.clear()
      this.current = frozenSnapshot('failed', null, this.addresses, this.caFingerprint, errorCode(cause))
    }
  }

  private async stopInternal(): Promise<void> {
    const server = this.server
    this.server = null
    if (server !== null) {
      const closed = new Promise<void>(resolve => {
        try {
          server.close(() => resolve())
        } catch {
          resolve()
        }
      })
      for (const socket of this.sockets) socket.destroy()
      server.closeAllConnections()
      await closed
    } else {
      for (const socket of this.sockets) socket.destroy()
    }
    this.sockets.clear()
    this.current = frozenSnapshot('inactive', null, this.addresses, this.caFingerprint, null)
  }
}

export default LanHttpsIngress
