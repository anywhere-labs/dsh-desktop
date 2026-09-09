/** Desktop attention for pending user questions, completed turns, and background jobs. */

import type { Context } from '@deepseek-ai/cordis'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-user-questions'
import z from '@deepseek-ai/schemastery'
import type { DesktopLocale, DesktopNotification } from './runtime.ts'

export const name = 'desktop-notifications'
export const inject = ['desktopRuntime']

export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'dsh-desktop-notifications'

export interface DesktopNotificationSettings {
  enabled: boolean
  notifyOnTurnCompletion: boolean
  notifyOnTurnFailure: boolean
  notifyOnUserQuestion: boolean
  notifyOnJobCompletion: boolean
  notifyOnJobFailure: boolean
  showResponsePreview: boolean
}

export const DesktopNotificationSettingsSchema: z<DesktopNotificationSettings> = z.object({
  enabled: z.boolean().default(true),
  notifyOnTurnCompletion: z.boolean().default(true),
  notifyOnTurnFailure: z.boolean().default(true),
  notifyOnUserQuestion: z.boolean().default(true),
  notifyOnJobCompletion: z.boolean().default(true),
  notifyOnJobFailure: z.boolean().default(true),
  showResponsePreview: z.boolean().default(true),
})

const DEFAULT_SETTINGS = DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)

interface NotificationCopy {
  'turn-completed': Pick<DesktopNotification, 'body'>
  'turn-failed': Pick<DesktopNotification, 'body'>
  'user-question': Pick<DesktopNotification, 'body'>
  'job-completed': DesktopNotification
  'job-failed': DesktopNotification
}

const NOTIFICATION_COPY: Record<DesktopLocale, NotificationCopy> = {
  en: {
    'turn-completed': { body: 'A user-initiated turn has finished.' },
    'turn-failed': { body: 'A user-initiated turn could not finish. Open DSH Desktop for details.' },
    'user-question': { body: 'Your answer is needed.' },
    'job-completed': { title: 'Background Job Completed', body: 'A background job has finished.' },
    'job-failed': { title: 'Background Job Failed', body: 'A background job could not finish. Open DSH Desktop for details.' },
  },
  zh: {
    'turn-completed': { body: '一个由你发起的回合已完成。' },
    'turn-failed': { body: '一个由你发起的回合未能完成，请打开 DSH Desktop 查看详情。' },
    'user-question': { body: '模型正在等待你的回答。' },
    'job-completed': { title: '后台任务已完成', body: '有一个后台任务已结束。' },
    'job-failed': { title: '后台任务失败', body: '一个后台任务未能完成，请打开 DSH Desktop 查看详情。' },
  },
}

interface OpenTurn {
  readonly turn: number
  userInitiated: boolean
  responsePreview: string
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
    openTurns.set(sessionId, { turn: event.data.turn, userInitiated: false, responsePreview: '' })
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
      openTurn.responsePreview = responsePreview(event)
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
      title: notificationTitle(session),
      body: settings.showResponsePreview && openTurn.responsePreview
        ? openTurn.responsePreview
        : notification.body,
    })
  } else if ((reason === 'error' || reason === 'max-tokens') && settings.notifyOnTurnFailure) {
    const notification = NOTIFICATION_COPY[runtime.locale]['turn-failed']
    runtime.notifyAttention({ ...notification, title: notificationTitle(session) })
  }
}

/** Match the session list's displayTitleOf: current title, project name, then session id. */
function notificationTitle(session: Session): string {
  const title = foldSessionTitle(session.snapshotEvents())?.title.replace(/\s+/gu, ' ').trim()
  if (title) return title
  return workspaceTitleOf(session.header.cwd ?? '') || String(session.header.id)
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
              title: notificationTitle(session),
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
      const stopEvents = sessionsCtx.on('session/event', (session, event) => {
        trackTurn(sessionsCtx.desktopRuntime, settings, openTurns, session, event)
      })
      const stopDisposed = sessionsCtx.on('session/disposed', (session) => {
        openTurns.delete(String(session.header.id))
        for (const [timer, pendingSession] of pendingQuestions) {
          if (pendingSession !== session) continue
          clearTimeout(timer)
          pendingQuestions.delete(timer)
        }
      })
      return () => {
        stopQuestions()
        for (const timer of pendingQuestions.keys()) clearTimeout(timer)
        pendingQuestions.clear()
        stopDisposed()
        stopEvents()
      }
    }, 'dsh-plugin-desktop: direct user turn attention')
  })
}
