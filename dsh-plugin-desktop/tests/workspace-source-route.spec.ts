import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleDesktopWorkspaceSourcesRequest } from '../src/workspace-source-route.ts'
import { WorkspaceSourceRoots } from '../src/workspace-source-roots.ts'

const ORIGIN = 'http://127.0.0.1:43120'
let temporaryDirectory: string | undefined

function fixture(): { readonly primary: string; readonly source: string; readonly roots: WorkspaceSourceRoots } {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'dsh-workspace-sources-'))
  const primary = join(temporaryDirectory, 'primary')
  const source = join(temporaryDirectory, 'source')
  mkdirSync(primary)
  mkdirSync(source)
  return { primary, source, roots: new WorkspaceSourceRoots(join(temporaryDirectory, 'sources.json')) }
}

afterEach(() => {
  if (temporaryDirectory !== undefined) rmSync(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = undefined
})

function post(body: unknown, origin = ORIGIN): IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage
  req.method = 'POST'
  req.url = '/_dsh/desktop/workspace-sources'
  req.headers = { origin, 'content-type': 'application/json' }
  return req
}

function response(): ServerResponse & {
  body: string
  end: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
} {
  const res = {
    body: '',
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string) => { res.body = body ?? '' }),
  }
  return res as unknown as ServerResponse & typeof res
}

function parsed(res: ReturnType<typeof response>): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>
}

describe('desktop workspace sources route', () => {
  it('opens the native chooser in the Host and validates before attaching', async () => {
    const { primary, source, roots } = fixture()
    const pickDirectory = vi.fn(async () => source)
    const validateDirectory = vi.fn(async () => true)
    const res = response()

    await handleDesktopWorkspaceSourcesRequest(
      post({ action: 'add', workspacePath: primary }), res, ORIGIN, roots, pickDirectory, validateDirectory, 'linux',
    )

    expect(pickDirectory).toHaveBeenCalledOnce()
    expect(validateDirectory).toHaveBeenCalledWith(source)
    expect(res.statusCode).toBe(200)
    expect(parsed(res)).toEqual({ sources: [source], selectedRoot: source })
    expect(roots.list(primary)).toEqual([source])
  })

  it('leaves associations unchanged when the native chooser is cancelled', async () => {
    const { primary, roots } = fixture()
    const pickDirectory = vi.fn(async () => null)
    const validateDirectory = vi.fn(async () => true)
    const res = response()

    await handleDesktopWorkspaceSourcesRequest(
      post({ action: 'add', workspacePath: primary }), res, ORIGIN, roots, pickDirectory, validateDirectory, 'darwin',
    )

    expect(validateDirectory).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(parsed(res)).toEqual({ sources: [], selectedRoot: primary, cancelled: true })
    expect(roots.list(primary)).toEqual([])
  })

  it('does not accept a renderer-supplied path for add', async () => {
    const { primary, source, roots } = fixture()
    const pickDirectory = vi.fn(async () => source)
    const res = response()

    await handleDesktopWorkspaceSourcesRequest(
      post({ action: 'add', workspacePath: primary, sourcePath: source }),
      res, ORIGIN, roots, pickDirectory, async () => true, 'linux',
    )

    expect(pickDirectory).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
    expect(roots.list(primary)).toEqual([])
  })

  it('rejects a directory refused by Desktop admission without persisting it', async () => {
    const { primary, source, roots } = fixture()
    const validateDirectory = vi.fn(async () => false)
    const res = response()

    await handleDesktopWorkspaceSourcesRequest(
      post({ action: 'add', workspacePath: primary }), res, ORIGIN, roots,
      async () => source, validateDirectory, 'linux',
    )

    expect(validateDirectory).toHaveBeenCalledWith(source)
    expect(res.statusCode).toBe(403)
    expect(roots.list(primary)).toEqual([])
  })

  it('keeps attached-root creation fail-closed on Windows before opening a picker', async () => {
    const { roots } = fixture()
    const pickDirectory = vi.fn(async () => null)
    const res = response()

    await handleDesktopWorkspaceSourcesRequest(
      post({ action: 'add', workspacePath: 'C:\\Work' }), res, ORIGIN, roots,
      pickDirectory, async () => true, 'win32',
    )

    expect(pickDirectory).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(501)
    expect(parsed(res)).toEqual({ error: 'attached source access is not supported on Windows' })
  })

  it('lets source selection and detaching operate only on persisted roots', async () => {
    const { primary, source, roots } = fixture()
    roots.add(primary, source)
    const pickDirectory = vi.fn(async () => null)
    const validateDirectory = vi.fn(async () => true)
    const selectResponse = response()

    await handleDesktopWorkspaceSourcesRequest(
      post({ action: 'select', workspacePath: primary, sourcePath: source }),
      selectResponse, ORIGIN, roots, pickDirectory, validateDirectory, 'linux',
    )

    expect(parsed(selectResponse)).toEqual({ sources: [source], selectedRoot: source })
    const removeResponse = response()
    await handleDesktopWorkspaceSourcesRequest(
      post({ action: 'remove', workspacePath: primary, sourcePath: source }),
      removeResponse, ORIGIN, roots, pickDirectory, validateDirectory, 'linux',
    )
    expect(parsed(removeResponse)).toEqual({ sources: [], selectedRoot: primary })
    expect(pickDirectory).not.toHaveBeenCalled()
  })

  it('rejects cross-origin mutation before opening the native chooser', async () => {
    const { primary, roots } = fixture()
    const pickDirectory = vi.fn(async () => null)
    const res = response()

    await handleDesktopWorkspaceSourcesRequest(
      post({ action: 'add', workspacePath: primary }, 'https://example.com'),
      res, ORIGIN, roots, pickDirectory, async () => true, 'linux',
    )

    expect(pickDirectory).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })
})
