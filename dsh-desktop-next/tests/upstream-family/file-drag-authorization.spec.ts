/** The shell half of the Host's file drag authorization: requests, answers, cancellation, deadlines and Host failure. */
import { afterEach, expect, it, vi } from 'vitest'
import { createFileDragAuthorization } from '../../src/upstream-family/file-drag-authorization.ts'

afterEach(() => { vi.useRealTimers() })

const resource = { path: '/workspace/报告.pdf', sha256: 'a'.repeat(64), size: 12 }
function channel() {
  const sent: Record<string, unknown>[] = []
  const send = vi.fn(async (message: object) => { sent.push(message as Record<string, unknown>) })
  return { authorization: createFileDragAuthorization(send), sent, send }
}

it('asks the Host for each address and settles each request with its own answer', async () => {
  const { authorization, sent } = channel()
  const first = authorization.resolve('dsh-resource://file/session/s/a.pdf', new AbortController().signal)
  const second = authorization.resolve('dsh-resource://file/session/s/b.pdf', new AbortController().signal)
  await vi.waitFor(() => { expect(sent).toHaveLength(2) })
  expect(sent).toEqual([
    { type: 'file-drag-resource', requestId: 1, address: 'dsh-resource://file/session/s/a.pdf' },
    { type: 'file-drag-resource', requestId: 2, address: 'dsh-resource://file/session/s/b.pdf' },
  ])
  expect(authorization.receive({ type: 'file-drag-resource', requestId: 2, resource: null })).toBe(true)
  expect(authorization.receive({ type: 'file-drag-resource', requestId: 1, resource })).toBe(true)
  await expect(first).resolves.toEqual(resource)
  await expect(second).resolves.toBeNull()
  // A late or repeated answer names no open request and changes nothing.
  expect(authorization.receive({ type: 'file-drag-resource', requestId: 1, resource: null })).toBe(true)
})

it('rejects with the Host error an answer carries', async () => {
  const { authorization } = channel()
  const pending = authorization.resolve('dsh-resource://file/session/s/a.pdf', new AbortController().signal)
  await Promise.resolve()
  authorization.receive({ type: 'file-drag-resource', requestId: 1, resource: null, error: 'File drag resource unavailable' })
  await expect(pending).rejects.toThrow('File drag resource unavailable')
})

it('cancels the Host read and rejects with the caller reason when the preparation is cancelled', async () => {
  const { authorization, sent } = channel()
  const abort = new AbortController()
  const pending = authorization.resolve('dsh-resource://file/session/s/a.pdf', abort.signal)
  abort.abort(new Error('File preparation cancelled'))
  await expect(pending).rejects.toThrow('File preparation cancelled')
  expect(sent.at(-1)).toEqual({ type: 'file-drag-cancel', requestId: 1 })
  expect(authorization.receive({ type: 'file-drag-resource', requestId: 1, resource })).toBe(true)
  const { authorization: later, send } = channel()
  await expect(later.resolve('dsh-resource://file/session/s/a.pdf', abort.signal)).rejects.toThrow('File preparation cancelled')
  expect(send).not.toHaveBeenCalled()
})

it('cancels an unanswered request after twelve seconds', async () => {
  vi.useFakeTimers()
  const { authorization, sent } = channel()
  const pending = authorization.resolve('dsh-resource://file/session/s/a.pdf', new AbortController().signal)
  const rejected = expect(pending).rejects.toThrow('File drag authorization timed out')
  await vi.advanceTimersByTimeAsync(11_999)
  expect(sent).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  await rejected
  expect(sent.at(-1)).toEqual({ type: 'file-drag-cancel', requestId: 1 })
})

it('rejects at once when no Host can receive the request, and every open request when the Host fails', async () => {
  const unavailable = createFileDragAuthorization(async () => { throw new Error('Next Host is unavailable') })
  await expect(unavailable.resolve('dsh-resource://file/session/s/a.pdf', new AbortController().signal)).rejects.toThrow('Next Host is unavailable')
  const { authorization } = channel()
  const requests = [authorization.resolve('a', new AbortController().signal), authorization.resolve('b', new AbortController().signal)]
  await Promise.resolve()
  authorization.fail(new Error('dsh desktop host exited with code 1'))
  for (const request of requests) await expect(request).rejects.toThrow('exited with code 1')
})

it.each([
  undefined, null, { type: 'injections', requestId: 1 }, { type: 'file-drag-resource', resource: null },
  { type: 'file-drag-resource', requestId: 1.5, resource: null }, { type: 'file-drag-resource', requestId: 1, resource: null, error: 7 },
  { type: 'file-drag-resource', requestId: 1, resource: { ...resource, path: 7 } },
  { type: 'file-drag-resource', requestId: 1, resource: { ...resource, sha256: 'A'.repeat(64) } },
  { type: 'file-drag-resource', requestId: 1, resource: { ...resource, size: -1 } },
  { type: 'file-drag-resource', requestId: 1, resource: { path: resource.path, sha256: resource.sha256 } },
])('leaves %j to the Host events, which reject a malformed answer as invalid IPC', async (message) => {
  const { authorization } = channel()
  const pending = authorization.resolve('dsh-resource://file/session/s/a.pdf', new AbortController().signal)
  await Promise.resolve()
  expect(authorization.receive(message)).toBe(false)
  authorization.fail(new Error('stopped'))
  await expect(pending).rejects.toThrow('stopped')
})
