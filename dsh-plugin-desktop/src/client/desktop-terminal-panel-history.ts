/** Keystroke command capture and case-insensitive fuzzy ranking for the terminal panel. */

/** One executed command line recorded for a terminal tab. */
export interface TerminalHistoryEntry {
  readonly id: number
  readonly command: string
  readonly at: number
}

type EscapeState = 'none' | 'esc' | 'csi' | 'ss3'

/**
 * Fold one xterm input event into CSI/SS3 termination state.
 * @param state - current escape-sequence state.
 * @param char - next input code point.
 * @returns the following state.
 */
function nextEscapeState(state: EscapeState, char: string): EscapeState {
  if (state === 'esc') return char === '[' ? 'csi' : char === 'O' ? 'ss3' : 'none'
  if (state === 'csi') {
    const code = char.codePointAt(0) ?? 0
    return code >= 0x40 && code <= 0x7e ? 'none' : 'csi'
  }
  return 'none'
}

/**
 * Rebuilds the command line a user is editing from the raw terminal input
 * stream, without any shell integration. Escape sequences (arrow keys,
 * Home/End) and control keys are consumed without touching the line, so
 * shell-recalled or cursor-edited commands can diverge from the tracked
 * line — that is the documented v1 trade-off. Full-screen programs
 * (alternate screen) reset the line and are never recorded.
 */
export class TerminalInputTracker {
  private buffer = ''
  private escape: EscapeState = 'none'

  /** The currently tracked, unsubmitted command line. */
  get current(): string { return this.buffer }

  /** Drop the tracked line and any pending escape state. */
  clear(): void {
    this.buffer = ''
    this.escape = 'none'
  }

  /**
   * Fold raw terminal input into the tracked line.
   * @param data - one xterm `onData` payload (single key or paste burst).
   * @param altScreen - whether the terminal currently shows a full-screen program.
   * @returns commands committed by Enter inside this payload, in order.
   */
  feed(data: string, altScreen: boolean): string[] {
    if (altScreen) {
      this.clear()
      return []
    }
    const committed: string[] = []
    for (const char of data) {
      if (this.escape !== 'none') {
        this.escape = nextEscapeState(this.escape, char)
        continue
      }
      if (char === '\x1b') { this.escape = 'esc'; continue }
      if (char === '\r' || char === '\n') {
        const command = this.buffer.trim()
        this.buffer = ''
        if (command !== '') committed.push(command)
        continue
      }
      if (char === '\x7f' || char === '\b') { this.buffer = this.buffer.slice(0, -1); continue }
      if (char === '\x03' || char === '\x15') { this.buffer = ''; continue }
      const code = char.codePointAt(0) ?? 0
      if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue
      this.buffer += char
    }
    return committed
  }
}

/**
 * Score a case-insensitive subsequence match of query against candidate.
 * Consecutive hits, word starts (after space, `/`, `.`, `_`, `-`), and
 * candidate prefixes score highest; shorter candidates rank tighter.
 * @param query - filter text typed by the user.
 * @param candidate - one history command.
 * @returns the score, or undefined when query is not a subsequence.
 */
export function fuzzyScore(query: string, candidate: string): number | undefined {
  const needle = query.toLowerCase()
  const haystack = candidate.toLowerCase()
  if (needle === '') return 0
  let score = 0
  let qi = 0
  let streak = 0
  let first = -1
  let last = -1
  for (let ci = 0; ci < haystack.length && qi < needle.length; ci += 1) {
    if (haystack[ci] !== needle[qi]) { streak = 0; continue }
    streak += 1
    score += 1 + streak * 2
    if (ci === 0) score += 8
    else if (qi === 0 && /[\s/._-]/u.test(haystack[ci - 1] ?? '')) score += 4
    if (first < 0) first = ci
    last = ci
    qi += 1
  }
  if (qi < needle.length) return undefined
  // Gaps between the first and last hit cost more than any single streak earns.
  return score - (last - first + 1 - needle.length) * 3
}

/**
 * Filter and rank history entries for the rail filter box and the suggestion
 * popup. A blank query keeps every entry, newest first.
 * @param entries - recorded commands, any order.
 * @param query - filter text.
 * @param dedupe - collapse identical commands into their most recent entry (suggestion popup).
 * @returns matching entries, best score first, ties broken by recency.
 */
export function rankHistoryEntries(
  entries: readonly TerminalHistoryEntry[],
  query: string,
  dedupe = false,
): TerminalHistoryEntry[] {
  const ranked = (() => {
    if (query.trim() === '') return [...entries].sort((a, b) => b.at - a.at)
    const scored: { entry: TerminalHistoryEntry; score: number }[] = []
    for (const entry of entries) {
      const score = fuzzyScore(query, entry.command)
      if (score !== undefined) scored.push({ entry, score })
    }
    scored.sort((a, b) => b.score - a.score || b.entry.at - a.entry.at)
    return scored.map(item => item.entry)
  })()
  if (!dedupe) return ranked
  const seen = new Set<string>()
  return ranked.filter((entry) => {
    if (seen.has(entry.command)) return false
    seen.add(entry.command)
    return true
  })
}

/**
 * Pick the inline ghost completion for the tracked line: the best history
 * entry that extends the line verbatim (case-insensitive prefix), mirroring
 * fish-style autosuggestion.
 * @param line - tracked command line.
 * @param entries - this terminal's recorded commands.
 * @returns the full suggested command, or undefined.
 */
export function inlineSuggestion(line: string, entries: readonly TerminalHistoryEntry[]): string | undefined {
  if (line.length < 2) return undefined
  const lowered = line.toLowerCase()
  let best: TerminalHistoryEntry | undefined
  for (const entry of entries) {
    if (entry.command.length <= line.length || !entry.command.toLowerCase().startsWith(lowered)) continue
    if (best === undefined || entry.at > best.at) best = entry
  }
  return best?.command
}
