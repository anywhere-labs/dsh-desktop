/**
 * State machine behind the Desktop find bar.
 *
 * Everything the bar does to the page goes through {@link FindViewport}, so the
 * navigation, counting, and reveal-on-navigate rules are testable without a
 * browser. The controller owns no React state: the component reads it through
 * `useSyncExternalStore`, which keeps a single source of truth for the query,
 * the match count, and the active match.
 */

import type { FindDocumentResult } from './find-document.ts'

/** DOM side effects performed for one search; injected so tests can record them. */
export interface FindViewport {
  /**
   * Collect matches for one query.
   * @param query - operator query.
   * @param matchCase - whether the comparison is case-sensitive.
   */
  collect(query: string, matchCase: boolean): FindDocumentResult
  /**
   * Publish highlights for the current result set.
   * @param ranges - matches in navigation order.
   * @param activeIndex - index of the active match, or -1 for none.
   */
  paint(ranges: readonly Range[], activeIndex: number): void
  /** Drop every highlight the bar owns. */
  clear(): void
  /**
   * Open the folded turn containing a match, if the match is inside one.
   * @param node - a match boundary.
   * @returns whether a fold was asked to open.
   */
  reveal(node: Node): boolean
  /**
   * Scroll the active match into view.
   * @param range - the active match.
   * @returns whether the view moved.
   */
  scroll(range: Range): boolean
  /**
   * Run a callback after the next paint, for work that must observe a committed
   * fold reveal.
   * @param callback - deferred work.
   */
  frame(callback: () => void): void
}

/** Subscribe to document mutations; returns an unsubscribe. */
export type FindMutationObserver = (onChange: () => void) => () => void

/** Immutable snapshot rendered by the find bar. */
export interface DesktopFindState {
  /** Whether the bar is on screen. */
  readonly open: boolean
  /** Current query text. */
  readonly query: string
  /** Whether the comparison is case-sensitive. */
  readonly matchCase: boolean
  /** Number of matches in the capped result set. */
  readonly matches: number
  /** Zero-based index of the active match, or -1 when there is none. */
  readonly activeIndex: number
  /** Whether the result cap cut the match list short. */
  readonly truncated: boolean
  /** Bumped on every open request so the component can re-focus its input. */
  readonly focusToken: number
}

/** Construction inputs for {@link DesktopFindController}. */
export interface DesktopFindControllerOptions {
  /** Page-side effects, normally {@link createDocumentFindViewport}. */
  readonly viewport: FindViewport
  /** Mutation subscription while the bar is open; defaults to a MutationObserver. */
  readonly observe?: FindMutationObserver | undefined
  /** Coalescing window for mutation-driven re-searches, in milliseconds. */
  readonly mutationDebounceMs?: number | undefined
}

const INITIAL_STATE: DesktopFindState = Object.freeze({
  open: false,
  query: '',
  matchCase: false,
  matches: 0,
  activeIndex: -1,
  truncated: false,
  focusToken: 0,
})

/** Wrap an index into `[0, length)`. */
function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length
}

/** Observe the whole document for content changes. */
function observeDocument(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  return () => { observer.disconnect() }
}

/** Find-bar state machine over an injected page port. */
export class DesktopFindController {
  private readonly viewport: FindViewport
  private readonly observe: FindMutationObserver
  private readonly mutationDebounceMs: number
  private readonly listeners = new Set<() => void>()
  private state: DesktopFindState = INITIAL_STATE
  private ranges: readonly Range[] = []
  private disconnectObserver: (() => void) | undefined
  private mutationTimer: ReturnType<typeof setTimeout> | undefined
  private framePending = false
  private disposed = false

  /**
   * @param options - page port, mutation subscription, and debounce window.
   */
  constructor(options: DesktopFindControllerOptions) {
    this.viewport = options.viewport
    this.observe = options.observe ?? observeDocument
    this.mutationDebounceMs = options.mutationDebounceMs ?? 150
  }

  /**
   * Read the current snapshot.
   * @returns the snapshot; the reference is stable between changes.
   */
  getSnapshot(): DesktopFindState {
    return this.state
  }

  /**
   * Subscribe to snapshot changes.
   * @param listener - change callback.
   * @returns unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Open the bar, or re-focus it when it is already open. */
  open(): void {
    if (this.disposed) return
    this.publish({ open: true, focusToken: this.state.focusToken + 1 })
    if (this.disconnectObserver === undefined) this.disconnectObserver = this.observe(() => { this.scheduleRefresh() })
    this.refresh({ scroll: true })
  }

  /** Close the bar, drop its highlights, and stop watching for content changes. */
  close(): void {
    this.clearMutationTimer()
    this.disconnectObserver?.()
    this.disconnectObserver = undefined
    this.viewport.clear()
    this.ranges = []
    this.publish({ open: false, matches: 0, activeIndex: -1, truncated: false })
  }

  /**
   * Replace the query and re-run the search.
   * @param query - new query text.
   */
  setQuery(query: string): void {
    if (query === this.state.query) return
    this.publish({ query })
    this.refresh({ scroll: true, resetActive: true })
  }

  /** Invert case sensitivity and re-run the search from the first match. */
  toggleMatchCase(): void {
    this.publish({ matchCase: !this.state.matchCase })
    this.refresh({ scroll: true, resetActive: true })
  }

  /** Advance to the next match, wrapping at the end. */
  next(): void {
    this.step(1)
  }

  /** Move to the previous match, wrapping at the start. */
  previous(): void {
    this.step(-1)
  }

  /**
   * Apply one keyboard event to the bar.
   * @param event - the keydown to interpret.
   * @returns whether the bar consumed the event.
   */
  handleKeydown(event: KeyboardEvent): boolean {
    const primary = event.ctrlKey || event.metaKey
    if (primary && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      this.open()
      return true
    }
    if (!this.state.open) return false
    if (primary && !event.altKey && event.key.toLowerCase() === 'g') {
      event.preventDefault()
      if (event.shiftKey) this.previous()
      else this.next()
      return true
    }
    if (event.key === 'F3') {
      event.preventDefault()
      if (event.shiftKey) this.previous()
      else this.next()
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return true
    }
    return false
  }

  /** Release every subscription and timer this controller owns. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearMutationTimer()
    this.disconnectObserver?.()
    this.disconnectObserver = undefined
    this.viewport.clear()
    this.ranges = []
    this.listeners.clear()
  }

  /**
   * Re-run the search and republish highlights.
   * @param options - whether to reveal/scroll the active match and reset to the first.
   */
  private refresh(options: { scroll: boolean; resetActive?: boolean | undefined; reveal?: boolean | undefined }): void {
    if (this.disposed) return
    const { query, matchCase, open } = this.state
    if (!open || query.length === 0) {
      this.ranges = []
      this.viewport.clear()
      this.publish({ matches: 0, activeIndex: -1, truncated: false })
      return
    }
    const result = this.viewport.collect(query, matchCase)
    this.ranges = result.ranges
    const matches = result.ranges.length
    const activeIndex = options.resetActive === true || this.state.activeIndex < 0
      ? (matches === 0 ? -1 : 0)
      : Math.min(this.state.activeIndex, matches - 1)
    this.publish({ matches, activeIndex, truncated: result.truncated })
    this.viewport.paint(this.ranges, activeIndex)
    if (options.scroll) this.revealActive(options.reveal !== false)
  }

  /**
   * Move the active match and present it.
   * @param step - direction to move, usually 1 or -1.
   */
  private step(step: number): void {
    if (this.ranges.length === 0) return
    const activeIndex = wrapIndex(this.state.activeIndex + step, this.ranges.length)
    this.publish({ activeIndex })
    this.viewport.paint(this.ranges, activeIndex)
    this.revealActive(true)
  }

  /**
   * Present the active match: open its folded turn first when it is hidden.
   * @param allowReveal - whether a folded ancestor may still be asked to open.
   */
  private revealActive(allowReveal: boolean): void {
    const range = this.ranges[this.state.activeIndex]
    if (range === undefined) return
    if (!allowReveal || !this.viewport.reveal(range.startContainer)) {
      this.viewport.scroll(range)
      return
    }
    if (this.framePending) return
    this.framePending = true
    this.viewport.frame(() => {
      this.framePending = false
      if (this.disposed || !this.state.open) return
      // The fold opened through React, so the ranges measured before the commit
      // are stale: re-collect, keep the operator's position, then scroll. The
      // deferred pass never reveals again — if the fold did not actually open,
      // re-asking would spin one frame per attempt forever.
      this.refresh({ scroll: true, reveal: false })
    })
  }

  /** Coalesce transcript mutations into one re-search. */
  private scheduleRefresh(): void {
    if (this.mutationTimer !== undefined) return
    this.mutationTimer = setTimeout(() => {
      this.mutationTimer = undefined
      if (!this.disposed && this.state.open) this.refresh({ scroll: false })
    }, this.mutationDebounceMs)
  }

  /** Cancel a pending mutation refresh. */
  private clearMutationTimer(): void {
    if (this.mutationTimer === undefined) return
    clearTimeout(this.mutationTimer)
    this.mutationTimer = undefined
  }

  /**
   * Merge a partial state into the snapshot and notify only on real change.
   * @param patch - fields to replace.
   */
  private publish(patch: Partial<DesktopFindState>): void {
    const next = { ...this.state, ...patch }
    if (next.open === this.state.open
      && next.query === this.state.query
      && next.matchCase === this.state.matchCase
      && next.matches === this.state.matches
      && next.activeIndex === this.state.activeIndex
      && next.truncated === this.state.truncated
      && next.focusToken === this.state.focusToken) {
      return
    }
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }
}
