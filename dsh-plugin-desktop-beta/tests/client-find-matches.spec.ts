import { describe, expect, it } from 'vitest'
import { findTextMatches } from '../src/client/find-matches.ts'

describe('findTextMatches', () => {
  it('matches nothing for an empty query or a longer query', () => {
    expect(findTextMatches('alpha', '', false)).toEqual([])
    expect(findTextMatches('alpha', 'alphabet', false)).toEqual([])
  })

  it('reports every occurrence in ascending offset order', () => {
    expect(findTextMatches('beta alpha beta', 'beta', false)).toEqual([
      { start: 0, end: 4 },
      { start: 11, end: 15 },
    ])
  })

  it('ignores case by default and honours matchCase when asked', () => {
    expect(findTextMatches('Beta beta BETA', 'beta', false)).toHaveLength(3)
    expect(findTextMatches('Beta beta BETA', 'beta', true)).toEqual([{ start: 5, end: 9 }])
  })

  it('never overlaps matches, so a repeated query counts like a browser', () => {
    expect(findTextMatches('aaaa', 'aa', false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })

  it('addresses the original text across a length-changing case fold', () => {
    // 'İ'.toLowerCase() is two code units, so a folded haystack would shift
    // every later offset. The slice comparison keeps offsets in the original.
    const text = 'İstanbul'
    const matches = findTextMatches(text, 'İ', false)
    expect(matches).toEqual([{ start: 0, end: 1 }])
    expect(text.slice(matches[0]?.start ?? 0, matches[0]?.end ?? 0)).toBe('İ')
  })

  it('matches a multi-code-unit emoji query by whole code points', () => {
    expect(findTextMatches('a 😀 b 😀', '😀', false)).toEqual([
      { start: 2, end: 4 },
      { start: 7, end: 9 },
    ])
  })
})
