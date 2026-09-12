import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, extname, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

const ROUTE_GENERATE = '/api/video-workbench/generate'
const ROUTE_STATUS = '/api/video-workbench/jobs'
const ROUTE_PAGE = '/video-workbench'
const MAX_BODY_BYTES = 32 * 1024

export type VideoWorkbenchJobState = 'QUEUED' | 'GENERATING' | 'COMPLETED' | 'FAILED'

export interface VideoWorkbenchJob {
  readonly runId: string
  readonly idempotencyKey: string
  readonly provider: 'libtv-cli'
  readonly state: VideoWorkbenchJobState
  readonly projectId: string
  readonly node: string
  readonly providerJobId?: string
  readonly output?: unknown
  readonly error?: string
  readonly createdAt: string
  readonly updatedAt: string
}

interface GenerateBody {
  readonly projectId?: unknown
  readonly node?: unknown
  readonly idempotencyKey?: unknown
  readonly confirmed?: unknown
  readonly approvalId?: unknown
}

const jobs = new Map<string, VideoWorkbenchJob>()

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function readJson(req: IncomingMessage): Promise<GenerateBody> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        const value: unknown = JSON.parse(body || '{}')
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('request must be an object')
        resolve(value as GenerateBody)
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function requiredString(value: unknown, field: string, maxLength = 300): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function updateJob(runId: string, patch: Partial<VideoWorkbenchJob>): VideoWorkbenchJob | undefined {
  const current = [...jobs.values()].find(job => job.runId === runId)
  if (current === undefined) return undefined
  const next: VideoWorkbenchJob = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  jobs.set(current.idempotencyKey, next)
  return next
}

function runLibTv(job: VideoWorkbenchJob): void {
  updateJob(job.runId, { state: 'GENERATING' })
  const command = process.env.LIBTV_BIN
    ?? `${process.env.HOME ?? ''}/.local/bin/libtv`
  const child = spawn(command, ['node', job.node, '--project', job.projectId, '--run'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', cause => {
    updateJob(job.runId, { state: 'FAILED', error: cause instanceof Error ? cause.message : String(cause) })
  })
  child.on('close', code => {
    if (code === 0) {
      let output: unknown = stdout.trim()
      try { output = JSON.parse(stdout) as unknown } catch { /* preserve CLI text */ }
      updateJob(job.runId, { state: 'COMPLETED', output })
      return
    }
    const detail = (stderr.trim() || stdout.trim() || `libtv exited with code ${String(code)}`).slice(-4000)
    updateJob(job.runId, { state: 'FAILED', error: detail })
  })
}

function isLocalSameOrigin(req: IncomingMessage, expectedOrigin: string): boolean {
  const origin = req.headers.origin
  return origin === undefined || origin === expectedOrigin
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

function workbenchDistRoot(): string {
  const configured = process.env.DSH_VIDEO_WORKBENCH_DIST?.trim()
  if (configured) return resolve(configured)
  const fromCurrentDirectory = resolve(process.cwd(), 'dsh-video-workbench/dist')
  const fromPlugin = resolve(dirname(fileURLToPath(import.meta.url)), '../../dsh-video-workbench/dist')
  const fromParentDirectory = resolve(process.cwd(), '..', 'dsh-video-workbench/dist')
  return [fromCurrentDirectory, fromPlugin, fromParentDirectory].find(path => existsSync(path)) ?? fromCurrentDirectory
}

async function serveWorkbenchFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'video workbench page requires GET' })
    return
  }
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const suffix = pathname === ROUTE_PAGE || pathname === `${ROUTE_PAGE}/`
    ? 'index.html'
    : pathname.slice(`${ROUTE_PAGE}/`.length)
  let decoded: string
  try { decoded = decodeURIComponent(suffix) } catch {
    sendJson(res, 400, { error: 'invalid video workbench asset path' })
    return
  }
  if (decoded.includes('\u0000') || decoded.includes('..') || decoded.includes('\\')) {
    sendJson(res, 400, { error: 'invalid video workbench asset path' })
    return
  }
  const root = resolve(workbenchDistRoot())
  const filename = resolve(root, decoded)
  const relativeName = relative(root, filename)
  if (relativeName.startsWith('..') || relativeName.includes('\\') || relativeName === '') {
    sendJson(res, 400, { error: 'invalid video workbench asset path' })
    return
  }
  try {
    const info = await stat(filename)
    if (!info.isFile()) throw new Error('not a file')
    const body = await readFile(filename)
    res.statusCode = 200
    res.setHeader('content-type', CONTENT_TYPES[extname(filename).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('cache-control', extname(filename) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-length', String(body.byteLength))
    if (req.method === 'HEAD') res.end()
    else res.end(body)
  } catch {
    sendJson(res, 404, { error: 'video workbench asset not found', distRoot: root })
  }
}

/** Serve the built workbench from the same DSH origin so its real adapter can call local routes. */
export function registerVideoWorkbenchPageRoute(ctx: Context): () => void {
  const registrations = [
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_PAGE, handler: serveWorkbenchFile }),
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PAGE,
      handler: (_req, res) => {
        res.statusCode = 302
        res.setHeader('location', `${ROUTE_PAGE}/`)
        res.end()
      },
    }),
  ]
  return () => { for (const registration of registrations) registration() }
}

/** Register the real-provider bridge. Secrets stay inside the local LibTV CLI. */
export function registerVideoWorkbenchRoutes(ctx: Context, rendererOrigin: string): () => void {
  const registrations = [
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_GENERATE,
      handler: async (req, res) => {
        if (req.method !== 'POST' || !isLocalSameOrigin(req, rendererOrigin)) {
          sendJson(res, 405, { error: 'video generation requires a local same-origin POST' })
          return
        }
        try {
          const body = await readJson(req)
          const projectId = requiredString(body.projectId, 'projectId', 100)
          const node = requiredString(body.node, 'node', 200)
          const idempotencyKey = requiredString(body.idempotencyKey, 'idempotencyKey', 200)
          const approvalId = requiredString(body.approvalId, 'approvalId', 200)
          if (body.confirmed !== true) throw new Error('generation requires explicit confirmation')
          const existing = jobs.get(idempotencyKey)
          if (existing !== undefined) {
            sendJson(res, 200, existing)
            return
          }
          const now = new Date().toISOString()
          const job: VideoWorkbenchJob = {
            runId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            idempotencyKey,
            provider: 'libtv-cli',
            state: 'QUEUED',
            projectId,
            node,
            createdAt: now,
            updatedAt: now,
          }
          jobs.set(idempotencyKey, job)
          void approvalId
          runLibTv(job)
          sendJson(res, 202, job)
        } catch (cause) {
          sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'invalid generation request' })
        }
      },
    }),
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_STATUS,
      handler: (req, res) => {
        if (req.method !== 'GET' || !isLocalSameOrigin(req, rendererOrigin)) {
          sendJson(res, 405, { error: 'video job status requires a local same-origin GET' })
          return
        }
        const runId = new URL(req.url ?? '/', 'http://localhost').pathname.slice(`${ROUTE_STATUS}/`.length)
        const job = [...jobs.values()].find(item => item.runId === runId)
        if (job === undefined) {
          sendJson(res, 404, { error: 'video job not found' })
          return
        }
        sendJson(res, 200, job)
      },
    }),
  ]
  return () => { for (const registration of registrations) registration() }
}
