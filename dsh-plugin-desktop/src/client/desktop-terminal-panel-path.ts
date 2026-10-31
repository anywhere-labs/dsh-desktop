/** Path folding and `cd` resolution for the Desktop terminal panel tab labels. */

/**
 * Derive the user's home directory from an absolute working directory.
 * Only the Linux `/home/<user>` and macOS `/Users/<user>` layouts are
 * recognized; anything else returns undefined rather than guessing.
 * @param cwd - absolute working directory reported by the Host terminal.
 * @returns the home prefix, or undefined when the layout is unrecognized.
 */
export function homeDirectoryOf(cwd: string): string | undefined {
  const match = /^\/(?:home|Users)\/[^/]+/u.exec(cwd)
  return match?.[0]
}

/**
 * Fold a long path for a tab label: the home prefix becomes `~`, and a
 * result longer than maxChars keeps the root and trailing segments around
 * an ellipsis, e.g. `~/…/osagentproject/capability-contract`.
 * @param path - absolute path or already-folded display path.
 * @param home - home prefix from {@link homeDirectoryOf}, when known.
 * @param maxChars - display budget; the folded result never exceeds it.
 * @returns the display path, always within maxChars.
 */
export function collapseTerminalPath(path: string, home?: string, maxChars = 40): string {
  const display = home !== undefined && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path
  if (display.length <= maxChars) return display
  const segments = display.split('/').filter(segment => segment !== '')
  if (segments.length <= 1) return display
  const prefix = display.startsWith('~') ? '~/…/' : '/…/'
  for (let keep = Math.min(2, segments.length); keep >= 1; keep -= 1) {
    const result = `${prefix}${segments.slice(-keep).join('/')}`
    if (result.length <= maxChars) return result
  }
  // Even the bare tail overflows the budget: truncate the tail itself.
  const last = segments[segments.length - 1] ?? ''
  const bare = `…/${last}`
  return bare.length <= maxChars ? bare : `…/${last.slice(0, Math.max(1, maxChars - 3))}…`
}

/**
 * Normalize an absolute path, resolving `.` and `..` and dropping trailing
 * slashes. The root directory normalizes to `/`.
 * @param path - absolute path to normalize.
 * @returns the normalized absolute path.
 */
function normalizeAbsolutePath(path: string): string {
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') { out.pop(); continue }
    out.push(segment)
  }
  return `/${out.join('/')}`
}

/**
 * Resolve a pure `cd` command against the tracked working directory so tab
 * labels can follow directory changes the Host never reports. Compound
 * commands, `cd -`, option flags, and `~user` forms are not tracked.
 * @param cwd - currently tracked working directory.
 * @param command - committed command line.
 * @param home - home prefix from {@link homeDirectoryOf}, when known.
 * @returns the new absolute directory, or undefined when untrackable.
 */
export function resolveCdTarget(cwd: string, command: string, home?: string): string | undefined {
  const match = /^cd(?:\s+(?<dir>.*?))?\s*$/u.exec(command)
  if (match === null) return undefined
  const raw = match.groups?.dir
  if (raw === undefined || raw.trim() === '') return home
  let dir = raw.trim()
  if (dir === '-') return undefined
  const quoted = (dir.startsWith('"') && dir.endsWith('"') && dir.length >= 2)
    || (dir.startsWith("'") && dir.endsWith("'") && dir.length >= 2)
  if (quoted) dir = dir.slice(1, -1)
  // Shell operators outside quotes mean a compound command, not a plain cd.
  if (!quoted && /[;&|<>$`]/u.test(dir)) return undefined
  if (dir.startsWith('-')) return undefined
  if (dir === '~' || dir.startsWith('~/')) {
    if (home === undefined) return undefined
    dir = `${home}${dir.slice(1)}`
  } else if (dir.startsWith('~')) {
    return undefined
  }
  const absolute = dir.startsWith('/') ? dir : `${cwd.replace(/\/+$/u, '')}/${dir}`
  return normalizeAbsolutePath(absolute)
}
