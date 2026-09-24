import { describe, expect, it, vi } from 'vitest'
import { DesktopFindController, type FindMutationObserver, type FindViewport } from '../src/client/find-controller.ts'
import type { FindDocumentResult } from '../src/client/find-document.ts'

interface RecordingViewport extends FindViewport {
  readonly collected: { query: string; matchCase: boolean }[]
  readonly painted: { matches: number; activeIndex: number }[]
  readonly revealed: Node[]
  readonly scrolled: number[]
  cleared: number
  result: FindDocumentResult
  revealResult: boolean
  readonly frames: (() => void)[]
}

function rangeOf(id: number): Range {
  return { startContainer: { nodeType: 1, id } } as unknown as Range
}

function recordingViewport(matches: number, truncated = false): RecordingViewport {
  const collected: { query: string; matchCase: boolean }[] = []
  const painted: { matches: number; activeIndex: number }[] = []
  const revealed: Node[] = []
  const scrolled: number[] = []
  const frames: (() => void)[] = []
  const viewport: RecordingViewport = {
    collected,
    painted,
    revealed,
    scrolled,
    frames,
    cleared: 0,
    revealResult: false,
    result: { ranges: Array.from({ length: matches }, (_, index) => rangeOf(index)), truncated },
    collect(query, matchCase) {
      collected.push({ query, matchCase })
      return viewport.result
    },
    paint(ranges, activeIndex) {
      painted.push({ matches: ranges.length, activeIndex })
    },
    clear() { viewport.cleared += 1 },
    reveal(node) {
      revealed.push(node)
      return viewport.revealResult
    },
    scroll(range) {
      scrolled.push(Number((range.startContainer as unknown as { id: number }).id))
      return true
    },
    frame(callback) { frames.push(callback) },
  }
  return viewport
}

function keyEvent(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) {
  let prevented = false
  const event = {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
    preventDefault() { prevented = true },
  }
  return { event: event as unknown as KeyboardEvent, prevented: () => prevented }
}

/**
 * Build a controller with the mutation port stubbed out.
 *
 * The shipped default installs a real `MutationObserver`, which a Node test
 * environment does not provide; every test that cares about transcript changes
 * injects its own observer instead.
 */
function controllerFor(viewport: RecordingViewport, observe: FindMutationObserver = () => () => {}) {
  return new DesktopFindController({ viewport, observe })
}

describe('DesktopFindController', () => {
  it('opens empty, searches on query, and paints the first match', () => {
    const viewport = recordingViewport(3)
    const controller = controllerFor(viewport)
    controller.open()
    expect(controller.getSnapshot()).toMatchObject({ open: true, matches: 0, activeIndex: -1, focusToken: 1 })

    controller.setQuery('beta')
    expect(viewport.collected).toEqual([{ query: 'beta', matchCase: false }])
    expect(viewport.painted).toEqual([{ matches: 3, activeIndex: 0 }])
    expect(viewport.scrolled).toEqual([0])
    expect(controller.getSnapshot()).toMatchObject({ query: 'beta', matches: 3, activeIndex: 0, truncated: false })
  })

  it('wraps navigation in both directions', () => {
    const viewport = recordingViewport(3)
    const controller = controllerFor(viewport)
    controller.open()
    controller.setQuery('beta')

    controller.previous()
    expect(controller.getSnapshot().activeIndex).toBe(2)
    controller.next()
    expect(controller.getSnapshot().activeIndex).toBe(0)
    controller.next()
    expect(controller.getSnapshot().activeIndex).toBe(1)
    expect(viewport.scrolled).toEqual([0, 2, 0, 1])
  })

  it('re-searches from the first match when case sensitivity changes', () => {
    const viewport = recordingViewport(2)
    const controller = controllerFor(viewport)
    controller.open()
    controller.setQuery('beta')
    controller.next()
    controller.toggleMatchCase()

    expect(viewport.collected.at(-1)).toEqual({ query: 'beta', matchCase: true })
    expect(controller.getSnapshot()).toMatchObject({ matchCase: true, activeIndex: 0 })
  })

  it('clears highlights and stops watching on close', () => {
    const viewport = recordingViewport(1)
    const stop = vi.fn()
    const controller = new DesktopFindController({ viewport, observe: () => stop })
    controller.open()
    controller.setQuery('beta')
    controller.close()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(viewport.cleared).toBeGreaterThan(0)
    expect(controller.getSnapshot()).toMatchObject({ open: false, matches: 0, activeIndex: -1 })
  })

  it('re-focuses on every open request while already open', () => {
    const viewport = recordingViewport(1)
    const controller = controllerFor(viewport)
    controller.open()
    controller.open()
    expect(controller.getSnapshot().focusToken).toBe(2)
  })

  it('opens on Ctrl/Cmd+F and navigates with Ctrl/Cmd+G and F3', () => {
    const viewport = recordingViewport(3)
    const controller = controllerFor(viewport)

    const open = keyEvent('f', { metaKey: true })
    expect(controller.handleKeydown(open.event)).toBe(true)
    expect(open.prevented()).toBe(true)
    controller.setQuery('beta')

    expect(controller.handleKeydown(keyEvent('g', { ctrlKey: true }).event)).toBe(true)
    expect(controller.getSnapshot().activeIndex).toBe(1)
    expect(controller.handleKeydown(keyEvent('g', { ctrlKey: true, shiftKey: true }).event)).toBe(true)
    expect(controller.getSnapshot().activeIndex).toBe(0)
    expect(controller.handleKeydown(keyEvent('F3', { shiftKey: true }).event)).toBe(true)
    expect(controller.getSnapshot().activeIndex).toBe(2)
  })

  it('closes on Escape only while open', () => {
    const viewport = recordingViewport(1)
    const controller = controllerFor(viewport)
    const closed = keyEvent('Escape')
    expect(controller.handleKeydown(closed.event)).toBe(false)
    expect(closed.prevented()).toBe(false)

    controller.open()
    expect(controller.handleKeydown(keyEvent('Escape').event)).toBe(true)
    expect(controller.getSnapshot().open).toBe(false)
  })

  it('coalesces transcript mutations into one debounced re-search', () => {
    vi.useFakeTimers()
    try {
      const viewport = recordingViewport(1)
      let onChange: (() => void) | undefined
      const controller = new DesktopFindController({
        viewport,
        observe: (listener) => { onChange = listener; return () => {} },
        mutationDebounceMs: 50,
      })
      controller.open()
      controller.setQuery('beta')
      expect(viewport.collected).toHaveLength(1)

      onChange?.()
      onChange?.()
      vi.advanceTimersByTime(49)
      expect(viewport.collected).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(viewport.collected).toHaveLength(2)
      expect(viewport.scrolled).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-collects once after a folded turn opens, then scrolls without revealing again', () => {
    const viewport = recordingViewport(2)
    viewport.revealResult = true
    const controller = controllerFor(viewport)
    controller.open()
    controller.setQuery('beta')

    expect(viewport.revealed).toHaveLength(1)
    expect(viewport.scrolled).toEqual([])
    expect(viewport.frames).toHaveLength(1)

    viewport.frames[0]?.()
    expect(viewport.collected).toHaveLength(2)
    expect(viewport.revealed).toHaveLength(1)
    expect(viewport.scrolled).toEqual([0])
  })

  it('clamps the active match when the transcript shrinks', () => {
    vi.useFakeTimers()
    try {
      const viewport = recordingViewport(3)
      let onChange: (() => void) | undefined
      const controller = new DesktopFindController({
        viewport,
        observe: (listener) => { onChange = listener; return () => {} },
        mutationDebounceMs: 10,
      })
      controller.open()
      controller.setQuery('beta')
      controller.next()
      controller.next()
      expect(controller.getSnapshot().activeIndex).toBe(2)

      viewport.result = { ranges: [rangeOf(0)], truncated: false }
      onChange?.()
      vi.advanceTimersByTime(10)
      expect(controller.getSnapshot()).toMatchObject({ matches: 1, activeIndex: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops publishing and watching once disposed', () => {
    const viewport = recordingViewport(1)
    const stop = vi.fn()
    const controller = new DesktopFindController({ viewport, observe: () => stop })
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.open()
    controller.dispose()
    expect(stop).toHaveBeenCalledTimes(1)

    listener.mockClear()
    controller.open()
    controller.setQuery('beta')
    expect(listener).not.toHaveBeenCalled()
  })
})
