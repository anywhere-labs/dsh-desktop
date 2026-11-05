/** Cursor-preserving file-reference insertion helpers for the composer. */

import { activeAtToken } from '@deepseek-ai/dsh-file-reference/grammar'

export interface FileInsertionSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface ClipboardOccurrenceRange {
  /** Start offset in the clipboard-text projection. */
  readonly offset: number
  /** Clipboard-text length; the editor detect projection represents the chip with one character. */
  readonly length: number
}

/** Expand a collapsed caret over its active @path query, if one ends at the caret. */
export function replaceActiveFileQuery(
  draft: string,
  occurrences: readonly ClipboardOccurrenceRange[],
  span: FileInsertionSpan,
): FileInsertionSpan {
  if (span.start !== span.end) return span
  const caret = detectToClipboardOffset(occurrences, span.end)
  if (caret === undefined) return span
  const active = activeAtToken(draft, caret)
  if (active === undefined) return span
  const clipboardStart = caret - active.prefix.length
  // Never flatten a structured reference chip into ordinary text.
  if (occurrences.some(occurrence => clipboardStart < occurrence.offset + occurrence.length
    && caret > occurrence.offset)) return span
  const detectStart = clipboardToDetectOffset(occurrences, clipboardStart)
  if (detectStart === undefined || detectStart > span.end) return span
  return { ...span, start: detectStart }
}

/** Add a single separating space only where adjacent text has no whitespace already. */
export function spacedFileMention(
  draft: string,
  occurrences: readonly ClipboardOccurrenceRange[],
  span: FileInsertionSpan,
  mention: string,
): string {
  const start = detectToClipboardOffset(occurrences, span.start)
  const end = detectToClipboardOffset(occurrences, span.end)
  if (start === undefined || end === undefined) return ` ${mention} `
  const before = start > 0 ? draft.charAt(start - 1) : ''
  const after = end < draft.length ? draft.charAt(end) : ''
  const leading = before === '' || !/\s/u.test(before) ? ' ' : ''
  const trailing = after === '' || !/\s/u.test(after) ? ' ' : ''
  return `${leading}${mention}${trailing}`
}

/** Map an editor detect-projection boundary to its clipboard-text boundary. */
function detectToClipboardOffset(
  occurrences: readonly ClipboardOccurrenceRange[],
  detectOffset: number,
): number | undefined {
  let expanded = 0
  for (const occurrence of occurrences) {
    const detectStart = occurrence.offset - expanded
    if (detectOffset < detectStart) return detectOffset + expanded
    if (detectOffset === detectStart) return occurrence.offset
    if (detectOffset === detectStart + 1) return occurrence.offset + occurrence.length
    if (detectOffset < detectStart + 1) return undefined
    expanded += occurrence.length - 1
  }
  return detectOffset + expanded
}

/** Map a clipboard-text boundary to the editor detect-projection boundary. */
function clipboardToDetectOffset(
  occurrences: readonly ClipboardOccurrenceRange[],
  clipboardOffset: number,
): number | undefined {
  let expanded = 0
  for (const occurrence of occurrences) {
    const clipboardEnd = occurrence.offset + occurrence.length
    if (clipboardOffset < occurrence.offset) return clipboardOffset - expanded
    if (clipboardOffset === occurrence.offset) return occurrence.offset - expanded
    if (clipboardOffset < clipboardEnd) return undefined
    if (clipboardOffset === clipboardEnd) return clipboardEnd - expanded - occurrence.length + 1
    expanded += occurrence.length - 1
  }
  return clipboardOffset - expanded
}
