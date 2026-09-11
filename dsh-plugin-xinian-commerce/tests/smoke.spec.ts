import { describe, expect, it } from 'vitest'
import { XinianService } from '../src/host/service.js'
import { registerXinianRoutes, type XinianWebServer } from '../src/host/routes.js'

describe('昔年插件无头闭环', () => {
  it('健康检查、创建商品和内容任务均可运行', async () => {
    const service = new XinianService(); const routes: any[] = []; const server: XinianWebServer = { port: 4317, register(route) { routes.push(route); return () => undefined } }; registerXinianRoutes(server, service)
    const call = async (path: string, method: string, value?: unknown) => { const route = routes.find(item => item.path === path); const req: any = { method, url: path, headers: { origin: 'http://127.0.0.1:4317' }, async *[Symbol.asyncIterator]() { if (value !== undefined) yield Buffer.from(JSON.stringify(value)) } }; const res: any = { setHeader() {}, end(body: string) { this.body = body } }; await route.handler(req, res); return { status: res.statusCode, data: JSON.parse(res.body) } }
    expect((await call('/api/xinian/health', 'GET')).data.status).toBe('ready')
    const product = await call('/api/xinian/products', 'POST', { title: '演示商品', category: '女装', price: 99, assetPaths: ['products/demo.png'] }); expect(product.status).toBe(201)
    const result = await service.content.generate(product.data.product.id); expect(result.state).toBe('DELIVERED'); expect(result.verification.delivery).toBe('DELIVERED')
  })
})
