/**
 * Telemetry baseline coverage: the pure turn fold and the JSONL sink.
 *
 * These tests pin the measurements a context change must move. They use the
 * real Cordis context and the public `session/event` stream, and they assert
 * the persisted record rather than the sink implementation.
 */

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply as applyTelemetry,
  Config as TelemetryConfig,
  name as telemetryName,
  type Config as TelemetrySettings,
} from '../src/telemetry.ts'
import { TurnFolder } from '../src/telemetry-fold.ts'

let seq = 0

function event(type: string, time: number, data: unknown): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

function settings(config: Partial<TelemetrySettings>): TelemetrySettings {
  return TelemetryConfig({ ...config } as TelemetrySettings)
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-desktop-telemetry-'))

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('TurnFolder', () => {
  it('condenses one turn into token, latency, and reliability measurements', () => {
    const folder = new TurnFolder()
    const sessionId = 'fold-session'
    const events: SessionEvent[] = [
      event('request/header', 900, {
        header: { config: { provider: 'deepseek', model: 'deepseek-chat' } },
        reason: 'turn',
      }),
      event('turn/start', 1000, { turn: 1 }),
      event('step/start', 1010, { turn: 1, step: 1 }),
      event('assistant/message', 1210, {
        turn: 1,
        step: 1,
        message: {},
        stream: [],
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 300,
          cacheWriteTokens: 0,
        },
      }),
      event('tool/call', 1220, { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{}' }),
      event('tool/result', 1270, { turn: 1, step: 1, message: { toolCallId: 'call-1', isError: true } }),
      event('llm/retry', 1290, { turn: 1, step: 1, provider: 'deepseek', retry: 1, maxRetries: 3 }),
      event('step/end', 1300, { turn: 1, step: 1 }),
      event('turn/end', 1400, { turn: 1, reason: { kind: 'completed' } }),
    ]

    const finished = events.map(current => folder.feed(sessionId, current)).filter(turn => turn !== undefined)

    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({
      sessionId,
      turn: 1,
      reason: 'completed',
      provider: 'deepseek',
      model: 'deepseek-chat',
      durationMs: 400,
      steps: 1,
      llmMs: 200,
      toolMs: 50,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 300,
      cacheHitRatio: 0.75,
      toolCalls: 1,
      toolErrors: 1,
      retries: 1,
      interrupted: false,
      toolCallsByName: { read: 1 },
      toolErrorsByName: { read: 1 },
    })
  })

  it('keeps concurrent sessions apart and tolerates a turn without a start', () => {
    const folder = new TurnFolder()
    folder.feed('a', event('turn/start', 10, { turn: 1 }))
    folder.feed('b', event('turn/start', 20, { turn: 1 }))
    folder.feed('a', event('step/start', 30, { turn: 1, step: 1 }))
    const b = folder.feed('b', event('turn/end', 40, { turn: 1, reason: { kind: 'cancelled' } }))
    const a = folder.feed('a', event('turn/end', 50, { turn: 1, reason: { kind: 'completed' } }))

    expect(b).toMatchObject({ sessionId: 'b', steps: 0, reason: 'cancelled' })
    expect(a).toMatchObject({ sessionId: 'a', steps: 1, reason: 'completed' })
  })
})

describe('desktop-telemetry plugin', () => {
  it('appends one JSONL record per finished turn', async () => {
    const file = join(scratch, 'turn.jsonl')
    const ctx = new Context()
    const fiber = ctx.plugin({
      name: telemetryName,
      apply: (child: Context) => applyTelemetry(child, settings({ path: file })),
    })
    await fiber

    const session = { id: 'telemetry-session' } as unknown as Session
    const turn = [
      event('turn/start', 1000, { turn: 1 }),
      event('step/start', 1010, { turn: 1, step: 1 }),
      event('assistant/message', 1110, {
        turn: 1,
        step: 1,
        message: {},
        stream: [],
        usage: { inputTokens: 10, outputTokens: 2 },
      }),
      event('turn/end', 1200, { turn: 1, reason: { kind: 'completed' } }),
    ]
    for (const current of turn) ctx.emit('session/event', session, current)

    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      sessionId: 'telemetry-session',
      turn: 1,
      inputTokens: 10,
      outputTokens: 2,
      cacheHitRatio: 0,
    })
    await fiber.dispose()
  })

  it('does not create a file when disabled', async () => {
    const file = join(scratch, 'disabled.jsonl')
    const ctx = new Context()
    const fiber = ctx.plugin({
      name: telemetryName,
      apply: (child: Context) => applyTelemetry(child, settings({ enabled: false, path: file })),
    })
    await fiber
    ctx.emit('session/event', { id: 'off' } as unknown as Session, event('turn/end', 1, { turn: 1, reason: { kind: 'completed' } }))
    expect(existsSync(file)).toBe(false)
    await fiber.dispose()
  })
})
