/** Privacy-safe desktop attention for completed user turns and background jobs. */

import type { Context } from '@deepseek-ai/cordis'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import z from '@deepseek-ai/schemastery'
import type { DesktopLocale, DesktopNotification } from './runtime.ts'
import {
  desktopSessionProgressFallbackTitle,
  type DesktopSessionProgressEntry,
  type DesktopSessionProgressSnapshot,
} from './session-progress.ts'

export const name = 'desktop-notifications'
export const inject = ['desktopRuntime']

export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'dsh-desktop-notifications'

export interface DesktopNotificationSettings {
  enabled: boolean
  notifyOnTurnCompletion: boolean
  notifyOnTurnFailure: boolean
  notifyOnJobCompletion: boolean
  notifyOnJobFailure: boolean
}

export const DesktopNotificationSettingsSchema: z<DesktopNotificationSettings> = z.object({
  enabled: z.boolean().default(true),
  notifyOnTurnCompletion: z.boolean().default(true),
  notifyOnTurnFailure: z.boolean().default(true),
  notifyOnJobCompletion: z.boolean().default(true),
  notifyOnJobFailure: z.boolean().default(true),
})

const DEFAULT_SETTINGS = DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)

type NotificationOutcome = 'turn-completed' | 'turn-failed' | 'job-completed' | 'job-failed'

const NOTIFICATION_COPY: Record<DesktopLocale, Record<NotificationOutcome, DesktopNotification>> = {
  en: {
    'turn-completed': { title: 'User Turn Completed', body: 'A user-initiated turn has finished.' },
    'turn-failed': { title: 'User Turn Failed', body: 'A user-initiated turn could not finish. Open DSH Desktop for details.' },
    'job-completed': { title: 'Background Job Completed', body: 'A background job has finished.' },
    'job-failed': { title: 'Background Job Failed', body: 'A background job could not finish. Open DSH Desktop for details.' },
  },
  zh: {
    'turn-completed': { title: '用户回合已完成', body: '一个由你发起的回合已完成。' },
    'turn-failed': { title: '用户回合失败', body: '一个由你发起的回合未能完成，请打开 DSH Desktop 查看详情。' },
    'job-completed': { title: '后台任务已完成', body: '有一个后台任务已结束。' },
    'job-failed': { title: '后台任务失败', body: '一个后台任务未能完成，请打开 DSH Desktop 查看详情。' },
  },
}

interface OpenTurn {
  readonly turn: number
  userInitiated: boolean
  firstUserText: string | undefined
}

/** Latest-wins session display title observed on the Host event firehose. */
export interface DesktopSessionProgressTitle {
  readonly title: string
  readonly updatedAt: number
}

/**
 * Extract privacy-safe display text from one user message event.
 *
 * Only the first text part is kept and truncated. Callers must treat the
 * result as same-sensitivity user content: it is safe for the local Dock
 * menu but never leaves the machine (never in notification bodies, logs,
 * or diagnostics).
 * @param event - user/message session event.
 * @returns display text, or undefined when no text part is present.
 */
export function desktopSessionProgressTextFromUserMessage(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  const content = event.data.content
  if (!Array.isArray(content)) return undefined
  for (const part of content) {
    if (part !== null && typeof part === 'object' && part.type === 'text') {
      const text = part.text.replace(/\s+/gu, ' ').trim()
      if (text.length > 0) return text.slice(0, 120)
      return undefined
    }
  }
  return undefined
}

/**
 * Record the latest session display title from one session event.
 * @param titles - mutable title map owned by the notifications effect.
 * @param sessionId - session identity.
 * @param session - live session emitting the event.
 * @param event - appended session event.
 */
export function trackDesktopSessionProgressTitle(
  titles: Map<string, DesktopSessionProgressTitle>,
  sessionId: string,
  session: Session,
  event: SessionEvent,
): void {
  if (session.header.origin === 'subagent') return
  if (event.type === 'session/title') {
    const title = event.data.title
    if (typeof title === 'string' && title.trim().length > 0) {
      titles.set(sessionId, { title: title.trim().slice(0, 120), updatedAt: Date.now() })
    }
    return
  }
  if (event.type === 'user/message') {
    if (event.data.source.kind !== 'user') return
    if (titles.has(sessionId)) return
    const text = desktopSessionProgressTextFromUserMessage(event)
    if (text !== undefined) titles.set(sessionId, { title: text, updatedAt: Date.now() })
  }
}

/** Unread session-progress entry owned by the notifications effect. */
export interface DesktopUnreadSessionProgress {
  readonly sessionId: string
  readonly failed: boolean
  readonly completedAt: number
}

/**
 * Build the unread session-progress list from finished-while-unfocused turns.
 * @param unread - unread map owned by the notifications effect.
 * @param titles - latest-wins title map owned by the notifications effect.
 * @returns newest-first entries with display titles or session-id fallbacks.
 */
export function buildDesktopUnreadSessionProgress(
  unread: Map<string, DesktopUnreadSessionProgress>,
  titles: Map<string, DesktopSessionProgressTitle>,
): DesktopSessionProgressEntry[] {
  return [...unread.values()]
    .sort((a, b) => b.completedAt - a.completedAt)
    .map(entry => ({
      sessionId: entry.sessionId,
      title: titles.get(entry.sessionId)?.title ?? desktopSessionProgressFallbackTitle(entry.sessionId),
      failed: entry.failed,
      completedAt: entry.completedAt,
    }))
}

/**
 * Build the Host-owned session-progress snapshot for the native shell.
 *
 * Recent sessions ride the same notification settings gate: no snapshot is
 * published while notifications are disabled.
 * @param unread - unread map owned by the notifications effect.
 * @param titles - latest-wins title map owned by the notifications effect.
 * @param recentSessionIds - newest-first recent session ids observed on the firehose.
 * @returns the snapshot published over `native:sessionProgress`.
 */
export function buildDesktopSessionProgressSnapshot(
  unread: Map<string, DesktopUnreadSessionProgress>,
  titles: Map<string, DesktopSessionProgressTitle>,
  recentSessionIds: readonly string[],
): DesktopSessionProgressSnapshot {
  const unreadEntries = buildDesktopUnreadSessionProgress(unread, titles)
  const unreadIds = new Set(unreadEntries.map(entry => entry.sessionId))
  const recent: DesktopSessionProgressEntry[] = []
  for (const sessionId of recentSessionIds) {
    if (unreadIds.has(sessionId)) continue
    const title = titles.get(sessionId)
    if (title === undefined) continue
    recent.push({ sessionId, title: title.title, failed: false, completedAt: title.updatedAt })
    if (recent.length >= 10) break
  }
  return { unread: unreadEntries, recent }
}

function notifyJob(
  runtime: Context['desktopRuntime'],
  settings: DesktopNotificationSettings,
  snapshot: JobSnapshot,
): void {
  if (!settings.enabled) return
  if (snapshot.status === 'completed' && settings.notifyOnJobCompletion) {
    runtime.notifyAttention(NOTIFICATION_COPY[runtime.locale]['job-completed'])
  } else if (snapshot.status === 'failed' && settings.notifyOnJobFailure) {
    runtime.notifyAttention(NOTIFICATION_COPY[runtime.locale]['job-failed'])
  }
}

function trackTurn(
  runtime: Context['desktopRuntime'],
  settings: DesktopNotificationSettings,
  openTurns: Map<string, OpenTurn>,
  unread: Map<string, DesktopUnreadSessionProgress>,
  titles: Map<string, DesktopSessionProgressTitle>,
  recentSessionIds: string[],
  session: Session,
  event: SessionEvent,
): void {
  if (session.header.origin !== 'subagent') {
    trackDesktopSessionProgressTitle(titles, String(session.header.id), session, event)
    if (event.type === 'turn/start' || event.type === 'user/message' || event.type === 'turn/end') {
      const sessionId = String(session.header.id)
      const at = recentSessionIds.indexOf(sessionId)
      if (at !== -1) recentSessionIds.splice(at, 1)
      recentSessionIds.unshift(sessionId)
      while (recentSessionIds.length > 20) recentSessionIds.pop()
    }
  }
  if (!settings.enabled) return
  if (session.header.origin === 'subagent') return
  const sessionId = String(session.header.id)

  if (event.type === 'turn/start') {
    openTurns.set(sessionId, { turn: event.data.turn, userInitiated: false, firstUserText: undefined })
    return
  }
  if (event.type === 'user/message') {
    const openTurn = openTurns.get(sessionId)
    if (openTurn !== undefined && event.data.source.kind === 'user') {
      openTurn.userInitiated = true
      if (openTurn.firstUserText === undefined) {
        openTurn.firstUserText = desktopSessionProgressTextFromUserMessage(event)
      }
    }
    return
  }
  if (event.type !== 'turn/end') return

  const openTurn = openTurns.get(sessionId)
  if (openTurn === undefined || openTurn.turn !== event.data.turn) return
  openTurns.delete(sessionId)
  if (!openTurn.userInitiated) return

  const reason = event.data.reason.kind
  const completedAt = Date.now()
  if (reason === 'completed' && settings.notifyOnTurnCompletion) {
    if (openTurn.firstUserText !== undefined && !titles.has(sessionId)) {
      titles.set(sessionId, { title: openTurn.firstUserText, updatedAt: completedAt })
    }
    unread.set(sessionId, { sessionId, failed: false, completedAt })
    publishDesktopSessionProgress(runtime, settings, unread, titles, recentSessionIds)
    runtime.notifyAttention({ ...NOTIFICATION_COPY[runtime.locale]['turn-completed'], sessionId })
  } else if ((reason === 'error' || reason === 'max-tokens') && settings.notifyOnTurnFailure) {
    if (openTurn.firstUserText !== undefined && !titles.has(sessionId)) {
      titles.set(sessionId, { title: openTurn.firstUserText, updatedAt: completedAt })
    }
    unread.set(sessionId, { sessionId, failed: true, completedAt })
    publishDesktopSessionProgress(runtime, settings, unread, titles, recentSessionIds)
    runtime.notifyAttention({ ...NOTIFICATION_COPY[runtime.locale]['turn-failed'], sessionId })
  }
}

/**
 * Publish the Host-owned session-progress snapshot to the native shell.
 * @param runtime - desktop runtime owning the native bridge.
 * @param settings - live notification settings gating the snapshot.
 * @param unread - unread map owned by the notifications effect.
 * @param titles - latest-wins title map owned by the notifications effect.
 * @param recentSessionIds - newest-first recent session ids.
 */
function publishDesktopSessionProgress(
  runtime: Context['desktopRuntime'],
  settings: DesktopNotificationSettings,
  unread: Map<string, DesktopUnreadSessionProgress>,
  titles: Map<string, DesktopSessionProgressTitle>,
  recentSessionIds: readonly string[],
): void {
  if (!settings.enabled) return
  runtime.publishSessionProgress(buildDesktopSessionProgressSnapshot(unread, titles, recentSessionIds))
}

/**
 * Mark one session as re-opened: drop its unread entry and republish.
 * @param runtime - desktop runtime owning the native bridge.
 * @param settings - live notification settings gating the snapshot.
 * @param unread - unread map owned by the notifications effect.
 * @param titles - latest-wins title map owned by the notifications effect.
 * @param recentSessionIds - newest-first recent session ids.
 * @param sessionId - session identity that was re-opened.
 */
export function markDesktopSessionProgressOpened(
  runtime: Pick<Context['desktopRuntime'], 'publishSessionProgress'>,
  settings: Pick<DesktopNotificationSettings, 'enabled'>,
  unread: Map<string, DesktopUnreadSessionProgress>,
  titles: Map<string, DesktopSessionProgressTitle>,
  recentSessionIds: readonly string[],
  sessionId: string,
): void {
  if (unread.delete(sessionId) && settings.enabled) {
    runtime.publishSessionProgress(buildDesktopSessionProgressSnapshot(unread, titles, recentSessionIds))
  }
}

/** Register independently optional settings, job, and live-session observers. */
export function apply(ctx: Context): void {
  let settings = DEFAULT_SETTINGS

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      const scope = settingsCtx.settings.register(
        DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
        DesktopNotificationSettingsSchema,
        { applies: 'live' },
      )
      settings = scope.get()
      const stopWatching = scope.watch((next) => { settings = next })
      return () => {
        stopWatching()
        settings = DEFAULT_SETTINGS
      }
    }, 'dsh-plugin-desktop: native notification settings')
  })

  ctx.inject(['jobs'], (jobsCtx) => {
    jobsCtx.effect(
      () => jobsCtx.jobs.onJobDone(snapshot => { notifyJob(jobsCtx.desktopRuntime, settings, snapshot) }),
      'dsh-plugin-desktop: background job attention',
    )
  })

  ctx.inject(['sessions'], (sessionsCtx) => {
    sessionsCtx.effect(() => {
      const openTurns = new Map<string, OpenTurn>()
      const unread = new Map<string, DesktopUnreadSessionProgress>()
      const titles = new Map<string, DesktopSessionProgressTitle>()
      const recentSessionIds: string[] = []
      const stopEvents = sessionsCtx.on('session/event', (session, event) => {
        trackTurn(sessionsCtx.desktopRuntime, settings, openTurns, unread, titles, recentSessionIds, session, event)
      })
      const stopDisposed = sessionsCtx.on('session/disposed', (session) => {
        const sessionId = String(session.header.id)
        openTurns.delete(sessionId)
        if (unread.delete(sessionId) && settings.enabled) {
          sessionsCtx.desktopRuntime.publishSessionProgress(
            buildDesktopSessionProgressSnapshot(unread, titles, recentSessionIds),
          )
        }
      })
      return () => {
        stopDisposed()
        stopEvents()
      }
    }, 'dsh-plugin-desktop: direct user turn attention')
  })
}
