/**
 * Offline golden-set runner for the desktop context pipeline.
 *
 * The cases live in `fixtures/context-golden.ts`. This runner executes them
 * with a stub LLM and an in-memory storage domain, so the baseline needs no
 * provider credentials and stays deterministic in CI.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { TurnFolder } from '../src/telemetry-fold.ts'
import {
  GOLDEN_CASES,
  type FileSeed,
  type FilesGoldenCase,
  type FoldGoldenCase,
  type GoldenEvent,
  type LoopGoldenCase,
  type MemorySeed,
  type RecallGoldenCase,
  type TelemetryGoldenCase,
} from './fixtures/context-golden.ts'

interface RecallMessage {
  source: { kind: string }
  content: { type: string; text?: string }[]
}

interface PreStepDecision {
  kind: string
  messages?: RecallMessage[]
}

interface StubLlm {
  calls: GenerateOptions[]
  service: { stream: (options: GenerateOptions) => AsyncGenerator<unknown> }
}

interface StubDomain {
  open: ReturnType<typeof vi.fn>
  maps: Map<string, Map<string, unknown>>
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-context-golden-'))

afterEach(() => {
  vi.restoreAllMocks()
})

function contextSettings(config: Partial<ContextSettings>): ContextSettings {
  return ContextConfig({ ...config } as ContextSettings)
}

function loopSettings(config: Partial<LoopGuardSettings>): LoopGuardSettings {
  return LoopGuardConfig({ ...config } as LoopGuardSettings)
}

function event(type: string, time: number, data: unknown): SessionEvent {
  return { type, time, data } as unknown as SessionEvent
}

function telemetryEvent(source: GoldenEvent): SessionEvent {
  return event(source.type, source.time, source.data)
}

function stubLlm(output: { text: string; fail?: boolean }): StubLlm {
  const calls: GenerateOptions[] = []
  async function* generate(): AsyncGenerator<unknown> {
    if (output.fail === true) throw new Error('stub provider failure')
    if (output.text.length > 0) yield { type: 'text-delta', index: 0, text: output.text }
  }
  return {
    calls,
    service: {
      stream: (options: GenerateOptions) => {
        calls.push(options)
        return generate()
      },
    },
  }
}

function promptText(options: GenerateOptions | undefined): string {
  const content = options?.messages?.[0]?.content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function stubDomain(memories: MemorySeed[], files: FileSeed[]): StubDomain {
  const maps = new Map<string, Map<string, unknown>>([
    ['memories', new Map(memories.map(({ sessionId, ...rest }) => [sessionId, { level: 'session', ...rest }]))],
    ['files', new Map(files.map(record => [record.key, { ...record }]))],
  ])
  const open = vi.fn(async () => ({
    table: (name: string) => {
      const map = maps.get(name) ?? new Map<string, unknown>()
      return {
        get: (key: string) => map.get(key),
        entries: () => map.entries(),
        put: async (key: string, value: unknown) => { map.set(key, value) },
        get size() { return map.size },
      }
    },
    close: async () => {},
  }))
  return { open, maps }
}

async function mountContext(
  config: Partial<ContextSettings>,
  seed: { memories?: MemorySeed[]; files?: FileSeed[]; llm?: StubLlm },
): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>>; domain: StubDomain; tools: { register: ReturnType<typeof vi.fn> } }> {
  const ctx = new Context()
  const domain = stubDomain(seed.memories ?? [], seed.files ?? [])
  const tools = { register: vi.fn(() => () => {}) }
  ctx.provide('storageDomain', domain)
  ctx.provide('tools', tools)
  if (seed.llm !== undefined) ctx.provide('llm', seed.llm.service)
  const fiber = ctx.plugin({
    name: contextName,
    inject: ['storageDomain'],
    apply: (child: Context) => applyContext(child, contextSettings(config)),
  })
  await fiber
  return { ctx, fiber, domain, tools }
}

function preStep(ctx: Context, sessionId: string, step: number): Promise<PreStepDecision> {
  const waterfall = ctx.waterfall as unknown as (
    name: string,
    ...inputs: unknown[]
  ) => Promise<PreStepDecision>
  return waterfall(
    'agent/pre-step',
    { agent: { session: { id: sessionId } }, turn: 1, step, messages: [], signal: new AbortController().signal },
    async () => ({ kind: 'allow', messages: [] }),
  )
}

function recallText(decision: PreStepDecision, kind: string): string[] {
  return (decision.messages ?? [])
    .filter(message => message.source.kind === kind)
    .map(message => message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join(''))
}

function memoryOf(domain: StubDomain, sessionId: string): { content: string; foldedSummaries: number; createdAt?: number } | undefined {
  return domain.maps.get('memories')?.get(sessionId) as { content: string; foldedSummaries: number; createdAt?: number } | undefined
}

function setMemory(domain: StubDomain, record: MemorySeed): void {
  const { sessionId, ...rest } = record
  domain.maps.get('memories')?.set(sessionId, { level: 'session', ...rest })
}

function replaceFiles(domain: StubDomain, records: FileSeed[]): void {
  const files = domain.maps.get('files')
  if (files === undefined) return
  files.clear()
  for (const record of records) files.set(record.key, { ...record })
}

const telemetryCases = GOLDEN_CASES.filter((entry): entry is TelemetryGoldenCase => entry.category === 'telemetry')
const foldCases = GOLDEN_CASES.filter((entry): entry is FoldGoldenCase => entry.category === 'fold')
const recallCases = GOLDEN_CASES.filter((entry): entry is RecallGoldenCase => entry.category === 'recall')
const filesCases = GOLDEN_CASES.filter((entry): entry is FilesGoldenCase => entry.category === 'files')
const loopCases = GOLDEN_CASES.filter((entry): entry is LoopGoldenCase => entry.category === 'loop')

describe('context golden set', () => {
  it('contains 20-30 deterministic cases across the pipeline', () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(20)
    expect(GOLDEN_CASES.length).toBeLessThanOrEqual(30)
    expect(new Set(GOLDEN_CASES.map(entry => entry.id)).size).toBe(GOLDEN_CASES.length)
  })

  describe('telemetry fold', () => {
    it.each(telemetryCases)('$id: $description', (entry) => {
      const folder = new TurnFolder()
      const finished = entry.events
        .map(source => folder.feed('golden-session', telemetryEvent(source)))
        .filter(turn => turn !== undefined)
      expect(finished).toHaveLength(1)
      expect(finished[0]).toMatchObject(entry.expect)
    })
  })

  describe('session summary fold', () => {
    it.each(foldCases)('$id: $description', async (entry) => {
      const llm = stubLlm(entry.llm)
      const { ctx, fiber, domain } = await mountContext(entry.config ?? {}, { llm })
      const session = { id: 'fold-session' } as unknown as Parameters<Context['emit']>[1]
      const base = {
        compactionId: 'compaction-1',
        shadowedRange: { start: 1, end: 2 },
        shadowedSeqs: [1, 2],
        shadowedTokenCount: 100,
        provider: 'deepseek',
        model: 'deepseek-chat',
      }
      const rounds = entry.rounds ?? 1
      const callsPerRound = entry.expect.llmCalls / rounds
      const createdAts: number[] = []
      for (let round = 0; round < rounds; round++) {
        for (const summary of entry.summaries) {
          ctx.emit('session/event', session, event('compaction/summary', 100, {
            ...base,
            summary: [{ type: 'text', text: summary }],
          }))
        }
        await vi.waitFor(() => expect(llm.calls).toHaveLength((round + 1) * callsPerRound))
        await new Promise(resolve => setTimeout(resolve, 5))
        const record = memoryOf(domain, 'fold-session')
        if (record !== undefined) createdAts.push(record.createdAt ?? 0)
      }
      await vi.waitFor(() => expect(llm.calls).toHaveLength(entry.expect.llmCalls))
      await new Promise(resolve => setTimeout(resolve, 5))
      if (entry.expect.memory === null) {
        expect(memoryOf(domain, 'fold-session')).toBeUndefined()
      } else {
        expect(memoryOf(domain, 'fold-session')).toMatchObject(entry.expect.memory)
      }
      if (entry.expect.createdAtStable === true) {
        expect(createdAts).toHaveLength(rounds)
        expect(new Set(createdAts).size).toBe(1)
      }
      if (entry.expect.promptContains !== undefined) {
        expect(promptText(llm.calls[0])).toContain(entry.expect.promptContains)
      }
      await fiber.dispose()
    })
  })

  describe('durable memory recall', () => {
    it.each(recallCases)('$id: $description', async (entry) => {
      const { ctx, fiber, domain } = await mountContext(
        { recall: entry.recall ?? true, ...entry.config },
        { memories: entry.memories },
      )
      const injected: string[] = []
      for (const step of entry.steps) {
        if (step.updateMemory !== undefined) setMemory(domain, step.updateMemory)
        const decision = await preStep(ctx, step.sessionId, step.step)
        injected.push(...recallText(decision, 'desktop-memory'))
      }
      expect(injected).toHaveLength(entry.expect.count)
      if (entry.expect.contains !== undefined) {
        expect(injected.join('\n')).toContain(entry.expect.contains)
      }
      await fiber.dispose()
    })
  })

  describe('indexed-file recall', () => {
    it.each(filesCases)('$id: $description', async (entry) => {
      const { ctx, fiber, domain, tools } = await mountContext(
        { fileRecall: entry.fileRecall ?? false, fileIndex: entry.fileIndex ?? false },
        { files: entry.files },
      )
      if (entry.index !== undefined) {
        const path = join(scratch, `${entry.id}.ts`)
        writeFileSync(path, entry.index.body, 'utf8')
        const definition = tools.register.mock.calls[0]?.[0] as { execute: (args: { path: string; note: string }) => Promise<{ truncated: boolean }> }
        expect(definition).toBeDefined()
        const result = await definition!.execute({ path, note: entry.index.note })
        expect(result.truncated).toBe(entry.index.expectTruncated)
        expect(memoryOf(domain, entry.expect.sessionId)).toBeUndefined()
        const record = [...domain.maps.get('files')?.values() ?? []][0] as { path: string; note: string; content: string }
        expect(record).toMatchObject({ path, note: entry.index.note, content: entry.index.body })
        await fiber.dispose()
        return
      }

      const injected: string[] = []
      for (const step of entry.steps) {
        if (step.updateFiles !== undefined) replaceFiles(domain, step.updateFiles)
        const decision = await preStep(ctx, step.sessionId, step.step)
        injected.push(...recallText(decision, 'desktop-files'))
      }
      expect(injected).toHaveLength(entry.expect.count)
      if (entry.expect.contains !== undefined) {
        expect(injected.join('\n')).toContain(entry.expect.contains)
      }
      if (entry.fileIndex === true) expect(tools.register).toHaveBeenCalledOnce()
      else expect(tools.register).not.toHaveBeenCalled()
      await fiber.dispose()
    })
  })

  describe('loop-guard budgets', () => {
    it.each(loopCases)('$id: $description', async (entry) => {
      let now = 0
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
      const ctx = new Context()
      const steer = vi.fn()
      const agent = {
        session: { id: 'loop-session' },
        options: { provider: 'deepseek', model: 'deepseek-chat' },
        steer,
      } as unknown as Agent
      const fiber = ctx.plugin({
        name: loopGuardName,
        apply: (child: Context) => applyLoopGuard(child, loopSettings(entry.config ?? {})),
      })
      await fiber
      const waterfall = ctx.waterfall as unknown as (
        name: string,
        ...inputs: unknown[]
      ) => Promise<PreStepDecision>
      const decisions: string[] = []
      for (const step of entry.preSteps) {
        if (step.advanceMs !== undefined) now += step.advanceMs
        const decision = await waterfall(
          'agent/pre-step',
          { agent, turn: 1, step: step.step, messages: [], signal: new AbortController().signal },
          async () => ({ kind: 'allow', messages: [] }),
        )
        decisions.push(decision.kind)
      }
      expect(decisions).toEqual(entry.expect)
      if (entry.expect.includes('reject')) {
        await vi.waitFor(() => expect(steer).toHaveBeenCalled())
      }
      await fiber.dispose()
      clock.mockRestore()
    })
  })
})
