import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, extname, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ProductVisualSidecar } from './product-visual-sidecar.ts'

const ROUTE_PAGE = '/product-visual-workbench'
const ROUTE_API = '/api/product-visual'
const ROUTE_CONFIG = '/api/config'
const ROUTE_BACKEND_PREFIXES = [
  '/api/account',
  '/api/attribution',
  '/api/benchmark',
  '/api/brand-data',
  '/api/brand-strategy',
  '/api/dashboard',
  '/api/edit',
  '/api/external',
  '/api/hotspot',
  '/api/live-clips',
  '/api/liveclip',
  '/api/liveclip-feedback',
  '/api/material',
  '/api/publish',
  '/api/report',
  '/api/script',
  '/api/tasks',
  '/api/topic',
  '/api/trace',
  '/api/video-clip-viral-extraction',
  '/api/video-generation',
] as const
const MAX_PROXY_BODY_BYTES = 50 * 1024 * 1024

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function distRoot(): string {
  const configured = process.env.DSH_PRODUCT_VISUAL_DIST?.trim()
  if (configured) return resolve(configured)
  const fromCurrentDirectory = resolve(process.cwd(), 'dsh-product-visual-workbench/dist')
  const fromPlugin = resolve(dirname(fileURLToPath(import.meta.url)), '../../dsh-product-visual-workbench/dist')
  const fromParentDirectory = resolve(process.cwd(), '..', 'dsh-product-visual-workbench/dist')
  return [fromCurrentDirectory, fromPlugin, fromParentDirectory].find(path => existsSync(path)) ?? fromCurrentDirectory
}

function sameOrigin(req: IncomingMessage, origin: string): boolean {
  return req.headers.origin === undefined || req.headers.origin === origin
}

async function serveFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'product visual page requires GET' })
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const suffix = pathname === ROUTE_PAGE || pathname === `${ROUTE_PAGE}/` ? 'index.html' : pathname.slice(`${ROUTE_PAGE}/`.length)
  let decoded = ''
  try { decoded = decodeURIComponent(suffix) } catch { return sendJson(res, 400, { error: 'invalid product visual asset path' }) }
  if (!decoded || decoded.includes('\u0000') || decoded.includes('..') || decoded.includes('\\')) return sendJson(res, 400, { error: 'invalid product visual asset path' })
  const root = resolve(distRoot())
  const filename = resolve(root, decoded)
  const relativeName = relative(root, filename)
  if (relativeName.startsWith('..') || relativeName.includes('\\')) return sendJson(res, 400, { error: 'invalid product visual asset path' })
  try {
    const info = await stat(filename)
    if (!info.isFile()) throw new Error('not a file')
    const body = await readFile(filename)
    res.statusCode = 200
    res.setHeader('content-type', CONTENT_TYPES[extname(filename).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('cache-control', extname(filename) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-length', String(body.byteLength))
    if (req.method === 'HEAD') res.end(); else res.end(body)
  } catch { sendJson(res, 404, { error: 'product visual asset not found' }) }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_PROXY_BODY_BYTES) { reject(new Error('product visual request body too large')); req.destroy(); return }
      chunks.push(buffer)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function proxy(req: IncomingMessage, res: ServerResponse, sidecar: ProductVisualSidecar): Promise<void> {
  const runtime = await sidecar.ensureReady()
  if (runtime.state !== 'READY') return sendJson(res, 503, { error: 'product visual service unavailable', runtime })
  try {
    const target = `http://127.0.0.1:${String(runtime.port)}${req.url ?? ROUTE_API}`
    const headers = new Headers()
    for (const name of ['content-type', 'accept']) {
      const value = req.headers[name]
      if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value)
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
    const response = await fetch(target, { method: req.method, headers, body, duplex: body ? 'half' : undefined } as RequestInit)
    res.statusCode = response.status
    const contentType = response.headers.get('content-type')
    if (contentType) res.setHeader('content-type', contentType)
    res.setHeader('cache-control', 'no-store')
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (cause) {
    sendJson(res, 502, { error: 'product visual service request failed', detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

export function registerProductVisualRoutes(ctx: Context): () => void {
  const sidecar = new ProductVisualSidecar()
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const registrations = [
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_PAGE, handler: serveFile }),
    ctx.webServer.register({ kind: 'exact', path: ROUTE_PAGE, handler: (_req, res) => { res.statusCode = 302; res.setHeader('location', `${ROUTE_PAGE}/`); res.end() } }),
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_API, handler: (req, res) => {
      if (!sameOrigin(req, origin)) return sendJson(res, 403, { error: 'product visual API requires local same-origin access' })
      return proxy(req, res, sidecar)
    } }),
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_CONFIG, handler: (req, res) => {
      if (!sameOrigin(req, origin)) return sendJson(res, 403, { error: 'product visual config requires local same-origin access' })
      return proxy(req, res, sidecar)
    } }),
    ...ROUTE_BACKEND_PREFIXES.map(path => ctx.webServer.register({ kind: 'prefix', path, handler: (req, res) => {
      if (!sameOrigin(req, origin)) return sendJson(res, 403, { error: 'product visual API requires local same-origin access' })
      return proxy(req, res, sidecar)
    } })),
    ctx.webServer.register({ kind: 'exact', path: `${ROUTE_API}/runtime`, handler: async (req, res) => {
      if (req.method !== 'GET' || !sameOrigin(req, origin)) return sendJson(res, 405, { error: 'runtime status requires local same-origin GET' })
      sendJson(res, 200, await sidecar.ensureReady())
    } }),
  ]
  return () => { for (const registration of registrations) registration(); void sidecar.stop() }
}
