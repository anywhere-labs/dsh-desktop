/** Native notifications for user-initiated turns, with bounded visible message previews. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { DesktopNotification, DesktopPreferences, NotificationOutcome } from './desktop-contract.ts'

const TITLE_LIMIT = 160
const BODY_LIMIT = 1000

function preview(content: readonly ContentBlock[], limit: number): string {
  const text = content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').replace(/\s+/g, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, '')}…`
}

export function isDesktopNotification(value: unknown): value is DesktopNotification {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.outcome === 'turn-failed' || candidate.outcome === 'turn-completed'
    && typeof candidate.userMessage === 'string' && candidate.userMessage.length <= TITLE_LIMIT
    && typeof candidate.assistantMessage === 'string' && candidate.assistantMessage.length <= BODY_LIMIT
}

export function notificationCopy(notification: DesktopNotification, language: string): { title: string; body: string } {
  const zh = language.startsWith('zh')
  return notification.outcome === 'turn-completed' ? {
    title: notification.userMessage || (zh ? '回合已完成' : 'Turn completed'),
    body: notification.assistantMessage || (zh ? '你发起的回合已完成。' : 'A turn you started has finished.'),
  } : {
    title: zh ? '回合未能完成' : 'Turn could not finish',
    body: zh ? '打开 DSH NEXT 查看详情。' : 'Open DSH NEXT for details.',
  }
}

export function notificationEnabled(preferences: DesktopPreferences, outcome: NotificationOutcome): boolean {
  const key = { 'turn-completed': 'turnCompleted', 'turn-failed': 'turnFailed' } as const
  return preferences.notifications && preferences[key[outcome]]
}

export class TurnAttention {
  private readonly open = new Map<string, { turn: number; user: boolean; userMessage: string; assistantMessage: string }>()
  constructor(private readonly notify: (notification: DesktopNotification) => void) {}
  event(session: Session, event: SessionEvent): void {
    if (session.header.origin === 'subagent') return
    const id = String(session.header.id)
    if (event.type === 'turn/start') { this.open.set(id, { turn: event.data.turn, user: false, userMessage: '', assistantMessage: '' }); return }
    const turn = this.open.get(id)
    if (!turn) return
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      turn.user = true
      turn.userMessage = preview(event.data.content, TITLE_LIMIT)
    }
    if (event.type === 'assistant/message' && event.data.turn === turn.turn && !event.data.interrupted) {
      turn.assistantMessage = preview(event.data.message.content, BODY_LIMIT)
    }
    if (event.type !== 'turn/end' || event.data.turn !== turn.turn) return
    this.open.delete(id)
    if (!turn.user) return
    const reason = event.data.reason.kind
    if (reason === 'completed') this.notify({ outcome: 'turn-completed', userMessage: turn.userMessage, assistantMessage: turn.assistantMessage })
    else if (reason === 'error' || reason === 'max-tokens') this.notify({ outcome: 'turn-failed' })
  }
  dispose(session: Session): void { this.open.delete(String(session.header.id)) }
}

export function installNotifications(ctx: Context, notify: (notification: DesktopNotification) => void): void {
  ctx.inject(['sessions'], child => child.effect(() => {
    const turns = new TurnAttention(notify)
    const events = child.on('session/event', (session, event) => turns.event(session, event))
    const disposed = child.on('session/disposed', session => turns.dispose(session))
    return () => { events(); disposed() }
  }, 'Next user turn notifications'))
}
