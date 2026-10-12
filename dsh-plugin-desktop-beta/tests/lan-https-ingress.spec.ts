import { createHash } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { request as requestHttps } from 'node:https'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { generate } from 'selfsigned'
import LanHttpsIngress, { type LanHttpsIngressOptions } from '../src/lan-https-ingress.ts'

const LAN_ADDRESS = '192.168.50.20'
const activeIngresses: LanHttpsIngress[] = []
const auxiliaryServers: Server[] = []

let caCertificate = ''
let leafCertificate = ''
let leafPrivateKey = ''

interface HttpsResult {
  readonly statusCode: number
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

beforeAll(async () => {
  const ca = await generate([{ name: 'commonName', value: 'DSH Desktop test root' }], {
    algorithm: 'sha256',
    keyType: 'ec',
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  })
  const leaf = await generate([{ name: 'commonName', value: '127.0.0.1' }], {
    algorithm: 'sha256',
    keyType: 'ec',
    ca: { key: ca.private, cert: ca.cert },
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true, critical: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: LAN_ADDRESS },
        ],
      },
    ],
  })
  caCertificate = ca.cert
  leafCertificate = leaf.cert
  leafPrivateKey = leaf.private
})

afterEach(async () => {
  await Promise.all(activeIngresses.splice(0).map(ingress => ingress.stop()))
  await Promise.all(auxiliaryServers.splice(0).map(server => closeServer(server)))
})

afterAll(() => {
  caCertificate = ''
  leafCertificate = ''
  leafPrivateKey = ''
})

function listen(server: Server, host: string = '127.0.0.1'): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => {
      server.off('error', reject)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('test server did not expose a TCP address'))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>(resolve => {
    try {
      server.close(() => resolve())
      server.closeAllConnections()
    } catch {
      resolve()
    }
  })
}

function options(targetPort: number, overrides: Partial<LanHttpsIngressOptions> = {}): LanHttpsIngressOptions {
  return {
    targetPort,
    requestedPort: 0,
    key: leafPrivateKey,
    cert: leafCertificate,
    caFingerprint: createHash('sha256').update(caCertificate).digest('hex'),
    allowedAddresses: [LAN_ADDRESS],
    ...overrides,
  }
}

async function startIngress(targetPort: number, overrides: Partial<LanHttpsIngressOptions> = {}): Promise<LanHttpsIngress> {
  const ingress = new LanHttpsIngress(options(targetPort, overrides))
  activeIngresses.push(ingress)
  const snapshot = await ingress.setEnabled(true)
  expect(snapshot.state).toBe('ready')
  expect(snapshot.actualPort).not.toBeNull()
  return ingress
}

function ingressPort(ingress: LanHttpsIngress): number {
  const port = ingress.snapshot().actualPort
  if (port === null) throw new Error('test ingress is not listening')
  return port
}

function httpsCall(
  ingress: LanHttpsIngress,
  path: string,
  init: {
    readonly method?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: Buffer | string
  } = {},
): Promise<HttpsResult> {
  return new Promise<HttpsResult>((resolve, reject) => {
    const request = requestHttps({
      host: '127.0.0.1',
      port: ingressPort(ingress),
      path,
      method: init.method ?? 'GET',
      ca: caCertificate,
      rejectUnauthorized: true,
      headers: {
        host: `${LAN_ADDRESS}:${String(ingressPort(ingress))}`,
        ...init.headers,
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.once('end', () => resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
    })
    request.once('error', reject)
    if (init.body !== undefined) request.write(init.body)
    request.end()
  })
}

function waitForText(socket: TLSSocket, text: string, current: () => string): Promise<void> {
  if (current().includes(text)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out waiting for ${JSON.stringify(text)} in ${JSON.stringify(current())}`))
    }, 2_000)
    const changed = (): void => {
      if (!current().includes(text)) return
      cleanup()
      resolve()
    }
    const failed = (cause: Error): void => {
      cleanup()
      reject(cause)
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      socket.off('data', changed)
      socket.off('error', failed)
    }
    socket.on('data', changed)
    socket.once('error', failed)
  })
}

describe('LAN HTTPS ingress', () => {
  it('serves a CA-trusted HTTPS origin and streams SSE before the upstream response ends', async () => {
    let releaseSecondChunk: (() => void) | undefined
    const backend = createServer(async (request, response) => {
      expect(request.url).toBe('/events')
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      })
      response.write('data: first\n\n')
      await new Promise<void>(resolve => { releaseSecondChunk = resolve })
      response.end('data: second\n\n')
    })
    auxiliaryServers.push(backend)
    const ingress = await startIngress(await listen(backend))

    const chunks: string[] = []
    let ended = false
    const complete = new Promise<void>((resolve, reject) => {
      const request = requestHttps({
        host: '127.0.0.1',
        port: ingressPort(ingress),
        path: '/events',
        ca: caCertificate,
        rejectUnauthorized: true,
        headers: { host: `${LAN_ADDRESS}:${String(ingressPort(ingress))}` },
      }, (response) => {
        expect((response.socket as TLSSocket).authorized).toBe(true)
        response.on('data', chunk => chunks.push(chunk.toString('utf8')))
        response.once('end', () => {
          ended = true
          resolve()
        })
      })
      request.once('error', reject)
      request.end()
    })

    await expect.poll(() => chunks.join('')).toContain('data: first')
    expect(ended).toBe(false)
    releaseSecondChunk?.()
    await complete
    expect(chunks.join('')).toBe('data: first\n\ndata: second\n\n')
  })

  it('streams a large request body and preserves browser authority while removing spoofable identity headers', async () => {
    let receivedHeaders: IncomingHttpHeaders | undefined
    const backend = createServer((request, response) => {
      receivedHeaders = request.headers
      request.pipe(response)
    })
    auxiliaryServers.push(backend)
    const ingress = await startIngress(await listen(backend))
    const body = Buffer.alloc(2 * 1024 * 1024, 0x5a)

    const result = await httpsCall(ingress, '/upload', {
      method: 'POST',
      body,
      headers: {
        origin: `https://${LAN_ADDRESS}:${String(ingressPort(ingress))}`,
        cookie: 'session=ordinary-browser',
        'content-length': String(body.length),
        'x-dsh-desktop-renderer': 'forged-capability',
        forwarded: 'for=203.0.113.9;proto=https',
        'x-forwarded-for': '203.0.113.9',
        'x-forwarded-host': 'attacker.invalid',
        'x-forwarded-proto': 'http',
      },
    })

    expect(result.statusCode).toBe(200)
    expect(result.body.equals(body)).toBe(true)
    expect(receivedHeaders).toMatchObject({
      host: `${LAN_ADDRESS}:${String(ingressPort(ingress))}`,
      origin: `https://${LAN_ADDRESS}:${String(ingressPort(ingress))}`,
      cookie: 'session=ordinary-browser',
    })
    expect(receivedHeaders?.['x-dsh-desktop-renderer']).toBeUndefined()
    expect(receivedHeaders?.forwarded).toBeUndefined()
    expect(receivedHeaders?.['x-forwarded-for']).toBeUndefined()
    expect(receivedHeaders?.['x-forwarded-host']).toBeUndefined()
    expect(receivedHeaders?.['x-forwarded-proto']).toBeUndefined()
  })

  it('adds Secure to every proxied Set-Cookie without duplicating an existing attribute', async () => {
    const backend = createServer((_request, response) => {
      response.setHeader('set-cookie', [
        'sid=one; Path=/; HttpOnly',
        'theme=dark; Path=/; Secure; SameSite=Lax',
      ])
      response.end('cookies')
    })
    auxiliaryServers.push(backend)
    const ingress = await startIngress(await listen(backend))

    const result = await httpsCall(ingress, '/')

    expect(result.headers['set-cookie']).toEqual([
      'sid=one; Path=/; HttpOnly; Secure',
      'theme=dark; Path=/; Secure; SameSite=Lax',
    ])
  })

  it('returns 403 for an unlisted Host or an explicit cross-site browser request', async () => {
    let backendHits = 0
    const backend = createServer((_request, response) => {
      backendHits += 1
      response.end('unexpected')
    })
    auxiliaryServers.push(backend)
    const ingress = await startIngress(await listen(backend))

    const wrongHost = await httpsCall(ingress, '/', { headers: { host: '192.168.50.99' } })
    const crossSite = await httpsCall(ingress, '/', { headers: { 'sec-fetch-site': 'cross-site' } })

    expect(wrongHost.statusCode).toBe(403)
    expect(wrongHost.body.toString('utf8')).toBe('forbidden')
    expect(crossSite.statusCode).toBe(403)
    expect(crossSite.headers['cache-control']).toBe('no-store')
    expect(backendHits).toBe(0)
  })

  it('returns 502 when the loopback target is unavailable', async () => {
    const reservation = createServer()
    const targetPort = await listen(reservation)
    await closeServer(reservation)
    const ingress = await startIngress(targetPort)

    const result = await httpsCall(ingress, '/')

    expect(result.statusCode).toBe(502)
    expect(result.body.toString('utf8')).toBe('bad gateway')
  })

  it('passes upgrade head and both socket directions without forwarding a renderer capability', async () => {
    let upgradeHeaders: IncomingHttpHeaders | undefined
    const backend = createServer()
    backend.on('upgrade', (request, socket, head) => {
      upgradeHeaders = request.headers
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Connection: Upgrade',
        'Upgrade: dsh-test',
        '',
        '',
      ].join('\r\n'))
      socket.write(`head:${head.toString('utf8')}`)
      socket.on('data', chunk => socket.write(`echo:${chunk.toString('utf8')}`))
      socket.once('end', () => socket.destroy())
    })
    auxiliaryServers.push(backend)
    const ingress = await startIngress(await listen(backend))
    const socket = connectTls({
      host: '127.0.0.1',
      port: ingressPort(ingress),
      ca: caCertificate,
      rejectUnauthorized: true,
    })
    let output = ''
    socket.on('data', chunk => { output += chunk.toString('utf8') })
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
    })
    expect(socket.authorized).toBe(true)
    socket.write([
      'GET /socket HTTP/1.1',
      `Host: ${LAN_ADDRESS}:${String(ingressPort(ingress))}`,
      'Connection: Upgrade',
      'Upgrade: dsh-test',
      'X-DSH-Desktop-Renderer: forged-capability',
      'X-Forwarded-For: 203.0.113.9',
      '',
      'first',
    ].join('\r\n'))

    await waitForText(socket, 'head:first', () => output)
    expect(output).toContain('101 Switching Protocols')
    expect(upgradeHeaders?.['x-dsh-desktop-renderer']).toBeUndefined()
    expect(upgradeHeaders?.['x-forwarded-for']).toBeUndefined()
    socket.write('second')
    await waitForText(socket, 'echo:second', () => output)

    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
    await ingress.stop()
    await closed
    expect(socket.destroyed).toBe(true)
  })

  it('starts and stops on demand, retries after stop, and reports bind conflicts without restarting the target', async () => {
    const backend = createServer((_request, response) => response.end('alive'))
    auxiliaryServers.push(backend)
    const targetPort = await listen(backend)
    const ingress = new LanHttpsIngress(options(targetPort, {
      allowedAddresses: [LAN_ADDRESS, LAN_ADDRESS],
    }))
    activeIngresses.push(ingress)
    expect(ingress.snapshot()).toMatchObject({
      state: 'inactive',
      actualPort: null,
      addresses: [LAN_ADDRESS],
      errorCode: null,
    })

    const first = await ingress.setEnabled(true)
    expect(first.state).toBe('ready')
    await expect(httpsCall(ingress, '/')).resolves.toMatchObject({ statusCode: 200 })
    expect((await ingress.setEnabled(false)).state).toBe('inactive')
    expect((await ingress.setEnabled(true)).state).toBe('ready')
    await expect(httpsCall(ingress, '/')).resolves.toMatchObject({ statusCode: 200 })

    const occupied = createServer()
    auxiliaryServers.push(occupied)
    const occupiedPort = await listen(occupied, '0.0.0.0')
    const conflicting = new LanHttpsIngress(options(targetPort, { requestedPort: occupiedPort }))
    activeIngresses.push(conflicting)
    const failed = await conflicting.setEnabled(true)
    expect(failed).toMatchObject({
      state: 'failed',
      actualPort: null,
      errorCode: 'EADDRINUSE',
    })
    expect((await conflicting.setEnabled(false)).state).toBe('inactive')
  })

  it('rejects non-canonical or non-IPv4 allowlist entries', () => {
    expect(() => new LanHttpsIngress(options(43_120, { allowedAddresses: ['192.168.050.20'] })))
      .toThrow('invalid LAN HTTPS IPv4 address')
    expect(() => new LanHttpsIngress(options(43_120, { allowedAddresses: ['::1'] })))
      .toThrow('invalid LAN HTTPS IPv4 address')
  })
})
