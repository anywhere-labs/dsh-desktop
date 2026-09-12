import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

const ROUTE_PAGE = '/dbskill-workbench'
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function workbenchRoot(): string {
  const configured = process.env.DSH_DBSKILL_WORKBENCH_ROOT?.trim()
  if (configured) return resolve(configured)
  const fromWorkspace = resolve(process.cwd(), 'dsh-plugin-desktop/dbskill-workbench')
  const fromPlugin = resolve(dirname(fileURLToPath(import.meta.url)), '../dbskill-workbench')
  const fromParent = resolve(process.cwd(), '..', 'dsh-plugin-desktop/dbskill-workbench')
  return [fromWorkspace, fromPlugin, fromParent].find(path => existsSync(path)) ?? fromWorkspace
}

function sendText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(message)
}

function desktopHomePath(requestUrl: string): string {
  const current = new URL(requestUrl, 'http://localhost')
  const home = new URL('/', current.origin)
  for (const [key, value] of current.searchParams) {
    if (key.startsWith('dsh-desktop-')) home.searchParams.append(key, value)
  }
  return `${home.pathname}${home.search}`.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

async function serveWorkbench(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed')
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const suffix = pathname === ROUTE_PAGE || pathname === `${ROUTE_PAGE}/`
    ? 'index.html'
    : pathname.slice(`${ROUTE_PAGE}/`.length)
  let decoded = ''
  try { decoded = decodeURIComponent(suffix) } catch { return sendText(res, 400, 'invalid asset path') }
  if (!decoded || decoded.includes('\u0000') || decoded.includes('..') || decoded.includes('\\')) {
    return sendText(res, 400, 'invalid asset path')
  }
  const root = resolve(workbenchRoot())
  const filename = resolve(root, decoded)
  const relativeName = relative(root, filename)
  if (relativeName.startsWith('..') || relativeName.includes('\\')) return sendText(res, 400, 'invalid asset path')
  try {
    const info = await stat(filename)
    if (!info.isFile()) throw new Error('not a file')
    let body = await readFile(filename)
    if (decoded === 'index.html') {
      const homePath = desktopHomePath(req.url ?? '/')
      body = Buffer.from(body.toString('utf8').replace('data-home', `data-home data-dsh-home-url="${homePath}"`))
    }
    res.statusCode = 200
    res.setHeader('content-type', CONTENT_TYPES[extname(filename).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('cache-control', extname(filename) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-length', String(body.byteLength))
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    sendText(res, 404, 'dbskill workbench asset not found')
  }
}

export function registerDbskillWorkbenchRoutes(ctx: Context): () => void {
  const registrations = [
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PAGE,
      handler: (_req, res) => {
        res.statusCode = 302
        res.setHeader('location', `${ROUTE_PAGE}/`)
        res.end()
      },
    }),
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_PAGE, handler: serveWorkbench }),
  ]
  return () => { for (const registration of registrations) registration() }
}
