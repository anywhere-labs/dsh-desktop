/** Pure geometry and visibility composition for main-process guest views. */

/** CSS-pixel rectangle in either renderer or window-content coordinates. */
export interface BrowserViewRect {
  x: number
  y: number
  width: number
  height: number
}

/** Window content area available to guest views. */
export interface BrowserViewContainer {
  width: number
  height: number
}

function finiteInteger(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0
}

/**
 * Intersect one rectangle that was already translated into window-content
 * coordinates with the current content area.
 * @param requested - untrusted rectangle in window-content CSS pixels.
 * @param container - window content size in CSS pixels.
 * @returns integer bounds at least 1x1, or `null` when nothing remains visible.
 */
export function clampBrowserViewBounds(
  requested: BrowserViewRect,
  container: BrowserViewContainer,
): BrowserViewRect | null {
  if (![requested.x, requested.y, requested.width, requested.height].every(Number.isFinite)) {
    return null
  }
  const containerWidth = Math.max(0, finiteInteger(container.width))
  const containerHeight = Math.max(0, finiteInteger(container.height))
  const left = Math.max(0, Math.trunc(requested.x))
  const top = Math.max(0, Math.trunc(requested.y))
  const width = Math.min(Math.max(0, Math.trunc(requested.width)), containerWidth - left)
  const height = Math.min(Math.max(0, Math.trunc(requested.height)), containerHeight - top)
  return width < 1 || height < 1 ? null : { x: left, y: top, width, height }
}

/** Inputs that decide whether one guest view may be shown. */
export interface BrowserViewVisibility {
  /** Visibility requested by the owning plugin. */
  requested: boolean
  /** Whether the owning main window is shown. */
  windowVisible: boolean
  /** Whether the owning main window is minimized. */
  minimized: boolean
  /** Last clamped rectangle; `null` when it is smaller than 1x1. */
  bounds: BrowserViewRect | null
}

/**
 * Compose every hide rule: plugin intent, window state, and usable geometry.
 * @param state - current visibility inputs.
 * @returns whether the guest view must be visible.
 */
export function browserViewVisible(state: BrowserViewVisibility): boolean {
  return state.requested && state.windowVisible && !state.minimized && state.bounds !== null
}
