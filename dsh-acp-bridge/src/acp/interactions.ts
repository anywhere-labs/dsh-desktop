/**
 * Routes DSH approvals and questions to the ACP sessions attached to the asking
 * Agent. DSH delivers each request to every owner client (Desktop, Web, the AA
 * plugin and this bridge); the first answer settles it and the others are
 * cancelled, so the ACP client and DSH Desktop can both answer.
 */

import type { Context } from '@deepseek-ai/cordis'
import { record, type QuestionAnswer } from './convert.js'
import { InteractionStream, type InteractionOutcome } from './interaction-stream.js'
import type { Log } from './log.js'

export type ApprovalDecision = 'allowed-once' | 'rejected'
export type QuestionDecision = { kind: 'answered', value: QuestionAnswer } | { kind: 'declined' }

export interface ApprovalRequest { eventId: string, toolName: string, reason?: string, callId?: string }
export interface QuestionRequest { eventId: string, questions: unknown }

/** One attached ACP session; `undefined` means it cannot answer and leaves the request to others. */
export interface InteractionTarget {
  readonly dshId: string
  approve(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision | undefined>
  answer(request: QuestionRequest, signal: AbortSignal): Promise<QuestionDecision | undefined>
}

const DECLINED: InteractionOutcome = {
  kind: 'rejected', error: { name: 'UserQuestionError', code: 'ASK_CANCELLED', message: '用户取消了问答。' },
}

/** The first defined answer, or undefined when every target passes. */
async function first<T>(answers: readonly Promise<T | undefined>[]): Promise<T | undefined> {
  return new Promise(resolve => {
    let pending = answers.length
    if (!pending) { resolve(undefined); return }
    for (const answer of answers) {
      answer.then(value => {
        if (value !== undefined) resolve(value)
        else if (--pending === 0) resolve(undefined)
      }, () => { if (--pending === 0) resolve(undefined) })
    }
  })
}

const KINDS: Readonly<Record<string, 'approval' | 'question'>> = { 'approval/request': 'approval', 'user-questions/request': 'question' }

export class InteractionHub {
  private readonly targets = new Set<InteractionTarget>()
  private readonly pending = new Map<string, { abort: AbortController, settledElsewhere: boolean }>()
  private reconnecting = false
  /** One stream for both kinds: DSH delivers every waterfall to every stream, and each delivery needs exactly one reply. */
  private readonly stream: InteractionStream

  constructor(private readonly ctx: Context, private readonly log: Log) {
    this.stream = new InteractionStream(ctx, frame => this.receive(frame), log)
  }

  /** Whether DSH is delivering approvals and questions to this bridge yet. */
  get available(): { approvals: boolean, questions: boolean } {
    const connected = this.stream.available
    return { approvals: connected && Boolean(this.ctx.get('approval')), questions: connected && Boolean(this.ctx.get('userQuestions')) }
  }

  /** Sessions currently following, across every connection. */
  get size(): number { return this.targets.size }

  /**
   * A session a client opens may have requests DSH sent while nobody here
   * could answer them; this bridge passed those on, and they now wait in DSH
   * Desktop. A new stream receives every waiting request again, so the client
   * that just opened the session is asked too.
   */
  add(target: InteractionTarget): void {
    this.targets.add(target)
    if (this.reconnecting || !this.stream.waiting(target.dshId, Object.keys(KINDS))) return
    this.reconnecting = true
    queueMicrotask(() => {
      this.reconnecting = false
      this.stream.reconnect()
    })
  }

  remove(target: InteractionTarget): void { this.targets.delete(target) }

  private async receive(frame: Record<string, unknown>): Promise<void> {
    const eventId = frame.eventId
    if (typeof eventId !== 'string') return
    if (frame.type === 'cancel') {
      const entry = this.pending.get(eventId)
      if (entry) { entry.settledElsewhere = true; entry.abort.abort() }
      return
    }
    if (frame.type !== 'waterfall') return
    // A reconnect delivers a pending request again under the same id; the
    // decision in progress replies to it on the current connection.
    if (this.pending.has(eventId)) return
    const kind = typeof frame.event === 'string' ? KINDS[frame.event] : undefined
    const targets = kind ? [...this.targets].filter(target => target.dshId === frame.agentId) : []
    if (!kind || !targets.length) { await this.reply(eventId, { kind: 'next' }); return }
    const entry = { abort: new AbortController(), settledElsewhere: false }
    this.pending.set(eventId, entry)
    // Never block the stream: its next frame may be this request's cancellation.
    void this.decide(kind, eventId, record(frame.request), targets, entry)
      .catch(error => this.log.warn('acp-bridge: interaction failed', error))
      .finally(() => this.pending.delete(eventId))
  }

  private async decide(kind: 'approval' | 'question', eventId: string,
    request: Record<string, unknown>, targets: readonly InteractionTarget[], entry: { abort: AbortController, settledElsewhere: boolean }): Promise<void> {
    let outcome: InteractionOutcome
    if (kind === 'approval') {
      const approval: ApprovalRequest = {
        eventId, toolName: typeof request.toolName === 'string' ? request.toolName : '工具',
        ...(typeof request.reason === 'string' ? { reason: request.reason } : {}),
        ...(typeof request.callId === 'string' ? { callId: request.callId } : {}),
      }
      const decision = await first(targets.map(target => target.approve(approval, entry.abort.signal)))
      outcome = decision === undefined ? { kind: 'next' } : { kind: 'result', value: decision }
    } else {
      const decision = await first(targets.map(target => target.answer({ eventId, questions: request.questions }, entry.abort.signal)))
      outcome = decision === undefined ? { kind: 'next' } : decision.kind === 'answered' ? { kind: 'result', value: decision.value } : DECLINED
    }
    if (entry.settledElsewhere) return
    // Withdraw the request from the other ACP clients that were asked too.
    entry.abort.abort()
    await this.reply(eventId, outcome)
  }

  private async reply(eventId: string, outcome: InteractionOutcome): Promise<void> {
    try { await this.stream.reply(eventId, outcome) }
    catch (error) { this.log.debug('acp-bridge: interaction reply not accepted', error) }
  }

  async close(): Promise<void> {
    for (const entry of this.pending.values()) entry.abort.abort()
    await this.stream.close()
  }
}
