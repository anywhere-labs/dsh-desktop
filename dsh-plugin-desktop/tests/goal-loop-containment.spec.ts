import { describe, expect, it } from 'vitest'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import {
  canonicalCallArguments,
  GoalRoundLedger,
  renderContainmentPrompt,
  resolveSettings,
  type StallVerdict,
} from '../src/goal-loop-containment.ts'

const goalView = (over: Partial<GoalView> = {}): GoalView => ({
  id: 'goal-1' as GoalView['id'],
  revision: 1,
  objective: '把 beta 包的评审面板接上 worktree',
  phase: 'active',
  maxGoalRounds: 256,
  roundsStarted: 4,
  createdAt: 0,
  updatedAt: 0,
  activation: 'armed',
  ...over,
})

/** Drive one round through the ledger and return its verdict. */
function runRound(
  ledger: GoalRoundLedger,
  round: number,
  turn: number,
  calls: { name: string, args: string, error?: boolean }[],
): StallVerdict | undefined {
  ledger.openRound(round, turn, 0)
  for (const call of calls) {
    ledger.recordCall(call.name, call.args)
    ledger.recordResult(call.error === true)
  }
  return ledger.closeRound(turn, calls.length * 1000)
}

describe('call signature canonicalization', () => {
  it('treats key order as identical and keeps non-JSON arguments verbatim', () => {
    expect(canonicalCallArguments('{"b":2,"a":1}')).toBe(canonicalCallArguments('{"a":1,"b":2}'))
    expect(canonicalCallArguments('{"a":1}')).not.toBe(canonicalCallArguments('{"a":2}'))
    expect(canonicalCallArguments('  not json  ')).toBe('not json')
  })
})

describe('goal round ledger', () => {
  it('stays silent while a round produces successful work', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 2, repeatLimit: 5 })
    expect(runRound(ledger, 1, 1, [{ name: 'edit', args: '{"path":"a"}' }])).toBeUndefined()
    expect(runRound(ledger, 2, 2, [{ name: 'read', args: '{"path":"b"}' }])).toBeUndefined()
  })

  it('contains only after the configured number of empty rounds', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 2, repeatLimit: 5 })
    expect(runRound(ledger, 1, 1, [])).toBeUndefined()
    const verdict = runRound(ledger, 2, 2, [])
    expect(verdict?.kind).toBe('no-tool-call')
    expect(verdict?.round).toBe(2)
    expect(verdict?.elapsedMs).toBe(0)
  })

  it('resets the empty-round streak once work succeeds again', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 2, repeatLimit: 5 })
    expect(runRound(ledger, 1, 1, [])).toBeUndefined()
    expect(runRound(ledger, 2, 2, [{ name: 'bash', args: '{"command":"ls"}' }])).toBeUndefined()
    expect(runRound(ledger, 3, 3, [])).toBeUndefined()
    expect(runRound(ledger, 4, 4, [])?.kind).toBe('no-tool-call')
  })

  it('judges a round whose every call failed as no progress', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 2, repeatLimit: 5 })
    expect(runRound(ledger, 1, 1, [{ name: 'bash', args: '{"command":"adb logcat"}', error: true }])).toBeUndefined()
    const verdict = runRound(ledger, 2, 2, [{ name: 'bash', args: '{"command":"adb shell"}', error: true }])
    expect(verdict?.kind).toBe('all-calls-failed')
    expect(verdict?.failures).toBe(1)
    expect(verdict?.successes).toBe(0)
  })

  it('contains an identical repeat immediately, even inside a productive round', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 2, repeatLimit: 3 })
    const repeated = { name: 'grep', args: '{"pattern":"actionCard"}' }
    expect(runRound(ledger, 1, 1, [repeated, repeated, { name: 'read', args: '{"path":"a"}' }])).toBeUndefined()
    const verdict = runRound(ledger, 2, 2, [{ ...repeated, args: '{"pattern":"actionCard"}' }])
    expect(verdict?.kind).toBe('exact-repeat')
    expect(verdict?.signatureCount).toBe(3)
    expect(verdict?.signature).toBe('grep({"pattern":"actionCard"})')
  })

  it('contains two identical failures even when tool results settle out of call order', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 3, repeatLimit: 5, repeatFailureLimit: 2 })
    ledger.openRound(1, 1, 0)
    ledger.recordCall('bash', '{"command":"broken"}', 'first')
    ledger.recordCall('read', '{"path":"a"}', 'second')
    ledger.recordResult(false, 'second')
    ledger.recordResult(true, 'first', 'COMMAND_FAILED:ENOENT')
    expect(ledger.closeRound(1, 1000)).toBeUndefined()
    ledger.openRound(2, 2, 2000)
    ledger.recordCall('bash', '{"command":"broken"}', 'third')
    ledger.recordResult(true, 'third', 'COMMAND_FAILED:ENOENT')
    expect(ledger.closeRound(2, 3000)?.kind).toBe('same-failure')
  })

  it('does not confuse distinct errors or a success with repeated failure', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 4, repeatLimit: 8, repeatFailureLimit: 2 })
    const failed = { name: 'bash', args: '{"command":"broken"}', error: true }
    expect(runRound(ledger, 1, 1, [failed])).toBeUndefined()
    ledger.openRound(2, 2, 1000)
    ledger.recordCall(failed.name, failed.args, 'second')
    ledger.recordResult(true, 'second', 'DIFFERENT_ERROR')
    expect(ledger.closeRound(2, 2000)).toBeUndefined()
    expect(runRound(ledger, 3, 3, [{ name: 'read', args: '{"path":"new"}' }])).toBeUndefined()
    expect(runRound(ledger, 4, 4, [failed])).toBeUndefined()
  })

  it('clears both repeat counts and streaks after a containment', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 2, repeatLimit: 2 })
    const repeated = { name: 'grep', args: '{"pattern":"same"}' }
    expect(runRound(ledger, 1, 1, [repeated, repeated])?.kind).toBe('exact-repeat')
    ledger.reset()
    expect(runRound(ledger, 2, 2, [])).toBeUndefined()
    expect(runRound(ledger, 3, 3, [repeated, repeated])?.kind).toBe('exact-repeat')
  })

  it('ignores calls and results that arrive outside an open round', () => {
    const ledger = new GoalRoundLedger({ stallRounds: 1, repeatLimit: 2 })
    ledger.recordCall('grep', '{"pattern":"x"}')
    ledger.recordResult(false)
    expect(ledger.closeRound(9, 1000)).toBeUndefined()
  })
})

describe('containment prompt', () => {
  const verdict: StallVerdict = {
    kind: 'all-calls-failed',
    round: 7,
    calls: 2,
    successes: 0,
    failures: 2,
    elapsedMs: 20_400,
    signature: 'bash({"command":"adb devices -l"})'.padEnd(400, 'x'),
    signatureCount: 4,
  }

  it('asks for the stall analysis in the product wording and carries the measured evidence', () => {
    const text = renderContainmentPrompt(verdict, goalView(), 2, 160)
    expect(text).toContain('分析一下为什么耗时这么久，卡在哪里了，以后不要犯了。')
    expect(text).toContain('<goal_loop_containment>')
    expect(text).toContain('第 7 轮实测：工具调用 2 次，成功 0 次，失败 2 次，耗时 20 秒')
    expect(text).toContain('本轮的工具调用全部失败，没有拿到新证据')
    expect(text).toContain('已进行 4/256 轮，这是第 2 次介入')
    expect(text).toContain('把 beta 包的评审面板接上 worktree')
    expect(text).toContain('本诊断轮不要调用工具或修改文件')
    expect(text).toContain('插件会恢复已核验的目标自动续轮')
    expect(text).toContain(verdict.signature.slice(0, 160))
    expect(text).not.toContain(verdict.signature)
  })

  it('names the measured reason for each stall kind', () => {
    expect(renderContainmentPrompt(
      { ...verdict, kind: 'no-tool-call', signature: '', signatureCount: 0 },
      goalView(),
      1,
      160,
    )).toContain('本轮没有调用任何工具，也没有把目标标记为完成')
    expect(renderContainmentPrompt({ ...verdict, kind: 'exact-repeat' }, goalView(), 1, 160)).toContain(
      '同一个调用用完全相同的参数重复了太多次',
    )
    expect(renderContainmentPrompt(
      { ...verdict, signature: '', signatureCount: 0 },
      goalView(),
      1,
      160,
    )).toContain('被重复最多的调用：（无）')
  })
})

describe('settings', () => {
  it('defaults to an enabled, human-parking containment', () => {
    expect(resolveSettings()).toEqual({
      enabled: true,
      stallRounds: 2,
      repeatLimit: 5,
      repeatFailureLimit: 2,
      maxInterventions: 3,
      argumentsPreviewChars: 160,
    })
    expect(resolveSettings({ enabled: false, stallRounds: 4 }).enabled).toBe(false)
    expect(resolveSettings({ stallRounds: 4 }).stallRounds).toBe(4)
  })
})
