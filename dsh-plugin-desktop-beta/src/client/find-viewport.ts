/**
 * Document-backed {@link FindViewport} used by the shipped Desktop find bar.
 *
 * Kept apart from the controller so the controller's rules can be exercised
 * against a recording double while this file holds every real DOM touch point.
 */

import type { FindViewport } from './find-controller.ts'
import { collectFindRanges, revealFoldedAncestor, scrollRangeIntoView } from './find-document.ts'
import { applyFindHighlights, clearFindHighlights } from './find-highlight.ts'

/**
 * Build the viewport the Desktop find bar drives.
 * @returns a viewport bound to the live document.
 */
export function createDocumentFindViewport(): FindViewport {
  return {
    collect: (query, matchCase) => collectFindRanges({ query, matchCase }),
    paint: (ranges, activeIndex) => { applyFindHighlights(ranges, activeIndex) },
    clear: () => { clearFindHighlights() },
    reveal: node => revealFoldedAncestor(node),
    scroll: range => scrollRangeIntoView(range),
    frame: (callback) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { callback() })
      else setTimeout(callback, 0)
    },
  }
}
