import { afterEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ ipcRenderer: { on: vi.fn() } }))
vi.mock('electron', () => electron)
import { IPC } from '../src/ipc.ts'
import { syncWindowFullscreen } from '../src/preload-platform.ts'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  electron.ipcRenderer.on.mockReset()
  vi.unstubAllGlobals()
})

function syncOn(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { ...platform, value })
  syncWindowFullscreen()
}

it.each(['darwin', 'win32'] as const)('mirrors the %s fullscreen state onto the document root', (value) => {
  const dataset: Record<string, string> = {}
  vi.stubGlobal('document', { documentElement: { dataset } })
  syncOn(value)

  const [channel, listener] = electron.ipcRenderer.on.mock.calls[0]!
  expect(channel).toBe(IPC.windowFullscreen)
  listener({}, true)
  expect(dataset.fullscreen).toBe('true')
  listener({}, false)
  expect(dataset).not.toHaveProperty('fullscreen')
})

it('listens for nothing on Linux', () => {
  syncOn('linux')
  expect(electron.ipcRenderer.on).not.toHaveBeenCalled()
})
