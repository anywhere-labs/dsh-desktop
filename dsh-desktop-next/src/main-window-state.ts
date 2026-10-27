/** Durable bounds for the one DSH NEXT main window. */
import { join } from 'node:path'
import { atomicJson, readPrivateFile } from './private-files.ts'

const STATE_VERSION = 1
const MAX_STATE_BYTES = 4 * 1024

export const MAIN_WINDOW_STATE_FILENAME = 'main-window-state.json'

/** Electron-compatible main-window rectangle, kept independent from Electron at runtime. */
export interface MainWindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface MainWindowStateV1 {
  readonly version: 1
  readonly bounds: MainWindowBounds
}

/** Minimal persistence seam used by the Next shell. */
export interface MainWindowStateStore {
  read(): MainWindowBounds | undefined
  write(bounds: MainWindowBounds): void
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

/** Filesystem-backed state store under the Next home directory. */
export class FileMainWindowStateStore implements MainWindowStateStore {
  readonly statePath: string

  constructor(homeDirectory: string) {
    this.statePath = join(homeDirectory, MAIN_WINDOW_STATE_FILENAME)
  }

  read(): MainWindowBounds | undefined {
    const text = readPrivateFile(this.statePath, MAX_STATE_BYTES)
    if (text === undefined) return undefined
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== STATE_VERSION) {
      throw new Error('main-window state has an unsupported version')
    }
    return parseBounds((parsed as { bounds?: unknown }).bounds)
  }

  write(bounds: MainWindowBounds): void {
    const validated = parseBounds(bounds)
    const state: MainWindowStateV1 = { version: STATE_VERSION, bounds: validated }
    atomicJson(this.statePath, state)
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

/** Compare two window rectangles without relying on object identity. */
export function sameMainWindowBounds(left: MainWindowBounds, right: MainWindowBounds): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
}
