import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileMainWindowStateStore,
  fitMainWindowBounds,
} from '../src/main-window-state.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-main-window-state-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('main-window state', () => {
  it('atomically round-trips one validated rectangle', () => {
    const store = new FileMainWindowStateStore(temporaryDirectory())
    expect(store.read()).toBeUndefined()

    const bounds = { x: -1200, y: 48, width: 1360, height: 820 }
    store.write(bounds)

    expect(store.read()).toEqual(bounds)
  })

  it('rejects malformed state instead of constructing an invalid BrowserWindow', () => {
    const store = new FileMainWindowStateStore(temporaryDirectory())
    writeFileSync(store.statePath, '{"version":1,"bounds":{"x":0,"y":0,"width":0,"height":800}}\n')

    expect(() => store.read()).toThrow('dimensions must be positive safe integers')
  })

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
