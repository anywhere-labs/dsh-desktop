import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { contextBreakdownProjectionDefinition } from '../node_modules/@deepseek-ai/dsh-token-meter/lib/types/breakdown-projection.js'
import { contextPressureProjectionDefinition } from '../node_modules/@deepseek-ai/dsh-token-meter/lib/types/usage-projection.js'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  return ctx
}

function replaceEvent(seq: number, start: number, end: number, text = '.'): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: 0,
    data: createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'test' },
    }),
    surfaceOp: { op: 'replace', start, end },
    sourceEventSeqs: [start, end],
  } as unknown as SessionEvent
}

describe('token-meter negative projection recovery', () => {
  it('invalidates pre-fix negative checkpoint rows via stateVersion mismatch', async () => {
    const ctx = await harness()

    expect(contextBreakdownProjectionDefinition.stateVersion).toBe(3)
    expect(contextPressureProjectionDefinition.stateVersion).toBe(5)

    const restored = ctx.sessionProjections.restore({
      contextBreakdown: {
        ver: 2,
        seq: 38481,
        val: { systemTokens: 5640, toolsTokens: 11075, messageTokens: -4840 },
      },
      contextPressure: {
        ver: 4,
        seq: 38481,
        val: {
          surfaceTokens: -4840,
          contextWindow: 1_000_000,
          pressureTokens: 89_773,
          sampledSurfaceTokens: 36_309,
        },
      },
    }, [], 0)

    expect(restored.snapshot.values.contextBreakdown).toEqual({
      systemTokens: 0,
      toolsTokens: 0,
      messageTokens: 0,
    })
    expect(restored.snapshot.values.contextPressure).toEqual({})
    expect(restored.checkpoint.contextBreakdown).toMatchObject({
      ver: 3,
      seq: -1,
      val: { systemTokens: 0, toolsTokens: 0, messageTokens: 0 },
    })
    expect(restored.checkpoint.contextPressure).toMatchObject({
      ver: 5,
      seq: -1,
      val: { surfaceTokens: 0 },
    })
  })

  it('clamps drifted replacement deltas before they can persist negative state', () => {
    const replacement = replaceEvent(38482, 100, 200)

    const breakdown = contextBreakdownProjectionDefinition.apply({
      systemTokens: 5640,
      toolsTokens: 11075,
      messageTokens: 0,
      claim: { start: 100, end: 200, tokens: 47095 },
    }, replacement)
    expect(breakdown.messageTokens).toBe(0)

    const pressure = contextPressureProjectionDefinition.apply({
      surfaceTokens: 0,
      contextWindow: 1_000_000,
      pressureTokens: 89_773,
      sampledSurfaceTokens: 36_309,
      claim: { start: 100, end: 200, tokens: 47095 },
    }, replacement)
    expect(pressure.surfaceTokens).toBe(0)
  })
})
