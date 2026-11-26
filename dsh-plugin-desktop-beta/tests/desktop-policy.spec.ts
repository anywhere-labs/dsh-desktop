/**
 * Policy smoke coverage for the retained single-agent foundation plugins.
 *
 * These tests mount the real Cordis context and exercise the public event
 * contracts rather than asserting implementation details. They protect the
 * deliberately conservative profile: context memory is fetched lazily (never
 * injected at every turn), files stay opt-in, and loop-guard owns the hard
 * break plus reset path.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import {
  apply as applyContext,
  Config as ContextConfig,
  name as contextName,
  type Config as ContextSettings,
} from '../src/context.ts'
import {
  apply as applyLoopGuard,
  Config as LoopGuardConfig,
  name as loopGuardName,
  type Config as LoopGuardSettings,
} from '../src/loop-guard.ts'

const session = { id: 'policy-session' } as Session

function contextSettings(config: Partial<ContextSettings>): ContextSettings {
  return ContextConfig({ ...config } as ContextSettings)
}

function loopSettings(config: Partial<LoopGuardSettings>): LoopGuardSettings {
  return LoopGuardConfig({ ...config } as LoopGuardSettings)
}

function contextDomain(records: ReadonlyMap<string, unknown> = new Map()): unknown {
  const table = {
    get: (key: string) => records.get(key),
    entries: () => records.entries(),
    put: vi.fn(),
    size: records.size,
  }
  return {
    open: vi.fn(async () => ({
      table: () => table,
      close: vi.fn(async () => {}),
    })),
  }
}

describe('retained single-agent plugins', () => {
  it('keeps public plugin names stable and memory retrieval explicit', async () => {
    expect(contextName).toBe('desktop-context')
    expect(loopGuardName).toBe('desktop-loop-guard')
    expect(contextSettings({ recall: false }).recall).toBe(false)
    expect(loopSettings({ repeatHardThreshold: 3 }).repeatHardThreshold).toBe(3)
  })

  it('mounts context without registering index_file or injecting recall by default', async () => {
    const ctx = new Context()
    const storageDomain = contextDomain()
    ctx.provide('storageDomain', storageDomain)
    const fiber = ctx.plugin({
      name: contextName,
      inject: ['storageDomain'],
      apply: (child: Context) => applyContext(child, contextSettings({})),
    })
    await fiber
    const tools = { register: vi.fn() }
    ctx.provide('tools', tools)
    expect(tools.register).not.toHaveBeenCalled()
    expect((storageDomain as { open: ReturnType<typeof vi.fn> }).open).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('does not mount context at all when storageDomain is absent', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({
      name: contextName,
      inject: ['storageDomain'],
      apply: (child: Context) => applyContext(child, contextSettings({})),
    })
    await fiber
    expect(ctx.get('desktopMemory')).toBeUndefined()
    await fiber.dispose()
  })

  it('blocks the hard repeat and steers a reset without a model call', async () => {
    const ctx = new Context()
    const steer = vi.fn()
    const agent = {
      session,
      options: { provider: '', model: '' },
      steer,
    } as unknown as Agent
    const fiber = ctx.plugin({
      name: loopGuardName,
      apply: (child: Context) => applyLoopGuard(child, loopSettings({
        repeatSoftThresholds: [2],
        repeatHardThreshold: 3,
        maxStepsPerTurn: 48,
        maxTurnWallMs: 60_000,
        reflectionProvider: '',
        reflectionModel: '',
        reflectionMaxTokens: 128,
        askOnAmbiguity: false,
      })),
    })
    await fiber

    const execute = (name: string, args: unknown) => (ctx.waterfall as (
      event: string,
      ...inputs: unknown[]
    ) => Promise<unknown>)(
      'tools/post-execute',
      { agent, name, arguments: args },
      { kind: 'allow' },
      async () => ({ kind: 'allow' }),
    )
    expect(await execute('read', { path: 'a' })).toEqual({ kind: 'allow' })
    expect((await execute('read', { path: 'a' }) as { kind: string }).kind).toBe('allow')
    expect(await execute('read', { path: 'a' })).toMatchObject({ kind: 'block' })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    const reset = steer.mock.calls[0]?.[0] as {
      source: { kind: string }
      content: Array<{ text: string }>
    } | undefined
    expect(reset).toBeDefined()
    if (reset === undefined) throw new Error('loop reset was not steered')
    expect(reset.source.kind).toBe('desktop-loop-guard')
    expect(reset.content[0]?.text).toContain('previous approach was interrupted')
    await fiber.dispose()
  })

  it('rejects a turn over the step budget and resets it', async () => {
    const ctx = new Context()
    const steer = vi.fn()
    const agent = { session, options: { provider: '', model: '' }, steer } as unknown as Agent
    const fiber = ctx.plugin({
      name: loopGuardName,
      apply: (child: Context) => applyLoopGuard(child, loopSettings({
        maxStepsPerTurn: 4,
        askOnAmbiguity: false,
      })),
    })
    await fiber
    const decision = await (ctx.waterfall as (
      event: string,
      ...inputs: unknown[]
    ) => Promise<unknown>)(
      'agent/pre-step',
      { agent, turn: 1, step: 4, messages: [], signal: new AbortController().signal },
      async () => ({ kind: 'allow' }),
    )
    expect(decision).toEqual({ kind: 'reject' })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    await fiber.dispose()
  })
})
