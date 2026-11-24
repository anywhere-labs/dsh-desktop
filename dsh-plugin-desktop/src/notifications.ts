/** Desktop attention for pending approvals, pending questions, user turns, and background jobs. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { DesktopLocale, DesktopNotification } from './runtime.ts'
import { observeDesktopJobOutcomes, type DesktopJobOutcome } from './jobs-bridge.ts'
import {
  bindDesktopNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  DESKTOP_NOTIFICATIONS_SETTINGS_ENTRY_ID,
  type DesktopNotificationConfig,
  type DesktopNotificationSettings,
} from './settings-bridge.ts'

export const name = 'desktop-notifications'
export const inject = ['desktopRuntime']

export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = DESKTOP_NOTIFICATIONS_SETTINGS_ENTRY_ID

/**
 * The editable notification preference subset and this instance's validated
 * configuration are edition-local because the two channels' cores model plugin
 * configuration differently; see `src/settings-bridge.ts`.
 */
export {
  DesktopNotificationSettingsSchema,
  DesktopNotificationConfig as Config,
  type DesktopNotificationSettings,
} from './settings-bridge.ts'

type NotificationOutcome =
  | 'turn-completed'
  | 'turn-failed'
  | 'turn-failed-max-tokens'
  | 'job-completed'
  | 'job-failed'
  | 'schedule-completed'
  | 'schedule-failed'
  | 'user-question'

const NOTIFICATION_COPY: Record<DesktopLocale, Record<NotificationOutcome, DesktopNotification>> = {
  en: {
    'turn-completed': { title: 'User Turn Completed', body: 'A user-initiated turn has finished.' },
    'turn-failed': { title: 'User Turn Failed', body: 'A user-initiated turn could not finish. Open DSH Desktop for details.' },
    'turn-failed-max-tokens': { title: 'User Turn Failed', body: 'The turn hit the context limit (max-tokens). Open DSH Desktop to continue.' },
    'job-completed': { title: 'Background Job Completed', body: 'A background job has finished.' },
    'job-failed': { title: 'Background Job Failed', body: 'A background job could not finish. Open DSH Desktop for details.' },
    'schedule-completed': { title: 'Automation Task Completed', body: 'An automation task has finished.' },
    'schedule-failed': { title: 'Automation Task Failed', body: 'An automation task could not finish. Open DSH Desktop for details.' },
    'user-question': { title: 'Model Needs Your Answer', body: 'Your answer is needed.' },
  },
  zh: {
    'turn-completed': { title: '用户回合已完成', body: '一个由你发起的回合已完成。' },
    'turn-failed': { title: '用户回合失败', body: '一个由你发起的回合未能完成，请打开 DSH Desktop 查看详情。' },
    'turn-failed-max-tokens': { title: '用户回合失败', body: '回合触发了上下文上限（max-tokens），请打开 DSH Desktop 继续。' },
    'job-completed': { title: '后台任务已完成', body: '有一个后台任务已结束。' },
    'job-failed': { title: '后台任务失败', body: '一个后台任务未能完成，请打开 DSH Desktop 查看详情。' },
    'schedule-completed': { title: '自动化任务完成', body: '一个自动化任务已完成。' },
    'schedule-failed': { title: '自动化任务失败', body: '一个自动化任务未能完成，请打开 DSH Desktop 查看详情。' },
    'user-question': { title: '模型需要你的回答', body: '模型正在等待你的回答。' },
  },
}

/** Copy whose body depends on the pending request or the tool-call count. */
interface InteractionCopy {
  'approval-requested': { title: string; body: (toolName: string) => string }
  'tool-only-turn': { title: string; body: (count: number) => string }
}

const INTERACTION_COPY: Record<DesktopLocale, InteractionCopy> = {
  en: {
    'approval-requested': { title: 'Approval Requested', body: (toolName: string) => `"${toolName}" is waiting for your approval.` },
    'tool-only-turn': { title: 'User Turn Completed', body: (count: number) => `Completed ${count} tool call${count === 1 ? '' : 's'}.` },
  },
  zh: {
    'approval-requested': { title: '等待权限审批', body: (toolName: string) => `「${toolName}」正在等待你的批准。` },
    'tool-only-turn': { title: '用户回合已完成', body: (count: number) => `完成了 ${count} 次工具调用。` },
  },
}

interface OpenTurn {
  readonly turn: number
  source: 'user' | 'schedule' | undefined
  responsePreview: string
  toolCallCount: number
  hasText: boolean
}

/** Plain text from the final answer only; native notifications cannot render Markdown. */
function responsePreview(event: SessionEvent<'assistant/message'>): string {
  const { message, interrupted } = event.data
  if (interrupted || message.content.some(block => block.type === 'tool-call')) return ''
  return plainTextPreview(message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n'))
}

/** Count tool-call blocks in one assistant message (for pure tool-call turn fallback). */
function countToolCalls(event: SessionEvent<'assistant/message'>): number {
  return event.data.message.content.filter(block => block.type === 'tool-call').length
}

/** Bound native notification content without splitting visible Unicode characters. */
function plainTextPreview(value: string): string {
  const text = value
    .replace(/```[^\n]*\n|```/gu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gmu, '')
    .replace(/\*\*|__|~~|`/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)
  let preview = ''
  let count = 0
  for (const { segment } of segments) {
    if (count++ === 400) return `${preview.trimEnd()}…`
    preview += segment
  }
  return preview
}

/** Match the session list's display title: current title, project name, then session id. */
function notificationTitle(session: Session): string {
  // Partial session faces (test doubles, detached projections) may not carry the
  // event snapshot; they fall back to the project name or session id.
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
  const title = foldSessionTitle(events)?.title.replace(/\s+/gu, ' ').trim()
  if (title) return title
  return workspaceTitleOf(session.header.cwd ?? '') || String(session.header.id)
}

/**
 * Session title when content previews are on; static fallback when off, so
 * disabling previews restores fully generic notices without session names.
 */
function titleFor(
  session: Session,
  fallback: string,
  settings: DesktopNotificationSettings,
): string {
  return settings.showResponsePreview ? notificationTitle(session) : fallback
}

function notifyJob(
  runtime: Context['desktopRuntime'],
  settings: DesktopNotificationSettings,
  outcome: DesktopJobOutcome,
): void {
  if (!settings.enabled) return
  if (outcome === 'completed' && settings.notifyOnJobCompletion) {
    runtime.notifyAttention(NOTIFICATION_COPY[runtime.locale]['job-completed'])
  } else if (outcome === 'failed' && settings.notifyOnJobFailure) {
    runtime.notifyAttention(NOTIFICATION_COPY[runtime.locale]['job-failed'])
  }
}

function trackTurn(
  runtime: Context['desktopRuntime'],
  settings: DesktopNotificationSettings,
  openTurns: Map<string, OpenTurn>,
  session: Session,
  event: SessionEvent,
): void {
  if (!settings.enabled) return
  if (session.header.origin === 'subagent') return
  const sessionId = String(session.header.id)

  if (event.type === 'turn/start') {
    openTurns.set(sessionId, { turn: event.data.turn, source: undefined, responsePreview: '', toolCallCount: 0, hasText: false })
    return
  }
  if (event.type === 'user/message') {
    const openTurn = openTurns.get(sessionId)
    const source = event.data.source.kind as string
    if (openTurn !== undefined && (source === 'user' || source === 'schedule')) {
      openTurn.source = source
    }
    return
  }
  if (event.type === 'assistant/message') {
    const openTurn = openTurns.get(sessionId)
    if (openTurn !== undefined && openTurn.turn === event.data.turn) {
      const preview = responsePreview(event)
      openTurn.responsePreview = preview
      if (preview !== '') openTurn.hasText = true
      openTurn.toolCallCount += countToolCalls(event)
    }
    return
  }
  if (event.type !== 'turn/end') return

  const openTurn = openTurns.get(sessionId)
  if (openTurn === undefined || openTurn.turn !== event.data.turn) return
  openTurns.delete(sessionId)

  const reason = event.data.reason.kind
  const outcome = reason === 'completed' ? 'completed'
    : reason === 'error' || reason === 'max-tokens' ? 'failed' : undefined
  if (!outcome || openTurn.source === undefined) return

  if (openTurn.source === 'schedule') {
    const enabled = outcome === 'completed' ? settings.notifyOnScheduleCompletion : settings.notifyOnScheduleFailure
    if (enabled) runtime.notifyAttention(NOTIFICATION_COPY[runtime.locale][`schedule-${outcome}`])
    return
  }

  if (outcome === 'completed') {
    if (!settings.notifyOnTurnCompletion) return
    const notification = NOTIFICATION_COPY[runtime.locale]['turn-completed']
    runtime.notifyAttention({
      title: titleFor(session, notification.title, settings),
      body: settings.showResponsePreview && openTurn.responsePreview
        ? openTurn.responsePreview
        : settings.showResponsePreview && !openTurn.hasText && openTurn.toolCallCount > 0
          ? INTERACTION_COPY[runtime.locale]['tool-only-turn'].body(openTurn.toolCallCount)
          : notification.body,
    })
  } else {
    if (!settings.notifyOnTurnFailure) return
    const notification = reason === 'max-tokens'
      ? NOTIFICATION_COPY[runtime.locale]['turn-failed-max-tokens']
      : NOTIFICATION_COPY[runtime.locale]['turn-failed']
    runtime.notifyAttention({ title: titleFor(session, notification.title, settings), body: notification.body })
  }
}

/** Register independently optional settings, job, and live-session observers.
 * @param ctx - the notification plugin context.
 * @param config - validated live notification preferences.
 */
export function apply(ctx: Context, config: DesktopNotificationConfig): void {
  let settings = DEFAULT_NOTIFICATION_SETTINGS

  // Loader sends volatile updates only to this plugin's fiber. An injected
  // settings child owns a different fiber and cannot receive those updates.
  ctx.effect(
    () => bindDesktopNotificationSettings(ctx, config, (next) => { settings = next }),
    'dsh-plugin-desktop: native notification settings',
  )

  ctx.inject(['jobs'], (jobsCtx) => {
    jobsCtx.effect(
      () => observeDesktopJobOutcomes(jobsCtx, (outcome) => { notifyJob(jobsCtx.desktopRuntime, settings, outcome) }),
      'dsh-plugin-desktop: background job attention',
    )
  })

  ctx.inject(['sessions'], (sessionsCtx) => {
    sessionsCtx.effect(() => {
      const openTurns = new Map<string, OpenTurn>()
      const pendingQuestions = new Map<ReturnType<typeof setTimeout>, Session>()
      const pendingApprovals = new Map<ReturnType<typeof setTimeout>, string>()
      const alertedApprovals = new Set<string>()
      const stopQuestions = sessionsCtx.on('user-questions/request', async (request, next) => {
        const session = request.agent?.session
        if (session === undefined || request.signal?.aborted || request.questions.length === 0
          || !settings.enabled || !settings.notifyOnUserQuestion) return next()

        // Let immediate answers/rejections settle before alerting about a pending
        // interaction. Observe the waterfall without claiming the request.
        const timer = setTimeout(() => {
          pendingQuestions.delete(timer)
          if (request.signal?.aborted || !settings.enabled || !settings.notifyOnUserQuestion) return
          const notification = NOTIFICATION_COPY[sessionsCtx.desktopRuntime.locale]['user-question']
          try {
            sessionsCtx.desktopRuntime.notifyAttention({
              title: titleFor(session, notification.title, settings),
              body: settings.showResponsePreview
                ? plainTextPreview(`${notification.body} ${request.questions.map(question => question.question).join('\n')}`)
                : notification.body,
            })
          } catch (error) {
            sessionsCtx.logger.warn('Unable to show the pending-question notification', error)
          }
        }, 0)
        pendingQuestions.set(timer, session)
        try {
          return await next()
        } finally {
          clearTimeout(timer)
          pendingQuestions.delete(timer)
        }
      }, { global: true, prepend: true })
      const stopApprovals = sessionsCtx.on('approval/request', async (request, next) => {
        const session = request.agent?.session
        if (session === undefined || request.signal?.aborted
          || !settings.enabled || !settings.notifyOnApprovalRequest) return next()

        const sessionId = String(session.header.id)
        let delivered = false
        // Let policy rejections and automatic answers settle before alerting
        // about a pending decision; observe the waterfall without claiming it.
        const timer = setTimeout(() => {
          pendingApprovals.delete(timer)
          if (request.signal?.aborted || alertedApprovals.has(sessionId)
            || !settings.enabled || !settings.notifyOnApprovalRequest) return
          alertedApprovals.add(sessionId)
          delivered = true
          const notification = INTERACTION_COPY[sessionsCtx.desktopRuntime.locale]['approval-requested']
          try {
            sessionsCtx.desktopRuntime.notifyAttention({
              title: titleFor(session, notification.title, settings),
              body: settings.showResponsePreview && request.reason
                ? plainTextPreview(`${notification.body(request.toolName)} ${request.reason}`)
                : notification.body(request.toolName),
            })
          } catch (error) {
            sessionsCtx.logger.warn('Unable to show the pending-approval notification', error)
          }
        }, 0)
        pendingApprovals.set(timer, sessionId)
        try {
          return await next()
        } finally {
          clearTimeout(timer)
          pendingApprovals.delete(timer)
          if (delivered) alertedApprovals.delete(sessionId)
        }
      }, { global: true, prepend: true })
      const stopEvents = sessionsCtx.on('session/event', (session, event) => {
        trackTurn(sessionsCtx.desktopRuntime, settings, openTurns, session, event)
      })
      const stopDisposed = sessionsCtx.on('session/disposed', (session) => {
        const sessionId = String(session.header.id)
        openTurns.delete(sessionId)
        alertedApprovals.delete(sessionId)
        for (const [timer, pendingSession] of pendingQuestions) {
          if (pendingSession !== session) continue
          clearTimeout(timer)
          pendingQuestions.delete(timer)
        }
        for (const [timer, pendingId] of pendingApprovals) {
          if (pendingId !== sessionId) continue
          clearTimeout(timer)
          pendingApprovals.delete(timer)
        }
      })
      return () => {
        stopApprovals()
        stopQuestions()
        for (const timer of pendingApprovals.keys()) clearTimeout(timer)
        pendingApprovals.clear()
        alertedApprovals.clear()
        for (const timer of pendingQuestions.keys()) clearTimeout(timer)
        pendingQuestions.clear()
        stopDisposed()
        stopEvents()
      }
    }, 'dsh-plugin-desktop: direct user turn attention')
  })
}
