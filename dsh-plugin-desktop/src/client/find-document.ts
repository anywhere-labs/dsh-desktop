/**
 * Document traversal for the Desktop find bar.
 *
 * The bar searches the rendered page rather than one feature's container: that
 * is what the operator's Ctrl/Cmd+F means everywhere else, and it keeps the
 * result independent of which panel happens to host the text. Two properties
 * are non-negotiable and live here rather than in the component:
 *
 * - The find bar's own surface is excluded, so the query never matches the text
 *   the operator is typing (Chromium's native find would match it, which is why
 *   the bar cannot ride `webContents.findInPage`).
 * - Only content Chromium itself renders is searched, so a `display: none`
 *   subtree contributes no matches, while upstream's folded turns
 *   (`hidden="until-found"`) stay searchable and are revealed on navigation.
 */

import { findTextMatches } from './find-matches.ts'

/** Attribute marking a subtree the find bar must never search. */
export const FIND_EXCLUDED_ATTRIBUTE = 'data-dsh-find-excluded'

/** Upper bound on highlighted matches; a longer result reports as truncated. */
export const DEFAULT_FIND_MATCH_LIMIT = 1000

/** Elements whose text is markup or metadata rather than presented content. */
const NON_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])

/** Inputs of one document-wide search. */
export interface FindDocumentOptions {
  /** Operator query; an empty query produces no ranges. */
  readonly query: string
  /** Whether the comparison is case-sensitive. */
  readonly matchCase: boolean
  /** Root to search; defaults to the whole document body. */
  readonly root?: Node | undefined
  /** Hard cap on collected ranges; defaults to {@link DEFAULT_FIND_MATCH_LIMIT}. */
  readonly limit?: number | undefined
}

/** Outcome of one document-wide search. */
export interface FindDocumentResult {
  /** Matches in document order, capped at the requested limit. */
  readonly ranges: readonly Range[]
  /** Whether the cap cut the result short. */
  readonly truncated: boolean
}

/**
 * Collect every searchable match of `query` under `root`.
 * @param options - query, comparison mode, and optional root/limit overrides.
 * @returns the collected ranges plus whether the cap truncated them.
 */
export function collectFindRanges(options: FindDocumentOptions): FindDocumentResult {
  const { query, matchCase } = options
  const root = options.root ?? document.body
  const limit = options.limit ?? DEFAULT_FIND_MATCH_LIMIT
  if (root === null || query.length === 0 || limit <= 0) return { ranges: [], truncated: false }
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: node => acceptFindNode(node),
  })
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    const text = node as Text
    for (const match of findTextMatches(text.data, query, matchCase)) {
      if (ranges.length >= limit) return { ranges, truncated: true }
      const range = document.createRange()
      range.setStart(text, match.start)
      range.setEnd(text, match.end)
      ranges.push(range)
    }
  }
  return { ranges, truncated: false }
}

/**
 * Decide one traversal step: reject prunes a whole subtree, skip drops one node.
 * @param node - element or text node offered by the TreeWalker.
 * @returns the TreeWalker filter verdict.
 */
function acceptFindNode(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element
    if (NON_CONTENT_TAGS.has(element.tagName)) return NodeFilter.FILTER_REJECT
    if (element.hasAttribute(FIND_EXCLUDED_ATTRIBUTE)) return NodeFilter.FILTER_REJECT
    // `hidden="until-found"` passes: it is folded content the operator expects to
    // find. Plain `hidden`, `display: none`, and `visibility: hidden` do not.
    if (!isRendered(element)) return NodeFilter.FILTER_REJECT
    return NodeFilter.FILTER_ACCEPT
  }
  return (node as Text).data.trim().length === 0 ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT
}

/**
 * Whether an element's own box is laid out, ignoring its ancestors.
 *
 * Ancestors need no separate probe: the walker rejects an unrendered element
 * with `FILTER_REJECT`, which prunes its whole subtree, and `display` is not
 * inherited — so every descendant this predicate sees has already passed its
 * ancestors' check. That matters for folded turns, whose `content-visibility:
 * hidden` hides descendants without changing their own `display`, and which
 * must stay searchable because `beforematch` opens them on demand.
 * @param element - candidate element.
 * @returns true when the element participates in layout.
 */
export function isRendered(element: Element): boolean {
  const hidden = element.getAttribute('hidden')
  if (hidden !== null && hidden !== 'until-found') return false
  const view = element.ownerDocument.defaultView
  if (view === null) return true
  const style = view.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/**
 * Find the folded ancestor that hides `node`, if any.
 * @param node - a match boundary inside the document.
 * @returns the nearest `hidden="until-found"` ancestor, or undefined.
 */
export function foldedAncestorOf(node: Node): HTMLElement | undefined {
  let element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  while (element !== null) {
    if (element.getAttribute('hidden') === 'until-found') return element as HTMLElement
    element = element.parentElement
  }
  return undefined
}

/**
 * Reveal the folded turn containing `node` through upstream's own reveal path.
 *
 * Upstream hides a collapsed turn with `hidden="until-found"` and opens it from
 * the `beforematch` event it already listens for, so dispatching that event
 * reuses the fold state rather than mutating attributes behind React's back.
 * The reveal is asynchronous — the caller must let React commit before
 * measuring the match.
 * @param node - a match boundary inside the document.
 * @returns whether a folded ancestor was asked to reveal.
 */
export function revealFoldedAncestor(node: Node): boolean {
  const folded = foldedAncestorOf(node)
  if (folded === undefined) return false
  folded.dispatchEvent(new Event('beforematch'))
  return true
}

/**
 * Scroll the scroll container owning `range` so the match is centered.
 * @param range - the active match.
 * @returns whether the container moved (false when the match has no box yet).
 */
export function scrollRangeIntoView(range: Range): boolean {
  const rect = range.getBoundingClientRect()
  const scroller = nearestScrollableAncestor(range.startContainer)
  if (scroller === null) {
    if (rect.width === 0 && rect.height === 0) return false
    const element = range.startContainer.parentElement
    element?.scrollIntoView({ block: 'center', inline: 'nearest' })
    return element !== null
  }
  const scrollerRect = scroller.getBoundingClientRect()
  const target = scroller.scrollTop + (rect.top - scrollerRect.top) - (scrollerRect.height - rect.height) / 2
  const next = Math.max(0, target)
  if (next === scroller.scrollTop) return false
  scroller.scrollTop = next
  return true
}

/**
 * Find the nearest ancestor that actually scrolls its overflow.
 * @param node - node to start from.
 * @returns the scroll container, or null when the document itself scrolls.
 */
export function nearestScrollableAncestor(node: Node): Element | null {
  let element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  while (element !== null) {
    if (isScrollContainer(element)) return element
    element = element.parentElement
  }
  return null
}

/**
 * Whether an element owns a vertical overflow it can scroll.
 * @param element - candidate container.
 * @returns true when the element has hidden overflow above its client box.
 */
function isScrollContainer(element: Element): boolean {
  if (element.scrollHeight <= element.clientHeight) return false
  const view = element.ownerDocument.defaultView
  if (view === null) return false
  const overflowY = view.getComputedStyle(element).overflowY
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
}
