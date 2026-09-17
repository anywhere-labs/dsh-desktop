/** Desktop attention for pending user questions, pending approval requests, completed turns, and background jobs. */

import type { Context } from '@deepseek-ai/cordis'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import z from '@deepseek-ai/schemastery'
import type { DesktopLocale, DesktopNotification } from './runtime.ts'

export const name = 'desktop-notifications'
export const inject = ['desktopRuntime']

export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'dsh-desktop-notifications'

export interface DesktopNotificationSettings {
  enabled: boolean
  notifyOnApprovalRequest: boolean
  notifyOnTurnCompletion: boolean
  notifyOnTurnFailure: boolean
  notifyOnUserQuestion: boolean
  notifyOnJobCompletion: boolean
  notifyOnJobFailure: boolean
  showResponsePreview: boolean
}

export const DesktopNotificationSettingsSchema: z<DesktopNotificationSettings> = z.object({
  enabled: z.boolean().default(true),
  notifyOnApprovalRequest: z.boolean().default(true),
  notifyOnTurnCompletion: z.boolean().default(true),
  notifyOnTurnFailure: z.boolean().default(true),
  notifyOnUserQuestion: z.boolean().default(true),
  notifyOnJobCompletion: z.boolean().default(true),
  notifyOnJobFailure: z.boolean().default(true),
  showResponsePreview: z.boolean().default(true),
})

const DEFAULT_SETTINGS = DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)

interface NotificationCopy {
  'turn-completed': DesktopNotification
  'turn-failed': DesktopNotification
  'turn-failed-max-tokens': DesktopNotification
  'user-question': DesktopNotification
  /** Pending approval alert; the body names the tool, the reason (when shown) explains why. */
  'approval-requested': { title: string; body: (toolName: string) => string }
  /** Pure tool-call turn with no final answer; the body reports the tool-call count. */
  'tool-only-turn': { title: string; body: (count: number) => string }
  'job-completed': DesktopNotification
  'job-failed': DesktopNotification
}

const NOTIFICATION_COPY: Record<DesktopLocale, NotificationCopy> = {
  en: {
    'turn-completed': { title: 'User Turn Completed', body: 'A user-initiated turn has finished.' },
    'turn-failed': { title: 'User Turn Failed', body: 'A user-initiated turn could not finish. Open DSH Desktop for details.' },
    'turn-failed-max-tokens': { title: 'User Turn Failed', body: 'The turn hit the context limit (max-tokens). Open DSH Desktop to continue.' },
    'user-question': { title: 'Model Needs Your Answer', body: 'Your answer is needed.' },
    'approval-requested': { title: 'Approval Requested', body: (toolName: string) => `"${toolName}" is waiting for your approval.` },
    'tool-only-turn': { title: 'User Turn Completed', body: (count: number) => `Completed ${count} tool call${count === 1 ? '' : 's'}.` },
    'job-completed': { title: 'Background Job Completed', body: 'A background job has finished.' },
    'job-failed': { title: 'Background Job Failed', body: 'A background job could not finish. Open DSH Desktop for details.' },
  },
  zh: {
    'turn-completed': { title: '用户回合已完成', body: '一个由你发起的回合已完成。' },
    'turn-failed': { title: '用户回合失败', body: '一个由你发起的回合未能完成，请打开 DSH Desktop 查看详情。' },
    'turn-failed-max-tokens': { title: '用户回合失败', body: '回合触发了上下文上限（max-tokens），请打开 DSH Desktop 继续。' },
    'user-question': { title: '模型需要你的回答', body: '模型正在等待你的回答。' },
    'approval-requested': { title: '等待权限审批', body: (toolName: string) => `「${toolName}」正在等待你的批准。` },
    'tool-only-turn': { title: '用户回合已完成', body: (count: number) => `完成了 ${count} 次工具调用。` },
    'job-completed': { title: '后台任务已完成', body: '有一个后台任务已结束。' },
    'job-failed': { title: '后台任务失败', body: '一个后台任务未能完成，请打开 DSH Desktop 查看详情。' },
  },
}

interface OpenTurn {
  readonly turn: number
  userInitiated: boolean
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

/** Match the session list's displayTitleOf: current title, project name, then session id. */
function notificationTitle(session: Session): string {
  const title = foldSessionTitle(session.snapshotEvents())?.title.replace(/\s+/gu, ' ').trim()
  if (title) return title
  return workspaceTitleOf(session.header.cwd ?? '') || String(session.header.id)
}

/** Session title when previews are on; static fallback when off (privacy-safe). */
function titleFor(
  session: Session,
  fallback: string,
  settings: DesktopNotificationSettings,
): string {
  return settings.showResponsePreview ? notificationTitle(session) : fallback
}

function trackTurn(
  runtime: Context['desktopRuntime'],
  settings: DesktopNotificationSettings,
  openTurns: Map<string, OpenTurn>,
  session: Session,
  event: SessionEvent,
): void {
  if (session.header.origin === 'subagent') return
  const sessionId = String(session.header.id)

  if (event.type === 'turn/start') {
    openTurns.set(sessionId, { turn: event.data.turn, userInitiated: false, responsePreview: '', toolCallCount: 0, hasText: false })
    return
  }
  if (event.type === 'user/message') {
    const openTurn = openTurns.get(sessionId)
    if (openTurn !== undefined && event.data.source.kind === 'user') openTurn.userInitiated = true
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
  if (!settings.enabled || !openTurn.userInitiated) return

  const reason = event.data.reason.kind
  if (reason === 'completed' && settings.notifyOnTurnCompletion) {
    const notification = NOTIFICATION_COPY[runtime.locale]['turn-completed']
    runtime.notifyAttention({
      title: titleFor(session, notification.title, settings),
      body: settings.showResponsePreview && openTurn.responsePreview
        ? openTurn.responsePreview
        : settings.showResponsePreview && !openTurn.hasText && openTurn.toolCallCount > 0
          ? NOTIFICATION_COPY[runtime.locale]['tool-only-turn'].body(openTurn.toolCallCount)
          : notification.body,
    })
  } else if (reason === 'max-tokens' && settings.notifyOnTurnFailure) {
    const notification = NOTIFICATION_COPY[runtime.locale]['turn-failed-max-tokens']
    runtime.notifyAttention({ title: titleFor(session, notification.title, settings), body: notification.body })
  } else if (reason === 'error' && settings.notifyOnTurnFailure) {
    const notification = NOTIFICATION_COPY[runtime.locale]['turn-failed']
    runtime.notifyAttention({ title: titleFor(session, notification.title, settings), body: notification.body })
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
      const pendingQuestions = new Map<ReturnType<typeof setTimeout>, Session>()
      const pendingApprovals = new Map<ReturnType<typeof setTimeout>, string>()
      const alertedApprovals = new Set<string>()
      const stopQuestions = sessionsCtx.on('user-questions/request', async (request, next) => {
        const session = request.agent?.session
        if (session === undefined || request.signal?.aborted || request.questions.length === 0
          || !settings.enabled || !settings.notifyOnUserQuestion) return next()

        // Let immediate answers/rejections settle before alerting about a pending interaction.
        // Observe the waterfall without claiming the request or changing the user's answer.
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
        // Let policy rejections and automatic answers settle before alerting about a pending
        // decision; observe the waterfall without claiming the request or changing its outcome.
        const timer = setTimeout(() => {
          pendingApprovals.delete(timer)
          if (request.signal?.aborted || alertedApprovals.has(sessionId)
            || !settings.enabled || !settings.notifyOnApprovalRequest) return
          alertedApprovals.add(sessionId)
          delivered = true
          const notification = NOTIFICATION_COPY[sessionsCtx.desktopRuntime.locale]['approval-requested']
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
