/** The preload half of the file actions: what the official client calls, and the channels it reaches. */
import { afterEach, expect, it, vi } from 'vitest'
import { createDesktopFileActionsBridge } from '../../src/upstream-family-preload.ts'

const electron = vi.hoisted(() => ({ ipcRenderer: { invoke: vi.fn() } }))
vi.mock('electron', () => electron)
afterEach(() => { electron.ipcRenderer.invoke.mockReset() })

it('forwards saves and answers with the main process result', async () => {
  electron.ipcRenderer.invoke.mockResolvedValue({ status: 'saved', path: '/downloads/a.gif' })
  const request = { url: 'https://images.example/a.gif', name: 'a.gif', mediaType: 'image/gif', mode: 'saveAs' as const }
  await expect(createDesktopFileActionsBridge().fileActions.save(request)).resolves.toEqual({ status: 'saved', path: '/downloads/a.gif' })
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith('dsh-desktop:file-save', request)
})

it('forwards clipboard image reads', async () => {
  electron.ipcRenderer.invoke.mockResolvedValue({ bytes: new Uint8Array([1]), mediaType: 'image/gif' })
  await expect(createDesktopFileActionsBridge().fileActions.readClipboardImage('https://images.example/a.gif')).resolves.toEqual({ bytes: new Uint8Array([1]), mediaType: 'image/gif' })
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith('dsh-desktop:clipboard-image-read', 'https://images.example/a.gif')
})

it('exposes only the two operations the client declares, callable without a receiver', async () => {
  electron.ipcRenderer.invoke.mockResolvedValue({ status: 'cancelled' })
  const bridge = createDesktopFileActionsBridge()
  expect(Object.keys(bridge)).toEqual(['fileActions'])
  expect(Object.keys(bridge.fileActions).sort()).toEqual(['readClipboardImage', 'save'])
  const { save } = bridge.fileActions
  await expect(save({ url: 'blob:dsh-app://app/1', mode: 'download' })).resolves.toEqual({ status: 'cancelled' })
})
