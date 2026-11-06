/** Native copy drags: product-frame ownership, temporary exports, Host-authorized borrowing and cleanup. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent, NativeImage, WebContents, WebFrameMain } from 'electron'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { installDesktopFileDrag, type FileDragElectron } from '../../src/upstream-family/file-drag.ts'
import { FILE_DRAG_IPC } from '../../src/upstream-family/file-drag-ipc.ts'

const electron = { handle: vi.fn(), removeHandler: vi.fn(), getPath: vi.fn(), getFileIcon: vi.fn() }
// Before each test: a finished test's cleanup still runs after its own test, and unregisters through these fakes.
beforeEach(() => { vi.resetAllMocks() })

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-file-drag-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  electron.getPath.mockReturnValue(root)
  const icon = {} as NativeImage
  electron.getFileIcon.mockResolvedValue(icon)
  const frame = Object.assign({} as WebFrameMain, { url: 'dsh-app://app/' })
  const window = Object.assign({} as BrowserWindow, { isDestroyed: () => false,
    webContents: Object.assign({} as WebContents, { mainFrame: frame, startDrag: vi.fn() }) })
  let current: BrowserWindow | undefined = window
  const resolve = vi.fn<Parameters<typeof installDesktopFileDrag>[2]>(async () => null)
  // The shell's guard: only the main frame of the application window, at the application origin.
  const owner = (event: IpcMainInvokeEvent): BrowserWindow => {
    if (current === undefined || event.sender !== current.webContents || event.senderFrame !== current.webContents.mainFrame
      || !event.senderFrame.url.startsWith('dsh-app://app/')) throw new Error('Rejected Next IPC sender')
    return current
  }
  const dispose = installDesktopFileDrag({ app: electron, ipcMain: electron } as unknown as FileDragElectron, owner, resolve)
  onTestFinished(dispose)
  const handlers = new Map<string, Handler>(electron.handle.mock.calls.map(([channel, handler]) => [channel, handler]))
  const event = Object.assign({} as IpcMainInvokeEvent, { sender: window.webContents, senderFrame: frame })
  const call = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => {
    const identity = channel === FILE_DRAG_IPC.prepare && args.length === 1 ? [randomUUID()] : []
    return (handlers.get(channel) as Handler)(event, ...args, ...identity)
  })
  const prepare = (bytes: Uint8Array, name = 'original.pdf', mediaType = 'application/pdf') => call(FILE_DRAG_IPC.prepare, { kind: 'bytes', bytes, name, mediaType })
  return { root, window, frame, event, icon, call, prepare, dispose, resolve, handlers, detach: () => { current = undefined } }
}

it('delivers original PDF bytes and filename through native copy drag', async () => {
  const f = await fixture()
  const bytes = new TextEncoder().encode('%PDF-1.4\noriginal\n%%EOF')
  const handle = await f.prepare(bytes, '报告.pdf')
  expect(f.window.webContents.startDrag).not.toHaveBeenCalled()
  expect(await f.call(FILE_DRAG_IPC.start, handle)).toBe(true)
  const [request] = vi.mocked(f.window.webContents.startDrag).mock.calls[0] as [{ file: string; icon: NativeImage }]
  expect(request.icon).toBe(f.icon)
  expect(request.file).toContain('报告.pdf')
  expect(new Uint8Array(await readFile(request.file))).toEqual(bytes)
  await f.call(FILE_DRAG_IPC.release, handle)
  expect(new Uint8Array(await readFile(request.file))).toEqual(bytes)
  expect(await f.call(FILE_DRAG_IPC.start, handle)).toBe(false)
  await f.dispose()
  expect(await readdir(f.root)).toEqual([])
})

it('accepts only the application main frame and releases failed native starts', async () => {
  const f = await fixture()
  expect(await f.call(FILE_DRAG_IPC.start, 'foreign')).toBe(false)
  const handle = await f.prepare(new Uint8Array([1]))
  vi.mocked(f.window.webContents.startDrag).mockImplementationOnce(() => { throw new Error('OS rejected drag') })
  expect(await f.call(FILE_DRAG_IPC.start, handle)).toBe(false)
  await vi.waitFor(async () => { expect(await readdir(f.root)).toEqual([]) })
  f.frame.url = 'dsh-app://shell/index.html'
  for (const channel of Object.values(FILE_DRAG_IPC)) await expect(f.call(channel, handle)).rejects.toThrow('Rejected Next IPC sender')
  f.frame.url = 'dsh-app://app/'
  Object.assign(f.event, { senderFrame: { url: 'dsh-app://app/' } })
  await expect(f.call(FILE_DRAG_IPC.start, handle)).rejects.toThrow('Rejected Next IPC sender')
  Object.assign(f.event, { senderFrame: f.frame, sender: {} })
  await expect(f.call(FILE_DRAG_IPC.start, handle)).rejects.toThrow('Rejected Next IPC sender')
  Object.assign(f.event, { sender: f.window.webContents })
  f.detach()
  await expect(f.call(FILE_DRAG_IPC.start, handle)).rejects.toThrow('Rejected Next IPC sender')
})

it('requires a fresh preparation identity of bounded length', async () => {
  const f = await fixture()
  const source = { kind: 'bytes', bytes: new Uint8Array([1]), name: 'a.png', mediaType: 'image/png' }
  for (const requestId of [undefined, '', 'x'.repeat(129), 42]) {
    await expect(f.call(FILE_DRAG_IPC.prepare, source, requestId)).rejects.toThrow('Invalid file preparation identity')
  }
  const icon = Promise.withResolvers<NativeImage>()
  electron.getFileIcon.mockReturnValueOnce(icon.promise)
  const first = f.call(FILE_DRAG_IPC.prepare, source, 'same')
  await vi.waitFor(() => { expect(electron.getFileIcon).toHaveBeenCalledOnce() })
  await expect(f.call(FILE_DRAG_IPC.prepare, source, 'same')).rejects.toThrow('Invalid file preparation identity')
  icon.resolve(f.icon)
  await expect(first).resolves.toEqual(expect.any(String))
})

it('cancels icon preparation on shutdown without waiting for the icon service', async () => {
  const f = await fixture()
  const pending = Promise.withResolvers<NativeImage>()
  electron.getFileIcon.mockReturnValue(pending.promise)
  const rejected = expect(f.prepare(new Uint8Array([1]))).rejects.toThrow('File transfer closed')
  await vi.waitFor(() => { expect(electron.getFileIcon).toHaveBeenCalledOnce() })
  await f.dispose()
  await rejected
  pending.resolve(f.icon)
  await pending.promise
  expect(await readdir(f.root)).toEqual([])
})

it('cancels stalled icon preparation and returns its storage budget before the icon completes', async () => {
  const f = await fixture()
  const icon = Promise.withResolvers<NativeImage>()
  electron.getFileIcon.mockReturnValueOnce(icon.promise)
  const preparing = f.call(FILE_DRAG_IPC.prepare,
    { kind: 'bytes', bytes: new Uint8Array(64 * 1024 * 1024), name: 'large.pdf', mediaType: 'application/pdf' }, 'cancelled')
  const rejected = expect(preparing).rejects.toThrow('cancelled')
  await vi.waitFor(() => { expect(electron.getFileIcon).toHaveBeenCalledOnce() })
  await f.call(FILE_DRAG_IPC.cancel, 'cancelled')
  await rejected
  expect(await readdir(f.root)).toEqual([])
  const next = await f.prepare(new Uint8Array([2]))
  expect(next).toEqual(expect.any(String))
  icon.resolve(f.icon)
  await icon.promise
})

it('aborts pending Host authorization when the bridge closes', async () => {
  const f = await fixture()
  const resource = Promise.withResolvers<null>()
  f.resolve.mockReturnValue(resource.promise)
  const preparing = f.call(FILE_DRAG_IPC.prepare,
    { kind: 'resource', address: 'dsh-resource://file/session/s/file.pdf', name: 'file.pdf', mediaType: 'application/pdf' })
  const rejected = expect(preparing).rejects.toThrow('File transfer closed')
  await vi.waitFor(() => { expect(f.resolve).toHaveBeenCalledOnce() })
  const signal = f.resolve.mock.calls[0]![1]
  await f.dispose()
  await rejected
  expect(signal.aborted).toBe(true)
  resource.resolve(null)
  await resource.promise
  expect(await readdir(f.root)).toEqual([])
})

it('rejects a preparation whose Host authorization fails, so the window copies the bytes instead', async () => {
  const f = await fixture()
  f.resolve.mockRejectedValue(new Error('File drag resource unavailable'))
  await expect(f.call(FILE_DRAG_IPC.prepare,
    { kind: 'resource', address: 'dsh-resource://file/session/s/file.pdf', name: 'file.pdf', mediaType: 'application/pdf' })).rejects.toThrow('File drag resource unavailable')
  await expect(f.prepare(new Uint8Array([1]), 'file.pdf')).resolves.toEqual(expect.any(String))
})

it('borrows only authorized unchanged files with the requested export name, never deleting the source', async () => {
  const f = await fixture()
  const bytes = Buffer.from('original PDF bytes')
  const path = join(f.root, 'report.pdf')
  await writeFile(path, bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  f.resolve.mockResolvedValue({ path, size: bytes.length, sha256 })
  const request = { kind: 'resource', address: 'dsh-resource://file/session/s/report.pdf', name: 'report.pdf', mediaType: 'application/pdf', sha256, size: bytes.length }
  const handle = await f.call(FILE_DRAG_IPC.prepare, request)
  expect(f.resolve).toHaveBeenCalledWith(request.address, expect.any(AbortSignal))
  expect(await readdir(f.root)).toEqual(['report.pdf'])
  expect(await f.call(FILE_DRAG_IPC.start, handle)).toBe(true)
  expect(f.window.webContents.startDrag).toHaveBeenCalledWith({ file: path, icon: f.icon })
  await f.dispose()
  expect(await readFile(path)).toEqual(bytes)
})

it('requests a copy for renamed, changed, and nonlocal resources', async () => {
  const f = await fixture()
  const path = join(f.root, 'report.pdf')
  const bytes = Buffer.from('PDF')
  await writeFile(path, bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  f.resolve.mockResolvedValue({ path, size: bytes.length, sha256 })
  const request = { kind: 'resource', address: 'dsh-resource://file/session/s/report.pdf', name: 'renamed.pdf', mediaType: 'application/pdf' }
  expect(await f.call(FILE_DRAG_IPC.prepare, request)).toBeUndefined()
  expect(await f.call(FILE_DRAG_IPC.prepare, { ...request, name: 'report.pdf', sha256: '0'.repeat(64) })).toBeUndefined()
  expect(await f.call(FILE_DRAG_IPC.prepare, { ...request, name: 'report.pdf', size: 100 })).toBeUndefined()
  // The Host's digest must still describe the file the shell reads.
  f.resolve.mockResolvedValueOnce({ path, size: bytes.length, sha256: 'f'.repeat(64) })
  expect(await f.call(FILE_DRAG_IPC.prepare, { ...request, name: 'report.pdf' })).toBeUndefined()
  const handle = await f.call(FILE_DRAG_IPC.prepare, { ...request, name: 'report.pdf' })
  await writeFile(path, 'changed')
  expect(await f.call(FILE_DRAG_IPC.start, handle)).toBe(false)
  f.resolve.mockResolvedValue(null)
  expect(await f.call(FILE_DRAG_IPC.prepare, request)).toBeUndefined()
})

it.each([null, {}, { kind: 'bytes', bytes: '/private/path', mediaType: 'text/plain' }, { kind: 'resource', address: '/private/path', mediaType: 1 },
  { kind: 'resource', address: 'dsh-resource://file/session/s/a.pdf', mediaType: 'application/pdf', sha256: 'abc' },
  { kind: 'resource', address: 'dsh-resource://file/session/s/a.pdf', mediaType: 'application/pdf', size: -1 },
  { kind: 'path', path: '/private/path', mediaType: 'text/plain' }])('rejects malformed wire request %j', async (value) => {
  const f = await fixture()
  await expect(f.call(FILE_DRAG_IPC.prepare, value)).rejects.toThrow('Invalid file drag request')
  expect(f.resolve).not.toHaveBeenCalled()
})

it('unregisters its channels once and refuses later operations when closed', async () => {
  const f = await fixture()
  const handle = await f.prepare(new Uint8Array([1]))
  await f.dispose()
  await f.dispose()
  expect(electron.removeHandler.mock.calls.map(([channel]) => channel).sort()).toEqual(Object.values(FILE_DRAG_IPC).sort())
  for (const channel of Object.values(FILE_DRAG_IPC)) await expect(f.call(channel, handle)).rejects.toThrow('File transfer closed')
  expect(await readdir(f.root)).toEqual([])
})
