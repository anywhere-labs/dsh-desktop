/** Durable size, position and maximized state for the one DSH Desktop Beta main window. */
import { join } from 'node:path'
import { atomicJson, readPrivateFile } from './private-files.ts'

const STATE_VERSION = 1
const MAX_STATE_BYTES = 4 * 1024

export const MAIN_WINDOW_STATE_FILENAME = 'desktop-window-state.json'

/** Electron-compatible main-window rectangle, kept independent from Electron at runtime. */
export interface MainWindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Normal (unmaximized) bounds, and whether the window covered its work area when last settled. */
export interface MainWindowState {
  readonly bounds: MainWindowBounds
  readonly maximized: boolean
}

/** The BrowserWindow members a capture reads. */
export interface MainWindowView {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  isFullScreen(): boolean
  isMaximized(): boolean
  getNormalBounds(): MainWindowBounds
}

function isSafeCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isPositiveDimension(value: unknown): value is number {
  return isSafeCoordinate(value) && value > 0
}

function parseBounds(value: unknown): MainWindowBounds {
  if (value === null || typeof value !== 'object') {
    throw new Error('main-window bounds must be an object')
  }
  const candidate = value as Partial<Record<keyof MainWindowBounds, unknown>>
  if (!isSafeCoordinate(candidate.x) || !isSafeCoordinate(candidate.y)) {
    throw new Error('main-window coordinates must be safe integers')
  }
  if (!isPositiveDimension(candidate.width) || !isPositiveDimension(candidate.height)) {
    throw new Error('main-window dimensions must be positive safe integers')
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  }
}

function parseState(value: unknown): MainWindowState {
  if (value === null || typeof value !== 'object') throw new Error('main-window state must be an object')
  const candidate = value as { version?: unknown, bounds?: unknown, maximized?: unknown }
  if (candidate.version !== STATE_VERSION) throw new Error('main-window state has an unsupported version')
  if (typeof candidate.maximized !== 'boolean') throw new Error('main-window maximized state must be a boolean')
  return { bounds: parseBounds(candidate.bounds), maximized: candidate.maximized }
}

/** Filesystem-backed state store in the Desktop data directory. */
export class FileMainWindowStateStore {
  readonly statePath: string

  constructor(homeDirectory: string) {
    this.statePath = join(homeDirectory, MAIN_WINDOW_STATE_FILENAME)
  }

  read(): MainWindowState | undefined {
    const text = readPrivateFile(this.statePath, MAX_STATE_BYTES)
    return text === undefined ? undefined : parseState(JSON.parse(text))
  }

  write(state: MainWindowState): void {
    const { bounds, maximized } = parseState({ ...state, version: STATE_VERSION })
    atomicJson(this.statePath, { version: STATE_VERSION, bounds, maximized })
  }
}

/** Keep a restored rectangle usable when monitor layout or work area has changed. */
export function fitMainWindowBounds(
  bounds: MainWindowBounds,
  workArea: MainWindowBounds,
  minimum: Pick<MainWindowBounds, 'width' | 'height'>,
): MainWindowBounds {
  const restored = parseBounds(bounds)
  const available = parseBounds(workArea)
  const minWidth = isPositiveDimension(minimum.width) ? minimum.width : 1
  const minHeight = isPositiveDimension(minimum.height) ? minimum.height : 1
  const width = Math.max(minWidth, Math.min(restored.width, available.width))
  const height = Math.max(minHeight, Math.min(restored.height, available.height))
  const visibleWidth = Math.max(
    0,
    Math.min(restored.x + width, available.x + available.width) - Math.max(restored.x, available.x),
  )
  const topEdgeIsReachable = restored.y >= available.y - 32
    && restored.y < available.y + available.height - 36
  if (width === restored.width
    && height === restored.height
    && visibleWidth >= Math.min(64, width)
    && topEdgeIsReachable) {
    return restored
  }
  const maxX = available.x + Math.max(0, available.width - width)
  const maxY = available.y + Math.max(0, available.height - height)
  return {
    x: Math.min(maxX, Math.max(available.x, restored.x)),
    y: Math.min(maxY, Math.max(available.y, restored.y)),
    width,
    height,
  }
}

/**
 * Read the state a settled main window should reopen with. Hidden, minimized, fullscreen and
 * destroyed windows keep `previous`: they are not a layout to reopen, and closing to the tray or
 * quitting hides the window before the last capture. On macOS a maximized window also keeps the
 * previous normal bounds, because Electron updates them there only for programmatic changes, not
 * for a zoom from the title bar; Windows and Linux report the restore rectangle, which follows a
 * maximized window moved to another display.
 * @param window - the main window.
 * @param previous - the last settled state, if any.
 * @param platform - the running platform.
 * @returns the state to keep, or `undefined` while nothing has settled yet.
 */
export function captureMainWindowState(window: MainWindowView, previous: MainWindowState | undefined, platform: NodeJS.Platform): MainWindowState | undefined {
  if (window.isDestroyed() || !window.isVisible() || window.isMinimized() || window.isFullScreen()) return previous
  const maximized = window.isMaximized()
  const bounds = maximized && platform === 'darwin' && previous !== undefined ? previous.bounds : window.getNormalBounds()
  return { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, maximized }
}

/** Compare two states without relying on object identity. */
export function sameMainWindowState(left: MainWindowState, right: MainWindowState): boolean {
  return left.maximized === right.maximized
    && left.bounds.x === right.bounds.x
    && left.bounds.y === right.bounds.y
    && left.bounds.width === right.bounds.width
    && left.bounds.height === right.bounds.height
}
