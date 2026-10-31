import { describe, expect, it } from 'vitest'
import { replaceActiveFileQuery, spacedFileMention } from '../src/client/desktop-file-context-insertion.ts'

describe('Desktop file-reference insertion', () => {
  it('replaces only the active @ query at the cursor and preserves later references', () => {
    const draft = '帮我看一下 @souce       总结后 生成文档到 @define'
    const caret = draft.indexOf('       总结后')
    const span = replaceActiveFileQuery(draft, [], { start: caret, end: caret, draftRev: 7 })

    expect(span).toEqual({ start: caret - '@souce'.length, end: caret, draftRev: 7 })
    expect(spacedFileMention(draft, [], span, '@src/main.ts')).toBe('@src/main.ts')
    expect(draft.slice(caret)).toBe('       总结后 生成文档到 @define')
  })

  it('inserts at an ordinary caret and adds spaces only where boundaries need them', () => {
    const draft = 'before after'
    const span = { start: 7, end: 7, draftRev: 2 }
    expect(replaceActiveFileQuery(draft, [], span)).toEqual(span)
    expect(spacedFileMention(draft, [], span, '@src/main.ts')).toBe('@src/main.ts ')
  })

  it('surrounds an insertion into an empty draft with spaces', () => {
    expect(spacedFileMention('', [], { start: 0, end: 0, draftRev: 1 }, '@src/main.ts'))
      .toBe(' @src/main.ts ')
  })

  it('maps a caret after a structured reference chip back to its text position', () => {
    const chip = '@[photo.png](assets/photo.png)'
    const draft = `${chip} @souce   later`
    const occurrences = [{ offset: 0, length: chip.length }]
    const clipboardCaret = draft.indexOf('   later')
    const detectCaret = 1 + clipboardCaret - chip.length
    const span = replaceActiveFileQuery(draft, occurrences, {
      start: detectCaret,
      end: detectCaret,
      draftRev: 4,
    })
    const expectedStart = 1 + draft.indexOf('@souce') - chip.length

    expect(span).toEqual({ start: expectedStart, end: detectCaret, draftRev: 4 })
    expect(spacedFileMention(draft, occurrences, span, '@src/main.ts')).toBe('@src/main.ts')
  })

  it('does not flatten an existing structured file-reference chip', () => {
    const draft = '@[photo.png](assets/photo.png)'
    const span = { start: 1, end: 1, draftRev: 3 }
    expect(replaceActiveFileQuery(draft, [{ offset: 0, length: draft.length }], span)).toEqual(span)
  })
})
