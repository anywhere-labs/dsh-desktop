import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'

const packageRoot = new URL('../', import.meta.url)
const patch = readFileSync(new URL(
  '../../patches/dsh-client-connection@0.1.6-alpha.2.patch',
  import.meta.url,
), 'utf8')

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
})

describe('connection GET/HEAD body-mode patch (#962)', () => {
  it('never hands undici a GET/HEAD Request with a body', () => {
    for (const marker of [
      'const effectiveBodyMode = method === "GET" || method === "HEAD" ? "buffered" : bodyMode;',
      'if (effectiveBodyMode === "buffered") {',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('defaults undeclared GET/HEAD routes to buffered at registration', () => {
    expect(patch).toContain('requestBody: route.requestBody ?? (methods.has("GET") || methods.has("HEAD") ? "buffered" : "streaming")')
  })

  it('exposes requestBody as optional so plugin authors can compile against it', () => {
    expect(patch).toContain('readonly requestBody?: ConnectionRequestBodyMode')
  })

  it('applies the patch to the installed beta runtime', () => {
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const manifestPath = workspaceRequire.resolve('@deepseek-ai/dsh-client-connection/package.json')
    const installed = readFileSync(join(dirname(manifestPath), 'lib/index.js'), 'utf8')
    expect(installed).toContain('const effectiveBodyMode = method === "GET" || method === "HEAD" ? "buffered" : bodyMode;')
    expect(installed).toContain('requestBody: route.requestBody ?? (methods.has("GET") || methods.has("HEAD") ? "buffered" : "streaming")')
  })

  it('resolves body handling for GET/HEAD routes without a declared requestBody', async () => {
    const context = new Context()
    contexts.push(context)
    const service = new HostConnectionService(
      context.root,
      [],
      { isAuthenticated: () => true } as never,
    )
    service.fetch.register({
      path: '/api/ping',
      methods: ['GET'],
      fetch: async () => new Response('pong'),
    })
    const handler = service.createSharedFetchHandler('/api')
    expect(handler.requestBodyMode({
      method: 'GET',
      url: new URL('http://dsh.internal/api/ping'),
    })).toBe('buffered')
    expect(handler.requestBodyMode({
      method: 'HEAD',
      url: new URL('http://dsh.internal/api/ping'),
    })).toBe('buffered')
    const response = await handler.fetch(new Request('http://dsh.internal/api/ping'))
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('pong')
  })
})
