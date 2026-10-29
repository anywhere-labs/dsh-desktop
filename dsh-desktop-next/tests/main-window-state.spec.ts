import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureMainWindowState,
  FileMainWindowStateStore,
  fitMainWindowBounds,
  MAIN_WINDOW_STATE_FILENAME,
  sameMainWindowState,
  type MainWindowBounds,
  type MainWindowView,
} from '../src/main-window-state.ts'

const directories: string[] = []
function fixture(): FileMainWindowStateStore {
  const directory = mkdtempSync(join(tmpdir(), 'main-window-state-'))
  directories.push(directory)
  return new FileMainWindowStateStore(directory)
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function view(state: Partial<{ destroyed: boolean, visible: boolean, minimized: boolean, fullScreen: boolean, maximized: boolean }>, normal: MainWindowBounds): MainWindowView {
  return {
    isDestroyed: () => state.destroyed ?? false,
    isVisible: () => state.visible ?? true,
    isMinimized: () => state.minimized ?? false,
    isFullScreen: () => state.fullScreen ?? false,
    isMaximized: () => state.maximized ?? false,
    getNormalBounds: () => ({ ...normal }),
  }
}

describe('main-window state store', () => {
  it('atomically round-trips validated bounds and the maximized flag in the home directory', () => {
    const store = fixture()
    expect(store.statePath.endsWith(MAIN_WINDOW_STATE_FILENAME)).toBe(true)
    expect(store.read()).toBeUndefined()
    const state = { bounds: { x: -1200, y: 48, width: 1360, height: 820 }, maximized: true }
    store.write(state)
    expect(store.read()).toEqual(state)
    expect(JSON.parse(readFileSync(store.statePath, 'utf8'))).toEqual({ version: 1, ...state })
    if (process.platform !== 'win32') expect(lstatSync(store.statePath).mode & 0o777).toBe(0o600)
  })

  it('rejects malformed state instead of constructing an invalid BrowserWindow', () => {
    const store = fixture()
    for (const [text, message] of [
      ['{"version":1,"bounds":{"x":0,"y":0,"width":0,"height":800},"maximized":false}', 'dimensions must be positive safe integers'],
      ['{"version":1,"bounds":{"x":0.5,"y":0,"width":900,"height":800},"maximized":false}', 'coordinates must be safe integers'],
      ['{"version":1,"bounds":{"x":0,"y":0,"width":900,"height":800}}', 'maximized state must be a boolean'],
      ['{"version":2,"bounds":{"x":0,"y":0,"width":900,"height":800},"maximized":false}', 'unsupported version'],
      ['[]', 'unsupported version'],
    ] as const) {
      writeFileSync(store.statePath, text)
      expect(() => store.read()).toThrow(message)
    }
    writeFileSync(store.statePath, `{"padding":"${'x'.repeat(5000)}"}`)
    expect(() => store.read()).toThrow('regular file smaller than')
  })

  it.skipIf(process.platform === 'win32')('refuses to follow a linked state file', () => {
    const store = fixture()
    const target = join(dirname(store.statePath), 'elsewhere.json')
    writeFileSync(target, '{"version":1,"bounds":{"x":0,"y":0,"width":900,"height":800},"maximized":false}')
    symlinkSync(target, store.statePath)
    expect(() => store.read()).toThrow('regular file')
    expect(() => store.write({ bounds: { x: 0, y: 0, width: 900, height: 800 }, maximized: false })).toThrow('Refusing to replace a linked')
  })

  it('validates before writing, so a bad capture never replaces the last good state', () => {
    const store = fixture()
    const state = { bounds: { x: 10, y: 20, width: 900, height: 700 }, maximized: false }
    store.write(state)
    expect(() => store.write({ bounds: { x: 10, y: 20, width: 0, height: 700 }, maximized: false })).toThrow('dimensions must be positive')
    expect(store.read()).toEqual(state)
  })
})

describe('main-window bounds fitting', () => {
  it('preserves visible bounds and clamps stale monitor geometry to the work area', () => {
    const workArea = { x: -1440, y: 24, width: 1440, height: 876 }
    const minimum = { width: 900, height: 640 }
    expect(fitMainWindowBounds(
      { x: -1320, y: 80, width: 1280, height: 760 },
      workArea,
      minimum,
    )).toEqual({ x: -1320, y: 80, width: 1280, height: 760 })
    expect(fitMainWindowBounds(
      { x: -1448, y: 0, width: 1280, height: 760 },
      workArea,
      minimum,
    )).toEqual({ x: -1448, y: 0, width: 1280, height: 760 })
    expect(fitMainWindowBounds(
      { x: 4200, y: -800, width: 2000, height: 1400 },
      workArea,
      minimum,
    )).toEqual({ x: -1440, y: 24, width: 1440, height: 876 })
  })
})

describe('main-window state capture', () => {
  const normal = { x: 140, y: 90, width: 1300, height: 820 }
  const previous = { bounds: { x: 40, y: 60, width: 1200, height: 780 }, maximized: false }

  it('records a normal window at its current bounds', () => {
    expect(captureMainWindowState(view({}, normal), previous, 'win32')).toEqual({ bounds: normal, maximized: false })
    expect(captureMainWindowState(view({}, normal), undefined, 'darwin')).toEqual({ bounds: normal, maximized: false })
  })

  it('records a maximized window with the restore rectangle Windows and Linux report', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(captureMainWindowState(view({ maximized: true }, normal), previous, platform)).toEqual({ bounds: normal, maximized: true })
    }
  })

  it('keeps the previous normal bounds of a window zoomed on macOS', () => {
    expect(captureMainWindowState(view({ maximized: true }, normal), previous, 'darwin')).toEqual({ bounds: previous.bounds, maximized: true })
    expect(captureMainWindowState(view({ maximized: true }, normal), undefined, 'darwin')).toEqual({ bounds: normal, maximized: true })
  })

  it('keeps the previous state while the window is hidden, minimized, fullscreen or destroyed', () => {
    for (const state of [{ visible: false }, { minimized: true }, { fullScreen: true }, { destroyed: true }]) {
      expect(captureMainWindowState(view({ ...state, maximized: true }, normal), previous, 'win32')).toBe(previous)
      expect(captureMainWindowState(view(state, normal), undefined, 'darwin')).toBeUndefined()
    }
  })

  it('compares every coordinate and the maximized flag', () => {
    const state = { bounds: { x: 1, y: 2, width: 3, height: 4 }, maximized: false }
    expect(sameMainWindowState(state, { bounds: { ...state.bounds }, maximized: false })).toBe(true)
    expect(sameMainWindowState(state, { ...state, maximized: true })).toBe(false)
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(sameMainWindowState(state, { ...state, bounds: { ...state.bounds, [key]: 9 } })).toBe(false)
    }
  })
})
