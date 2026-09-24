/**
 * Highlight painting for the Desktop find bar.
 *
 * Highlights go through the CSS Custom Highlight API rather than `<mark>`
 * wrappers: the transcript belongs to React and to upstream's streaming
 * renderer, so wrapping matched text in elements would be undone on the next
 * commit (and would corrupt the ranges the bar is navigating). Highlight
 * pseudo-elements paint ranges without touching a single node.
 */

/** Registered highlight name for every match. */
export const FIND_ALL_HIGHLIGHT = 'dsh-desktop-find'

/** Registered highlight name for the active match. */
export const FIND_ACTIVE_HIGHLIGHT = 'dsh-desktop-find-active'

/**
 * Whether this engine can paint range highlights without mutating the DOM.
 * @returns true when the Custom Highlight API is available.
 */
export function supportsFindHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'
}

/**
 * Publish the current result set to the highlight registry.
 * @param ranges - matches in navigation order.
 * @param activeIndex - index of the active match, or -1 for none.
 */
export function applyFindHighlights(ranges: readonly Range[], activeIndex: number): void {
  if (!supportsFindHighlights()) return
  CSS.highlights.set(FIND_ALL_HIGHLIGHT, new Highlight(...ranges))
  const active = ranges[activeIndex]
  if (active === undefined) {
    CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT)
    return
  }
  CSS.highlights.set(FIND_ACTIVE_HIGHLIGHT, new Highlight(active))
}

/** Drop every highlight the bar owns. */
export function clearFindHighlights(): void {
  if (!supportsFindHighlights()) return
  CSS.highlights.delete(FIND_ALL_HIGHLIGHT)
  CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT)
}
