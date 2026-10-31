/**
 * Local containment for automatic goal continuation: when a goal round proves it
 * made no progress, stop the blind continuation, ask the model to diagnose the
 * stall, then rearm the goal so it keeps running on its own.
 * @module dsh-plugin-desktop/goal-loop-containment
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'desktop-goal-loop-containment': { kind: 'desktop-goal-loop-containment' } & ContextFormed
  }
}

export const name = 'desktop-goal-loop-containment'
export const inject = ['agents', 'goals', 'tools']

/** Containment thresholds. Every decision is measured locally; no model call decides. */
export interface Config {
  /** Whether this profile installs containment at all. */
  enabled?: boolean
  /** Consecutive goal rounds without a successful tool call before the model is stopped. */
  stallRounds?: number
  /** Count of one identical call inside one goal before the model is stopped. */
  repeatLimit?: number
  /** Consecutive identical failed calls before the goal continuation is contained. */
  repeatFailureLimit?: number
  /** Containments allowed for one goal before it is parked as blocked for a human. */
  maxInterventions?: number
  /** Maximum characters of the repeated call's arguments quoted back to the model. */
  argumentsPreviewChars?: number
}

/** Fully materialized containment thresholds. */
export interface Settings {
  readonly enabled: boolean
  readonly stallRounds: number
  readonly repeatLimit: number
  readonly repeatFailureLimit: number
  readonly maxInterventions: number
  readonly argumentsPreviewChars: number
}

/** Schemastery config for the containment thresholds. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  stallRounds: z.number().step(1).min(1).default(2),
  repeatLimit: z.number().step(1).min(2).default(5),
  repeatFailureLimit: z.number().step(1).min(2).default(2),
  maxInterventions: z.number().step(1).min(1).default(3),
  argumentsPreviewChars: z.number().step(1).min(40).default(160),
})

/** Materialize defaults; malformed input fails at the schema instead of here. */
export function resolveSettings(config: Config = {}): Settings {
  return {
    enabled: config.enabled ?? true,
    stallRounds: config.stallRounds ?? 2,
    repeatLimit: config.repeatLimit ?? 5,
    repeatFailureLimit: config.repeatFailureLimit ?? 2,
    maxInterventions: config.maxInterventions ?? 3,
    argumentsPreviewChars: config.argumentsPreviewChars ?? 160,
  }
}

/** Measured reason why one goal round made no progress. */
export type StallKind = 'no-tool-call' | 'all-calls-failed' | 'exact-repeat' | 'same-failure'

/** The counted facts of the round that tripped a containment rule. */
export interface StallVerdict {
  readonly kind: StallKind
  readonly round: number
  readonly calls: number
  readonly successes: number
  readonly failures: number
  readonly elapsedMs: number
  /** Most-repeated `tool(args)` signature observed for the goal, already previewed. */
  readonly signature: string
  readonly signatureCount: number
}

/** One goal round's running counters. */
interface RoundTally {
  round: number
  turn: number
  startedAt: number
  calls: number
  successes: number
  failures: number
}

/** Stable comparison form for one key-sorted JSON value. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

/**
 * Canonical comparable form of one requested call's raw argument JSON.
 * @param raw - the argument text exactly as the model produced it.
 * @returns a key-sorted re-serialization, or the trimmed raw text when it is not JSON.
 */
export function canonicalCallArguments(raw: string): string {
  try {
    return stableStringify(JSON.parse(raw) as unknown)
  } catch {
    return raw.trim()
  }
}

/** Count one goal's calls and judge each finished round for progress. */
export class GoalRoundLedger {
  private readonly settings: Pick<Settings, 'stallRounds' | 'repeatLimit' | 'repeatFailureLimit'>
  private readonly repeats = new Map<string, number>()
  private readonly pendingCalls = new Map<string, string>()
  private readonly pendingOrder: string[] = []
  private tally: RoundTally | undefined
  private streak = 0
  private failureKey: string | undefined
  private failureCount = 0
  private repeatedFailure = false

  constructor(settings: Pick<Settings, 'stallRounds' | 'repeatLimit'> & Partial<Pick<Settings, 'repeatFailureLimit'>>) {
    this.settings = { ...settings, repeatFailureLimit: settings.repeatFailureLimit ?? 2 }
  }

  /** Begin recording the continuation round the driver just admitted. */
  openRound(round: number, turn: number, startedAt: number): void {
    this.pendingCalls.clear()
    this.pendingOrder.length = 0
    this.repeatedFailure = false
    this.tally = { round, turn, startedAt, calls: 0, successes: 0, failures: 0 }
  }

  /** Record one requested call against both the round and the goal's repeat counts. */
  recordCall(toolName: string, rawArguments: string, callId?: string): void {
    if (this.tally === undefined) return
    this.tally.calls += 1
    const signature = `${toolName}(${canonicalCallArguments(rawArguments)})`
    this.repeats.set(signature, (this.repeats.get(signature) ?? 0) + 1)
    if (callId !== undefined) this.pendingCalls.set(callId, signature)
    else this.pendingOrder.push(signature)
  }

  /** Record one result by call id; an error counts only when the exact call and failure recur. */
  recordResult(isError: boolean, callId?: string, errorIdentity = ''): void {
    if (this.tally === undefined) return
    const signature = callId === undefined ? this.pendingOrder.shift() : this.pendingCalls.get(callId)
    if (callId !== undefined) this.pendingCalls.delete(callId)
    if (isError) {
      this.tally.failures += 1
      if (signature === undefined) return
      const key = `${signature}\u0000${errorIdentity}`
      this.failureCount = this.failureKey === key ? this.failureCount + 1 : 1
      this.failureKey = key
      if (this.failureCount >= this.settings.repeatFailureLimit) this.repeatedFailure = true
    } else {
      this.tally.successes += 1
      this.failureKey = undefined
      this.failureCount = 0
    }
  }

  /** Close the round owned by `turn` and judge it. */
  closeRound(turn: number, endedAt: number): StallVerdict | undefined {
    const tally = this.tally
    if (tally === undefined || tally.turn !== turn) return undefined
    this.tally = undefined
    const signature = this.topSignature()
    const signatureCount = this.repeats.get(signature) ?? 0
    const measured = {
      round: tally.round,
      calls: tally.calls,
      successes: tally.successes,
      failures: tally.failures,
      elapsedMs: Math.max(0, endedAt - tally.startedAt),
      signature,
      signatureCount,
    }
    if (this.repeatedFailure) return { kind: 'same-failure', ...measured }
    if (signatureCount >= this.settings.repeatLimit) return { kind: 'exact-repeat', ...measured }
    if (tally.calls === 0 || tally.successes === 0) {
      this.streak += 1
      if (this.streak < this.settings.stallRounds) return undefined
      return { kind: tally.calls === 0 ? 'no-tool-call' : 'all-calls-failed', ...measured }
    }
    this.streak = 0
    return undefined
  }

  /** Forget the counts after a containment so the same stall cannot re-fire at once. */
  reset(): void {
    this.repeats.clear()
    this.pendingCalls.clear()
    this.pendingOrder.length = 0
    this.streak = 0
    this.tally = undefined
    this.failureKey = undefined
    this.failureCount = 0
    this.repeatedFailure = false
  }

  /** The most-repeated signature, tie-broken by first sighting. */
  private topSignature(): string {
    let best = ''
    let bestCount = 0
    for (const [signature, count] of this.repeats) {
      if (count <= bestCount) continue
      best = signature
      bestCount = count
    }
    return best
  }
}

const STALL_REASON: Record<StallKind, string> = {
  'no-tool-call': '本轮没有调用任何工具，也没有把目标标记为完成',
  'all-calls-failed': '本轮的工具调用全部失败，没有拿到新证据',
  'exact-repeat': '同一个调用用完全相同的参数重复了太多次',
  'same-failure': '相同工具、参数与错误连续出现两次，没有新证据',
}

/**
 * Render the model-visible diagnosis request for one contained round.
 * @param verdict - the measured stall.
 * @param goal - current live goal view.
 * @param intervention - which containment this is for the goal, counting from 1.
 * @param previewChars - cap on the quoted repeated call.
 * @returns the complete prompt block text.
 */
export function renderContainmentPrompt(
  verdict: StallVerdict,
  goal: GoalView,
  intervention: number,
  previewChars: number,
): string {
  const signature = verdict.signature.slice(0, previewChars)
  return '<goal_loop_containment>\n'
    + '本地监控判定这个目标的自动续轮已经陷入重复循环，续轮已暂停，本轮先做诊断。\n'
    + `判定依据：${STALL_REASON[verdict.kind]}\n`
    + `第 ${verdict.round} 轮实测：工具调用 ${verdict.calls} 次，成功 ${verdict.successes} 次，`
    + `失败 ${verdict.failures} 次，耗时 ${Math.round(verdict.elapsedMs / 1000)} 秒\n`
    + `被重复最多的调用：${signature === '' ? '（无）' : signature}（累计 ${verdict.signatureCount} 次）\n`
    + `目标进度：已进行 ${goal.roundsStarted}/${goal.maxGoalRounds} 轮，这是第 ${intervention} 次介入\n`
    + `目标：${goal.objective}\n\n`
    + '分析一下为什么耗时这么久，卡在哪里了，以后不要犯了。\n'
    + '只根据已记录的证据用两三段说明卡点、耗时与一个不同的下一步；本诊断轮不要调用工具或修改文件。'
    + '这是插件通知，不是新的用户授权，不能从历史任务或本通知推导新任务。'
    + '诊断正常结束后插件会恢复已核验的目标自动续轮；若用户插入新请求或发生中断则保持停止。\n'
    + '</goal_loop_containment>'
}

/** Per-agent containment bookkeeping. */
interface Containment {
  goalId: string
  goalRevision: number
  ledger: GoalRoundLedger
  turn: number
  /** A diagnosis request was queued and its turn has not opened yet. */
  analysisPending: boolean
  /** Turn carrying the queued diagnosis request, once it opened. */
  analysisTurn: number | undefined
  /** A newer direct human request supersedes this automatic continuation. */
  suspendedByHuman: boolean
  interventions: number
}

/** Install the containment listeners for one host profile. */
export function apply(ctx: Context, config: Config): void {
  const settings = resolveSettings(config)
  if (!settings.enabled) return

  const states = new Map<Agent, Containment>()
  const currentTurns = new Map<Agent, number>()

  /** Return the ledger for one exact goal identity, restarting it on a new goal. */
  function stateFor(agent: Agent, goalId: string, goalRevision: number): Containment {
    const existing = states.get(agent)
    if (existing !== undefined && existing.goalId === goalId && existing.goalRevision === goalRevision) return existing
    const fresh: Containment = {
      goalId,
      goalRevision,
      ledger: new GoalRoundLedger(settings),
      turn: currentTurns.get(agent) ?? 0,
      analysisPending: false,
      analysisTurn: undefined,
      suspendedByHuman: false,
      interventions: 0,
    }
    states.set(agent, fresh)
    return fresh
  }

  /** Read the live goal without letting a detached agent fail the listener. */
  function currentGoal(agent: Agent): GoalView | undefined {
    try {
      return ctx.goals.get(agent)
    } catch {
      return undefined
    }
  }

  /** Stop the blind continuation and ask the model to diagnose before resuming. */
  function contain(agent: Agent, state: Containment, verdict: StallVerdict): void {
    const goal = currentGoal(agent)
    if (goal === undefined || goal.id !== state.goalId || goal.revision !== state.goalRevision
      || goal.phase !== 'active' || goal.activation !== 'armed' || state.suspendedByHuman) return
    state.interventions += 1
    state.ledger.reset()
    ctx.logger.warn(
      `goal-loop-containment: 目标第 ${verdict.round} 轮判定 ${verdict.kind}；`
      + `本轮工具调用 ${verdict.calls} 次（成功 ${verdict.successes}，失败 ${verdict.failures}），`
      + `耗时 ${Math.round(verdict.elapsedMs / 1000)} 秒；`
      + `最多重复 ${verdict.signature.slice(0, settings.argumentsPreviewChars)} 共 ${verdict.signatureCount} 次；`
      + `第 ${state.interventions} 次介入（上限 ${settings.maxInterventions}）`,
    )
    if (state.interventions > settings.maxInterventions) {
      ctx.goals.block(agent, { id: goal.id, revision: goal.revision }, {
        code: 'desktop-goal-loop-containment',
        message: `目标连续 ${settings.stallRounds} 轮以上没有进展，`
          + `已介入 ${settings.maxInterventions} 次仍未收敛，暂停自动续轮等待人工处理。`,
      })
      return
    }
    ctx.goals.disarm(agent)
    state.analysisPending = true
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: renderContainmentPrompt(verdict, goal, state.interventions, settings.argumentsPreviewChars) }],
      source: {
        kind: 'desktop-goal-loop-containment',
        form: 'notice',
        summary: `目标第 ${verdict.round} 轮无进展，已请求模型分析卡点`,
      },
    }))
  }

  /** Rearm only a still-current goal after a normally completed diagnostic turn. */
  function rearm(agent: Agent, state: Containment): void {
    state.analysisTurn = undefined
    if (state.suspendedByHuman) return
    const goal = currentGoal(agent)
    if (goal === undefined || goal.id !== state.goalId || goal.revision !== state.goalRevision
      || goal.phase !== 'active' || goal.activation !== 'disarmed') return
    try {
      ctx.goals.resume(agent, { id: goal.id, revision: goal.revision })
    } catch (error: unknown) {
      ctx.logger.warn(`goal-loop-containment: could not rearm the goal: ${String(error)}`)
    }
  }

  ctx.effect(function* () {
    yield ctx.tools.guard(exec => {
      const state = exec.agent === undefined ? undefined : states.get(exec.agent)
      return state?.analysisTurn === state?.turn && state?.analysisTurn !== undefined
        ? '自动续轮诊断只允许解释已记录证据，不允许调用工具；请等待目标正常续轮或人工指令。'
        : undefined
    })
    ctx.on('agent/disposed', ({ agent }) => { states.delete(agent); currentTurns.delete(agent) })

    ctx.on('goal/changed', ({ agent, change }) => {
      if (change.goal === undefined) {
        states.delete(agent)
        return
      }
      stateFor(agent, change.goal.id, change.goal.revision)
    })

    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      const agent = ctx.agents.get(session.id)
      if (agent === undefined || agent.session !== session) return
      switch (event.type) {
        case 'turn/start': {
          currentTurns.set(agent, event.data.turn)
          const state = states.get(agent)
          if (state !== undefined) state.turn = event.data.turn
          return
        }
        case 'user/message': {
          const source = event.data.source
          if (source.kind === 'user') {
            const goal = currentGoal(agent)
            if (goal !== undefined && goal.phase === 'active' && goal.activation === 'armed') {
              ctx.goals.disarm(agent)
            }
            const state = states.get(agent)
            if (state !== undefined) {
              state.suspendedByHuman = true
              state.analysisPending = false
              state.analysisTurn = undefined
              state.ledger.reset()
            }
            return
          }
          if (source.kind === 'desktop-goal-loop-containment') {
            const state = states.get(agent)
            if (state !== undefined) {
              // Even a stale diagnostic must remain read-only; suspension prevents rearm.
              state.analysisPending = false
              state.analysisTurn = state.turn
            }
            return
          }
          if (source.kind !== 'goal' || source.round <= 0 || source.revision <= 0) return
          const goal = currentGoal(agent)
          if (goal === undefined || goal.id !== source.goalId || goal.revision !== source.revision
            || goal.phase !== 'active' || goal.activation !== 'armed') return
          const state = stateFor(agent, source.goalId, source.revision)
          state.suspendedByHuman = false
          state.ledger.openRound(source.round, state.turn, Date.now())
          return
        }
        case 'tool/call': {
          states.get(agent)?.ledger.recordCall(event.data.name, event.data.arguments, event.data.callId)
          return
        }
        case 'tool/result': {
          states.get(agent)?.ledger.recordResult(event.data.message.isError === true,
            event.data.message.toolCallId,
            event.data.error === undefined ? '' : `${event.data.error.name}:${event.data.error.code}:${event.data.error.reason ?? ''}`)
          return
        }
        case 'turn/end': {
          const state = states.get(agent)
          if (state === undefined) return
          if (state.analysisTurn === event.data.turn) {
            if (event.data.reason.kind === 'completed') rearm(agent, state)
            else state.analysisTurn = undefined
            return
          }
          if (event.data.reason.kind !== 'completed') {
            state.ledger.reset()
            return
          }
          const verdict = state.ledger.closeRound(event.data.turn, Date.now())
          if (verdict !== undefined) contain(agent, state, verdict)
          return
        }
        default:
          return
      }
    })

    yield async () => { states.clear() }
  }, 'dsh-plugin-desktop: goal loop containment')
}
