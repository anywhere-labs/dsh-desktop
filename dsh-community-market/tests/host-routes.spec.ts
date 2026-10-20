import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const assetRef = 'mktimg_0123456789abcdefghijklmnopqrstuv'
const assetBody = Buffer.from('normalized-png-fixture')

const media = vi.hoisted(() => ({
  register: vi.fn(() => assetRef),
  resolve: vi.fn(),
  unregisterSource: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('../src/media/service.js', () => ({
  createMarketMediaService: () => media,
}))

import {
  DSH_1024STORE_ADAPTER_ID,
  DSH_1024STORE_ENDPOINT,
  DSH_1024STORE_KEY,
  DSH_1024STORE_PROVIDER_ID,
} from '../src/adapters/dsh-1024store.js'
import {
  DSHFIND_ADAPTER_ID,
  DSHFIND_ENDPOINT,
  DSHFIND_KEY,
  DSHFIND_PROVIDER_ID,
} from '../src/adapters/dshfind.js'
import { MemoryMarketStateStore, type MarketStateStore } from '../src/catalog/state-store.js'
import type { CatalogSourceManifest, LocalSourceRecord } from '../src/contracts/index.js'
import { marketRoutes, registerMarketRoutes } from '../src/host/routes.js'
import { apply, inject as marketInject } from '../src/index.js'
import { restrictedHttpClient } from '../src/network/restricted-http.js'

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

function fixture(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as unknown
}

interface MarketServer {
  readonly baseUrl: string
  readonly close: () => Promise<void>
  readonly logger: { readonly error: ReturnType<typeof vi.fn> }
}

function localHeaders(server: MarketServer, origin = server.baseUrl): Record<string, string> {
  return {
    host: new URL(server.baseUrl).host,
    origin,
  }
}

async function readRoute(server: MarketServer, path: string, signal?: AbortSignal): Promise<Response> {
  return await fetch(`${server.baseUrl}${path}`, {
    headers: localHeaders(server),
    ...(signal === undefined ? {} : { signal }),
  })
}

async function mutateSource(server: MarketServer, mutation: unknown, origin = server.baseUrl): Promise<Response> {
  return await fetch(`${server.baseUrl}${marketRoutes.sources}`, {
    method: 'POST',
    headers: {
      ...localHeaders(server, origin),
      'content-type': 'application/json',
    },
    body: JSON.stringify(mutation),
  })
}

const standardManifest = fixture('../docs/examples/catalog-source.example.json') as CatalogSourceManifest

const builtInSource = (overrides: Partial<LocalSourceRecord> = {}): LocalSourceRecord => ({
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'built-in',
  adapterId: DSH_1024STORE_ADAPTER_ID,
  providerId: DSH_1024STORE_PROVIDER_ID,
  builtInProviderKey: DSH_1024STORE_KEY,
  enabled: false,
  order: 0,
  ...overrides,
})

const dshfindSource = (overrides: Partial<LocalSourceRecord> = {}): LocalSourceRecord => ({
  sourceRecordId: '038f1f77-a5c4-7b73-a9ae-0242ac120004',
  registrationKind: 'built-in',
  adapterId: DSHFIND_ADAPTER_ID,
  providerId: DSHFIND_PROVIDER_ID,
  builtInProviderKey: DSHFIND_KEY,
  enabled: false,
  order: 1,
  ...overrides,
})

const standardSource = (overrides: Partial<LocalSourceRecord> = {}): LocalSourceRecord => ({
  sourceRecordId: '028f1f77-a5c4-7b73-a9ae-0242ac120003',
  registrationKind: 'user-added',
  adapterId: 'market.standard-http-v1',
  providerId: 'org.example.community-catalog',
  manifestUrl: 'https://plugins.example.org/catalog-source.json',
  manifest: standardManifest,
  enabled: false,
  order: 1,
  ...overrides,
})

async function startMarketServer(
  initialSources: readonly LocalSourceRecord[],
  sharedState?: MarketStateStore,
  setCatalogCacheOverride?: MarketStateStore['setCatalogCache'],
): Promise<MarketServer> {
  const routes = new Map<string, RouteHandler>()
  const backing = sharedState ?? new MemoryMarketStateStore({ sources: initialSources })
  const logger = { error: vi.fn() }
  const state: MarketStateStore = setCatalogCacheOverride === undefined
    ? backing
    : {
        getSources: () => backing.getSources(),
        setSources: records => backing.setSources(records),
        getCatalogCache: () => backing.getCatalogCache(),
        setCatalogCache: setCatalogCacheOverride,
      }
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const handler = routes.get(pathname)
    if (handler === undefined) {
      res.statusCode = 404
      res.end()
      return
    }
    void Promise.resolve(handler(req, res)).catch((cause: unknown) => {
      res.statusCode = 500
      res.end(cause instanceof Error ? cause.message : String(cause))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  const ctx = {
    webServer: {
      port,
      register: (route: { readonly path: string; readonly handler: RouteHandler }) => {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
    logger,
  } as unknown as Context
  const disposeRoutes = registerMarketRoutes(ctx, state)
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      disposeRoutes()
      await closeServer(server)
    },
    logger,
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
  })
}

describe('community market Host routes', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns storage-backed source state with built-in provider metadata', async () => {
    const server = await startMarketServer([builtInSource()])
    try {
      const response = await readRoute(server, marketRoutes.state)

      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      await expect(response.json()).resolves.toMatchObject({
        sources: [{
          sourceRecordId: builtInSource().sourceRecordId,
          name: 'DSH 1024Store',
          endpoint: DSH_1024STORE_ENDPOINT,
          partnership: true,
          enabled: false,
        }],
        builtIns: [
          {
            key: DSH_1024STORE_KEY,
            providerId: DSH_1024STORE_PROVIDER_ID,
            partnership: true,
          },
          {
            key: DSHFIND_KEY,
            providerId: DSHFIND_PROVIDER_ID,
            endpoint: DSHFIND_ENDPOINT,
            partnership: true,
          },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('normalizes catalog query parameters and returns aggregated source results', async () => {
    const activeSource = standardSource({ enabled: true, order: 0 })
    const providerPage = fixture('../docs/examples/catalog-provider-page.example.json') as {
      readonly items: readonly unknown[]
      readonly [key: string]: unknown
    }
    const getJson = vi.spyOn(restrictedHttpClient, 'getJson')
      .mockResolvedValueOnce({
        value: standardManifest,
        finalUrl: activeSource.manifestUrl!,
      })
      .mockResolvedValueOnce({
        value: { ...providerPage, page: { total: 1 } },
        finalUrl: 'https://plugins.example.org/v1/plugins?limit=50',
      })
    const server = await startMarketServer([activeSource])
    try {
      const response = await readRoute(
        server,
        `${marketRoutes.catalog}?q=%20sidebar%20&category=interface&limit=15&sort=updated&locale=zh-CN`,
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({
        query: {
          q: 'sidebar',
          category: ['interface'],
          limit: 15,
          sort: 'updated',
          locale: 'zh-CN',
        },
        results: [{
          source: { sourceRecordId: activeSource.sourceRecordId },
          stale: false,
          snapshot: {
            items: [{
              id: 'better-sidebar',
              provenance: { sourceRecordId: activeSource.sourceRecordId },
            }],
          },
        }],
        categories: ['interface'],
        metadata: {
          scannedAt: expect.any(String),
          expiresAt: expect.any(String),
          providerRevision: '2026-08-17T08:00:00Z',
          cacheStatus: 'fresh',
        },
      })
      expect(body.fetchedAt).toEqual(expect.any(String))
      expect(getJson).toHaveBeenCalledTimes(2)
      expect(getJson).toHaveBeenNthCalledWith(
        1,
        activeSource.manifestUrl,
        expect.any(AbortSignal),
        { allowedOrigin: 'https://plugins.example.org' },
      )
      expect(getJson).toHaveBeenNthCalledWith(
        2,
        'https://plugins.example.org/v1/plugins?limit=50',
        expect.any(AbortSignal),
        { allowedOrigin: 'https://plugins.example.org' },
      )
    } finally {
      await server.close()
    }
  })

  it('serves the persisted first page before a restarted Host refresh completes', async () => {
    const activeSource = standardSource({ enabled: true, order: 0 })
    const providerPage = fixture('../docs/examples/catalog-provider-page.example.json') as {
      readonly items: readonly unknown[]
      readonly [key: string]: unknown
    }
    let requests = 0
    const getJson = vi.spyOn(restrictedHttpClient, 'getJson').mockImplementation(async (_url, signal) => {
      requests += 1
      if (requests === 1) return { value: standardManifest, finalUrl: activeSource.manifestUrl! }
      if (requests === 2) return {
        value: { ...providerPage, page: { total: 1 } },
        finalUrl: 'https://plugins.example.org/v1/plugins?limit=50',
      }
      return await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const shared = new MemoryMarketStateStore({ sources: [activeSource] })
    const first = await startMarketServer([], shared)
    try {
      const firstResponse = await readRoute(
        first,
        `${marketRoutes.catalog}?sourceRecordId=${activeSource.sourceRecordId}&limit=50&locale=en`,
      )
      expect(firstResponse.status).toBe(200)
      await vi.waitFor(() => expect(shared.getCatalogCache()).toBeDefined())
    } finally {
      await first.close()
    }

    const second = await startMarketServer([], shared)
    try {
      const startedAt = Date.now()
      const secondResponse = await readRoute(
        second,
        `${marketRoutes.catalog}?sourceRecordId=${activeSource.sourceRecordId}&limit=50&locale=en`,
      )
      expect(Date.now() - startedAt).toBeLessThan(500)
      expect(secondResponse.status).toBe(200)
      await expect(secondResponse.json()).resolves.toMatchObject({
        results: [{ stale: true, snapshot: { items: [{ id: 'better-sidebar' }] } }],
        metadata: { cacheStatus: 'cached' },
      })
      expect(requests).toBe(2)

      const refreshController = new AbortController()
      const refresh = readRoute(
        second,
        `${marketRoutes.catalog}?sourceRecordId=${activeSource.sourceRecordId}&limit=50&locale=en&refresh=1`,
        refreshController.signal,
      )
      await vi.waitFor(() => expect(requests).toBe(3))
      refreshController.abort()
      await expect(refresh).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      await second.close()
      getJson.mockRestore()
    }
  })

  it('keeps a successful catalog response when cache persistence fails', async () => {
    const activeSource = standardSource({ enabled: true, order: 0 })
    const providerPage = fixture('../docs/examples/catalog-provider-page.example.json') as {
      readonly items: readonly unknown[]
      readonly [key: string]: unknown
    }
    let requests = 0
    const getJson = vi.spyOn(restrictedHttpClient, 'getJson').mockImplementation(async () => {
      requests += 1
      if (requests === 1) return { value: standardManifest, finalUrl: activeSource.manifestUrl! }
      return {
        value: { ...providerPage, page: { total: 1 } },
        finalUrl: 'https://plugins.example.org/v1/plugins?limit=50',
      }
    })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const server = await startMarketServer(
      [],
      new MemoryMarketStateStore({ sources: [activeSource] }),
      async () => { throw new Error('simulated storage write failure') },
    )
    try {
      const response = await readRoute(
        server,
        `${marketRoutes.catalog}?sourceRecordId=${activeSource.sourceRecordId}&limit=50&locale=en`,
      )
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        results: [{ snapshot: { items: [{ id: 'better-sidebar' }] } }],
      })
      await vi.waitFor(() => expect(server.logger.error).toHaveBeenCalled())
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
      await server.close()
      getJson.mockRestore()
    }
  })

  it.each([
    [DSH_1024STORE_KEY, DSH_1024STORE_ADAPTER_ID, DSH_1024STORE_PROVIDER_ID, 'DSH 1024Store'],
    [DSHFIND_KEY, DSHFIND_ADAPTER_ID, DSHFIND_PROVIDER_ID, 'dshfind'],
  ] as const)('adds reviewed built-in provider %s as a disabled source', async (key, adapterId, providerId, name) => {
    const server = await startMarketServer([])
    try {
      const response = await mutateSource(server, {
        action: 'add-builtin',
        key,
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        sources: [{
          registrationKind: 'built-in',
          adapterId,
          providerId,
          builtInProviderKey: key,
          enabled: false,
          order: 0,
          name,
        }],
      })
    } finally {
      await server.close()
    }
  })

  it('selects exactly one of two built-in sources', async () => {
    const current = builtInSource({ enabled: true })
    const replacement = dshfindSource()
    const server = await startMarketServer([current, replacement])
    try {
      const response = await mutateSource(server, {
        action: 'select',
        sourceRecordId: replacement.sourceRecordId,
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        sources: [
          { builtInProviderKey: DSH_1024STORE_KEY, enabled: false },
          { builtInProviderKey: DSHFIND_KEY, enabled: true },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('rejects an unknown built-in provider key without changing the registry', async () => {
    const server = await startMarketServer([])
    try {
      const response = await mutateSource(server, {
        action: 'add-builtin',
        key: 'attacker-controlled-provider',
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'built-in source unavailable' })
      const state = await readRoute(server, marketRoutes.state)
      await expect(state.json()).resolves.toMatchObject({ sources: [] })
    } finally {
      await server.close()
    }
  })

  it('selects one source and disables the previously active source', async () => {
    const existing = builtInSource()
    const previouslyActive = standardSource({ enabled: true })
    const server = await startMarketServer([existing, previouslyActive])
    try {
      const response = await mutateSource(server, {
        action: 'select',
        sourceRecordId: existing.sourceRecordId,
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        sources: [
          { sourceRecordId: existing.sourceRecordId, enabled: true },
          { sourceRecordId: previouslyActive.sourceRecordId, enabled: false },
        ],
      })
      const state = await readRoute(server, marketRoutes.state)
      await expect(state.json()).resolves.toMatchObject({
        sources: [
          { sourceRecordId: existing.sourceRecordId, enabled: true },
          { sourceRecordId: previouslyActive.sourceRecordId, enabled: false },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('removes a source and compacts the remaining source order', async () => {
    const removed = builtInSource()
    const remaining = standardSource()
    const server = await startMarketServer([removed, remaining])
    try {
      const response = await mutateSource(server, {
        action: 'remove',
        sourceRecordId: removed.sourceRecordId,
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        sources: [{ sourceRecordId: remaining.sourceRecordId, order: 0 }],
      })
      const state = await readRoute(server, marketRoutes.state)
      const body = await state.json()
      expect(body.sources).toHaveLength(1)
      expect(body.sources[0]).toMatchObject({
        sourceRecordId: remaining.sourceRecordId,
        order: 0,
      })
    } finally {
      await server.close()
    }
  })

  it('adds a disabled standard source after validating its HTTPS manifest', async () => {
    const manifestUrl = 'https://plugins.example.org/catalog-source.json'
    const getJson = vi.spyOn(restrictedHttpClient, 'getJson').mockResolvedValue({
      value: fixture('../docs/examples/catalog-source.example.json'),
      finalUrl: manifestUrl,
    })
    const server = await startMarketServer([])
    try {
      const response = await mutateSource(server, {
        action: 'add-standard',
        manifestUrl,
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        sources: [{
          registrationKind: 'user-added',
          adapterId: 'market.standard-http-v1',
          providerId: 'org.example.community-catalog',
          manifestUrl,
          enabled: false,
          order: 0,
        }],
      })
      expect(getJson).toHaveBeenCalledWith(
        manifestUrl,
        expect.any(AbortSignal),
        { allowedOrigin: 'https://plugins.example.org' },
      )
    } finally {
      await server.close()
    }
  })

  it('rejects a cross-origin source mutation without changing the registry', async () => {
    const server = await startMarketServer([])
    try {
      const response = await mutateSource(server, {
        action: 'add-builtin',
        key: DSH_1024STORE_KEY,
      }, 'http://attacker.example')

      expect(response.status).toBe(405)
      await expect(response.json()).resolves.toEqual({
        error: 'source changes require a local same-origin POST',
      })
      const state = await readRoute(server, marketRoutes.state)
      await expect(state.json()).resolves.toMatchObject({ sources: [] })
    } finally {
      await server.close()
    }
  })

  it('rejects an unsafe standard manifest URL before making a network request', async () => {
    const getJson = vi.spyOn(restrictedHttpClient, 'getJson')
    const server = await startMarketServer([])
    try {
      const response = await mutateSource(server, {
        action: 'add-standard',
        manifestUrl: 'https://plugins.example.org/catalog-source.json?token=secret',
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'manifest URL must use credential-free standard HTTPS port 443',
      })
      expect(getJson).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('aborts an active catalog request when its client disconnects', async () => {
    let releaseRequest!: () => void
    const requestStarted = new Promise<void>((resolve) => { releaseRequest = resolve })
    let externalSignal: AbortSignal | undefined
    vi.spyOn(restrictedHttpClient, 'getJson').mockImplementation(async (_url, signal) => {
      externalSignal = signal
      releaseRequest()
      return await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      })
    })
    const server = await startMarketServer([standardSource({ enabled: true, order: 0 })])
    const controller = new AbortController()
    try {
      const request = readRoute(
        server,
        `${marketRoutes.catalog}?q=plugin&refresh=1`,
        controller.signal,
      ).catch((cause: unknown) => cause)
      await requestStarted

      controller.abort()
      await request

      await vi.waitFor(() => { expect(externalSignal?.aborted).toBe(true) })
    } finally {
      controller.abort()
      await server.close()
    }
  })
})

interface TestAssetServer {
  readonly baseUrl: string
  readonly disposeRoutes: () => void
  readonly close: () => Promise<void>
}

async function startAssetServer(): Promise<TestAssetServer> {
  const handlers = new Map<string, (req: any, res: any) => void | Promise<void>>()
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const handler = handlers.get(path)
    if (handler === undefined) {
      res.statusCode = 404
      res.end()
      return
    }
    void Promise.resolve(handler(req, res)).catch(() => {
      if (!res.writableEnded) {
        res.statusCode = 500
        res.end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  const scope = {
    get: () => ({ sources: [] }),
    update: async () => {},
  }
  const context = {
    webServer: {
      port,
      register: (route: { path: string; handler: (req: any, res: any) => void | Promise<void> }) => {
        handlers.set(route.path, route.handler)
        return () => { handlers.delete(route.path) }
      },
    },
    logger: { error: vi.fn() },
  }
  const disposeRoutes = registerMarketRoutes(context as never, scope as never)
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    disposeRoutes,
    close: async () => {
      disposeRoutes()
      await closeServer(server)
    },
  }
}

function assetUrl(server: TestAssetServer): string {
  return `${server.baseUrl}${marketRoutes.assets}?ref=${assetRef}`
}

describe('community market asset routes', () => {
  beforeEach(() => {
    media.resolve.mockReset()
    media.dispose.mockClear()
  })

  it('serves an asset with cache validators and browser isolation headers', async () => {
    media.resolve.mockResolvedValue({
      body: assetBody,
      contentType: 'image/png',
      etag: '"asset-etag"',
    })
    const server = await startAssetServer()
    try {
      const response = await fetch(assetUrl(server))

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(response.headers.get('content-length')).toBe(String(assetBody.byteLength))
      expect(response.headers.get('content-disposition')).toBe('inline')
      expect(response.headers.get('etag')).toBe('"asset-etag"')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(assetBody))

      const cached = await fetch(assetUrl(server), { headers: { 'if-none-match': '"asset-etag"' } })
      expect(cached.status).toBe(304)
      expect(cached.headers.get('content-length')).toBeNull()
      expect((await cached.arrayBuffer()).byteLength).toBe(0)
    } finally {
      await server.close()
    }
  })

  it('rejects malformed and unknown asset references without resolving media', async () => {
    media.resolve.mockResolvedValue(undefined)
    const server = await startAssetServer()
    try {
      const malformed = await fetch(`${server.baseUrl}${marketRoutes.assets}?ref=javascript:alert(1)`)
      expect(malformed.status).toBe(404)
      expect(media.resolve).not.toHaveBeenCalled()

      const unknown = await fetch(`${server.baseUrl}${marketRoutes.assets}?ref=${assetRef}`)
      expect(unknown.status).toBe(404)
      expect(media.resolve).toHaveBeenCalledWith(assetRef, expect.any(AbortSignal))
    } finally {
      await server.close()
    }
  })

  it('aborts an in-flight asset resolution when the market generation is disposed', async () => {
    let observedSignal: AbortSignal | undefined
    media.resolve.mockImplementation(async (_ref: string, signal: AbortSignal) => {
      observedSignal = signal
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { resolve() }, { once: true }))
      throw signal.reason
    })
    const server = await startAssetServer()
    const controller = new AbortController()
    const request = fetch(assetUrl(server), { signal: controller.signal }).catch(() => undefined)
    try {
      await vi.waitFor(() => { expect(observedSignal).toBeDefined() })
      server.disposeRoutes()
      await vi.waitFor(() => { expect(observedSignal?.aborted).toBe(true) })
    } finally {
      controller.abort()
      await request
      await server.close()
    }
  })
})

type Handler = (req: any, res: any) => void | Promise<void>

interface Injection {
  readonly names: readonly string[]
  readonly factory: (ctx: { get(name: string): unknown; effect(factory: () => void | (() => void)): void }) => void
  cleanups: (() => void)[]
  active: boolean
}

function createHarness() {
  const values = new Map<string, unknown>()
  const handlers = new Map<string, Handler>()
  const injections: Injection[] = []
  const globalCleanups: (() => void)[] = []
  let activeInjection: Injection | undefined

  const registerEffect = (factory: () => void | (() => void), owner = activeInjection): void => {
    const cleanup = factory()
    if (typeof cleanup !== 'function') return
    if (owner === undefined) globalCleanups.push(cleanup)
    else owner.cleanups.push(cleanup)
  }

  const activate = (injection: Injection): void => {
    if (injection.active || !injection.names.every(name => values.has(name))) return
    injection.active = true
    activeInjection = injection
    injection.factory({
      get: name => values.get(name),
      effect: factory => { registerEffect(factory, injection) },
    })
    activeInjection = undefined
  }

  const context = {
    logger: { error: vi.fn(), warn: vi.fn() },
    webServer: {
      port: 43_120,
      register: vi.fn((route: { path: string; handler: Handler }) => {
        handlers.set(route.path, route.handler)
        return () => { handlers.delete(route.path) }
      }),
    },
    effect: (factory: () => void | (() => void)) => { registerEffect(factory) },
    inject: (
      names: readonly string[],
      factory: (ctx: { get(name: string): unknown; effect(factory: () => void | (() => void)): void }) => void,
    ) => {
      const injection: Injection = { names, factory, cleanups: [], active: false }
      injections.push(injection)
      activate(injection)
    },
  }

  const request = async (path: string) => {
    const req = Object.assign(new EventEmitter(), {
      method: 'GET',
      url: path,
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:43120',
        'sec-fetch-site': 'same-origin',
      },
      socket: { remoteAddress: '127.0.0.1' },
      destroy: vi.fn(),
    })
    let body: unknown
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      statusCode: 0,
      headers: new Map<string, string>(),
      setHeader(name: string, value: string) { response.headers.set(name.toLowerCase(), value) },
      removeHeader(name: string) { response.headers.delete(name.toLowerCase()) },
      end(value?: string) {
        response.writableEnded = true
        body = value === undefined || value === '' ? undefined : JSON.parse(value)
      },
    })
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`missing route ${path}`)
    await handler(req, response)
    return { status: response.statusCode, body }
  }

  return {
    context,
    request,
    /** Every soft-injection `apply` asked for, in registration order. */
    injectedNames: () => injections.map(injection => [...injection.names]),
    provide(name: string, value: unknown) {
      values.set(name, value)
      for (const injection of injections) activate(injection)
    },
    remove(name: string) {
      values.delete(name)
      for (const injection of injections) {
        if (!injection.active || !injection.names.includes(name)) continue
        for (const cleanup of injection.cleanups.splice(0).reverse()) cleanup()
        injection.active = false
      }
    },
    dispose() {
      for (const injection of injections.toReversed()) {
        for (const cleanup of injection.cleanups.splice(0).reverse()) cleanup()
        injection.active = false
      }
      for (const cleanup of globalCleanups.splice(0).reverse()) cleanup()
    },
  }
}

describe('community market Host capability lifecycle', () => {
  it('starts and serves state on a Host that has no storage domain', async () => {
    const harness = createHarness()
    apply(harness.context as never)

    // Durable storage is optional: `webServer` is the only hard requirement, and
    // the storage domain arrives (or does not) through a soft injection.
    expect(marketInject).toEqual(['webServer'])
    expect(harness.injectedNames()).toContainEqual(['storageDomain'])
    expect(harness.injectedNames()).toContainEqual(['pluginManager', 'profileContext'])
    await expect(harness.request(marketRoutes.state)).resolves.toMatchObject({
      status: 200,
      body: { sources: [] },
    })
    expect(harness.context.logger.error).not.toHaveBeenCalled()

    harness.dispose()
  })
  it('serves package operations once the official plugin manager and its profile are live', async () => {
    const harness = createHarness()
    apply(harness.context as never)
    const listBundles = vi.fn(async () => [])
    harness.provide('pluginManager', { listBundles, installBundle: vi.fn(), setBundleEnabled: vi.fn(), removeBundle: vi.fn() })
    harness.provide('profileContext', { name: 'next', dir: 'C:/fixture-profile' })
    await expect(harness.request(marketRoutes.installations)).resolves.toMatchObject({
      status: 200,
      body: { installations: [] },
    })
    expect(listBundles).toHaveBeenCalledOnce()
    await expect(harness.request(marketRoutes.state)).resolves.toMatchObject({
      body: { desktopActions: { openTerminal: false } },
    })
    harness.dispose()
  })
  it('keeps package routes fail-closed until the official manager is live and after it is disposed', async () => {
    const harness = createHarness()
    apply(harness.context as never)

    await expect(harness.request(marketRoutes.installable)).resolves.toMatchObject({ status: 503 })
    await expect(harness.request(marketRoutes.installations)).resolves.toMatchObject({ status: 503 })
    await expect(harness.request(marketRoutes.state)).resolves.toMatchObject({
      status: 200,
      body: { desktopActions: { openTerminal: false } },
    })

    harness.provide('desktopActions', { openTerminal: vi.fn() })
    await expect(harness.request(marketRoutes.state)).resolves.toMatchObject({
      body: { desktopActions: { openTerminal: true } },
    })

    harness.provide('profileContext', { name: 'web', dir: 'C:/fixture-profile' })
    harness.provide('pluginManager', { listBundles: vi.fn(async () => []), installBundle: vi.fn(), setBundleEnabled: vi.fn(), removeBundle: vi.fn() })
    await expect(harness.request(marketRoutes.installable)).resolves.toMatchObject({ status: 404 })

    harness.remove('pluginManager')
    await expect(harness.request(marketRoutes.installable)).resolves.toMatchObject({ status: 503 })
    await expect(harness.request(marketRoutes.installations)).resolves.toMatchObject({ status: 503 })

    harness.dispose()
  })
})
