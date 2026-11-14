/** Native original-byte saves, window-scoped IPC ownership and credential-free image reads. */
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IpcMainInvokeEvent, Session } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { installAppDownloads } from '../../src/app-downloads.ts'
import { installFileActions, type FileActionsElectron } from '../../src/upstream-family/file-actions.ts'
import { FILE_ACTIONS_IPC } from '../../src/upstream-family/file-actions-ipc.ts'

vi.mock('electron', () => ({ dialog: {} }))

const roots: string[] = []
const owners: EventEmitter[] = []
afterEach(async () => {
  for (const owner of owners.splice(0)) owner.emit('closed')
  vi.useRealTimers(); vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function directory() { const path = await realpath(await mkdtemp(join(tmpdir(), 'dsh-file-actions-'))); roots.push(path); return path }

/** A `net.request` stand-in; `reply` plays the Chromium side of each request once it is sent. */
class FakeRequest extends EventEmitter {
  readonly abort = vi.fn()
  readonly end = vi.fn(() => { this.reply?.(this) })
  constructor(readonly options: Record<string, unknown>, private readonly reply?: (request: FakeRequest) => void) { super() }
  respond(body: Readable, statusCode = 200, headers: Record<string, string | string[]> = {}): void {
    this.emit('response', Object.assign(body, { statusCode, headers }))
  }
}

function harness(root: string, hostUrl?: () => string | undefined) {
  const owner = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { downloadURL: vi.fn<(url: string) => void>() }), isDestroyed: () => false,
  })
  owners.push(owner)
  const assertOwner = vi.fn(() => owner as never)
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => Promise<unknown>>()
  const on = vi.fn<(name: string, listener: (event: object, item: object, contents: object) => void) => void>()
  const requests: FakeRequest[] = []
  const reply = { current: undefined as ((request: FakeRequest) => void) | undefined }
  const electron = {
    app: { getPath: () => root },
    ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, value: unknown) => Promise<unknown>) => { handlers.set(channel, handler) } },
    net: { request: (options: Record<string, unknown>) => {
      const request = new FakeRequest(options, reply.current)
      requests.push(request)
      return request
    } },
    session: { defaultSession: { on }, fromPartition: (partition: string) => ({ partition }) },
  } as unknown as FileActionsElectron
  installFileActions(electron, assertOwner, hostUrl)
  const event = {} as IpcMainInvokeEvent
  const invoke = async (channel: string, value: unknown): Promise<unknown> => handlers.get(channel)!(event, value)
  const item = (mime = 'image/gif', url = owner.webContents.downloadURL.mock.lastCall![0]) => {
    let destination = ''
    const download = Object.assign(new EventEmitter(), {
      getURLChain: () => [url],
      getFilename: () => 'original.gif', getMimeType: () => mime, getSavePath: () => destination,
      setSavePath: vi.fn((path: string) => { destination = path }),
      setSaveDialogOptions: vi.fn(), cancel: vi.fn(),
    })
    on.mock.calls[0]![1]({}, download, owner.webContents)
    return download
  }
  const save = async (mode: 'download' | 'saveAs' = 'download') => {
    const pending = invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/original.gif', name: 'image.gif', mode })
    const download = item()
    if (mode === 'download') await writeFile(download.getSavePath(), new Uint8Array([0, 128, 255]))
    download.emit('done', {}, 'completed')
    return pending
  }
  return { owner, assertOwner, invoke, item, save, on, requests, reply }
}

it('returns the completed destination and releases download listeners', async () => {
  const root = await directory(), f = harness(root)
  await expect(f.save()).resolves.toEqual({ status: 'saved', path: join(root, 'image.gif') })
  expect(f.owner.listenerCount('closed')).toBe(0)
  expect(f.owner.webContents.listenerCount('did-start-navigation')).toBe(0)
})

it.each(['file:///private/data', 'dsh-app://app/api/private', 'javascript:alert(1)', 'https://user:secret@images.example/a'])('rejects unsupported URL %s', async (url) => {
  const root = await directory(), f = harness(root)
  await expect(f.invoke(FILE_ACTIONS_IPC.save, { url, mode: 'download' })).rejects.toThrow('Unsupported')
  expect(f.owner.webContents.downloadURL).not.toHaveBeenCalled()
  expect(await readdir(root)).toEqual([])
})

it.each([undefined, 'https://images.example/a', { url: 1, mode: 'download' }, { url: 'https://images.example/a', mode: 'open' },
  { url: 'https://images.example/a', mode: 'saveAs', name: 1 }, { url: 'https://images.example/a', mode: 'saveAs', mediaType: 1 }])('rejects malformed request %j', async (value) => {
  const f = harness(await directory())
  await expect(f.invoke(FILE_ACTIONS_IPC.save, value)).rejects.toThrow('Invalid file save request')
})

it('retains original downloads and reserves distinct paths until Chromium finishes', async () => {
  const root = await directory(), f = harness(root)
  await writeFile(join(root, 'image.gif'), 'previous')
  await f.save()
  expect(await readFile(join(root, 'image.gif'), 'utf8')).toBe('previous')
  expect(await readFile(join(root, 'image (1).gif'))).toEqual(Buffer.from([0, 128, 255]))
})

it.each(['download', 'saveAs'] as const)('creates a Downloads directory the home does not have yet for %s', async (mode) => {
  const root = join(await directory(), 'Downloads'), f = harness(root)
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'a.gif', mode })
  const download = f.item()
  expect(await readdir(root)).toEqual(mode === 'download' ? ['a.gif'] : [])
  download.emit('done', {}, 'cancelled')
  await expect(pending).resolves.toEqual({ status: 'cancelled' })
})

it.skipIf(process.platform === 'win32')('reports the real path of a file below a linked Downloads directory, which the Host can reveal', async () => {
  const root = await directory()
  await mkdir(join(root, 'elsewhere'))
  await symlink(join(root, 'elsewhere'), join(root, 'Downloads'))
  const f = harness(join(root, 'Downloads'))
  await expect(f.save()).resolves.toEqual({ status: 'saved', path: join(root, 'elsewhere', 'image.gif') })
})

it('keeps a suggested name inside the Downloads directory', async () => {
  const root = await directory(), f = harness(root)
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: '../../outside.gif', mode: 'download' })
  const download = f.item()
  expect(download.setSavePath).toHaveBeenCalledWith(join(root, '_.._outside.gif'))
  download.emit('done', {}, 'cancelled')
  await expect(pending).resolves.toEqual({ status: 'cancelled' })
})

it.each(['cancelled', 'interrupted'] as const)('reports native %s without a completed path', async (state) => {
  const root = await directory(), f = harness(root)
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'wrong.png', mode: 'download' })
  const download = f.item('image/webp')
  expect(download.setSavePath).toHaveBeenCalledWith(join(root, 'wrong.webp'))
  download.emit('done', {}, state)
  if (state === 'cancelled') await expect(pending).resolves.toEqual({ status: 'cancelled' })
  else await expect(pending).rejects.toThrow('interrupted')
  expect(await readdir(root)).toEqual([])
})

it.each(['download', 'saveAs'] as const)('fails a %s that a network error leaves resumable and removes its reservation', async (mode) => {
  const root = await directory(), f = harness(root)
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'a.gif', mode })
  const download = f.item()
  // Chromium reports the failure as an update and finishes the item only when it is cancelled.
  download.cancel.mockImplementation(() => { download.emit('done', {}, 'cancelled') })
  download.emit('updated', {}, 'interrupted')
  download.emit('updated', {}, 'interrupted')
  await expect(pending).rejects.toThrow('interrupted')
  expect(download.cancel).toHaveBeenCalledOnce()
  expect(await readdir(root)).toEqual([])
})

it('keeps a download that merely progresses or pauses', async () => {
  const f = harness(await directory())
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'a.gif', mode: 'download' })
  const download = f.item()
  download.emit('updated', {}, 'progressing')
  await new Promise(resolve => { setImmediate(resolve) })
  expect(download.cancel).not.toHaveBeenCalled()
  download.emit('done', {}, 'completed')
  await expect(pending).resolves.toMatchObject({ status: 'saved' })
})

it('uses the native save dialog and waits for completion before reporting success', async () => {
  const root = await directory(), f = harness(root)
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'photo.png', mode: 'saveAs' })
  const download = f.item('image/jpeg')
  expect(download.setSavePath).not.toHaveBeenCalled()
  expect(download.setSaveDialogOptions).toHaveBeenCalledWith({ title: 'photo.jpg', defaultPath: join(root, 'photo.jpg'), properties: ['showOverwriteConfirmation', 'createDirectory'] })
  download.emit('done', {}, 'cancelled')
  await expect(pending).resolves.toEqual({ status: 'cancelled' })
})

it('asks the owner guard before every operation and again when the bytes arrive', async () => {
  const root = await directory(), f = harness(root)
  f.assertOwner.mockImplementationOnce(() => { throw new Error('Rejected owner') })
  await expect(f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', mode: 'download' })).rejects.toThrow('Rejected owner')
  f.assertOwner.mockImplementationOnce(() => { throw new Error('Rejected owner') })
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/a')).rejects.toThrow('Rejected owner')
  expect(f.owner.webContents.downloadURL).not.toHaveBeenCalled()
  expect(f.requests).toEqual([])

  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'a.gif', mode: 'download' })
  const download = f.item()
  f.assertOwner.mockImplementationOnce(() => { throw new Error('Rejected owner') })
  download.emit('done', {}, 'completed')
  await expect(pending).rejects.toThrow('Rejected owner')

  f.reply.current = request => { request.respond(Readable.from([Buffer.from('bytes')])) }
  f.assertOwner.mockImplementationOnce(() => f.owner as never).mockImplementationOnce(() => { throw new Error('Rejected owner') })
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/b')).rejects.toThrow('Rejected owner')
})

it('reports a failed reservation and cancels the item', async () => {
  const root = await directory()
  await writeFile(join(root, 'not-a-directory'), '')
  const f = harness(join(root, 'not-a-directory'))
  const refused = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'a.gif', mode: 'download' })
  const download = f.item()
  await expect(refused).rejects.toThrow('EEXIST')
  expect(download.cancel).toHaveBeenCalledOnce()
  expect(f.owner.listenerCount('closed')).toBe(0)
})

it('cancels pending downloads when the owning document changes', async () => {
  const f = harness(await directory())
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', mode: 'download' })
  const download = f.item()
  f.owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  await expect(pending).resolves.toEqual({ status: 'cancelled' })
  expect(download.cancel).toHaveBeenCalledOnce()
  download.emit('done', {}, 'cancelled')
  expect(f.owner.listenerCount('closed')).toBe(0)
})

it('matches overlapping downloads of the same source to their captured requests', async () => {
  const root = await directory(), f = harness(root)
  const first = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'first.gif', mode: 'download' })
  const firstUrl = f.owner.webContents.downloadURL.mock.lastCall![0]
  const second = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', name: 'second.gif', mode: 'saveAs' })
  const secondItem = f.item()
  const firstItem = f.item('image/gif', firstUrl)
  expect(firstItem.setSavePath).toHaveBeenCalledWith(join(root, 'first.gif'))
  expect(secondItem.setSaveDialogOptions.mock.lastCall?.[0]).toMatchObject({ defaultPath: join(root, 'second.gif') })
  secondItem.emit('done', {}, 'cancelled')
  firstItem.emit('done', {}, 'completed')
  await expect(first).resolves.toMatchObject({ status: 'saved' })
  await expect(second).resolves.toEqual({ status: 'cancelled' })
})

it('matches an item whose URL Chromium canonicalized', async () => {
  const root = await directory(), f = harness(root)
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a|b.gif', mode: 'download' })
  const requested = f.owner.webContents.downloadURL.mock.lastCall![0]
  expect(requested).toContain('/a|b.gif#dsh-download=')
  const download = f.item('image/gif', requested.replace('|', '%7C'))
  expect(download.cancel).not.toHaveBeenCalled()
  download.emit('done', {}, 'completed')
  await expect(pending).resolves.toMatchObject({ status: 'saved' })
})

it('leaves other downloads to their owners and cancels a forged fragment', async () => {
  const f = harness(await directory())
  const ordinary = f.item('text/plain', 'blob:dsh-app://app/1234')
  expect(ordinary.cancel).not.toHaveBeenCalled()
  expect(ordinary.setSavePath).not.toHaveBeenCalled()
  const forged = f.item('text/plain', 'https://images.example/a#dsh-download=forged')
  expect(forged.cancel).toHaveBeenCalledOnce()
  expect(forged.setSavePath).not.toHaveBeenCalled()
})

it('shares the session with the application-route download handler without either taking the other\'s items', async () => {
  const root = await directory(), f = harness(root)
  const forward = vi.fn(() => new Promise<Response>(() => {}))
  const contents = f.owner.webContents as unknown as { getURL(): string; isDestroyed(): boolean }
  contents.getURL = () => 'dsh-app://app/'
  contents.isDestroyed = () => false
  const listeners = [f.on.mock.calls[0]![1]]
  installAppDownloads({ on: (_name: string, listener: never) => { listeners.push(listener) } } as unknown as Pick<Session, 'on'>, {
    window: () => f.owner as never, forward, downloads: () => root, language: () => 'en', warn: vi.fn(),
  })
  const dispatch = (url: string) => {
    const event = { preventDefault: vi.fn() }
    let destination = ''
    const item = Object.assign(new EventEmitter(), { getURL: () => url, getURLChain: () => [url], getFilename: () => 'a.gif', getMimeType: () => 'image/gif',
      getSavePath: () => destination, setSavePath: vi.fn((path: string) => { destination = path }), setSaveDialogOptions: vi.fn(), cancel: vi.fn() })
    for (const listener of listeners) listener(event, item, f.owner.webContents)
    return { event, item }
  }
  const route = dispatch('dsh-app://app/api/session.export?sessionId=s1')
  expect(route.event.preventDefault).toHaveBeenCalledOnce()
  expect(route.item.cancel).not.toHaveBeenCalled()
  expect(route.item.setSavePath).not.toHaveBeenCalled()
  await vi.waitFor(() => { expect(forward).toHaveBeenCalledOnce() })

  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'blob:dsh-app://app/1234', name: 'a.gif', mode: 'download' })
  const owned = dispatch(f.owner.webContents.downloadURL.mock.lastCall![0])
  expect(owned.event.preventDefault).not.toHaveBeenCalled()
  expect(owned.item.setSavePath).toHaveBeenCalledWith(join(root, 'a.gif'))
  expect(forward).toHaveBeenCalledOnce()
  owned.item.emit('done', {}, 'completed')
  await expect(pending).resolves.toEqual({ status: 'saved', path: join(root, 'a.gif') })
})

it('retires timed-out downloads and cancels items arriving after their window closes', async () => {
  vi.useFakeTimers(); vi.stubEnv('DSH_DESKTOP_FILE_DOWNLOAD_TIMEOUT_MS', '1000')
  const root = await directory(), f = harness(root)
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', mode: 'download' })
  const rejected = expect(pending).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(1000)
  await rejected
  const download = f.item()
  expect(download.cancel).toHaveBeenCalledOnce()
  download.emit('done', {}, 'cancelled')
  expect(await readdir(root)).toEqual([])
  expect(f.owner.listenerCount('closed')).toBe(0)
  expect(f.owner.webContents.listenerCount('did-start-navigation')).toBe(0)

  const late = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', mode: 'download' })
  f.owner.emit('closed')
  await expect(late).resolves.toEqual({ status: 'cancelled' })
  const stale = f.item()
  expect(stale.cancel).toHaveBeenCalledOnce()
  expect(stale.setSavePath).not.toHaveBeenCalled()
})

it('allows the native save dialog to remain open beyond the download startup deadline', async () => {
  vi.useFakeTimers(); vi.stubEnv('DSH_DESKTOP_FILE_DOWNLOAD_TIMEOUT_MS', '1000')
  const f = harness(await directory())
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', mode: 'saveAs' })
  const download = f.item()
  await vi.advanceTimersByTimeAsync(2000)
  expect(download.cancel).not.toHaveBeenCalled()
  download.emit('done', {}, 'completed')
  await expect(pending).resolves.toMatchObject({ status: 'saved' })
})

it('reports a synchronous Chromium launch failure and releases pending listeners', async () => {
  const f = harness(await directory())
  f.owner.webContents.downloadURL.mockImplementation(() => { throw new Error('Download unavailable') })
  await expect(f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', mode: 'download' })).rejects.toThrow('Download unavailable')
  expect(f.owner.listenerCount('closed')).toBe(0)
  expect(f.owner.webContents.listenerCount('did-start-navigation')).toBe(0)
})

it('preserves pending downloads across iframe and same-document navigation', async () => {
  const root = await directory(), f = harness(root)
  const pending = f.invoke(FILE_ACTIONS_IPC.save, { url: 'https://images.example/a', mode: 'saveAs' })
  const download = f.item()
  f.owner.webContents.emit('did-start-navigation', {}, 'https://example.org', false, false)
  f.owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/#tab', true, true)
  download.setSavePath(join(root, 'chosen.gif'))
  download.emit('done', {}, 'completed')
  await expect(pending).resolves.toEqual({ status: 'saved', path: join(root, 'chosen.gif') })
  expect(download.cancel).not.toHaveBeenCalled()
})

it.each(['0', '999', '2147483648', 'soon'])('refuses the download deadline %j', async (value) => {
  vi.stubEnv('DSH_DESKTOP_FILE_DOWNLOAD_TIMEOUT_MS', value)
  await expect(async () => harness(await directory())).rejects.toThrow('DSH_DESKTOP_FILE_DOWNLOAD_TIMEOUT_MS must be an integer')
})

it.each(['0', '-1', '1.5', 'much'])('refuses the image size limit %j', async (value) => {
  vi.stubEnv('DSH_DESKTOP_IMAGE_READ_MAX_BYTES', value)
  await expect(async () => harness(await directory())).rejects.toThrow('DSH_DESKTOP_IMAGE_READ_MAX_BYTES must be a positive integer')
})

it('reads an original image through a credential-free in-memory Chromium session', async () => {
  const f = harness(await directory())
  f.reply.current = request => { request.respond(Readable.from([Buffer.from([0, 128]), Buffer.from([255])]), 200, { 'content-type': 'image/gif', 'x-many': ['a', 'b'] }) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/original.gif')).resolves.toEqual({
    bytes: new Uint8Array([0, 128, 255]), mediaType: 'image/gif',
  })
  expect(f.requests).toHaveLength(1)
  expect(f.requests[0]!.options).toEqual({
    url: 'https://images.example/original.gif', session: { partition: 'dsh-desktop-image-read' },
    redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer',
  })
  expect(f.owner.listenerCount('closed')).toBe(0)
  expect(f.owner.webContents.listenerCount('did-start-navigation')).toBe(0)
})

it('reports an empty media type when the response names none', async () => {
  const f = harness(await directory())
  f.reply.current = request => { request.respond(Readable.from([Buffer.from('x')])) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'http://images.example/a')).resolves.toEqual({ bytes: new Uint8Array(Buffer.from('x')), mediaType: '' })
})

it('validates and follows each redirect itself, aborting the request it leaves', async () => {
  const f = harness(await directory())
  f.reply.current = (request) => {
    if (request.options.url === 'https://images.example/final') request.respond(Readable.from([Buffer.from('bytes')]))
    else request.emit('redirect', 302, 'GET', '/final', {})
  }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/first')).resolves.toMatchObject({ bytes: new Uint8Array(Buffer.from('bytes')) })
  expect(f.requests.map(request => request.options.url)).toEqual(['https://images.example/first', 'https://images.example/final'])
  expect(f.requests[0]!.abort).toHaveBeenCalled()
})

it('gives up on a redirect loop', async () => {
  const f = harness(await directory())
  f.reply.current = (request) => { request.emit('redirect', 307, 'GET', 'https://images.example/again', {}) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/first')).rejects.toThrow('Invalid image redirect')
  expect(f.requests).toHaveLength(21)
})

it.each([
  ['the Host itself', 'http://127.0.0.1:19321/api/private'],
  ['a localhost alias of the Host', 'http://localhost:19321/api/private'],
  ['an IPv6 alias of the Host', 'http://[::1]:19321/api/private'],
  ['a file URL', 'file:///private/data'],
  ['the application scheme', 'dsh-app://app/api/private'],
  ['embedded credentials', 'https://user:secret@images.example/a'],
])('refuses %s without a request', async (_name, url) => {
  const f = harness(await directory(), () => 'http://127.0.0.1:19321')
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, url)).rejects.toThrow('Invalid image URL')
  expect(f.requests).toEqual([])
})

it('refuses a non-string image URL', async () => {
  const f = harness(await directory())
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 42)).rejects.toThrow('Invalid image URL')
})

it('rejects redirects to the application Host', async () => {
  const f = harness(await directory(), () => 'http://127.0.0.1:19321')
  f.reply.current = (request) => { request.emit('redirect', 302, 'GET', 'http://localhost:19321/api/private', {}) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/photo')).rejects.toThrow('Invalid image URL')
  expect(f.requests).toHaveLength(1)
})

it('reads a same-port address of another host', async () => {
  const f = harness(await directory(), () => 'http://127.0.0.1:19321')
  f.reply.current = (request) => { request.respond(Readable.from([Buffer.from('x')])) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'http://images.example:19321/a')).resolves.toMatchObject({ mediaType: '' })
})

it('releases the request of a failed status', async () => {
  const f = harness(await directory())
  const body = new Readable({ read() {} })
  f.reply.current = (request) => { request.respond(body, 404) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/gone')).rejects.toThrow('Original image unavailable')
  await vi.waitFor(() => { expect(f.requests[0]!.abort).toHaveBeenCalled() })
  expect(body.destroyed).toBe(true)
})

it('treats a response without a body as unavailable', async () => {
  const f = harness(await directory())
  f.reply.current = (request) => { request.respond(Readable.from([]), 204) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/empty')).rejects.toThrow('Original image unavailable')
})

it('stops reading past the size limit', async () => {
  vi.stubEnv('DSH_DESKTOP_IMAGE_READ_MAX_BYTES', '4')
  const f = harness(await directory())
  const body = new Readable({ read() {} })
  f.reply.current = (request) => { request.respond(body); body.push(Buffer.from('123')); body.push(Buffer.from('45')) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/huge')).rejects.toThrow('exceeds the download limit')
  await vi.waitFor(() => { expect(f.requests[0]!.abort).toHaveBeenCalled() })
  expect(body.destroyed).toBe(true)
})

it('surfaces a network failure', async () => {
  const f = harness(await directory())
  f.reply.current = (request) => { request.emit('error', new Error('net::ERR_CONNECTION_REFUSED')) }
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/a')).rejects.toThrow('ERR_CONNECTION_REFUSED')
  expect(f.owner.listenerCount('closed')).toBe(0)
})

it('times out a request that never answers', async () => {
  vi.stubEnv('DSH_DESKTOP_IMAGE_READ_TIMEOUT_MS', '1000')
  const f = harness(await directory())
  await expect(f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/slow')).rejects.toThrow(/timeout|timed out/iu)
  expect(f.requests[0]!.abort).toHaveBeenCalled()
  expect(f.owner.listenerCount('closed')).toBe(0)
})

it('aborts original-image reads on window navigation and releases lifecycle listeners', async () => {
  const f = harness(await directory())
  const reading = f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/original.gif')
  f.owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  await expect(reading).rejects.toThrow(/abort/iu)
  expect(f.requests[0]!.abort).toHaveBeenCalled()
  expect(f.owner.listenerCount('closed')).toBe(0)
  expect(f.owner.webContents.listenerCount('did-start-navigation')).toBe(0)
})

it('aborts a read when its window closes while the body arrives', async () => {
  const f = harness(await directory())
  const body = new Readable({ read() {} })
  f.reply.current = (request) => { request.respond(body); body.push(Buffer.from('partial')) }
  const reading = f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/original.gif')
  await vi.waitFor(() => { expect(f.requests).toHaveLength(1) })
  await new Promise(resolve => { setTimeout(resolve, 10) })
  f.owner.emit('closed')
  await expect(reading).rejects.toThrow(/abort/iu)
  expect(body.destroyed).toBe(true)
  expect(f.requests[0]!.abort).toHaveBeenCalled()
})

it('keeps a read across iframe and same-document navigation', async () => {
  const f = harness(await directory())
  const body = new Readable({ read() {} })
  f.reply.current = (request) => { request.respond(body) }
  const reading = f.invoke(FILE_ACTIONS_IPC.clipboardImageRead, 'https://images.example/original.gif')
  f.owner.webContents.emit('did-start-navigation', {}, 'https://example.org', false, false)
  f.owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/#tab', true, true)
  body.push(Buffer.from('bytes')); body.push(null)
  await expect(reading).resolves.toMatchObject({ bytes: new Uint8Array(Buffer.from('bytes')) })
})
