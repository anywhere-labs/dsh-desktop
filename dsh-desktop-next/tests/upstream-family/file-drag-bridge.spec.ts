/** The preload half of the native file drag: what the official client calls, and the channels it reaches. */
import { afterEach, expect, it, vi } from 'vitest'
import type { FileDragHandle, FileDragRequestId } from '@deepseek-ai/dsh-util-file-drag'
import { createDesktopFileDragBridge } from '../../src/upstream-family-preload.ts'

const electron = vi.hoisted(() => ({ ipcRenderer: { invoke: vi.fn() } }))
vi.mock('electron', () => electron)
afterEach(() => { electron.ipcRenderer.invoke.mockReset() })

const requestId = 'request-1' as FileDragRequestId
const handle = 'handle-1' as FileDragHandle

it('forwards preparations and starts and answers with the main process result', async () => {
  electron.ipcRenderer.invoke.mockResolvedValueOnce(handle).mockResolvedValueOnce(true)
  const source = { kind: 'bytes' as const, bytes: new Uint8Array([1]), name: 'a.png', mediaType: 'image/png' }
  const { fileDrag } = createDesktopFileDragBridge()
  await expect(fileDrag.prepare(source, requestId)).resolves.toBe(handle)
  expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith('dsh-desktop:file-drag-prepare', source, requestId)
  await expect(fileDrag.start(handle)).resolves.toBe(true)
  expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith('dsh-desktop:file-drag-start', handle)
})

it('sends cancellations and releases without waiting and swallows their failures', async () => {
  electron.ipcRenderer.invoke.mockRejectedValue(new Error('main process shutting down'))
  const { fileDrag } = createDesktopFileDragBridge()
  expect(fileDrag.cancel(requestId)).toBeUndefined()
  expect(fileDrag.release(handle)).toBeUndefined()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([['dsh-desktop:file-drag-cancel', requestId], ['dsh-desktop:file-drag-release', handle]])
  await new Promise(resolve => setTimeout(resolve, 0))
})

it('exposes only the four operations the client declares, callable without a receiver', async () => {
  electron.ipcRenderer.invoke.mockResolvedValue(undefined)
  const bridge = createDesktopFileDragBridge()
  expect(Object.keys(bridge)).toEqual(['fileDrag'])
  expect(Object.keys(bridge.fileDrag).sort()).toEqual(['cancel', 'prepare', 'release', 'start'])
  const { prepare } = bridge.fileDrag
  await expect(prepare({ kind: 'resource', address: 'dsh-resource://file/session/s/a.png', mediaType: 'image/png' }, requestId)).resolves.toBeUndefined()
})
