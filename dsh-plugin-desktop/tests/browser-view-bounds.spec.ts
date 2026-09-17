import { describe, expect, it } from 'vitest'
import { browserViewVisible, clampBrowserViewBounds } from '../src/browser-view-bounds.ts'

describe('guest view bounds', () => {
  it('rounds fractional renderer rectangles down to integers', () => {
    expect(clampBrowserViewBounds(
      { x: 10.7, y: 20.2, width: 300.9, height: 200.5 },
      { width: 1280, height: 840 },
    )).toEqual({ x: 10, y: 20, width: 300, height: 200 })
  })

  it('intersects a rectangle that leaves the content area', () => {
    expect(clampBrowserViewBounds(
      { x: 900, y: 600, width: 400, height: 300 },
      { width: 1000, height: 700 },
    )).toEqual({ x: 900, y: 600, width: 100, height: 100 })
    expect(clampBrowserViewBounds(
      { x: -50, y: -40, width: 200, height: 100 },
      { width: 1000, height: 700 },
    )).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  it('hides rectangles smaller than 1x1 or outside the content area', () => {
    const container = { width: 1000, height: 700 }
    expect(clampBrowserViewBounds({ x: 0, y: 0, width: 0, height: 500 }, container)).toBeNull()
    expect(clampBrowserViewBounds({ x: 0, y: 0, width: 500, height: 0.4 }, container)).toBeNull()
    expect(clampBrowserViewBounds({ x: 1000, y: 0, width: 200, height: 200 }, container)).toBeNull()
    expect(clampBrowserViewBounds({ x: 0, y: 700, width: 200, height: 200 }, container)).toBeNull()
    expect(clampBrowserViewBounds({ x: 0, y: 0, width: -20, height: 200 }, container)).toBeNull()
  })

  it('collapses an unusable container, including an empty content area', () => {
    expect(clampBrowserViewBounds({ x: 0, y: 0, width: 100, height: 100 }, { width: 0, height: 0 })).toBeNull()
    expect(clampBrowserViewBounds({ x: 0, y: 0, width: 100, height: 100 }, { width: 100, height: -5 })).toBeNull()
  })

  it('refuses non-finite renderer rectangles', () => {
    const container = { width: 1000, height: 700 }
    expect(clampBrowserViewBounds({ x: Number.NaN, y: 0, width: 100, height: 100 }, container)).toBeNull()
    expect(clampBrowserViewBounds({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 }, container)).toBeNull()
  })
})

describe('guest view visibility', () => {
  const bounds = { x: 0, y: 0, width: 100, height: 100 }

  it('requires plugin intent, a shown window, and usable geometry', () => {
    const shown = { requested: true, windowVisible: true, minimized: false, bounds }
    expect(browserViewVisible(shown)).toBe(true)
    expect(browserViewVisible({ ...shown, requested: false })).toBe(false)
    expect(browserViewVisible({ ...shown, windowVisible: false })).toBe(false)
    expect(browserViewVisible({ ...shown, minimized: true })).toBe(false)
    expect(browserViewVisible({ ...shown, bounds: null })).toBe(false)
  })

  it('hides a minimized window even while the plugin asks for the view', () => {
    expect(browserViewVisible({ requested: true, windowVisible: true, minimized: true, bounds })).toBe(false)
  })
})
