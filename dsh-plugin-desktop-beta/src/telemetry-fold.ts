/**
 * Pure per-turn telemetry fold for DSH Desktop.
 *
 * The fold consumes the public {@link SessionEvent} stream and condenses one
 * turn into the measurements a context change must move: token surfaces,
 * cache reuse, model/tool latency, tool reliability, and retry pressure. It
 * deliberately has no Cordis or filesystem dependencies so the exact same
 * reducer can grade recorded sessions offline and run live in the plugin.
 *
 * @module dsh-plugin-desktop-beta/telemetry-fold
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm-retry'

/** One finalized turn, written as a single JSONL record. */
export interface TelemetryTurn {
  /** Session the turn belongs to. */
  sessionId: string
  /** Turn number inside the session. */
  turn: number
  /** Why the turn ended, as reported by the loop. */
  reason: string
  /** Unix epoch milliseconds of the first observed event. */
  startedAt: number
  /** Unix epoch milliseconds of `turn/end`. */
  endedAt: number
  /** Wall-clock length of the turn. */
  durationMs: number
  /** Model steps admitted in the turn. */
  steps: number
  /** Time spent waiting for model responses (step start to assistant message). */
  llmMs: number
  /** Time spent inside tool executions (tool call to tool result). */
  toolMs: number
  /** Provider route used by the latest request in the turn. */
  provider: string
  /** Model route used by the latest request in the turn. */
  model: string
  /** Non-cached prompt tokens reported by the adapter. */
  inputTokens: number
  /** Generated tokens reported by the adapter. */
  outputTokens: number
  /** Prompt tokens served from the provider cache. */
  cacheReadTokens: number
  /** Prompt tokens written into the provider cache. */
  cacheWriteTokens: number
  /** Reasoning tokens reported by the adapter. */
  reasoningTokens: number
  /** Exact full-call total when the adapter reports one; otherwise zero. */
  totalTokens: number
  /** `cacheRead / (input + cacheRead + cacheWrite)`, four decimal places. */
  cacheHitRatio: number
  /** Tool calls requested in the turn. */
  toolCalls: number
  /** Tool results carrying `isError: true`. */
  toolErrors: number
  /** Provider-routed retries scheduled in the turn. */
  retries: number
  /** Whether any assistant message in the turn was interrupted. */
  interrupted: boolean
  /** Tool calls per tool name. */
  toolCallsByName: Record<string, number>
  /** Failed tool results per tool name. */
  toolErrorsByName: Record<string, number>
}

interface TurnAccumulator {
  sessionId: string
  turn: number
  startedAt: number
  reason: string
  steps: number
  llmMs: number
  toolMs: number
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  toolCalls: number
  toolErrors: number
  retries: number
  interrupted: boolean
  stepStarts: Map<number, number>
  toolStarts: Map<string, number>
  toolNames: Map<string, string>
  toolCallsByName: Record<string, number>
  toolErrorsByName: Record<string, number>
}

interface TurnRoute {
  provider: string
  model: string
}

function accumulator(sessionId: string, turn: number, startedAt: number, route: TurnRoute | undefined): TurnAccumulator {
  return {
    sessionId,
    turn,
    startedAt,
    reason: '',
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    provider: route?.provider ?? '',
    model: route?.model ?? '',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    toolCalls: 0,
    toolErrors: 0,
    retries: 0,
    interrupted: false,
    stepStarts: new Map(),
    toolStarts: new Map(),
    toolNames: new Map(),
    toolCallsByName: {},
    toolErrorsByName: {},
  }
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function turnOf(event: SessionEvent): number | undefined {
  switch (event.type) {
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'assistant/message':
    case 'assistant/attempt':
    case 'tool/call':
    case 'tool/result':
    case 'developer/message':
    case 'system/message':
    case 'llm/retry':
    case 'llm/retry-started':
      return event.data.turn
    default:
      return undefined
  }
}

function finalize(turn: TurnAccumulator, endedAt: number): TelemetryTurn {
  const promptTokens = turn.inputTokens + turn.cacheReadTokens + turn.cacheWriteTokens
  return {
    sessionId: turn.sessionId,
    turn: turn.turn,
    reason: turn.reason,
    startedAt: turn.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - turn.startedAt),
    steps: turn.steps,
    llmMs: turn.llmMs,
    toolMs: turn.toolMs,
    provider: turn.provider,
    model: turn.model,
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
    cacheReadTokens: turn.cacheReadTokens,
    cacheWriteTokens: turn.cacheWriteTokens,
    reasoningTokens: turn.reasoningTokens,
    totalTokens: turn.totalTokens,
    cacheHitRatio: promptTokens === 0 ? 0 : Number((turn.cacheReadTokens / promptTokens).toFixed(4)),
    toolCalls: turn.toolCalls,
    toolErrors: turn.toolErrors,
    retries: turn.retries,
    interrupted: turn.interrupted,
    toolCallsByName: { ...turn.toolCallsByName },
    toolErrorsByName: { ...turn.toolErrorsByName },
  }
}

/**
 * Folds session events into per-turn measurements.
 *
 * Feed every event for every session; {@link feed} returns the finalized
 * record exactly once, when `turn/end` arrives. Turns are keyed per session so
 * concurrent sessions never share accumulators.
 */
export class TurnFolder {
  private readonly turns = new Map<string, TurnAccumulator>()
  private readonly routes = new Map<string, TurnRoute>()

  private key(sessionId: string, turn: number): string {
    return `${sessionId}\u0000${turn}`
  }

  private ensure(sessionId: string, turn: number, time: number): TurnAccumulator {
    const key = this.key(sessionId, turn)
    let turnState = this.turns.get(key)
    if (turnState === undefined) {
      turnState = accumulator(sessionId, turn, time, this.routes.get(sessionId))
      this.turns.set(key, turnState)
    }
    return turnState
  }

  /**
   * Apply one committed event.
   * @param sessionId - owning session identity.
   * @param event - committed session event, exactly as logged.
   * @returns the finalized turn on `turn/end`, otherwise `undefined`.
   */
  feed(sessionId: string, event: SessionEvent): TelemetryTurn | undefined {
    if (event.type === 'request/header') {
      const header = event.data.header
      this.routes.set(sessionId, { provider: header.config.provider, model: header.config.model })
      return undefined
    }

    if (event.type === 'turn/start') {
      const route = this.routes.get(sessionId)
      this.turns.set(this.key(sessionId, event.data.turn), accumulator(sessionId, event.data.turn, event.time, route))
      return undefined
    }

    if (event.type === 'turn/end') {
      const key = this.key(sessionId, event.data.turn)
      const turnState = this.turns.get(key) ?? this.ensure(sessionId, event.data.turn, event.time)
      turnState.reason = event.data.reason.kind
      this.turns.delete(key)
      return finalize(turnState, event.time)
    }

    const turn = turnOf(event)
    if (turn === undefined) return undefined
    const state = this.ensure(sessionId, turn, event.time)

    switch (event.type) {
      case 'step/start':
        state.steps += 1
        state.stepStarts.set(event.data.step, event.time)
        break
      case 'assistant/message': {
        const startedAt = state.stepStarts.get(event.data.step)
        if (startedAt !== undefined) {
          state.llmMs += Math.max(0, event.time - startedAt)
          state.stepStarts.delete(event.data.step)
        }
        if (event.data.interrupted === true) state.interrupted = true
        const usage = event.data.usage
        if (usage !== undefined) {
          state.inputTokens += usage.inputTokens
          state.outputTokens += usage.outputTokens
          state.cacheReadTokens += usage.cacheReadTokens ?? 0
          state.cacheWriteTokens += usage.cacheWriteTokens ?? 0
          state.reasoningTokens += usage.reasoningTokens ?? 0
          state.totalTokens += usage.totalTokens ?? 0
        }
        break
      }
      case 'tool/call':
        state.toolCalls += 1
        state.toolStarts.set(String(event.data.callId), event.time)
        state.toolNames.set(String(event.data.callId), event.data.name)
        bump(state.toolCallsByName, event.data.name)
        break
      case 'tool/result': {
        const callId = String(event.data.message.toolCallId)
        const startedAt = state.toolStarts.get(callId)
        if (startedAt !== undefined) {
          state.toolMs += Math.max(0, event.time - startedAt)
          state.toolStarts.delete(callId)
        }
        if (event.data.message.isError === true) {
          state.toolErrors += 1
          bump(state.toolErrorsByName, state.toolNames.get(callId) ?? 'unknown')
        }
        break
      }
      case 'llm/retry':
        state.retries += 1
        break
      default:
        break
    }
    return undefined
  }
}
