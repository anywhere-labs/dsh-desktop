import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolGuard } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/goal-loop-containment.ts'

function fixture() {
  const session = { id: 'session-1' } as Session
  const followups: unknown[] = []
  const agent = { session, status: 'idle', followup: (message: unknown) => { followups.push(message) } } as unknown as Agent
  let goal: GoalView = {
    id: 'goal-1' as GoalView['id'], revision: 1, objective: 'Inspect the current task',
    phase: 'active', activation: 'armed', roundsStarted: 1, maxGoalRounds: 8,
    createdAt: 0, updatedAt: 0,
  }
  let disarms = 0
  let resumes = 0
  let guard: ToolGuard | undefined
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const ctx = {
    agents: { get: (id: string) => id === session.id ? agent : undefined },
    goals: {
      get: () => goal,
      disarm: () => { disarms += 1; goal = { ...goal, activation: 'disarmed' }; return goal },
      resume: () => { resumes += 1; goal = { ...goal, revision: goal.revision + 1, activation: 'armed' }; return goal },
      block: () => { goal = { ...goal, phase: 'blocked', activation: 'disarmed' }; return goal },
    },
    logger: { warn: () => undefined },
    tools: { guard: (fn: ToolGuard) => { guard = fn; return () => { guard = undefined } } },
    on: (name: string, fn: (...args: unknown[]) => void) => { handlers.set(name, fn) },
    effect: (setup: () => Generator<unknown>) => { for (const _ of setup()) { /* register effects */ } },
  } as unknown as Context
  apply(ctx, { stallRounds: 1 })
  function emit(data: { type: string; data: unknown }) {
    const event = data as SessionEvent
    handlers.get('session/event')?.(session, event)
  }
  function start(turn: number, source: Record<string, unknown>) {
    emit({ type: 'turn/start', data: { turn } })
    emit({ type: 'user/message', data: { source } })
  }
  function end(turn: number, kind: string) {
    emit({ type: 'turn/end', data: { turn, reason: { kind } } })
  }
  return { agent, start, end, emit, followups, get guard() { return guard }, get disarms() { return disarms }, get resumes() { return resumes }, get goal() { return goal } }
}

function toolReason(guard: ToolGuard | undefined, agent: Agent): string | undefined {
  if (guard === undefined) throw new Error('tool guard not registered')
  return guard({ agent, name: 'write' } as Parameters<ToolGuard>[0])
}

describe('Desktop goal containment plugin', () => {
  it('disarms a live goal on a new direct human turn, without reviving it on turn end', () => {
    const f = fixture()
    f.start(1, { kind: 'user' })
    expect(f.disarms).toBe(1)
    expect(f.goal.activation).toBe('disarmed')
    f.end(1, 'completed')
    expect(f.resumes).toBe(0)
  })

  it('does not treat a compressed or synthetic non-goal message as an admitted goal round', () => {
    const f = fixture()
    f.start(1, { kind: 'injected', summary: 'historical goal round' })
    f.end(1, 'completed')
    expect(f.followups).toHaveLength(0)
    expect(f.disarms).toBe(0)
  })

  it('rearms only after a normally completed diagnostic for the same goal', () => {
    const f = fixture()
    f.start(1, { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 })
    f.end(1, 'completed')
    f.start(2, { kind: 'desktop-goal-loop-containment' })
    f.end(2, 'completed')
    expect(f.resumes).toBe(1)
    expect(f.goal.activation).toBe('armed')
  })

  it('does not rearm an old goal after a new direct human request', () => {
    const f = fixture()
    f.start(1, { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 })
    f.end(1, 'completed')
    f.start(2, { kind: 'user' })
    f.end(2, 'completed')
    f.start(3, { kind: 'desktop-goal-loop-containment' })
    expect(toolReason(f.guard, f.agent)).toContain('诊断只允许解释已记录证据')
    f.end(3, 'completed')
    expect(f.resumes).toBe(0)
    expect(f.goal.activation).toBe('disarmed')
  })

  it('blocks tool execution during a diagnostic turn and never rearms after cancellation', () => {
    const f = fixture()
    f.start(1, { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 })
    f.end(1, 'completed')
    expect(f.disarms).toBe(1)
    expect(f.followups).toHaveLength(1)
    f.start(2, { kind: 'desktop-goal-loop-containment' })
    expect(toolReason(f.guard, f.agent)).toContain('诊断只允许解释已记录证据')
    // The guard is keyed by live Agent identity, not by a forged object or source text.
    expect(toolReason(f.guard, { session: f.agent.session } as Agent)).toBeUndefined()
    f.end(2, 'aborted')
    expect(toolReason(f.guard, f.agent)).toBeUndefined()
    expect(f.resumes).toBe(0)
  })
})
