import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { IPC } from '../src/ipc.ts'
import { syncWindowFullscreenState } from '../src/window-fullscreen.ts'

function fakeWindow() {
  return Object.assign(new EventEmitter(), {
    fullscreen: false,
    destroyed: false,
    isDestroyed() { return this.destroyed },
    isFullScreen() { return this.fullscreen },
    webContents: Object.assign(new EventEmitter(), { send: vi.fn() }),
  })
}

it.each(['darwin', 'win32'] as const)('sends the %s fullscreen state on every transition and after each load', (platform) => {
  const window = fakeWindow()
  syncWindowFullscreenState(window as never, platform)

  window.fullscreen = true
  window.emit('enter-full-screen')
  window.fullscreen = false
  window.emit('leave-full-screen')
  // A reload in fullscreen gets the state again, because the new document starts windowed.
  window.fullscreen = true
  window.webContents.emit('did-finish-load')
  expect(window.webContents.send.mock.calls).toEqual([
    [IPC.windowFullscreen, true],
    [IPC.windowFullscreen, false],
    [IPC.windowFullscreen, true],
  ])

  window.destroyed = true
  window.emit('leave-full-screen')
  expect(window.webContents.send).toHaveBeenCalledTimes(3)
})

it('sends nothing on Linux, where no window control covers the page', () => {
  const window = fakeWindow()
  syncWindowFullscreenState(window as never, 'linux')
  window.fullscreen = true
  window.emit('enter-full-screen')
  window.webContents.emit('did-finish-load')
  expect(window.webContents.send).not.toHaveBeenCalled()
})
