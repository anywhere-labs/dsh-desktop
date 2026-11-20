import { PassThrough, Readable } from 'node:stream'
import { beforeEach, expect, it, vi } from 'vitest'

/**
 * Fake Chromium `ClientRequest`. The real object pauses on `redirect: 'manual'`
 * until `followRedirect()` or `abort()` is called, so the tests drive both
 * events explicitly.
 */
const harness = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  interface FakeRequest {
    headers: Map<string, string>
    listeners: Map<string, Listener[]>
    aborted: boolean
    followed: boolean
    ended: boolean
    setHeader(name: string, value: string): void
    followRedirect(): void
    abort(): void
    end(): void
    on(event: string, listener: Listener): FakeRequest
    emit(event: string, ...args: unknown[]): void
  }
  const requests: FakeRequest[] = []
  const partitions: string[] = []
  const dispatch = (request: FakeRequest, event: string, args: unknown[]): void => {
    for (const listener of request.listeners.get(event) ?? []) listener(...args)
  }
  const create = (): FakeRequest => {
    const request: FakeRequest = {
      headers: new Map(), listeners: new Map(), aborted: false, followed: false, ended: false,
      setHeader: (name, value) => { request.headers.set(name, value) },
      followRedirect: () => { request.followed = true },
      abort: () => { if (request.aborted) return; request.aborted = true; dispatch(request, 'abort', []) },
      end: () => { request.ended = true },
      on: (event, listener) => { request.listeners.set(event, [...request.listeners.get(event) ?? [], listener]); return request },
      emit: (event, ...args) => { dispatch(request, event, args) },
    }
    requests.push(request)
    return request
  }
  return { requests, partitions, create }
})

vi.mock('electron', () => ({
  net: { request: vi.fn(() => harness.create()) },
  session: { fromPartition: vi.fn((name: string) => { harness.partitions.push(name); return { name } }) },
}))

const { createArtifactRequest, updateIdleTimeoutMs } = await import('../src/update-transport.ts')

const endpoint = 'https://www.dshdesktop.cn/api/downloads/mac'
const storage = 'https://www.dshdesktop.cn/downloads/dsh/2.0.17-beta.1/mac/DSH-Desktop-Beta-2.0.17-beta.1-universal.dmg'

beforeEach(() => { harness.requests.length = 0; harness.partitions.length = 0 })

/** Build the IncomingMessage the transport converts into a Response. */
function incoming(status: number, body?: string): Readable & { statusCode: number; headers: Record<string, string> } {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)]) as Readable & { statusCode: number; headers: Record<string, string> }
  stream.statusCode = status
  stream.headers = { 'content-type': 'application/x-apple-diskimage' }
  return stream
}

it('follows the release-service redirect and keeps the release selectors off the storage hop', async () => {
  const pending = createArtifactRequest()(endpoint, { headers: { 'X-DSH-Desktop-Channel': 'beta', 'X-DSH-Desktop-Target-Version': '2.0.17-beta.1' } })
  expect(harness.requests).toHaveLength(1)
  // A ClientRequest that never ends is never sent, so every hop must dispatch.
  expect(harness.requests[0]!.ended).toBe(true)
  expect(harness.requests[0]!.headers.get('x-dsh-desktop-channel')).toBe('beta')
  expect(harness.requests[0]!.headers.get('cache-control')).toBe('no-cache')

  harness.requests[0]!.emit('redirect', 302, 'GET', storage, {})
  // The hop is abandoned without letting Chromium follow it, so the next URL
  // passes through the same HTTPS check.
  expect(harness.requests[0]!.aborted).toBe(true)
  expect(harness.requests[0]!.followed).toBe(false)
  expect(harness.requests).toHaveLength(2)
  expect(harness.requests[1]!.ended).toBe(true)
  expect(harness.requests[1]!.headers.get('x-dsh-desktop-channel')).toBeUndefined()
  expect(harness.requests[1]!.headers.get('x-dsh-desktop-target-version')).toBeUndefined()
  expect(harness.requests[1]!.headers.get('accept')).toBe('application/octet-stream')

  harness.requests[1]!.emit('response', incoming(200, 'koly'))
  const settled = await pending
  expect(settled.finalUrl).toBe(storage)
  expect(settled.response.status).toBe(200)
  expect(Buffer.from(await settled.response.arrayBuffer()).toString()).toBe('koly')
})

it('refuses a redirect that leaves HTTPS or the default port before any bytes move', async () => {
  for (const target of ['http://127.0.0.1/private', 'https://www.dshdesktop.cn:8443/private']) {
    harness.requests.length = 0
    const pending = createArtifactRequest()(endpoint, {})
    harness.requests[0]!.emit('redirect', 302, 'GET', target, {})
    await expect(pending).rejects.toThrow(/settle on HTTPS/)
    expect(harness.requests).toHaveLength(1)
  }
})

it('stops a redirect loop instead of issuing unlimited hops', async () => {
  const pending = createArtifactRequest()(endpoint, {})
  for (let index = 0; index < 8; index++) harness.requests[index]!.emit('redirect', 302, 'GET', `https://www.dshdesktop.cn/hop/${index + 1}`, {})
  await expect(pending).rejects.toThrow(/Too many update redirects/)
})

it('delivers an HTTP error response to the caller instead of throwing', async () => {
  const pending = createArtifactRequest()(endpoint, {})
  harness.requests[0]!.emit('response', incoming(409))
  const settled = await pending
  expect(settled).toMatchObject({ finalUrl: endpoint })
  expect(settled.response.status).toBe(409)
})

it('aborts the active request when the caller cancels', async () => {
  const controller = new AbortController()
  const pending = createArtifactRequest()(endpoint, { signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(harness.requests[0]!.aborted).toBe(true)
})

it('carries installer traffic on a non-persistent partition instead of application cookies', async () => {
  const pending = createArtifactRequest()(endpoint, {})
  expect(harness.partitions).toEqual(['dsh-next-update'])
  expect(harness.partitions[0]).not.toMatch(/^persist:/)
  harness.requests[0]!.emit('response', incoming(200, 'koly'))
  await pending
})

it('fails a request whose headers stay away for the idle timeout, and aborts it', async () => {
  const startedAt = Date.now()
  const pending = createArtifactRequest({ idleTimeoutMs: 100 })(endpoint, {})
  await expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' })
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90)
  expect(harness.requests[0]!.aborted).toBe(true)
})

it('starts the header wait again on each redirect hop', async () => {
  const pending = createArtifactRequest({ idleTimeoutMs: 150 })(endpoint, {})
  await new Promise(resolve => setTimeout(resolve, 100))
  harness.requests[0]!.emit('redirect', 302, 'GET', storage, {})
  await new Promise(resolve => setTimeout(resolve, 100))
  harness.requests[1]!.emit('response', incoming(200, 'koly'))
  const settled = await pending
  expect(Buffer.from(await settled.response.arrayBuffer()).toString()).toBe('koly')
})

it('keeps a slow body that still sends chunks, and fails one that goes silent', async () => {
  const pending = createArtifactRequest({ idleTimeoutMs: 200 })(endpoint, {})
  const body = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'application/octet-stream' } })
  harness.requests[0]!.emit('response', body)
  const reader = (await pending).response.body!.getReader()
  // Six chunks 50 ms apart outlast one idle timeout without tripping it.
  for (let index = 0; index < 6; index++) {
    body.write(Buffer.from('k'))
    expect((await reader.read()).value).toEqual(new Uint8Array([107]))
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await expect(reader.read()).rejects.toMatchObject({ code: 'ETIMEDOUT' })
  expect(harness.requests[0]!.aborted).toBe(true)
})

it('stops watching a body that ended', async () => {
  const pending = createArtifactRequest({ idleTimeoutMs: 100 })(endpoint, {})
  harness.requests[0]!.emit('response', incoming(200, 'koly'))
  const settled = await pending
  expect(Buffer.from(await settled.response.arrayBuffer()).toString()).toBe('koly')
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(harness.requests[0]!.aborted).toBe(false)
})

it('reads the idle timeout override and rejects requests while it is invalid', async () => {
  expect(updateIdleTimeoutMs({})).toBe(60_000)
  expect(updateIdleTimeoutMs({ DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS: '5000' })).toBe(5_000)
  for (const value of ['999', '2147483648', '1.5', 'soon']) {
    expect(() => updateIdleTimeoutMs({ DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS: value })).toThrow(/integer from 1000 through 2147483647/)
  }
  process.env.DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS = 'soon'
  try {
    await expect(createArtifactRequest()(endpoint, {})).rejects.toThrow(/integer from 1000 through 2147483647/)
    expect(harness.requests).toHaveLength(0)
  } finally {
    delete process.env.DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS
  }
})
