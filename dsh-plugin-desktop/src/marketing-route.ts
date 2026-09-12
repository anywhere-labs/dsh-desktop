/** 营销引擎工作台：静态页面 + /api 反向代理到 MarketingSidecar。仿 product-visual-route.ts。 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { MarketingSidecar } from './marketing-sidecar.ts'

const ROUTE_PAGE = '/marketing-workbench'
const ROUTE_API = '/api/marketing'

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}
function sameOrigin(req: IncomingMessage, origin: string): boolean {
  return req.headers.origin === undefined || req.headers.origin === origin
}
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []; let size = 0
    req.on('data', chunk => { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += b.length; if (size > 50 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return } chunks.push(b) })
    req.on('end', () => resolvePromise(Buffer.concat(chunks))); req.on('error', reject)
  })
}
async function proxy(req: IncomingMessage, res: ServerResponse, sidecar: MarketingSidecar): Promise<void> {
  const runtime = await sidecar.ensureReady()
  if (runtime.state !== 'READY') return sendJson(res, 503, { error: '营销引擎服务不可用', runtime })
  // /api/marketing/* -> 后端 /api/* ; /marketing-workbench -> 后端 /workbench
  const suffix = req.url?.startsWith(ROUTE_API) ? req.url.slice(ROUTE_API.length) : req.url ?? ''
  const back = suffix === '/' || suffix === '' ? '/workbench' : suffix
  const target = `http://127.0.0.1:${String(runtime.port)}${back}`
  try {
    const headers = new Headers()
    for (const name of ['content-type', 'accept']) { const value = req.headers[name]; if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value) }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
    const response = await fetch(target, { method: req.method, headers, body, duplex: body ? 'half' : undefined } as RequestInit)
    res.statusCode = response.status
    const ct = response.headers.get('content-type'); if (ct) res.setHeader('content-type', ct)
    res.setHeader('cache-control', 'no-store'); res.end(Buffer.from(await response.arrayBuffer()))
  } catch (cause) { sendJson(res, 502, { error: '营销引擎代理失败', detail: cause instanceof Error ? cause.message : String(cause) }) }
}

export function registerMarketingRoutes(ctx: Context): () => void {
  const sidecar = new MarketingSidecar()
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const registrations = [
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_PAGE, handler: (req, res) => proxy(req, res, sidecar) }),
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_API, handler: (req, res) => {
      if (!sameOrigin(req, origin)) return sendJson(res, 403, { error: '营销引擎 API 需本地同源访问' })
      return proxy(req, res, sidecar)
    } }),
    ctx.webServer.register({ kind: 'exact', path: `${ROUTE_API}/runtime`, handler: async (req, res) => {
      if (req.method !== 'GET' || !sameOrigin(req, origin)) return sendJson(res, 405, { error: 'runtime 状态需本地同源 GET' })
      sendJson(res, 200, await sidecar.ensureReady())
    } }),
  ]
  return () => { for (const registration of registrations) registration(); void sidecar.stop() }
}
