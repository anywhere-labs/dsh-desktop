import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { DeepThinkSidecar } from './deepthink-sidecar.ts'

const ROUTE = '/deepthink'

const RETURN_CONTROL = `<script>(function(){var W=window.WebSocket;window.WebSocket=function(u,p){try{var x=new URL(u,window.location.href);if(x.pathname.indexOf('/deepthink/ws')===0){x.port='9899';x.pathname=x.pathname.slice('/deepthink'.length);u=x.href}}catch(_){}return p===undefined?new W(u):new W(u,p)};window.WebSocket.prototype=W.prototype;var b=document.createElement('button');b.type='button';b.textContent='返回 DSH 首页';b.setAttribute('aria-label','返回 DeepSeek Harness 首页');b.setAttribute('data-dsh-return','home');b.setAttribute('data-dsh-return-target','/');b.style.cssText='position:fixed;top:12px;left:12px;z-index:2147483647;border:1px solid rgba(148,163,184,.45);border-radius:10px;padding:8px 12px;background:rgba(15,23,42,.88);color:#e2e8f0;font:600 13px system-ui;cursor:pointer;box-shadow:0 8px 24px rgba(15,23,42,.22)';b.onclick=function(){var go=function(){var c=new URL(window.location.href),h=new URL('/',c.origin);c.searchParams.forEach(function(v,k){if(k.indexOf('dsh-desktop-')===0)h.searchParams.append(k,v)});window.location.replace(h.href)};if(document.startViewTransition)document.startViewTransition(go);else go()};document.body.appendChild(b)})()</script>`

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(value))
}

function sameOrigin(req: IncomingMessage, origin: string): boolean { return req.headers.origin === undefined || req.headers.origin === origin }

function routedLocation(location: string, source: URL): string {
  const target = new URL(location, source.origin)
  for (const [key, value] of source.searchParams) {
    if (key.startsWith('dsh-desktop-') && !target.searchParams.has(key)) target.searchParams.append(key, value)
  }
  const pathname = target.pathname.startsWith(`${ROUTE}/`) ? target.pathname : `${ROUTE}${target.pathname}`
  return `${pathname}${target.search}${target.hash}`
}

export function registerDeepThinkRoutes(ctx: Context): () => void {
  const sidecar = new DeepThinkSidecar()
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const proxy = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const runtime = await sidecar.ensureReady()
    if (runtime.state !== 'READY') return json(res, 503, { error: 'DeepThink service unavailable', runtime })
    const incoming = new URL(req.url ?? `${ROUTE}/`, origin)
    const suffix = incoming.pathname.slice(ROUTE.length) || '/'
    const target = `http://127.0.0.1:${String(runtime.port)}${suffix}${incoming.search}`
    try {
      const headers = new Headers()
      for (const name of ['content-type', 'accept', 'cookie', 'authorization']) { const value = req.headers[name]; if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value) }
      const chunks: Buffer[] = []
      if (req.method !== 'GET' && req.method !== 'HEAD') for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const response = await fetch(target, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, duplex: chunks.length ? 'half' : undefined } as RequestInit)
      res.statusCode = response.status
      const contentType = response.headers.get('content-type'); if (contentType) res.setHeader('content-type', contentType)
      const location = response.headers.get('location'); if (location) res.setHeader('location', routedLocation(location, incoming))
      let payload = Buffer.from(await response.arrayBuffer())
      if (contentType?.includes('text/html')) payload = Buffer.from(payload.toString('utf8').replace('</body>', `${RETURN_CONTROL}</body>`))
      res.setHeader('cache-control', 'no-store'); res.end(payload)
    } catch (cause) { json(res, 502, { error: 'DeepThink proxy failed', detail: cause instanceof Error ? cause.message : String(cause) }) }
  }
  const registrations = [
    ctx.webServer.register({ kind: 'exact', path: ROUTE, handler: (_req, res) => { res.statusCode = 302; res.setHeader('location', `${ROUTE}/`); res.end() } }),
    ctx.webServer.register({ kind: 'exact', path: `${ROUTE}/runtime`, handler: async (_req, res) => json(res, 200, await sidecar.ensureReady()) }),
    ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: (req, res) => { if (!sameOrigin(req, origin)) return json(res, 403, { error: 'DeepThink requires same-origin access' }); return proxy(req, res) } }),
  ]
  return () => { for (const registration of registrations) registration(); void sidecar.stop() }
}
