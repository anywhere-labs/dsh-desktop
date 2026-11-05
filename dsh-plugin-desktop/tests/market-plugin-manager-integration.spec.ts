import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

const PACKAGE_NAME = 'dsh-plugin-market-integration'
const PACKAGE_VERSION = '1.2.3'

interface CommunityMarketModule {
  readonly name: string
  readonly inject: string[]
  readonly apply: (ctx: Context) => void
  readonly marketRoutes: {
    readonly installations: string
    readonly installationEnabled: string
    readonly operationPreview: string
    readonly operationExecute: string
  }
}

/** The official manager's bundle record, as the Market reads it through `listBundles`. */
interface OfficialBundle {
  readonly name: string
  readonly version: string
  readonly official: boolean
  readonly availability: 'profile'
  readonly enabled: boolean
  readonly installed: boolean
  readonly optional: boolean
  readonly removable: boolean
  readonly rows: never[]
  readonly overrides: never[]
}

async function createWebServer() {
  type Handler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  const handlers = new Map<string, Handler>()
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    const handler = handlers.get(path)
    if (handler === undefined) {
      response.statusCode = 404
      response.end()
      return
    }
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.writableEnded) {
        response.statusCode = 500
        response.end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture web server did not bind TCP')
  const origin = `http://127.0.0.1:${address.port}`
  const headers = { origin, 'sec-fetch-site': 'same-origin' }
  return {
    service: {
      port: address.port,
      register(route: { path: string; handler: Handler }) {
        handlers.set(route.path, route.handler)
        return () => { handlers.delete(route.path) }
      },
    },
    async get(path: string) {
      const response = await fetch(`${origin}${path}`, { headers })
      return { status: response.status, body: await response.json() as Record<string, unknown> }
    },
    async post(path: string, body: unknown) {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() as Record<string, unknown> }
    },
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }),
  }
}

describe('community market and official plugin manager integration', () => {
  it('routes market inventory, toggles and uninstall through the Host pluginManager service', async () => {
    const marketModuleUrl = new URL('../../dsh-community-market/src/index.js', import.meta.url).href
    const market = await import(marketModuleUrl) as CommunityMarketModule
    const root = await mkdtemp(join(tmpdir(), 'dsh-market-plugin-manager-'))
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    const ctx = new Context()
    const webServer = await createWebServer()
    let bundles: OfficialBundle[] = [{
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      official: false,
      availability: 'profile',
      enabled: true,
      installed: true,
      optional: false,
      removable: true,
      rows: [],
      overrides: [],
    }]
    const pluginManager = {
      listBundles: vi.fn(async () => bundles),
      installBundle: vi.fn(),
      setBundleEnabled: vi.fn(async (name: string, enabled: boolean) => {
        bundles = bundles.map(bundle => bundle.name === name ? { ...bundle, enabled } : bundle)
        return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
      }),
      removeBundle: vi.fn(async (name: string) => {
        bundles = bundles.filter(bundle => bundle.name !== name)
        return { changed: true, application: 'applied', stage: 'remove', target: name }
      }),
    }
    try {
      ctx.provide('webServer', webServer.service as never)
      // The Market needs only what every dsh Host supplies: the official manager and the profile it manages.
      ctx.provide('profileContext', { name: 'web', dir: profileDir } as never)
      ctx.provide('pluginManager', pluginManager as never)
      await ctx.plugin({ name: market.name, inject: market.inject, apply: market.apply })

      await expect(webServer.get(market.marketRoutes.installations)).resolves.toMatchObject({
        status: 200,
        body: {
          installations: [{
            packageName: PACKAGE_NAME, version: PACKAGE_VERSION, enabled: true, installed: true, toggleable: true, removable: true,
          }],
        },
      })
      await expect(webServer.post(market.marketRoutes.installationEnabled, {
        packageName: PACKAGE_NAME,
        enabled: false,
      })).resolves.toMatchObject({
        status: 200,
        body: { packageName: PACKAGE_NAME, enabled: false, application: 'applied' },
      })
      expect(pluginManager.setBundleEnabled).toHaveBeenCalledWith(PACKAGE_NAME, false)

      const preview = await webServer.post(market.marketRoutes.operationPreview, {
        action: 'uninstall',
        packageName: PACKAGE_NAME,
      })
      expect(preview).toMatchObject({
        status: 200,
        body: { action: 'uninstall', packageName: PACKAGE_NAME, version: PACKAGE_VERSION, profileName: 'web' },
      })
      expect(preview.body.previewId).toEqual(expect.any(String))
      const executed = await webServer.post(market.marketRoutes.operationExecute, {
        previewId: preview.body.previewId,
      })
      expect(executed).toMatchObject({
        status: 200,
        body: { action: 'uninstall', packageName: PACKAGE_NAME, application: 'applied' },
      })
      expect(executed.body).not.toHaveProperty('restartToken')
      expect(pluginManager.removeBundle).toHaveBeenCalledWith(PACKAGE_NAME)
      expect(pluginManager.installBundle).not.toHaveBeenCalled()
      await expect(webServer.get(market.marketRoutes.installations)).resolves.toMatchObject({
        status: 200,
        body: { installations: [] },
      })
    } finally {
      await ctx.fiber.dispose()
      await webServer.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})
