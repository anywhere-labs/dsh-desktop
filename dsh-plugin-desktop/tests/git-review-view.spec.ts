import { describe, expect, it } from 'vitest'
import { formatGitReviewTurnDiff, GIT_REVIEW_NOTES_STORAGE_KEY, gitReviewNoteKey, parseGitReviewDiffLines, readGitReviewNotes, statusFromGitReviewTurnDiff, writeGitReviewNotes } from '../src/client/git-review-view.ts'

describe('Desktop Git review view helpers', () => {
  it('tracks old and new unified-diff line numbers independently', () => {
    expect(parseGitReviewDiffLines([
      'diff --git a/a.ts b/a.ts',
      '@@ -10,2 +20,3 @@',
      ' keep',
      '-remove',
      '+add one',
      '+add two',
    ].join('\n'))).toEqual([
      { kind: 'meta', text: 'diff --git a/a.ts b/a.ts' },
      { kind: 'hunk', text: '@@ -10,2 +20,3 @@' },
      { kind: 'context', oldLine: 10, newLine: 20, text: ' keep' },
      { kind: 'remove', oldLine: 11, text: '-remove' },
      { kind: 'add', newLine: 21, text: '+add one' },
      { kind: 'add', newLine: 22, text: '+add two' },
    ])
  })

  it('treats source lines beginning with triple plus or minus as content after the hunk header', () => {
    expect(parseGitReviewDiffLines('@@ -1 +1 @@\n---const oldValue = 1\n+++const newValue = 2').slice(1)).toEqual([
      { kind: 'remove', oldLine: 1, text: '---const oldValue = 1' },
      { kind: 'add', newLine: 1, text: '+++const newValue = 2' },
    ])
  })

  it('formats and classifies Last-turn add, delete and modify states', () => {
    const added = { kind: 'text' as const, path: 'src/a.ts', display: 'src/a.ts', before: false, after: true, coarse: false, hunks: [
      { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+new'] },
    ] }
    const deleted = { ...added, before: true, after: false }
    const modified = { ...added, before: true, after: true }
    expect(statusFromGitReviewTurnDiff(added)).toBe('A')
    expect(statusFromGitReviewTurnDiff(deleted)).toBe('D')
    expect(statusFromGitReviewTurnDiff(modified)).toBe('M')
    expect(formatGitReviewTurnDiff(added)).toContain('+++ "b/src/a.ts"')
    expect(formatGitReviewTurnDiff({ kind: 'binary', path: 'src/image.png', display: 'src/image.png' })).toBe('')
  })

  it('keys local line notes by worktree, review scope, path and line', () => {
    expect(gitReviewNoteKey('/repo', 'src/a.ts', 12, 'staged')).not.toBe(gitReviewNoteKey('/repo', 'src/a.ts', 12, 'last-turn'))
    expect(gitReviewNoteKey('/repo', 'src/a.ts', 12, 'staged')).not.toBe(gitReviewNoteKey('/other', 'src/a.ts', 12, 'staged'))
  })

  it('reads and writes bounded plain-text notes through injected browser storage', () => {
    let saved = ''
    const storage = {
      getItem: (key: string) => key === GIT_REVIEW_NOTES_STORAGE_KEY ? JSON.stringify({ 'note-key': 'Keep this in mind' }) : null,
      setItem: (key: string, value: string) => { if (key === GIT_REVIEW_NOTES_STORAGE_KEY) saved = value },
    }
    expect(readGitReviewNotes(storage)).toEqual({ 'note-key': 'Keep this in mind' })
    writeGitReviewNotes({ 'note-key': 'Updated' }, storage)
    expect(JSON.parse(saved)).toEqual({ 'note-key': 'Updated' })
  })
})
