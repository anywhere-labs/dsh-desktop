/** The Host half of the native file drag: Session file authorization and the shell's request and cancel messages. */
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { installHostFileDragResources, localDragResource } from '../../src/upstream-family/file-drag-resource.ts'

afterEach(() => { vi.restoreAllMocks() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-drag-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(SessionStore)
  ctx.provide('sandboxPolicy', { workspaceRoot: root } as never)
  const id = SessionId('file-drag-test')
  ctx.sessions.create(id, { meta: { cwd: root, origin: 'subagent' } })
  const path = join(root, '报告.pdf')
  const bytes = Buffer.from('%PDF-1.4\n原始内容\n%%EOF')
  await writeFile(path, bytes)
  return { ctx, root, id, path, bytes, address: sessionFileAddress(id, '报告.pdf') }
}

/** A read that never completes on its own and rejects once its signal aborts, like a filesystem read held by a slow disk. */
function stalledRead(_target: unknown, _range: unknown, signal?: AbortSignal): Promise<Uint8Array> {
  return new Promise((_resolve, reject) => { signal?.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true }) })
}

/** The Host's message handling over `ctx`, with the answers it sent. */
function serving(ctx: Context) {
  const sent: object[] = []
  const send = vi.fn(async (message: object) => { sent.push(message) })
  const resources = installHostFileDragResources(Promise.resolve({ ctx }), send)
  onTestFinished(() => resources.stop())
  return { resources, sent, send }
}

it('authorizes Session-relative file reads and returns their original digest privately to main', async () => {
  const f = await fixture()
  expect(await localDragResource(f.ctx, f.address)).toEqual({
    path: await realpath(f.path), size: f.bytes.length, sha256: createHash('sha256').update(f.bytes).digest('hex'),
  })
})

it('rejects unscoped references and missing Sessions', async () => {
  const f = await fixture()
  await expect(localDragResource(f.ctx, f.path)).rejects.toThrow('Session resource')
  await expect(localDragResource(f.ctx, sessionFileAddress('missing', f.path))).rejects.toThrow('Session unavailable')
  await expect(localDragResource(f.ctx, sessionFileAddress(f.id, f.root))).resolves.toBeNull()
})

it('does not authorize borrowing when the filesystem has no Host mapping', async () => {
  const f = await fixture()
  vi.spyOn(f.ctx.fs, 'processPathFromHostPath').mockReturnValue(undefined)
  expect(await localDragResource(f.ctx, f.address)).toBeNull()
})

it('honors filesystem read denial without returning a path', async () => {
  const f = await fixture()
  vi.spyOn(f.ctx.fs, 'readByteRange').mockRejectedValue(new Error('read denied'))
  await expect(localDragResource(f.ctx, f.address)).rejects.toThrow('read denied')
})

it.skipIf(process.platform === 'win32')('declines symlink borrowing so the authorized byte reader can copy it', async () => {
  const f = await fixture()
  await symlink(f.path, join(f.root, 'linked.pdf'))
  expect(await localDragResource(f.ctx, sessionFileAddress(f.id, 'linked.pdf'))).toBeNull()
})

it('stops a chunked authorization read when the caller cancels', async () => {
  const f = await fixture()
  const pending = Promise.withResolvers<Uint8Array>()
  const reading = vi.spyOn(f.ctx.fs, 'readByteRange').mockReturnValue(pending.promise)
  const abort = new AbortController()
  const preparing = localDragResource(f.ctx, f.address, abort.signal)
  const rejected = expect(preparing).rejects.toThrow()
  await vi.waitFor(() => { expect(reading).toHaveBeenCalledOnce() })
  const signal = reading.mock.calls[0]![2]
  abort.abort()
  expect(signal?.aborted).toBe(true)
  pending.resolve(f.bytes)
  await rejected
})

it('authorizes empty files and detects content changes while reading', async () => {
  const f = await fixture()
  await writeFile(f.path, '')
  expect(await localDragResource(f.ctx, f.address)).toMatchObject({ size: 0, sha256: createHash('sha256').digest('hex') })
  await writeFile(f.path, f.bytes)
  vi.spyOn(f.ctx.fs, 'readByteRange').mockResolvedValueOnce(new Uint8Array())
  await expect(localDragResource(f.ctx, f.address)).resolves.toBeNull()
})

it('answers each request with its resource, null for a nonlocal one, and a generic error for a failed one', async () => {
  const f = await fixture()
  const { resources, sent } = serving(f.ctx)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(resources.receive({ type: 'file-drag-resource', requestId: 1, address: f.address })).toBe(true)
  expect(resources.receive({ type: 'file-drag-resource', requestId: 2, address: sessionFileAddress(f.id, f.root) })).toBe(true)
  expect(resources.receive({ type: 'file-drag-resource', requestId: 3, address: f.path })).toBe(true)
  await vi.waitFor(() => { expect(sent).toHaveLength(3) })
  expect(sent).toEqual(expect.arrayContaining([
    { type: 'file-drag-resource', requestId: 1, resource: { path: await realpath(f.path), size: f.bytes.length, sha256: createHash('sha256').update(f.bytes).digest('hex') } },
    { type: 'file-drag-resource', requestId: 2, resource: null },
    // The shell's answer carries no Host path or failure detail.
    { type: 'file-drag-resource', requestId: 3, resource: null, error: 'File drag resource unavailable' },
  ]))
})

it('takes only the two drag messages and drops a malformed request unanswered', async () => {
  const f = await fixture()
  const { resources, send } = serving(f.ctx)
  for (const message of [undefined, null, 'file-drag-resource', { type: 'shutdown' }, { type: 'injections', requestId: 1 }]) {
    expect(resources.receive(message)).toBe(false)
  }
  for (const message of [{ type: 'file-drag-resource', requestId: 1.5, address: f.address }, { type: 'file-drag-resource', requestId: 1 },
    { type: 'file-drag-resource', address: f.address }, { type: 'file-drag-cancel' }, { type: 'file-drag-cancel', requestId: 9 }]) {
    expect(resources.receive(message)).toBe(true)
  }
  await resources.stop()
  expect(send).not.toHaveBeenCalled()
})

it('aborts the read a cancel names and answers it quietly', async () => {
  const f = await fixture()
  const { resources, sent } = serving(f.ctx)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const reading = vi.spyOn(f.ctx.fs, 'readByteRange').mockImplementation(stalledRead)
  resources.receive({ type: 'file-drag-resource', requestId: 7, address: f.address })
  await vi.waitFor(() => { expect(reading).toHaveBeenCalledOnce() })
  const signal = reading.mock.calls[0]![2]
  resources.receive({ type: 'file-drag-cancel', requestId: 7 })
  expect(signal?.aborted).toBe(true)
  await vi.waitFor(() => { expect(sent).toEqual([{ type: 'file-drag-resource', requestId: 7, resource: null, error: 'File drag resource unavailable' }]) })
  expect(error).not.toHaveBeenCalled()
})

it('stops by aborting unfinished reads, awaiting their answers and refusing later requests', async () => {
  const f = await fixture()
  const { resources, sent } = serving(f.ctx)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(f.ctx.fs, 'readByteRange').mockImplementation(stalledRead)
  resources.receive({ type: 'file-drag-resource', requestId: 1, address: f.address })
  await vi.waitFor(() => { expect(f.ctx.fs.readByteRange).toHaveBeenCalledOnce() })
  await resources.stop()
  expect(sent).toEqual([{ type: 'file-drag-resource', requestId: 1, resource: null, error: 'File drag resource unavailable' }])
  resources.receive({ type: 'file-drag-resource', requestId: 2, address: f.address })
  await vi.waitFor(() => { expect(sent).toHaveLength(2) })
  expect(sent[1]).toEqual({ type: 'file-drag-resource', requestId: 2, resource: null, error: 'File drag resource unavailable' })
  expect(f.ctx.fs.readByteRange).toHaveBeenCalledOnce()
})

it('answers requests made while the Host boots once it is ready, and fails them if it never is', async () => {
  const f = await fixture()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const booting = Promise.withResolvers<{ ctx: Context }>()
  const sent: object[] = []
  const resources = installHostFileDragResources(booting.promise, async (message) => { sent.push(message) })
  resources.receive({ type: 'file-drag-resource', requestId: 1, address: f.address })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(sent).toEqual([])
  booting.resolve({ ctx: f.ctx })
  await vi.waitFor(() => { expect(sent).toEqual([expect.objectContaining({ requestId: 1, resource: expect.objectContaining({ size: f.bytes.length }) })]) })
  const failed = installHostFileDragResources(Promise.reject(new Error('boot failed')), async (message) => { sent.push(message) })
  failed.receive({ type: 'file-drag-resource', requestId: 2, address: f.address })
  await vi.waitFor(() => { expect(sent[1]).toEqual({ type: 'file-drag-resource', requestId: 2, resource: null, error: 'File drag resource unavailable' }) })
  await Promise.all([resources.stop(), failed.stop()])
})
