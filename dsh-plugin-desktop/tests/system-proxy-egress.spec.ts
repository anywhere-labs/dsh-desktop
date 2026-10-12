import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import {
  buildDesktopProxyOverlay,
  desktopProxyEnvLookup,
  type DesktopProxyEnvLookup,
  type DesktopSystemProxyProbe,
} from '../src/system-proxy.ts'

/**
 * End-to-end proof that a synthesized overlay actually moves bytes.
 *
 * The unit tests cover what the overlay should contain; this covers the part no assertion about a
 * record can reach. Three undici copies coexist in this application -- the one nested inside
 * `@deepseek-ai/dsh-http-proxy`, the hoisted one, and Electron's built-in -- and they share a
 * dispatcher only because `setGlobalDispatcher` writes a versioned well-known symbol. Nothing
 * declares that agreement, so an undici upgrade could end it silently while every unit test stays
 * green. A request that visibly arrives at a real socket is the only thing that would notice.
 */

let seen: string[] = []
let proxy: Server
let proxyUrl: string

beforeAll(async () => {
  proxy = createServer((request, response) => {
    seen.push(`REQ ${request.url ?? ''}`)
    response.writeHead(502)
    response.end('fake-proxy')
  })
  proxy.on('connect', (request, socket) => {
    seen.push(`CONNECT ${request.url ?? ''}`)
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    socket.end()
  })
  const address = await new Promise<AddressInfo>(resolve => {
    proxy.listen(0, '127.0.0.1', () => { resolve(proxy.address() as AddressInfo) })
  })
  proxyUrl = `http://127.0.0.1:${String(address.port)}`
})

afterAll(async () => {
  await new Promise<void>(resolve => { proxy.close(() => { resolve() }) })
})

beforeEach(() => {
  // A developer machine that genuinely has a proxy would otherwise decide these assertions.
  for (const name of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY',
    'no_proxy', 'NO_PROXY']) {
    vi.stubEnv(name, '')
  }
  seen = []
})

afterEach(() => { vi.unstubAllEnvs() })

/** An empty launch environment, standing in for a user who exported nothing. */
function noEnv(): DesktopProxyEnvLookup {
  return { get: () => undefined }
}

/**
 * Install the policy the supervisor would install, run one request, then take it back down.
 *
 * Disposal is not optional: the installation mutates `process.env` and the process-global undici
 * dispatcher, so a leak here would silently decide a later test file's result.
 */
async function observe(
  env: DesktopProxyEnvLookup,
  probe: DesktopSystemProxyProbe,
  lanAddresses: readonly string[],
  run: () => Promise<unknown>,
): Promise<string[]> {
  seen = []
  const resolution = buildDesktopProxyOverlay({ env, probe, lanAddresses })
  const dispose = await installProxyFromEnvironment(
    desktopProxyEnvLookup(env, resolution.overlay),
    () => undefined,
  )
  try {
    await run().catch(() => undefined)
  } finally {
    await dispose()
  }
  return seen
}

/** Request a host that cannot resolve, so only the proxy can ever see it. */
async function fetchAway(url: string): Promise<void> {
  await fetch(url, { signal: AbortSignal.timeout(2_000) })
}

describe('system proxy egress', () => {
  it('sends an HTTPS request through the proxy the system configuration named', async () => {
    const observed = await observe(noEnv(), { http: proxyUrl, https: proxyUrl }, [],
      () => fetchAway('https://example.invalid/'))

    expect(observed).toContain('CONNECT example.invalid:443')
  })

  it('sends a plain HTTP request through the same proxy', async () => {
    const observed = await observe(noEnv(), { http: proxyUrl, https: proxyUrl }, [],
      () => fetchAway('http://example.invalid/probe'))

    expect(observed).toContain('REQ http://example.invalid/probe')
  })

  it('leaves loopback off the proxy, so a local server stays reachable', async () => {
    const observed = await observe(noEnv(), { http: proxyUrl, https: proxyUrl }, [],
      () => fetchAway('http://127.0.0.1:1/'))

    expect(observed).toEqual([])
  })

  it("leaves this machine's own LAN address off the proxy", async () => {
    const observed = await observe(noEnv(), { http: proxyUrl, https: proxyUrl }, ['192.168.77.7'],
      () => fetchAway('http://192.168.77.7:1/'))

    expect(observed).toEqual([])
  })

  it('uses the proxy the user exported and ignores the system one', async () => {
    const exported: DesktopProxyEnvLookup = {
      get: name => (name === 'HTTP_PROXY' || name === 'HTTPS_PROXY' ? { value: proxyUrl } : undefined),
    }
    const observed = await observe(exported, { http: 'http://127.0.0.1:9/', https: 'http://127.0.0.1:9/' }, [],
      () => fetchAway('https://example.invalid/'))

    expect(observed).toContain('CONNECT example.invalid:443')
  })

  it('connects directly when the machine has no proxy', async () => {
    const observed = await observe(noEnv(), {}, [], () => fetchAway('https://example.invalid/'))

    expect(observed).toEqual([])
  })
})
