import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { createLaunchEnvironmentSnapshot, type LaunchEnvironmentLayerInput } from '@deepseek-ai/dsh-launch-environment'
import {
  parseSystemProxyProbe,
  probeSystemProxy,
  withSystemProxy,
  type SystemProxyResolver,
} from '../src/system-proxy.ts'

const PROXY = 'http://127.0.0.1:7897'

function resolver(answers: (url: string, attempt: number) => string): SystemProxyResolver & { rounds: () => number } {
  let calls = 0
  return {
    forceReloadProxyConfig: async () => {},
    resolveProxy: async url => answers(url, Math.floor(calls++ / 3) + 1),
    rounds: () => Math.ceil(calls / 3),
  }
}

const noWait = async (): Promise<void> => {}

function snapshot(...layers: LaunchEnvironmentLayerInput[]) {
  return createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }, ...layers])
}

describe('probeSystemProxy', () => {
  it('reports the proxy the system resolver named for each scheme', async () => {
    const probe = await probeSystemProxy(resolver(() => 'PROXY 127.0.0.1:7897'), noWait)

    expect(probe).toMatchObject({ http: PROXY, https: PROXY, disagreed: false })
  })

  it('retries a DIRECT answer before concluding the machine is direct', async () => {
    const answers = resolver((_url, attempt) => attempt < 2 ? 'DIRECT' : 'PROXY 127.0.0.1:7897')
    const probe = await probeSystemProxy(answers, noWait)

    expect(probe.https).toBe(PROXY)
    expect(answers.rounds()).toBe(2)
  })

  it('gives up after three DIRECT rounds', async () => {
    const answers = resolver(() => 'DIRECT')
    const probe = await probeSystemProxy(answers, noWait)

    expect(probe).toEqual({ notes: [] })
    expect(answers.rounds()).toBe(3)
  })

  it('explains a SOCKS-only configuration once and does not retry it', async () => {
    const answers = resolver(() => 'SOCKS5 127.0.0.1:7898')
    const probe = await probeSystemProxy(answers, noWait)

    expect(probe.https).toBeUndefined()
    expect(probe.notes).toHaveLength(3)
    expect(probe.notes?.[0]).toContain('HTTP or mixed port')
    expect(answers.rounds()).toBe(1)
  })

  it('starts direct when the configuration cannot be read', async () => {
    const probe = await probeSystemProxy({
      forceReloadProxyConfig: async () => { throw new Error('reload failed') },
      resolveProxy: async () => { throw new Error('resolver down') },
    }, noWait)

    expect(probe.https).toBeUndefined()
    expect(probe.notes?.join('\n')).toContain('resolver down')
  })
})

describe('parseSystemProxyProbe', () => {
  it('round-trips what main sends', () => {
    const sent = { http: PROXY, https: PROXY, disagreed: true, notes: ['n'] }

    expect(parseSystemProxyProbe(JSON.stringify(sent))).toEqual(sent)
  })

  it('treats a missing value as no system proxy', () => {
    expect(parseSystemProxyProbe(undefined)).toEqual({})
  })

  it('degrades malformed input to direct with a note instead of stopping the Host', () => {
    expect(parseSystemProxyProbe('{').https).toBeUndefined()
    expect(parseSystemProxyProbe('[]').notes).toHaveLength(1)
    const probe = parseSystemProxyProbe(JSON.stringify({ https: 'socks5://127.0.0.1:1', http: 7 }))
    expect(probe.https).toBeUndefined()
    expect(probe.http).toBeUndefined()
    expect(probe.notes).toHaveLength(2)
  })
})

describe('withSystemProxy', () => {
  it('answers both casings from the system proxy when the user configured none', () => {
    const { environment, resolution } = withSystemProxy(snapshot(), { http: PROXY, https: PROXY }, ['192.168.1.5'])

    expect(resolution.source).toBe('system')
    expect(environment.get('HTTPS_PROXY')?.value).toBe(PROXY)
    expect(environment.get('https_proxy')).toEqual({ value: PROXY, source: 'process' })
    expect(environment.get('NO_PROXY')?.value).toBe('192.168.1.5,.local')
    expect(environment.getFrom('HTTPS_PROXY', ['process'])?.value).toBe(PROXY)
    expect(environment.getFrom('HTTPS_PROXY', ['user-env'])).toBeUndefined()
  })

  it('keeps an exported proxy and leaves the environment untouched', () => {
    const base = snapshot({ source: 'process', values: { HTTPS_PROXY: 'http://corp:8080' } })
    const { environment, resolution } = withSystemProxy(base, { https: PROXY }, [])

    expect(resolution.source).toBe('environment')
    expect(environment).toBe(base)
  })

  it('keeps a proxy written in the DSH home .env file', () => {
    const base = snapshot({ source: 'user-env', path: '/home/.env', values: { HTTP_PROXY: 'http://corp:8080' } })
    const { environment, resolution } = withSystemProxy(base, { http: PROXY, https: PROXY }, [])

    expect(resolution.source).toBe('environment')
    expect(environment.get('HTTP_PROXY')?.value).toBe('http://corp:8080')
  })

  it('passes other names through', () => {
    const base = snapshot({ source: 'process', values: { DSH_HOME: '/h' } })
    const { environment } = withSystemProxy(base, { https: PROXY }, [])

    expect(environment.get('DSH_HOME')?.value).toBe('/h')
  })

  it('logs a direct start', () => {
    expect(withSystemProxy(snapshot(), {}, []).resolution.summary).toContain('outbound proxy = none')
  })
})

/**
 * The Host hands this environment to upstream `runProfile()`, which installs it with
 * `installProxyFromEnvironment`. Proving bytes arrive at a real socket is the only check that the
 * wrapped snapshot is actually accepted by the upstream installer.
 */
describe('system proxy egress through the upstream installer', () => {
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
      'no_proxy', 'NO_PROXY']) vi.stubEnv(name, '')
    seen = []
  })

  afterEach(() => { vi.unstubAllEnvs() })

  async function observe(base: ReturnType<typeof snapshot>, url: string): Promise<string[]> {
    const { environment } = withSystemProxy(base, { http: proxyUrl, https: proxyUrl }, ['192.168.77.7'])
    const dispose = await installProxyFromEnvironment(environment, () => undefined)
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) }).catch(() => undefined)
    } finally {
      await dispose()
    }
    return seen
  }

  it('sends HTTPS through the system proxy', async () => {
    expect(await observe(snapshot(), 'https://example.invalid/')).toContain('CONNECT example.invalid:443')
  })

  it('sends plain HTTP through the system proxy', async () => {
    expect(await observe(snapshot(), 'http://example.invalid/probe')).toContain('REQ http://example.invalid/probe')
  })

  it('keeps loopback and this machine\'s LAN address off the proxy', async () => {
    expect(await observe(snapshot(), 'http://127.0.0.1:1/')).toEqual([])
    expect(await observe(snapshot(), 'http://192.168.77.7:1/')).toEqual([])
  })

  it('lets a .env proxy win over the system proxy', async () => {
    const base = snapshot({ source: 'user-env', path: '/home/.env', values: { HTTPS_PROXY: 'http://127.0.0.1:9/' } })

    expect(await observe(base, 'https://example.invalid/')).toEqual([])
  })
})
