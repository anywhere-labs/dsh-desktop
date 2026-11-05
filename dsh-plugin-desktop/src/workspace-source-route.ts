import type { IncomingMessage, ServerResponse } from 'node:http'
import { WorkspaceSourceRoots } from './workspace-source-roots.ts'

export const DESKTOP_WORKSPACE_SOURCES_PATH = '/_dsh/desktop/workspace-sources'
const MAX_REQUEST_BYTES = 16 * 1024

type SourceMutation =
  | { readonly action: 'add'; readonly workspacePath: string }
  | { readonly action: 'remove' | 'select'; readonly workspacePath: string; readonly sourcePath: string }

function finishJson(res: ServerResponse, statusCode: number, value: object): void {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function parseMutation(value: unknown): SourceMutation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (typeof input.workspacePath !== 'string') return undefined
  if (input.action === 'add') {
    return Object.keys(input).length === 2 && !('sourcePath' in input)
      ? { action: 'add', workspacePath: input.workspacePath }
      : undefined
  }
  if ((input.action !== 'remove' && input.action !== 'select')
    || typeof input.sourcePath !== 'string'
    || Object.keys(input).length !== 3) return undefined
  return { action: input.action, workspacePath: input.workspacePath, sourcePath: input.sourcePath }
}

function isAbsolutePath(value: string, platform: NodeJS.Platform): boolean {
  return value.length > 0 && (platform === 'win32'
    ? /^[a-z]:[\\/]/iu.test(value) || /^\\\\[^\\]+\\[^\\]+/u.test(value)
    : value.startsWith('/'))
}

/** Same-origin, loopback-only route for managing Desktop-owned source associations.
 * @param req - request received by the Desktop WebServer.
 * @param res - response owned by the Desktop WebServer.
 * @param expectedOrigin - loopback renderer origin allowed to manage source roots.
 * @param roots - persistent associations between primary Workspaces and source roots.
 * @param pickDirectory - native folder chooser owned by the Electron Host.
 * @param validateDirectory - Desktop storage policy for the selected folder.
 * @param platform - operating system used to validate paths and support.
 */
export async function handleDesktopWorkspaceSourcesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  roots: WorkspaceSourceRoots,
  pickDirectory: () => Promise<string | null>,
  validateDirectory: (path: string) => Promise<boolean>,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const origin = req.headers.origin
  const fetchSite = req.headers['sec-fetch-site']
  if (origin !== expectedOrigin && !(origin === undefined && fetchSite === 'same-origin')) {
    return finishJson(res, 403, { error: 'forbidden' })
  }

  if (req.method === 'GET') {
    let workspacePath: string | null = null
    try {
      workspacePath = new URL(req.url ?? '/', expectedOrigin).searchParams.get('workspacePath')
    } catch {}
    if (workspacePath === null || !isAbsolutePath(workspacePath, platform)) {
      return finishJson(res, 400, { error: 'invalid workspace path' })
    }
    try {
      return finishJson(res, 200, {
        sources: roots.list(workspacePath),
        selectedRoot: roots.selectedRoot(workspacePath),
      })
    } catch {
      return finishJson(res, 400, { error: 'workspace path is unavailable' })
    }
  }

  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finishJson(res, 415, { error: 'content type must be application/json' })
  }

  let mutation: SourceMutation | undefined
  try {
    mutation = parseMutation(await readJson(req))
  } catch {
    return finishJson(res, 400, { error: 'invalid source request' })
  }
  if (mutation === undefined
    || !isAbsolutePath(mutation.workspacePath, platform)
    || (mutation.action !== 'add' && !isAbsolutePath(mutation.sourcePath, platform))) {
    return finishJson(res, 400, { error: 'invalid source request' })
  }
  if (platform === 'win32'
    && (mutation.action === 'add' || (mutation.action === 'select' && mutation.sourcePath !== mutation.workspacePath))) {
    return finishJson(res, 501, { error: 'attached source access is not supported on Windows' })
  }

  if (mutation.action === 'add') {
    let sourcePath: string | null
    try {
      sourcePath = await pickDirectory()
    } catch {
      return finishJson(res, 500, { error: 'native directory picker failed' })
    }
    if (sourcePath === null) {
      try {
        return finishJson(res, 200, {
          sources: roots.list(mutation.workspacePath),
          selectedRoot: roots.selectedRoot(mutation.workspacePath),
          cancelled: true,
        })
      } catch {
        return finishJson(res, 400, { error: 'workspace path is unavailable' })
      }
    }
    if (!isAbsolutePath(sourcePath, platform)) {
      return finishJson(res, 500, { error: 'native directory picker returned an invalid path' })
    }
    try {
      if (!await validateDirectory(sourcePath)) {
        return finishJson(res, 403, { error: 'selected source folder is not allowed' })
      }
    } catch {
      return finishJson(res, 500, { error: 'directory validation failed' })
    }
    try {
      return finishJson(res, 200, {
        sources: roots.add(mutation.workspacePath, sourcePath),
        selectedRoot: roots.selectedRoot(mutation.workspacePath),
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      const statusCode = /overlap|at most|filesystem root|absolute/u.test(message) ? 400 : 409
      return finishJson(res, statusCode, { error: message || 'source folder could not be updated' })
    }
  }

  try {
    const sources = mutation.action === 'remove'
      ? roots.remove(mutation.workspacePath, mutation.sourcePath)
      : roots.list(mutation.workspacePath)
    const selectedRoot = mutation.action === 'select'
      ? roots.select(mutation.workspacePath, mutation.sourcePath)
      : roots.selectedRoot(mutation.workspacePath)
    return finishJson(res, 200, { sources, selectedRoot })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : ''
    const statusCode = /overlap|at most|filesystem root|absolute/u.test(message) ? 400 : 409
    return finishJson(res, statusCode, { error: message || 'source folder could not be updated' })
  }
}
