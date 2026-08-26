import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
const require = createRequire(import.meta.url)
const LlmPiAi = require('@deepseek-ai/dsh-llm-pi-ai') as any

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

async function listingServer(body: string): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {})
  return ctx
}

describe('Desktop pi-ai model discovery patch', () => {
  it('keeps built-in providers offline when no endpoint override is present', async () => {
    const server = await listingServer(JSON.stringify({ data: [{ id: 'from-endpoint-only' }] }))
    const ctx = await harness()

    const models = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'deepseek' })

    expect(models.length).toBeGreaterThan(0)
    expect(server.paths).toEqual([])
  })

  it('probes a built-in provider live when baseURL is explicitly overridden with a listable protocol', async () => {
    const ctx = await harness()
    const catalog = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'deepseek' })
    const known = catalog.find(model =>
      typeof model.name === 'string'
      && typeof model.contextWindow === 'number'
      && typeof model.maxTokens === 'number')
    if (known === undefined) throw new Error('deepseek catalog did not expose an enrichable model')
    const server = await listingServer(JSON.stringify({
      data: [
        { id: known.id, display_name: 'Live Name' },
        { id: 'fresh-from-endpoint' },
      ],
    }))

    const models = await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'deepseek',
      baseURL: `${server.url}/v1`,
      api: 'openai-completions',
    })

    expect(server.paths).toEqual(['/v1/models'])
    expect(server.headers[0]?.authorization).toBeUndefined()
    expect(models).toEqual([
      {
        id: known.id,
        name: 'Live Name',
        contextWindow: known.contextWindow,
        maxTokens: known.maxTokens,
      },
      { id: 'fresh-from-endpoint' },
    ])
  })

  it('keeps the offline catalog for built-in providers when the override protocol is not listable', async () => {
    const server = await listingServer(JSON.stringify({ data: [{ id: 'from-endpoint-only' }] }))
    const ctx = await harness()
    const catalog = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'deepseek' })

    const models = await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'deepseek',
      baseURL: server.url,
      api: 'anthropic-messages',
    })

    expect(models.map(model => model.id).sort())
      .toEqual(catalog.map(model => model.id).sort())
    expect(server.paths).toEqual([])
  })
})
