import { describe, expect, it } from 'vitest'
import { XinianService } from '../src/host/service.js'
import { registerXinianRoutes, type XinianWebServer } from '../src/host/routes.js'

class TestServer implements XinianWebServer {
  readonly port = 4317
  readonly routes: Array<{ path: string; handler: any }> = []
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: any }): () => void { this.routes.push(route); return () => undefined }
  async request(path: string, method: string, body?: unknown) {
    const route = this.routes.find(item => item.path === path || (item.path.endsWith('/') && path.startsWith(item.path)))
    if (!route) throw new Error('route not found')
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req: any = { method, url: path, headers: { origin: `http://127.0.0.1:${this.port}` }, async *[Symbol.asyncIterator]() { yield* chunks } }
    const result: any = { headers: {}, setHeader(key: string, value: string) { this.headers[key] = value }, end(value: string) { this.body = value } }
    await route.handler(req, result)
    return { status: result.statusCode, body: JSON.parse(result.body ?? '{}') }
  }
}

describe('昔年电商 Host API', () => {
  it('返回健康状态并创建商品', async () => {
    const server = new TestServer(); registerXinianRoutes(server, new XinianService())
    expect((await server.request('/api/xinian/health', 'GET')).body.status).toBe('ready')
    const created = await server.request('/api/xinian/products', 'POST', { title: '风衣', category: '女装', price: 299, assetPaths: ['products/cover.png'] })
    expect(created.status).toBe(201); expect(created.body.product.title).toBe('风衣')
  })

  it('缺少商品输入时将任务置为等待输入', async () => {
    const server = new TestServer(); registerXinianRoutes(server, new XinianService())
    const result = await server.request('/api/xinian/tasks', 'POST', { type: 'content', storeIds: [], input: {}, approvalRequired: false })
    expect(result.status).toBe(201); expect(result.body.task.state).toBe('WAITING_INPUT')
  })
})
