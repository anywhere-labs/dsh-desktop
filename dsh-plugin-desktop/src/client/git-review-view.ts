import type { GitReviewTurnDiff } from '../git-review-contract.ts'

export interface GitReviewDiffLine {
  readonly kind: 'add' | 'remove' | 'context' | 'hunk' | 'meta'
  readonly oldLine?: number
  readonly newLine?: number
  readonly text: string
}

/** Convert a unified diff into display rows with accurate old/new line numbers. */
export function parseGitReviewDiffLines(diff: string): readonly GitReviewDiffLine[] {
  const output: GitReviewDiffLine[] = []
  let oldLine: number | undefined
  let newLine: number | undefined
  let inHunk = false
  for (const text of diff.split(/\r?\n/u)) {
    if (text.startsWith('diff --git')) {
      inHunk = false
      output.push({ kind: 'meta', text })
      continue
    }
    if (text.startsWith('@@')) {
      inHunk = true
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(text)
      oldLine = match === null ? undefined : Number(match[1])
      newLine = match === null ? undefined : Number(match[3])
      output.push({ kind: 'hunk', text })
      continue
    }
    if (text.startsWith('index ') || text.startsWith('\\') || (!inHunk && (text.startsWith('+++') || text.startsWith('---')))) {
      output.push({ kind: 'meta', text })
      continue
    }
    if (text.startsWith('+')) {
      output.push({ kind: 'add', ...(newLine === undefined ? {} : { newLine }), text })
      if (newLine !== undefined) newLine++
      continue
    }
    if (text.startsWith('-')) {
      output.push({ kind: 'remove', ...(oldLine === undefined ? {} : { oldLine }), text })
      if (oldLine !== undefined) oldLine++
      continue
    }
    if (text.startsWith(' ')) {
      output.push({ kind: 'context', ...(oldLine === undefined ? {} : { oldLine }), ...(newLine === undefined ? {} : { newLine }), text })
      if (oldLine !== undefined) oldLine++
      if (newLine !== undefined) newLine++
      continue
    }
    if (text.length > 0) output.push({ kind: 'meta', text })
  }
  return output
}

/** Serialize a WorkspaceChanges turn diff as a safe, copyable unified patch. */
export function formatGitReviewTurnDiff(diff: GitReviewTurnDiff | undefined): string {
  if (diff === undefined || diff.kind !== 'text') return ''
  const newline = String.fromCharCode(10)
  const quotePath = (value: string): string => JSON.stringify(value)
  const oldPath = diff.before ? quotePath(`a/${diff.path}`) : '/dev/null'
  const newPath = diff.after ? quotePath(`b/${diff.path}`) : '/dev/null'
  const hunks = diff.hunks.map(hunk => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${newline}${hunk.lines.join(newline)}`).join(newline)
  return `diff --git ${oldPath} ${newPath}${newline}--- ${oldPath}${newline}+++ ${newPath}${newline}${hunks}${newline}`
}

/** File state from before/after snapshots; undefined means the format lacks lifecycle data. */
export function statusFromGitReviewTurnDiff(diff: GitReviewTurnDiff | undefined): 'A' | 'D' | 'M' | undefined {
  if (diff === undefined || diff.kind !== 'text') return undefined
  if (!diff.before && diff.after) return 'A'
  if (diff.before && !diff.after) return 'D'
  return 'M'
}

export type GitReviewNotes = Readonly<Record<string, string>>
export const GIT_REVIEW_NOTES_STORAGE_KEY = 'dsh.git-review.notes.v1'
const MAX_SAVED_NOTES = 500
const MAX_NOTE_LENGTH = 4_000

export function gitReviewNoteKey(worktreePath: string, path: string, line: number, scope = ''): string {
  return JSON.stringify([worktreePath, scope, path, line])
}

/** Read bounded, plain-text per-line notes from browser-local storage. */
export function readGitReviewNotes(storage?: Pick<Storage, 'getItem'>): GitReviewNotes {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    const raw = target?.getItem(GIT_REVIEW_NOTES_STORAGE_KEY)
    if (raw === null || raw === undefined) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const notes: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed).slice(-MAX_SAVED_NOTES)) {
      if (key.length <= 8_192 && typeof value === 'string' && value.trim().length > 0) notes[key] = value.slice(0, MAX_NOTE_LENGTH)
    }
    return notes
  } catch { return {} }
}

/** Store only bounded local notes; no note content is sent to the Host or a remote. */
export function writeGitReviewNotes(notes: GitReviewNotes, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    if (target === undefined) return
    const entries = Object.entries(notes).slice(-MAX_SAVED_NOTES).map(([key, value]) => [key.slice(0, 8_192), value.slice(0, MAX_NOTE_LENGTH)])
    target.setItem(GIT_REVIEW_NOTES_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* Storage may be blocked or full; review itself must continue to work. */ }
}
