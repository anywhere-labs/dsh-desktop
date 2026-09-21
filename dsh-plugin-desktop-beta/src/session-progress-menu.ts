/** Native Dock/Jump List session-progress menu builder (macOS Dock, Windows Jump List). */

import type { MenuItemConstructorOptions } from 'electron'
import {
  DESKTOP_SESSION_PROGRESS_VISIBLE_LIMIT,
  desktopSessionProgressFallbackTitle,
  truncateDesktopSessionProgressTitle,
  type DesktopSessionProgressEntry,
  type DesktopSessionProgressSnapshot,
} from './session-progress.ts'
import type { DesktopLocale } from './runtime.ts'

/** Copy keys for the Dock/Jump List session-progress menu sections. */
export type DesktopSessionProgressLabelKey =
  | 'unreadSessions'
  | 'recentSessions'
  | 'moreSessions'
  | 'openDesktop'

const labels: Record<DesktopLocale, Record<DesktopSessionProgressLabelKey, (value: string) => string>> = {
  en: {
    unreadSessions: () => 'Unread',
    recentSessions: () => 'Recent',
    moreSessions: () => 'More',
    openDesktop: productName => `Open ${productName}`,
  },
  zh: {
    unreadSessions: () => '未读会话',
    recentSessions: () => '最近会话',
    moreSessions: () => '更多',
    openDesktop: productName => `打开 ${productName}`,
  },
}

/**
 * Resolve one session-progress menu label.
 * @param locale - active Desktop locale.
 * @param key - label key.
 * @param value - product name interpolation for the fallback item.
 * @returns the localized label.
 */
export function desktopSessionProgressLabel(
  locale: DesktopLocale,
  key: DesktopSessionProgressLabelKey,
  value = '',
): string {
  return labels[locale][key](value)
}

/**
 * Resolve the display title for one session-progress entry.
 * @param entry - session-progress entry.
 * @returns the truncated title, or a truncated session-id fallback.
 */
export function desktopSessionProgressDisplayTitle(entry: DesktopSessionProgressEntry): string {
  const title = entry.title.trim()
  if (title.length === 0) return desktopSessionProgressFallbackTitle(entry.sessionId)
  return truncateDesktopSessionProgressTitle(title)
}

/**
 * Build one Dock/Jump List menu section with a ChatGPT-parity 3+More layout.
 * @param entries - newest-first session entries for the section.
 * @param openSession - native click handler receiving the target session id.
 * @returns the section items, or an empty array when the section has no entries.
 */
function buildSessionProgressSection(
  header: string,
  moreLabel: string,
  entries: readonly DesktopSessionProgressEntry[],
  openSession: (sessionId: string) => void,
): MenuItemConstructorOptions[] {
  if (entries.length === 0) return []
  const visible = entries.slice(0, DESKTOP_SESSION_PROGRESS_VISIBLE_LIMIT)
  const overflow = entries.slice(DESKTOP_SESSION_PROGRESS_VISIBLE_LIMIT)
  const items: MenuItemConstructorOptions[] = [{ label: header, enabled: false }]
  for (const entry of visible) {
    const sessionId = entry.sessionId
    items.push({ label: desktopSessionProgressDisplayTitle(entry), click: () => { openSession(sessionId) } })
  }
  if (overflow.length > 0) {
    items.push({
      label: moreLabel,
      submenu: overflow.map(entry => {
        const sessionId = entry.sessionId
        return {
          label: desktopSessionProgressDisplayTitle(entry),
          click: () => { openSession(sessionId) },
        } satisfies MenuItemConstructorOptions
      }),
    })
  }
  return items
}

/**
 * Build the Dock/Jump List session-progress menu template.
 *
 * Mirrors the ChatGPT/Codex layout: an Unread section (unread plus ready
 * sessions, de-duplicated), then a Recent section excluding already-listed
 * sessions. The first section is never preceded by a separator.
 * @param locale - active Desktop locale.
 * @param snapshot - Host-owned unread/recent snapshot.
 * @param productName - native application label for the fallback item.
 * @param openSession - native click handler receiving the target session id.
 * @param openDesktop - fallback handler revealing the main window.
 * @returns the menu template for `app.dock.setMenu` (macOS) reuse.
 */
export function buildDesktopSessionProgressMenu(
  locale: DesktopLocale,
  snapshot: DesktopSessionProgressSnapshot,
  productName: string,
  openSession: (sessionId: string) => void,
  openDesktop: () => void,
): MenuItemConstructorOptions[] {
  const unreadById = new Map<string, DesktopSessionProgressEntry>()
  for (const entry of [...snapshot.unread]) {
    if (!unreadById.has(entry.sessionId)) unreadById.set(entry.sessionId, entry)
  }
  const listed = new Set(unreadById.keys())
  const recent = snapshot.recent.filter(entry => !listed.has(entry.sessionId))
  const moreLabel = desktopSessionProgressLabel(locale, 'moreSessions')
  const sections = [
    buildSessionProgressSection(
      desktopSessionProgressLabel(locale, 'unreadSessions'),
      moreLabel,
      [...unreadById.values()],
      openSession,
    ),
    buildSessionProgressSection(
      desktopSessionProgressLabel(locale, 'recentSessions'),
      moreLabel,
      recent,
      openSession,
    ),
  ].filter(section => section.length > 0)
  const template = sections.flatMap((section, index) => (
    index === 0 ? section : [{ type: 'separator' } as const, ...section]
  ))
  if (template.length === 0) {
    return [{ label: desktopSessionProgressLabel(locale, 'openDesktop', productName), click: openDesktop }]
  }
  return template
}

/** Task payload for one Windows Jump List session entry. */
export interface DesktopSessionProgressJumpTask {
  /** Display title (already truncated for Dock parity). */
  readonly title: string
  /** Task description shown as a tooltip (260-character Windows limit). */
  readonly description: string
  /** Command-line arguments appended after the executable path. */
  readonly args: string
}

/**
 * Build Windows Jump List tasks for unread sessions.
 *
 * Each task relaunches the packaged executable with
 * `--open-session=<id>`; the running instance consumes it through the
 * `second-instance` handler and routes the renderer to that session.
 * @param snapshot - Host-owned unread/recent snapshot.
 * @returns Jump List tasks, newest first, capped at the visible limit.
 */
export function buildDesktopSessionProgressJumpTasks(
  snapshot: DesktopSessionProgressSnapshot,
): DesktopSessionProgressJumpTask[] {
  return snapshot.unread.slice(0, DESKTOP_SESSION_PROGRESS_VISIBLE_LIMIT).map(entry => ({
    title: desktopSessionProgressDisplayTitle(entry),
    description: desktopSessionProgressDisplayTitle(entry).slice(0, 260),
    args: `--open-session=${entry.sessionId}`,
  }))
}

/**
 * Parse a `--open-session=<id>` argument from a process argv list.
 * @param argv - process arguments (including or excluding the executable prefix).
 * @returns the session id, or undefined when no well-formed argument is present.
 */
export function parseDesktopSessionJumpArgv(argv: readonly string[]): string | undefined {
  const prefix = '--open-session='
  for (const argument of argv) {
    if (typeof argument !== 'string' || !argument.startsWith(prefix)) continue
    const sessionId = argument.slice(prefix.length).trim()
    // Session ids are opaque non-empty tokens without whitespace; anything
    // else is a malformed invocation rather than a routable session.
    if (sessionId.length > 0 && !/\s/u.test(sessionId)) return sessionId
  }
  return undefined
}
