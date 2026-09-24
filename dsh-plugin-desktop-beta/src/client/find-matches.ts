/**
 * Text matching for the Desktop find bar.
 *
 * Kept free of the DOM so the same offsets that drive highlighting and match
 * counting can be tested without a browser: every match addresses the original
 * `text` by UTF-16 offset, and matches never overlap, so a query repeated inside
 * its own match (`aa` in `aaa`) reports the same count a browser's find reports.
 */

/** One non-overlapping occurrence inside a single text run. */
export interface TextMatch {
  /** Inclusive UTF-16 offset of the first matched code unit. */
  readonly start: number
  /** Exclusive UTF-16 offset one past the last matched code unit. */
  readonly end: number
}

/**
 * Find every non-overlapping occurrence of `query` in `text`.
 *
 * Case folding is applied to whole candidate slices rather than to a folded copy
 * of the haystack: `String.prototype.toLowerCase` can change a string's length
 * (for example `'İ'` folds to two code units), and a folded haystack would then
 * address different offsets than the text node the caller highlights. The
 * `indexOf` fast path is used only while the fold is length-preserving, which is
 * the case for every ASCII query.
 * @param text - the text run to search, exactly as it appears in its text node.
 * @param query - the operator's search text; an empty query matches nothing.
 * @param matchCase - whether the comparison is case-sensitive.
 * @returns matches in ascending offset order.
 */
export function findTextMatches(text: string, query: string, matchCase: boolean): readonly TextMatch[] {
  if (query.length === 0 || text.length < query.length) return []
  const foldedText = matchCase ? text : text.toLowerCase()
  const foldedQuery = matchCase ? query : query.toLowerCase()
  const matches: TextMatch[] = []
  if (foldedText.length === text.length && foldedQuery.length === query.length) {
    let from = 0
    for (;;) {
      const at = foldedText.indexOf(foldedQuery, from)
      if (at < 0) return matches
      matches.push({ start: at, end: at + query.length })
      from = at + query.length
    }
  }
  // Length-changing fold: compare candidate slices so every offset still
  // addresses the original text.
  const limit = text.length - query.length
  for (let at = 0; at <= limit;) {
    if (text.slice(at, at + query.length).toLowerCase() === foldedQuery) {
      matches.push({ start: at, end: at + query.length })
      at += query.length
    } else {
      at += 1
    }
  }
  return matches
}
