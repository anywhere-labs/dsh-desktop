// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectFindRanges,
  DEFAULT_FIND_MATCH_LIMIT,
  FIND_EXCLUDED_ATTRIBUTE,
  foldedAncestorOf,
  revealFoldedAncestor,
} from '../src/client/find-document.ts'

function rangeTexts(ranges: readonly Range[]): string[] {
  return ranges.map(range => range.toString())
}

describe('collectFindRanges', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('collects matches across separate text nodes in document order', () => {
    document.body.innerHTML = '<p>beta one</p><div><span>two beta</span></div>'
    const result = collectFindRanges({ query: 'beta', matchCase: false })
    expect(rangeTexts(result.ranges)).toEqual(['beta', 'beta'])
    expect(result.truncated).toBe(false)
  })

  it('never searches its own excluded surface', () => {
    document.body.innerHTML = `
      <p>beta in the transcript</p>
      <div ${FIND_EXCLUDED_ATTRIBUTE}><input value="beta"><span>beta in the bar</span></div>
    `
    const result = collectFindRanges({ query: 'beta', matchCase: false })
    expect(result.ranges).toHaveLength(1)
    expect(result.ranges[0]?.startContainer.parentElement?.tagName).toBe('P')
  })

  it('skips content Chromium does not render', () => {
    document.body.innerHTML = `
      <p>beta visible</p>
      <div hidden><p>beta plain hidden</p></div>
      <div style="display: none"><p>beta display none</p></div>
      <div style="visibility: hidden"><p>beta visibility hidden</p></div>
    `
    const result = collectFindRanges({ query: 'beta', matchCase: false })
    expect(rangeTexts(result.ranges)).toEqual(['beta'])
  })

  it('keeps upstream folded turns searchable', () => {
    // Upstream hides a collapsed turn with `hidden="until-found"` and opens it
    // from `beforematch`, so its text must stay in the result set.
    document.body.innerHTML = `
      <p>beta visible</p>
      <div hidden="until-found"><p>beta inside a folded turn</p></div>
    `
    const result = collectFindRanges({ query: 'beta', matchCase: false })
    expect(result.ranges).toHaveLength(2)
  })

  it('never decides visibility from an engine probe that hides folded descendants', () => {
    // Chromium reports `checkVisibility() === false` for every descendant of a
    // folded turn: the `content-visibility: hidden` behind `hidden="until-found"`
    // is exactly what folds it, while those descendants are what the find
    // operation must reveal. A traversal that trusts that probe silently drops
    // folded matches, so the decision stays on the element's own box plus the
    // `hidden` attribute.
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'checkVisibility')
    Object.defineProperty(Element.prototype, 'checkVisibility', { configurable: true, value: () => false })
    try {
      document.body.innerHTML = `
        <p>beta visible</p>
        <div hidden="until-found"><p>beta inside a folded turn</p></div>
      `
      expect(collectFindRanges({ query: 'beta', matchCase: false }).ranges).toHaveLength(2)
    } finally {
      if (descriptor === undefined) delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility
      else Object.defineProperty(Element.prototype, 'checkVisibility', descriptor)
    }
  })

  it('skips markup and metadata elements', () => {
    document.body.innerHTML = '<style>.beta{color:red}</style><script>const beta = 1</script><p>beta</p>'
    const result = collectFindRanges({ query: 'beta', matchCase: false })
    expect(rangeTexts(result.ranges)).toEqual(['beta'])
  })

  it('caps the result set and reports the truncation', () => {
    document.body.innerHTML = `<p>${'beta '.repeat(10)}</p>`
    const result = collectFindRanges({ query: 'beta', matchCase: false, limit: 3 })
    expect(result.ranges).toHaveLength(3)
    expect(result.truncated).toBe(true)
    expect(DEFAULT_FIND_MATCH_LIMIT).toBeGreaterThan(3)
  })

  it('produces no ranges for an empty query', () => {
    document.body.innerHTML = '<p>beta</p>'
    expect(collectFindRanges({ query: '', matchCase: false }).ranges).toEqual([])
  })

  it('honours matchCase', () => {
    document.body.innerHTML = '<p>Beta beta</p>'
    expect(collectFindRanges({ query: 'Beta', matchCase: true }).ranges).toHaveLength(1)
  })
})

describe('folded turn helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('finds and reveals the folded ancestor of a match', () => {
    document.body.innerHTML = '<div hidden="until-found"><p id="inner">beta</p></div>'
    const inner = document.getElementById('inner')
    expect(inner).not.toBeNull()
    const text = inner?.firstChild
    expect(text).toBeTruthy()
    expect(foldedAncestorOf(text as Node)?.getAttribute('hidden')).toBe('until-found')

    let revealed = 0
    const folded = foldedAncestorOf(text as Node)
    folded?.addEventListener('beforematch', () => { revealed += 1 })
    expect(revealFoldedAncestor(text as Node)).toBe(true)
    expect(revealed).toBe(1)
  })

  it('reports nothing to reveal outside a folded turn', () => {
    document.body.innerHTML = '<p id="inner">beta</p>'
    const text = document.getElementById('inner')?.firstChild
    expect(foldedAncestorOf(text as Node)).toBeUndefined()
    expect(revealFoldedAncestor(text as Node)).toBe(false)
  })
})
