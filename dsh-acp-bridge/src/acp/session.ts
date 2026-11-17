/**
 * One ACP session on one connection: a DSH session followed through the
 * Session Controller, its events projected to ACP updates, and at most one
 * prompt in flight. DSH stays the owner: Desktop, Web and other ACP clients can
 * use the same session at the same time.
 */

import { RequestError, type ContentBlock as AcpContent, type PromptResponse, type SessionConfigOption, type SessionUpdate, type ToolCallContent, type Usage } from '@agentclientprotocol/sdk'
import type {
  ModelCatalog, ModelSelection, PromptContentPart, SessionAssistantStreamFrame, SessionFollowFrame, SessionPromptRequest,
  SessionUpdateQueueRequest, SessionWireEvent,
} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import {
  addUsage, expandStreamRecords, PromptError, promptParts, questionChoices, questionForm, record, slashCommand, stopReason, textContent,
  toolCallUpdate, toolResultUpdate, parseArguments, type ChoiceQuestion, type Fields, type QuestionAnswer, type QuestionForm,
} from './convert.js'
import { HostError, hostMessage, type DshHost } from './host.js'
import type { ApprovalDecision, ApprovalRequest, InteractionHub, InteractionTarget, QuestionDecision, QuestionRequest } from './interactions.js'
import type { Log } from './log.js'
import { carriedEffort, catalogEntry, configOptions, DEFAULT_EFFORT, findModel, OPTION, planValue, type ConfigState } from './options.js'

/** The ACP side a session talks to: the connection, or a test double. */
export interface AcpClient {
  /** The client renders form elicitations (`elicitation.form`). */
  readonly elicitation: boolean
  /** The client renders boolean configuration options. */
  readonly booleanOptions: boolean
  update(sessionId: string, update: SessionUpdate): Promise<void>
  requestPermission(params: Fields, signal: AbortSignal): Promise<Fields>
  elicit(params: Fields, signal: AbortSignal): Promise<Fields>
  /** The client stopped reading: updates pile up in the DSH process. */
  overloaded(): void
}

type Mode = 'replay' | 'fold' | 'live'
type Result = { response: PromptResponse } | { error: RequestError }

interface Inflight {
  requestId: string
  /** DSH accepted the message into the session's queue. */
  admitted: boolean
  /** A turn took the message from the queue, or `user/message` carried this request id. */
  claimed: boolean
  turn: number | undefined
  cancelRequested: boolean
  usage: Usage | undefined
  /** How the prompt ends once its message leaves the queue without a turn: cancelled unless set otherwise. */
  withdrawn: Result | undefined
  /** Aborted by `session/cancel` and `session/close`: stops a command that is still running. */
  abort: AbortController
  settle(result: Result): void
}

const CANCELLED: Result = { response: { stopReason: 'cancelled' } }

/** A mirror of DSH's queued input, kept current from `agent/inbox/spliced`. */
type Inbox = Record<'next-turn' | 'next-step', Fields[]>

function inboxOf(value: unknown): Inbox | undefined {
  const inbox = record(value)
  const turn = inbox['next-turn'], step = inbox['next-step']
  if (!Array.isArray(turn) || !Array.isArray(step)) return undefined
  return { 'next-turn': turn.map(record), 'next-step': step.map(record) }
}

interface Attempt { id: string, key: string, sent: boolean, blocks: Map<number, 'text' | 'thought' | 'other'> }

/** A tool call from the follow stream; `shown` once this client was sent its card, under `title`. */
interface Call { name: string, args: unknown, title: string, shown: boolean }

/** Messages a `session/load` replays; older history is summarized in one line. */
export const LOAD_MESSAGES = 1000
/** Token deltas are batched this long, so the client gets ~25 updates per second at most. */
const DELTA_MS = 40
const CONFIG_EVENTS = /^(?:model\/selection|permission\/preset|agent-preset\/selected|plan\/)/u
const MAX_CALLS = 256
/** How long an approval waits for the card of its tool call before it describes the call itself. */
const CARD_WAIT_MS = 2_000
/** Updates waiting for a client that does not read; beyond this the connection is closed. */
const MAX_BACKLOG = 20_000
/** A queued message DSH will not take any more: the turn ahead of it stopped, and DSH waits for new input. */
const STALLED = '上一轮没有正常结束，DSH 不会接着处理排队的消息，这条消息没有发送，请重新发送。'

function invalid(message: string): RequestError { return RequestError.invalidParams(undefined, message) }
function internal(message: string): RequestError { return RequestError.internalError(undefined, message) }
function closedError(): RequestError { return invalid('这个会话已关闭。') }

/** Compaction rewrites history with `replace` surface operations; those are not conversation. */
function replaced(event: SessionWireEvent): boolean {
  return record(event.surfaceOp).op === 'replace'
}

export async function samePath(a: string, b: string): Promise<boolean> {
  if (a === b) return true
  try { return await realpath(a) === await realpath(b) } catch { return false }
}

export interface PendingOptions { cwd: string, model?: ModelSelection, permission?: string, preset?: string }

export class AcpSession implements InteractionTarget {
  dshId: string
  private state: 'pending' | 'attached' | 'closed'
  private readonly pending: { model: ModelSelection | undefined, modelChosen: boolean, permission: string | undefined, preset: string | undefined }
  private materializing: Promise<void> | undefined
  private created = false
  private follow: AbortController | undefined
  private output: Promise<void> = Promise.resolve()
  private backlog = 0
  private overloadReported = false
  /** This client's prompts in the order they were sent: one may run, the others wait in the DSH queue. */
  private readonly inflights: Inflight[] = []
  /** Admissions in send order, so DSH queues the messages in the order the client sent them. */
  private admissions: Promise<unknown> = Promise.resolve()
  private stallTimer: ReturnType<typeof setTimeout> | undefined
  private inbox: Inbox | undefined
  private turn: number | undefined
  private attempt: Attempt | undefined
  private readonly streamed = new Map<string, { text: boolean, thought: boolean }>()
  private delta: { kind: 'agent_message_chunk' | 'agent_thought_chunk', text: string } | undefined
  private deltaTimer: ReturnType<typeof setTimeout> | undefined
  private readonly calls = new Map<string, Call>()
  /** Approvals waiting for the card of their tool call, by call ID. */
  private readonly cardWaiters = new Map<string, Set<() => void>>()
  private lastConfig = ''
  private lastCommands = ''
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private questionNoticeSent = false
  /** Withdraws this session's open permission requests and forms when it closes. */
  private readonly interactions = new AbortController()

  private constructor(readonly id: string, private readonly cwd: string, private readonly host: DshHost, private readonly hub: InteractionHub,
    private readonly client: AcpClient, private readonly log: Log, private readonly existing: boolean, pending?: PendingOptions) {
    this.dshId = id
    this.state = 'pending'
    this.pending = { model: pending?.model, modelChosen: false, permission: pending?.permission, preset: pending?.preset }
  }

  /** A new conversation: DSH creates the session with the first prompt, so idle threads cost nothing. */
  static create(host: DshHost, hub: InteractionHub, client: AcpClient, log: Log, options: PendingOptions): AcpSession {
    return new AcpSession(randomUUID(), options.cwd, host, hub, client, log, false, options)
  }

  /** An existing DSH session; `open` starts following it. The caller can close it while it opens. */
  static existing(host: DshHost, hub: InteractionHub, client: AcpClient, log: Log, id: string, cwd: string): AcpSession {
    return new AcpSession(id, cwd, host, hub, client, log, true)
  }

  /** Follow the session from now on; `replay` sends its history first. */
  async open(replay: boolean): Promise<void> {
    if (this.host.workspaces.archivedSessionIds.includes(this.id as SessionId)) throw invalid('这个会话已在 DSH 中归档。')
    await this.attach(replay ? 'replay' : 'fold', this.cwd)
  }

  get closed(): boolean { return this.state === 'closed' }

  // ── follow ──────────────────────────────────────────────────────────────

  /**
   * Start following. `session/close` or a closed connection can arrive at any
   * await here; the session then stays closed and nothing keeps following it.
   * Returns the configuration options of the attached session.
   */
  private async attach(mode: 'replay' | 'fold', expectedCwd?: string): Promise<SessionConfigOption[]> {
    if (this.closed) throw closedError()
    const abort = new AbortController()
    this.follow = abort
    const fail = (error: RequestError): never => {
      if (this.follow === abort) this.follow = undefined
      abort.abort()
      throw error
    }
    const frames = this.host.controller.follow({
      address: { kind: 'session', sessionId: this.dshId as SessionId },
      activate: true, assistantStream: true, maxMessages: mode === 'replay' ? LOAD_MESSAGES : 1,
    }, abort.signal)
    const iterator = frames[Symbol.asyncIterator]()
    const first = await iterator.next().catch((error: unknown) => {
      if (this.closed) return fail(closedError())
      const code = record(error).code
      if (code === 'session/not-found' || code === 'gateway/not-found') return fail(invalid('DSH 中没有这个会话。'))
      return fail(internal(`DSH 无法打开这个会话：${hostMessage(error)}`))
    })
    if (this.closed) fail(closedError())
    const snapshot = first.value
    if (first.done || snapshot?.type !== 'snapshot') return fail(internal('DSH 没有返回会话内容。'))
    if (snapshot.header.origin === 'subagent') fail(invalid('子 Agent 的会话不能单独打开。'))
    if (expectedCwd && snapshot.header.cwd && !await samePath(snapshot.header.cwd, expectedCwd)) {
      fail(invalid(`这个会话属于工作目录 ${snapshot.header.cwd}，与请求的目录不同。`))
    }
    if (this.closed) fail(closedError())
    const previous = this.state
    this.state = 'attached'
    this.hub.add(this)
    let options: SessionConfigOption[] = []
    try {
      // Queue state as of the snapshot; later splices arrive as live events.
      this.inbox = inboxOf(record(snapshot.projections.values).inbox)
      if (mode === 'replay' && snapshot.hasMore) {
        this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `（只显示最近 ${LOAD_MESSAGES} 条消息，更早的历史请在 DSH 中查看。）\n\n` } })
      }
      for (const entry of snapshot.records) this.handle(entry, mode)
      const title = snapshot.projections.values.title
      if (typeof title === 'string' && title) this.send({ sessionUpdate: 'session_info_update', title })
      const active = snapshot.assistantStream?.activeAttempt
      // History stops at the last committed event; the step in progress continues it. A
      // stream this bridge cannot read is skipped, and its committed message is sent in full.
      const chunks = mode === 'replay' && active ? expandStreamRecords(active.stream) : undefined
      if (active && chunks) {
        const attempt: Attempt = { id: active.attemptId, key: `${active.turn}:${active.step}`, sent: false, blocks: new Map() }
        this.attempt = attempt
        for (const chunk of chunks) this.chunk(attempt, chunk)
        this.flushDelta()
      }
      options = await this.configOptions().catch(() => [])
      this.lastConfig = JSON.stringify(options)
      if (this.closed) throw closedError()
    } catch (error) {
      if (!this.closed) { this.hub.remove(this); this.state = previous }
      fail(error instanceof RequestError ? error : internal(`DSH 无法打开这个会话：${hostMessage(error)}`))
    }
    this.refreshCommands()
    void this.run(iterator, abort)
    if (mode === 'replay') await this.drain()
    return options
  }

  private async run(iterator: AsyncIterator<SessionFollowFrame>, abort: AbortController): Promise<void> {
    try {
      for (;;) {
        const next = await iterator.next()
        if (next.done) break
        try { this.handle(next.value, 'live') }
        catch (error) { this.log.warn('acp-bridge: session update failed', error) }
      }
    } catch (error) {
      if (!abort.signal.aborted) this.log.warn('acp-bridge: DSH stopped following a session', error)
    }
    if (!abort.signal.aborted) this.lost()
  }

  /** DSH ended the follow stream, for example because the session was archived. */
  private lost(): void {
    if (this.state === 'closed') return
    this.flushDelta()
    this.state = 'closed'
    this.hub.remove(this)
    this.interactions.abort()
    if (this.stallTimer) clearTimeout(this.stallTimer)
    for (const inflight of this.inflights.splice(0)) {
      inflight.abort.abort()
      inflight.settle({ error: internal('DSH 已停止这个会话。') })
    }
  }

  private handle(frame: SessionFollowFrame, mode: Mode): void {
    if (frame.type === 'assistant-stream') {
      if (mode === 'live') this.stream(frame.frame)
      return
    }
    if (frame.type !== 'event') return
    const event = frame.event
    const data = record(event.data)
    if (mode === 'live') this.flushDelta()
    switch (event.type) {
      case 'turn/start':
        if (typeof data.turn === 'number') this.turn = data.turn
        break
      case 'user/message':
        this.userMessage(event, data, mode)
        break
      case 'agent/inbox/spliced':
        if (mode === 'live') this.spliced(data)
        break
      case 'assistant/message':
        if (mode !== 'fold' && !replaced(event)) this.assistantMessage(data, mode)
        break
      case 'tool/call':
        this.toolCall(data, mode)
        break
      case 'tool/result':
        this.toolResult(data, mode)
        break
      case 'session/title':
        if (mode === 'live' && typeof data.title === 'string' && data.title) {
          this.send({ sessionUpdate: 'session_info_update', title: data.title, updatedAt: new Date(event.time).toISOString() })
        }
        break
      case 'turn/end':
        if (mode === 'live') this.turnEnded(data)
        break
    }
    if (mode === 'live' && CONFIG_EVENTS.test(event.type)) this.scheduleRefresh()
  }

  /** This client's prompt whose message `message` is, by its request id. */
  private mine(message: Fields): Inflight | undefined {
    const rpcId = record(message.source).rpcId
    return this.inflights.find(inflight => message.id === inflight.requestId || rpcId === inflight.requestId)
  }

  private userMessage(event: SessionWireEvent, data: Fields, mode: Mode): void {
    const source = record(data.source)
    const inflight = mode === 'live' ? this.mine(data) : undefined
    if (inflight) {
      if (!inflight.claimed) {
        inflight.claimed = true
        inflight.turn = this.turn
      }
      return
    }
    // Messages typed in DSH Desktop, AA or another ACP client; the client shows its own already.
    if (mode === 'fold' || source.kind !== 'user' || replaced(event)) return
    const blocks = Array.isArray(data.content) ? data.content : []
    this.enqueue(() => this.chunks('user_message_chunk', blocks))
  }

  /**
   * Keep the queue mirror current and follow this client's messages through it.
   * DSH takes one queued message when a turn starts and writes `user/message`
   * only after the model resolves, so a turn can fail or be cancelled without
   * ever writing it; the removal is the reliable signal.
   */
  private spliced(data: Fields): void {
    const target = data.target === 'next-step' ? 'next-step' : 'next-turn'
    const inserted = Array.isArray(data.inserted) ? data.inserted.map(record) : []
    const start = typeof data.start === 'number' ? data.start : 0
    const count = typeof data.removedCount === 'number' ? data.removedCount : 0
    const removed = this.inbox ? this.inbox[target].splice(start, count, ...inserted) : []
    for (const message of removed) {
      const inflight = this.mine(message)
      if (!inflight || inflight.claimed) continue
      if (data.outcome === 'canceled') {
        // Removed from the queue before any turn took it: here, in DSH Desktop or by another client.
        this.finish(inflight, inflight.withdrawn ?? CANCELLED)
      } else {
        inflight.claimed = true
        inflight.turn = this.turn
      }
    }
  }

  private async chunks(kind: 'user_message_chunk' | 'agent_message_chunk', blocks: readonly unknown[]): Promise<SessionUpdate[]> {
    const updates: SessionUpdate[] = []
    let text = ''
    const flush = () => { if (text) { updates.push({ sessionUpdate: kind, content: { type: 'text', text } }); text = '' } }
    for (const raw of blocks) {
      const block = record(raw)
      if (block.type === 'text' && typeof block.text === 'string') text += block.text
      else if (block.type === 'image') { flush(); updates.push({ sessionUpdate: kind, content: await this.host.image(this.dshId, block) }) }
      else if (block.type === 'file') text += `[文件 ${String(record(block.attachment).name ?? '')}]`
    }
    flush()
    return updates
  }

  private assistantMessage(data: Fields, mode: 'replay' | 'live'): void {
    const key = `${String(data.turn)}:${String(data.step)}`
    const streamed = mode === 'live' ? this.streamed.get(key) : undefined
    this.streamed.delete(key)
    const blocks = Array.isArray(record(data.message).content) ? record(data.message).content as unknown[] : []
    if (mode === 'live') {
      for (const inflight of this.inflights) {
        if (inflight.claimed && (inflight.turn === undefined || inflight.turn === data.turn)) inflight.usage = addUsage(inflight.usage, data.usage)
      }
    }
    this.enqueue(async () => {
      const updates: SessionUpdate[] = []
      for (const raw of blocks) {
        const block = record(raw)
        if (block.type === 'reasoning' && typeof block.text === 'string' && block.text && !streamed?.thought) {
          updates.push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: block.text } })
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text && !streamed?.text) {
          updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: block.text } })
        } else if (block.type === 'image') {
          updates.push({ sessionUpdate: 'agent_message_chunk', content: await this.host.image(this.dshId, block) })
        }
      }
      if (mode === 'live') {
        const usage = this.host.usage(this.dshId, data.usage)
        if (usage) updates.push({ sessionUpdate: 'usage_update', ...usage })
      }
      return updates
    })
  }

  private remember(callId: string, call: Call): void {
    this.calls.set(callId, call)
    while (this.calls.size > MAX_CALLS) this.calls.delete(this.calls.keys().next().value!)
  }

  private toolCall(data: Fields, mode: Mode): void {
    if (typeof data.callId !== 'string') return
    const callId = data.callId
    const name = typeof data.name === 'string' ? data.name : 'tool'
    const args = parseArguments(data.arguments)
    if (mode === 'fold') {
      this.remember(callId, { name, args, title: name, shown: false })
    } else {
      const card = toolCallUpdate(callId, name, args, this.host.presentCall(this.host.live(this.dshId), name, args))
      this.remember(callId, { name, args, title: card.sessionUpdate === 'tool_call' ? card.title : name, shown: true })
      this.send(card)
    }
    const waiters = this.cardWaiters.get(callId)
    this.cardWaiters.delete(callId)
    for (const wake of waiters ?? []) wake()
  }

  private toolResult(data: Fields, mode: Mode): void {
    const message = record(data.message)
    const callId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined
    if (!callId) return
    const call = this.calls.get(callId)
    this.calls.delete(callId)
    // A replayed result whose call fell outside the history window has no card to close.
    if (mode === 'fold' || (mode === 'replay' && !call)) return
    const failed = message.isError === true || data.error !== undefined
    const content = Array.isArray(message.content) ? message.content : []
    const view = call && !failed
      ? this.host.presentResult(this.host.live(this.dshId), call.name, call.args, { content, isError: false, ...(data.meta !== undefined ? { meta: data.meta } : {}) })
      : undefined
    this.enqueue(async () => {
      const images: ToolCallContent[] = []
      for (const block of content) if (record(block).type === 'image') images.push({ type: 'content', content: await this.host.image(this.dshId, block) })
      const update = toolResultUpdate(callId, failed, content, view, images)
      // Attached after the call started: open the card with the result rather than update one this client never got.
      return [call?.shown ? update : { ...update, sessionUpdate: 'tool_call' as const, title: call?.title ?? '工具调用' } as SessionUpdate]
    })
  }

  private turnEnded(data: Fields): void {
    this.questionNoticeSent = false
    this.refreshCommands()
    for (const inflight of [...this.inflights]) {
      if (!inflight.claimed || (inflight.turn !== undefined && inflight.turn !== data.turn)) continue
      const result = stopReason(data.reason, inflight.cancelRequested)
      this.finish(inflight, 'error' in result
        ? { error: internal(result.error) }
        : { response: { stopReason: result.stopReason, ...(inflight.usage ? { usage: inflight.usage } : {}) } })
    }
    // A turn that completes moves DSH on to the next queued message. Any other ending
    // (cancelled, failed, blocked) leaves the queue waiting for new input.
    const kind = record(data.reason).kind
    if (kind !== 'completed' && kind !== 'max-tokens') this.scheduleStallCheck(kind === 'aborted' ? CANCELLED : { error: internal(STALLED) })
  }

  private scheduleStallCheck(result: Result): void {
    // An admission can still be settling here; the check runs once it has.
    if (this.stallTimer || !this.inflights.some(inflight => !inflight.claimed)) return
    // After the macrotask the Agent has settled: idle, or running again because new input woke it.
    this.stallTimer = setTimeout(() => {
      this.stallTimer = undefined
      void this.withdrawStalled(result).catch(error => this.log.debug('acp-bridge: stalled messages not withdrawn', error))
    }, 0)
  }

  /** Messages DSH would keep queued until some client sends again: an ACP prompt cannot wait that long. */
  private async withdrawStalled(result: Result): Promise<void> {
    if (this.state !== 'attached' || this.host.live(this.dshId)?.status === 'running') return
    const waiting = this.inflights.filter(inflight => inflight.admitted && !inflight.claimed)
    await Promise.allSettled(waiting.map(inflight => this.withdraw(inflight, result)))
  }

  // ── token stream ────────────────────────────────────────────────────────

  private stream(frame: SessionAssistantStreamFrame): void {
    if (frame.type === 'start') {
      this.flushDelta()
      this.attempt = { id: frame.attemptId, key: `${frame.turn}:${frame.step}`, sent: false, blocks: new Map() }
      return
    }
    const attempt = this.attempt
    if (!attempt || attempt.id !== frame.attemptId) return
    if (frame.type === 'chunk') { this.chunk(attempt, record(frame.chunk)); return }
    this.flushDelta()
    this.attempt = undefined
    if (frame.outcome.kind === 'committed' && frame.outcome.eventType === 'assistant/message') return
    if (attempt.sent) {
      // What was streamed cannot be taken back; the committed message will follow in full.
      this.streamed.delete(attempt.key)
      this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\n\n（这一步的输出没有完成。）\n\n' } })
    }
  }

  private chunk(attempt: Attempt, chunk: Fields): void {
    const index = typeof chunk.index === 'number' ? chunk.index : -1
    if (chunk.type === 'block-start') {
      attempt.blocks.set(index, chunk.blockType === 'reasoning' ? 'thought' : chunk.blockType === 'text' ? 'text' : 'other')
      return
    }
    if ((chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') || typeof chunk.text !== 'string' || !chunk.text) return
    if (attempt.blocks.get(index) === 'other') return
    const kind = chunk.type === 'reasoning-delta' || attempt.blocks.get(index) === 'thought' ? 'thought' : 'text'
    attempt.sent = true
    const flags = this.streamed.get(attempt.key) ?? { text: false, thought: false }
    flags[kind] = true
    this.streamed.set(attempt.key, flags)
    this.appendDelta(kind === 'text' ? 'agent_message_chunk' : 'agent_thought_chunk', chunk.text)
  }

  private appendDelta(kind: 'agent_message_chunk' | 'agent_thought_chunk', text: string): void {
    if (this.delta && this.delta.kind !== kind) this.flushDelta()
    this.delta ??= { kind, text: '' }
    this.delta.text += text
    this.deltaTimer ??= setTimeout(() => { this.deltaTimer = undefined; this.flushDelta() }, DELTA_MS)
  }

  private flushDelta(): void {
    if (this.deltaTimer) { clearTimeout(this.deltaTimer); this.deltaTimer = undefined }
    const delta = this.delta
    this.delta = undefined
    if (delta?.text) this.send({ sessionUpdate: delta.kind, content: { type: 'text', text: delta.text } })
  }

  // ── ordered output ──────────────────────────────────────────────────────

  private send(update: SessionUpdate): void { this.enqueue(() => [update]) }

  /** Updates leave in the order their DSH events arrived, even when building one needs I/O. */
  private enqueue(build: () => SessionUpdate[] | Promise<SessionUpdate[]>): Promise<void> {
    if (++this.backlog > MAX_BACKLOG && !this.overloadReported) {
      this.overloadReported = true
      this.log.warn('acp-bridge: an ACP client stopped reading updates; closing its connection')
      this.client.overloaded()
    }
    const next = this.output.then(async () => {
      if (this.closed) return
      for (const update of await build()) {
        if (this.closed) return
        await this.client.update(this.id, update)
      }
    })
    this.output = next.catch(error => this.log.debug('acp-bridge: session update not delivered', error))
      .finally(() => { this.backlog-- })
    return this.output
  }

  /** Wait until everything queued so far has been sent. */
  private async drain(): Promise<void> {
    this.flushDelta()
    await this.output
  }

  private finish(inflight: Inflight, result: Result): void {
    const index = this.inflights.indexOf(inflight)
    if (index < 0) return
    this.inflights.splice(index, 1)
    // The response follows the turn's last update and leaves before any later one: ACP updates
    // name no prompt, so a client files each under the prompt it has no answer for yet. The
    // SDK writes the response within the microtasks after `settle`; the macrotask waits for that.
    this.output = this.output.then(() => {
      inflight.settle(result)
      return new Promise<void>(resolve => setImmediate(resolve))
    })
  }

  // ── prompts ─────────────────────────────────────────────────────────────

  private parts(blocks: readonly AcpContent[]): PromptContentPart[] {
    try { return promptParts(blocks) } catch (error) {
      if (error instanceof PromptError) throw invalid(error.message)
      throw error
    }
  }

  private release(inflight: Inflight): void {
    const index = this.inflights.indexOf(inflight)
    if (index >= 0) this.inflights.splice(index, 1)
  }

  /**
   * The prompt is registered before anything else, so `session/cancel` and
   * `session/close` reach it while DSH still creates the session or a command
   * runs; a cancelled prompt is never sent. A prompt sent while another one
   * runs goes to the DSH queue, as Enter does in DSH Desktop during a reply,
   * and returns when the turn that takes it ends.
   */
  async prompt(blocks: readonly AcpContent[], signal: AbortSignal): Promise<PromptResponse> {
    if (this.closed) throw closedError()
    const command = slashCommand(blocks)
    // Refuse bad input before DSH creates anything.
    let parts = command ? undefined : this.parts(blocks)
    let settle!: (result: Result) => void
    const settled = new Promise<Result>(resolve => { settle = resolve })
    const inflight: Inflight = { requestId: randomUUID(), admitted: false, claimed: false, turn: undefined,
      cancelRequested: false, usage: undefined, withdrawn: undefined, abort: new AbortController(), settle }
    this.inflights.push(inflight)
    const onAbort = () => { void this.cancelPrompt(inflight).catch(error => this.log.warn('acp-bridge: cancel failed', error)) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    const stopped = (): PromptResponse => { this.release(inflight); return { stopReason: 'cancelled' } }
    try {
      try { await this.materialize() } catch (error) {
        if (this.closed || inflight.cancelRequested) return stopped()
        throw error
      }
      if (this.closed || inflight.cancelRequested) return stopped()
      if (command) {
        const reply = await this.command(command, inflight.abort.signal)
        if (reply) {
          this.release(inflight)
          return inflight.cancelRequested ? { stopReason: 'cancelled' } : reply
        }
        parts = this.parts(blocks)
        if (this.closed || inflight.cancelRequested) return stopped()
      }
      if (!await this.admit(inflight, parts!)) return stopped()
      if (inflight.cancelRequested) void this.stopTurn(inflight).catch(error => this.log.warn('acp-bridge: cancel failed', error))
      const result = await settled
      if ('error' in result) throw result.error
      return result.response
    } catch (error) {
      this.release(inflight)
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Hand the message to DSH after the ones sent before it, so the DSH queue
   * keeps the client's order. Admission is not tied to the ACP request:
   * cancelling goes through `cancel`. False when the prompt was cancelled first.
   */
  private admit(inflight: Inflight, parts: PromptContentPart[]): Promise<boolean> {
    const admitted = this.admissions.then(async () => {
      if (this.closed || inflight.cancelRequested) return false
      try {
        await this.host.controller.prompt({ requestId: inflight.requestId as SessionPromptRequest['requestId'],
          sessionId: this.dshId as SessionId, mode: 'queue', content: parts }, new AbortController().signal)
      } catch (error) {
        const message = hostMessage(error)
        throw record(error).code === 'gateway/bad-request' ? invalid(message) : internal(`DSH 没有接收这条消息：${message}`)
      }
      inflight.admitted = true
      return true
    })
    this.admissions = admitted.catch(() => undefined)
    return admitted
  }

  /** A registered DSH command runs directly; anything else (skills included) is a normal prompt. */
  private async command(command: { name: string, line: string }, signal: AbortSignal): Promise<PromptResponse | undefined> {
    const registry = this.host.ctx.get('commands')
    if (!registry) return undefined
    const agent = await this.host.agent(this.dshId)
    if (signal.aborted) return { stopReason: 'cancelled' }
    if (!registry.find(agent, command.name)) return undefined
    let text: string
    try {
      const execution = await registry.execute(agent, command.line, [], signal)
      if (signal.aborted) return { stopReason: 'cancelled' }
      if (!execution) return undefined
      const result = execution.result
      text = result.kind === 'error' ? `⚠️ ${result.text}` : result.text ?? `/${command.name} 已执行。`
    } catch (error) {
      if (signal.aborted) return { stopReason: 'cancelled' }
      text = `⚠️ /${command.name} 执行失败：${hostMessage(error)}`
    }
    this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
    await this.drain()
    this.scheduleRefresh()
    this.refreshCommands()
    return { stopReason: 'end_turn' }
  }

  /**
   * `session/cancel`: stop every prompt this client sent in the session, whichever
   * stage each is in. The running turn is cancelled as DSH's Stop does, keeping
   * other clients' queued messages; this client's queued messages are withdrawn.
   */
  async cancel(): Promise<void> {
    const targets = this.inflights.filter(inflight => !inflight.cancelRequested)
    for (const inflight of targets) this.markCancelled(inflight)
    await Promise.allSettled(targets.filter(inflight => inflight.admitted).map(inflight => this.stopTurn(inflight)))
  }

  /**
   * One prompt's own request was cancelled. A queued message leaves the queue
   * alone; cancelling a running turn also ends the prompts queued behind it, which
   * DSH would not take up after the cancelled turn.
   */
  private async cancelPrompt(inflight: Inflight): Promise<void> {
    if (inflight.cancelRequested || !this.inflights.includes(inflight)) return
    this.markCancelled(inflight)
    if (inflight.admitted) await this.stopTurn(inflight)
  }

  private markCancelled(inflight: Inflight): void {
    inflight.cancelRequested = true
    inflight.withdrawn ??= CANCELLED
    inflight.abort.abort()
  }

  /**
   * Remove the prompt's message from the DSH queue while no turn has taken it;
   * the prompt then ends with `result`. Returns whether the message was removed.
   */
  private async withdraw(inflight: Inflight, result: Result): Promise<boolean> {
    if (inflight.claimed || !this.inflights.includes(inflight)) return false
    const sessionId = this.dshId as SessionId
    try {
      const state = await this.host.controller.state({ sessionId }, new AbortController().signal)
      const item = state.queue?.find(entry => entry.rpcId === inflight.requestId || entry.id === inflight.requestId)
      if (!item || inflight.claimed || !this.inflights.includes(inflight)) return false
      // Set first: the removal can reach `spliced` before `updateQueue` returns.
      const previous = inflight.withdrawn
      const outcome = inflight.withdrawn ??= result
      try {
        await this.host.controller.updateQueue({ sessionId, itemId: item.id as SessionUpdateQueueRequest['itemId'], action: { kind: 'remove' } })
      } catch (error) {
        inflight.withdrawn = previous
        throw error
      }
      this.finish(inflight, outcome)
      return true
    } catch (error) {
      this.log.debug('acp-bridge: queued message not removed', error)
      return false
    }
  }

  private async stopTurn(inflight: Inflight): Promise<void> {
    if (!this.inflights.includes(inflight)) return
    if (!inflight.claimed && await this.withdraw(inflight, CANCELLED)) return
    // Not in the queue any more: a turn took it, and that turn is cancelled.
    if (!this.inflights.includes(inflight)) return
    try { this.host.controller.cancel({ sessionId: this.dshId as SessionId }) } catch (error) { this.log.debug('acp-bridge: turn not cancelled', error) }
  }

  // ── creation ────────────────────────────────────────────────────────────

  private async materialize(): Promise<void> {
    if (this.state !== 'pending') return
    if (this.existing) throw invalid('这个会话还在打开，请稍后再发送。')
    const task = this.materializing ??= this.create()
    try { await task } catch (error) {
      if (this.materializing === task) this.materializing = undefined
      throw error instanceof RequestError ? error : internal(`DSH 无法创建会话：${hostMessage(error)}`)
    }
  }

  /**
   * Idempotent: a retry after a later step failed reuses the DSH session it
   * already created. Stops at the first await after `session/close`.
   */
  private async create(): Promise<void> {
    const open = () => { if (this.closed) throw closedError() }
    if (!this.created) {
      const workspace = await this.host.workspaces.create(this.cwd)
      open()
      const created = await this.host.controller.create({ workspaceId: workspace.id, sessionId: this.id as SessionId,
        ...(this.pending.preset ? { agentPreset: this.pending.preset } : {}) })
      this.dshId = created.sessionId
      this.created = true
      open()
    }
    const agent = await this.host.agent(this.dshId)
    open()
    if (this.pending.modelChosen && this.pending.model) {
      await this.host.controller.selectModel({ sessionId: this.dshId as SessionId, ...this.pending.model })
      open()
    }
    const permissions = this.host.ctx.get('permissionPresets')
    if (this.pending.permission && permissions && permissions.current(agent.session) !== this.pending.permission) {
      permissions.set(agent.session, this.pending.permission)
    }
    await this.host.ctx.get('sessions')?.flush(agent.session)
    open()
    // The client holds the options of a session DSH had not created: Agent modes and no plan mode.
    const shown = JSON.stringify(await this.configOptions().catch(() => []))
    open()
    const options = await this.attach('fold')
    if (JSON.stringify(options) !== shown) this.send({ sessionUpdate: 'config_option_update', configOptions: options })
  }

  // ── interactions ────────────────────────────────────────────────────────

  async approve(request: ApprovalRequest, hubSignal: AbortSignal): Promise<ApprovalDecision | undefined> {
    if (this.state !== 'attached') return undefined
    const signal = AbortSignal.any([hubSignal, this.interactions.signal])
    if (request.callId) await this.callSeen(request.callId, signal)
    await this.drain()
    if (signal.aborted || this.state !== 'attached') return undefined
    try {
      const response = await this.client.requestPermission({
        sessionId: this.id,
        toolCall: this.approvalCard(request),
        options: [
          { optionId: 'allow-once', name: '允许一次', kind: 'allow_once' },
          { optionId: 'reject', name: '拒绝', kind: 'reject_once' },
        ],
      }, signal)
      const outcome = record(response.outcome)
      if (outcome.outcome !== 'selected') return undefined
      return outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected'
    } catch (error) {
      if (!signal.aborted) this.log.debug('acp-bridge: permission request failed', error)
      return undefined
    }
  }

  /**
   * DSH delivers an approval on its interaction stream, which can overtake the
   * `tool/call` event on the follow stream. Wait briefly until the call is seen:
   * ACP clients look up the card a permission request points at by its ID.
   */
  private callSeen(callId: string, signal: AbortSignal): Promise<void> {
    if (this.calls.has(callId) || signal.aborted) return Promise.resolve()
    let waiters = this.cardWaiters.get(callId)
    if (!waiters) this.cardWaiters.set(callId, waiters = new Set())
    const own = waiters
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        own.delete(done)
        if (!own.size && this.cardWaiters.get(callId) === own) this.cardWaiters.delete(callId)
        resolve()
      }
      const timer = setTimeout(done, CARD_WAIT_MS)
      own.add(done)
      signal.addEventListener('abort', done, { once: true })
    })
  }

  /**
   * The tool call of a permission request. A card this client has is named by
   * its ID and title (some clients show only the request); otherwise the call
   * is described in full, so the client can open its card from the request.
   */
  private approvalCard(request: ApprovalRequest): Fields {
    const call = request.callId ? this.calls.get(request.callId) : undefined
    if (request.callId && call?.shown) return { toolCallId: request.callId, title: call.title }
    if (request.callId && call) {
      const card: Fields = { ...toolCallUpdate(request.callId, call.name, call.args, this.host.presentCall(this.host.live(this.dshId), call.name, call.args)) }
      delete card.sessionUpdate
      delete card.name
      return { ...card, status: 'pending' }
    }
    return {
      toolCallId: request.callId ?? `approval:${request.eventId}`, title: `请求批准：${request.toolName}`, status: 'pending',
      ...(request.reason ? { content: [textContent(request.reason)] } : {}),
    }
  }

  async answer(request: QuestionRequest, hubSignal: AbortSignal): Promise<QuestionDecision | undefined> {
    if (this.state !== 'attached') return undefined
    const signal = AbortSignal.any([hubSignal, this.interactions.signal])
    const form = this.client.elicitation ? questionForm(request.questions) : undefined
    // Without forms, single-choice questions (plan reviews included) still fit the options of a permission request.
    const choices = form ? undefined : questionChoices(request.questions)
    if (!form && !choices) {
      if (!this.questionNoticeSent) {
        this.questionNoticeSent = true
        this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\n\n（DSH 在等待回答一个问题，这个客户端显示不了这种问题，请在 DSH 中作答。）\n\n' } })
      }
      return undefined
    }
    await this.drain()
    if (signal.aborted || this.state !== 'attached') return undefined
    return form ? this.fill(form, signal) : this.choose(request.eventId, choices!, signal)
  }

  private async fill(form: QuestionForm, signal: AbortSignal): Promise<QuestionDecision | undefined> {
    try {
      const response = await this.client.elicit({ sessionId: this.id, mode: 'form', message: form.message, requestedSchema: form.schema }, signal)
      if (response.action === 'accept') {
        const answer = form.answer(record(response.content))
        return answer ? { kind: 'answered', value: answer } : { kind: 'declined' }
      }
      return response.action === 'decline' || response.action === 'cancel' ? { kind: 'declined' } : undefined
    } catch (error) {
      if (!signal.aborted) this.log.debug('acp-bridge: question form failed', error)
      return undefined
    }
  }

  /**
   * One permission request per question. Each question gets a card of its own,
   * sent before the request that points at it and closed with the choice. A
   * question the client dismisses leaves the whole request to DSH.
   */
  private async choose(eventId: string, questions: readonly ChoiceQuestion[], signal: AbortSignal): Promise<QuestionDecision | undefined> {
    const answers: QuestionAnswer['answers'] = []
    for (const [index, question] of questions.entries()) {
      if (signal.aborted || this.state !== 'attached') return undefined
      const toolCallId = `question:${eventId}:${index}`
      const detail = question.detail ? [textContent(question.detail)] : []
      this.send({ sessionUpdate: 'tool_call', toolCallId, title: question.title, kind: 'other', status: 'pending', ...(detail.length ? { content: detail } : {}) })
      let picked: string | undefined
      try {
        await this.drain()
        if (!signal.aborted && this.state === 'attached') {
          const response = await this.client.requestPermission({
            sessionId: this.id, toolCall: { toolCallId, title: question.title },
            options: question.options.map(({ optionId, name, kind }) => ({ optionId, name, kind })),
          }, signal)
          const outcome = record(response.outcome)
          if (outcome.outcome === 'selected') picked = question.options.find(option => option.optionId === outcome.optionId)?.label
        }
      } catch (error) {
        if (!signal.aborted) this.log.debug('acp-bridge: question choices failed', error)
      }
      const result = picked !== undefined ? `已选择：${picked}` : signal.aborted ? '已在其他地方回答' : '已交给 DSH 回答'
      this.send({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', content: [...detail, textContent(result)] })
      if (picked === undefined) return undefined
      answers.push({ id: question.id, selected: [picked] })
    }
    return { kind: 'answered', value: { answers } }
  }

  // ── configuration ───────────────────────────────────────────────────────

  private async currentModel(catalog: ModelCatalog | undefined): Promise<ModelSelection | undefined> {
    if (this.state === 'pending') return this.pending.model ?? catalog?.default
    const value = await this.projections()
    const next = record(record(value.modelSelection).next)
    if (typeof next.provider === 'string' && typeof next.model === 'string') {
      return { provider: next.provider, model: next.model, ...(typeof next.reasoningEffort === 'string' ? { reasoningEffort: next.reasoningEffort } : {}) }
    }
    return catalog?.default
  }

  private async projections(): Promise<Fields> {
    try {
      const value = await this.host.controller.projections({ sessionId: this.dshId as SessionId }, new AbortController().signal)
      return record(value?.values)
    } catch (error) {
      this.log.debug('acp-bridge: session projections unavailable', error)
      return {}
    }
  }

  private async configState(): Promise<ConfigState> {
    const catalog = await this.host.catalog()
    const model = await this.currentModel(catalog)
    const choices = this.host.permissionChoices()
    if (this.state === 'pending') {
      const permission = this.pending.permission ?? this.host.defaultPermission()
      const preset = this.pending.preset ?? this.host.defaultPreset()
      const presets = preset ? await this.host.presetChoices().catch(() => []) : []
      return { catalog, model,
        ...(permission ? { permission: { choices, current: permission } } : {}),
        ...(preset && presets.length ? { preset: { choices: presets, current: preset } } : {}) }
    }
    const agent = this.host.live(this.dshId)
    const projected = record((await this.projections()).permissions).currentValue
    const permission = typeof projected === 'string' ? projected : this.host.currentPermission(agent)
    const plan = agent ? this.host.planMode(agent) : undefined
    let active: boolean | undefined
    try { active = plan && agent ? plan.get(agent).active : undefined } catch { active = undefined }
    return { catalog, model,
      ...(permission ? { permission: { choices, current: permission } } : {}),
      ...(active !== undefined ? { plan: { active, booleanOptions: this.client.booleanOptions } } : {}) }
  }

  async configOptions(): Promise<SessionConfigOption[]> {
    return configOptions(await this.configState())
  }

  async setConfig(id: string, value: unknown): Promise<SessionConfigOption[]> {
    if (this.state === 'closed') throw invalid('这个会话已关闭。')
    const catalog = await this.host.catalog()
    switch (id) {
      case OPTION.model: {
        const found = typeof value === 'string' ? findModel(catalog, value) : undefined
        if (!found) throw invalid('DSH 的模型列表里没有这个模型。')
        const effort = carriedEffort(found.entry, (await this.currentModel(catalog))?.reasoningEffort)
        await this.selectModel({ provider: found.provider, model: found.entry.id, ...(effort ? { reasoningEffort: effort } : {}) })
        break
      }
      case OPTION.effort: {
        const current = await this.currentModel(catalog)
        const efforts = catalogEntry(catalog, current)?.reasoning?.efforts ?? []
        if (!current || typeof value !== 'string' || (value !== DEFAULT_EFFORT && !efforts.some(effort => effort.id === value))) {
          throw invalid('当前模型不支持这个推理强度。')
        }
        await this.selectModel({ provider: current.provider, model: current.model, ...(value === DEFAULT_EFFORT ? {} : { reasoningEffort: value }) })
        break
      }
      case OPTION.permission: {
        if (typeof value !== 'string' || !this.host.permissionChoices().some(choice => choice.id === value)) throw invalid('DSH 没有这个权限选项。')
        if (this.state === 'pending') this.pending.permission = value
        else await this.applyPermission(value)
        break
      }
      case OPTION.preset: {
        if (this.state !== 'pending') throw invalid('Agent 模式只能在发送第一条消息前选择。')
        if (typeof value !== 'string' || !(await this.host.presetChoices()).some(choice => choice.id === value)) throw invalid('DSH 没有这个 Agent 模式。')
        this.pending.preset = value
        break
      }
      case OPTION.plan: {
        const active = planValue(value)
        if (active === undefined || this.state !== 'attached') throw invalid('计划模式需要在会话开始后切换。')
        const agent = await this.host.agent(this.dshId)
        const plan = this.host.planMode(agent)
        if (!plan) throw invalid('当前 DSH 没有加载计划模式。')
        plan.set(agent, active)
        await this.host.ctx.get('sessions')?.flush(agent.session)
        break
      }
      default:
        throw invalid(`未知的配置项：${id}`)
    }
    const options = await this.configOptions()
    this.lastConfig = JSON.stringify(options)
    return options
  }

  private async selectModel(selection: ModelSelection): Promise<void> {
    if (this.state === 'pending') {
      this.pending.model = selection
      this.pending.modelChosen = true
      return
    }
    try { await this.host.controller.selectModel({ sessionId: this.dshId as SessionId, ...selection }) }
    catch (error) { throw invalid(`DSH 无法切换到这个模型：${hostMessage(error)}`) }
  }

  /** The same `/permission` command DSH's own composer runs, so DSH applies its side effects. */
  private async applyPermission(preset: string): Promise<void> {
    const agent = await this.host.agent(this.dshId)
    if (this.host.currentPermission(agent) === preset) return
    const commands = this.host.ctx.get('commands')
    if (!commands?.find(agent, 'permission')) throw invalid('这个 Agent 不支持切换权限。')
    const execution = await commands.execute(agent, `/permission ${preset}`, [], new AbortController().signal)
    if (execution?.result.kind !== 'success') throw new HostError('DSH 没有应用这个权限，请刷新会话后重试。')
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer || this.state !== 'attached') return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refreshConfig().catch(error => this.log.debug('acp-bridge: config refresh failed', error))
    }, 100)
  }

  /** Changes made in DSH Desktop or another client reach this client too. */
  private async refreshConfig(): Promise<void> {
    if (this.state !== 'attached') return
    const options = await this.configOptions()
    const json = JSON.stringify(options)
    if (json === this.lastConfig || this.state !== 'attached') return
    this.lastConfig = json
    this.send({ sessionUpdate: 'config_option_update', configOptions: options })
  }

  refreshCommands(): void {
    if (this.state !== 'attached') return
    void (async () => {
      const agent = this.host.live(this.dshId) ?? await this.host.agent(this.dshId)
      const list = await this.host.commands(agent, this.cwd)
      const json = JSON.stringify(list)
      if (json === this.lastCommands || this.state !== 'attached') return
      this.lastCommands = json
      this.send({ sessionUpdate: 'available_commands_update', availableCommands: list })
    })().catch(error => this.log.debug('acp-bridge: command catalog refresh failed', error))
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** `session/close` or a closed connection: cancel the prompts this client started and stop following. */
  async close(): Promise<void> {
    if (this.closed) return
    if (this.inflights.length) await this.cancel().catch(error => this.log.debug('acp-bridge: cancel on close failed', error))
    this.flushDelta()
    this.state = 'closed'
    this.hub.remove(this)
    this.interactions.abort()
    this.follow?.abort()
    this.follow = undefined
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (this.stallTimer) clearTimeout(this.stallTimer)
    for (const pending of this.inflights.splice(0)) {
      pending.abort.abort()
      pending.settle(CANCELLED)
    }
  }
}
