/**
 * Offline golden set for the desktop context pipeline.
 *
 * Each case is deterministic: no provider, no credentials, no wall clock except
 * where a case explicitly advances it. The runner interprets these records with
 * a stub LLM and an in-memory storage domain, so the set can gate CI and be
 * compared run to run.
 */

import type { Config as ContextSettings } from '../../src/context.ts'
import type { Config as LoopGuardSettings } from '../../src/loop-guard.ts'
import type { TelemetryTurn } from '../../src/telemetry-fold.ts'

export interface GoldenEvent {
  type: string
  time: number
  data: unknown
}

export interface MemorySeed {
  sessionId: string
  content: string
  foldedSummaries: number
  createdAt: number
  expiresAt?: number
}

export interface FileSeed {
  key: string
  path: string
  note: string
  content: string
  truncated: boolean
  createdAt: number
}

export interface TelemetryGoldenCase {
  id: string
  category: 'telemetry'
  description: string
  events: GoldenEvent[]
  expect: Partial<TelemetryTurn>
}

export interface FoldGoldenCase {
  id: string
  category: 'fold'
  description: string
  config?: Partial<ContextSettings>
  summaries: string[]
  /** Emit the same batch this many times to exercise dedup across folds. */
  rounds?: number
  llm: { text: string; fail?: boolean }
  expect: {
    llmCalls: number
    memory: { content: string; foldedSummaries: number } | null
    /** The second identical fold must not change the recall version key. */
    createdAtStable?: boolean
    /** The fold request must carry this marker (budget truncation, etc.). */
    promptContains?: string
  }
}

export interface RecallGoldenCase {
  id: string
  category: 'recall'
  description: string
  recall?: boolean
  config?: Partial<ContextSettings>
  memories: MemorySeed[]
  steps: {
    sessionId: string
    step: number
    updateMemory?: MemorySeed
  }[]
  expect: { sessionId: string; count: number; contains?: string }
}

export interface FilesGoldenCase {
  id: string
  category: 'files'
  description: string
  fileRecall?: boolean
  fileIndex?: boolean
  files: FileSeed[]
  steps: {
    sessionId: string
    step: number
    updateFiles?: FileSeed[]
  }[]
  expect: { sessionId: string; count: number; contains?: string }
  index?: { note: string; body: string; expectTruncated: boolean }
}

export interface LoopGoldenCase {
  id: string
  category: 'loop'
  description: string
  config?: Partial<LoopGuardSettings>
  preSteps: { step: number; advanceMs?: number }[]
  expect: ('allow' | 'reject')[]
}

export type GoldenCase = TelemetryGoldenCase | FoldGoldenCase | RecallGoldenCase | FilesGoldenCase | LoopGoldenCase

function event(type: string, time: number, data: unknown): GoldenEvent {
  return { type, time, data }
}

const TELEMETRY_CASES: TelemetryGoldenCase[] = [
  {
    id: 'telemetry-basic',
    category: 'telemetry',
    description: 'one turn condenses tokens, cache, latency, tools, and retries',
    events: [
      event('request/header', 900, { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } }, reason: 'turn' }),
      event('turn/start', 1000, { turn: 1 }),
      event('step/start', 1010, { turn: 1, step: 1 }),
      event('assistant/message', 1210, {
        turn: 1,
        step: 1,
        message: {},
        stream: [],
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0 },
      }),
      event('tool/call', 1220, { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{}' }),
      event('tool/result', 1270, { turn: 1, step: 1, message: { toolCallId: 'call-1', isError: true } }),
      event('llm/retry', 1290, { turn: 1, step: 1, provider: 'deepseek', retry: 1, maxRetries: 3 }),
      event('turn/end', 1400, { turn: 1, reason: { kind: 'completed' } }),
    ],
    expect: {
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
    },
  },
  {
    id: 'telemetry-cancelled',
    category: 'telemetry',
    description: 'a cancelled turn keeps the measured prefix and reports the reason',
    events: [
      event('turn/start', 0, { turn: 2 }),
      event('step/start', 10, { turn: 2, step: 1 }),
      event('assistant/message', 60, { turn: 2, step: 1, message: {}, stream: [], usage: { inputTokens: 5, outputTokens: 1 } }),
      event('turn/end', 100, { turn: 2, reason: { kind: 'cancelled' } }),
    ],
    expect: { turn: 2, reason: 'cancelled', steps: 1, inputTokens: 5, outputTokens: 1, cacheHitRatio: 0 },
  },
  {
    id: 'telemetry-zero-prompt',
    category: 'telemetry',
    description: 'no prompt tokens means no cache hit rather than a divide-by-zero',
    events: [
      event('turn/start', 0, { turn: 1 }),
      event('step/start', 1, { turn: 1, step: 1 }),
      event('assistant/message', 2, { turn: 1, step: 1, message: {}, stream: [], usage: { inputTokens: 0, outputTokens: 7 } }),
      event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }),
    ],
    expect: { inputTokens: 0, outputTokens: 7, cacheHitRatio: 0, totalTokens: 0 },
  },
  {
    id: 'telemetry-cache-mix',
    category: 'telemetry',
    description: 'cache read, write, and fresh input stay separate while the ratio uses all prompt tokens',
    events: [
      event('turn/start', 0, { turn: 1 }),
      event('step/start', 1, { turn: 1, step: 1 }),
      event('assistant/message', 2, {
        turn: 1,
        step: 1,
        message: {},
        stream: [],
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 200, cacheWriteTokens: 100 },
      }),
      event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }),
    ],
    expect: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 200, cacheWriteTokens: 100, cacheHitRatio: 0.5 },
  },
  {
    id: 'telemetry-multi-step',
    category: 'telemetry',
    description: 'token usage and model latency accumulate across steps',
    events: [
      event('turn/start', 0, { turn: 1 }),
      event('step/start', 10, { turn: 1, step: 1 }),
      event('assistant/message', 110, { turn: 1, step: 1, message: {}, stream: [], usage: { inputTokens: 10, outputTokens: 2 } }),
      event('step/start', 120, { turn: 1, step: 2 }),
      event('assistant/message', 260, { turn: 1, step: 2, message: {}, stream: [], usage: { inputTokens: 20, outputTokens: 4 } }),
      event('turn/end', 300, { turn: 1, reason: { kind: 'completed' } }),
    ],
    expect: { steps: 2, llmMs: 240, inputTokens: 30, outputTokens: 6 },
  },
  {
    id: 'telemetry-tool-mix',
    category: 'telemetry',
    description: 'tool calls and failures are attributed by name',
    events: [
      event('turn/start', 0, { turn: 1 }),
      event('tool/call', 10, { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }),
      event('tool/result', 20, { turn: 1, step: 1, message: { toolCallId: 'a', isError: false } }),
      event('tool/call', 30, { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{}' }),
      event('tool/result', 50, { turn: 1, step: 1, message: { toolCallId: 'b', isError: true } }),
      event('tool/call', 60, { turn: 1, step: 1, callId: 'c', name: 'bash', arguments: '{}' }),
      event('tool/result', 100, { turn: 1, step: 1, message: { toolCallId: 'c', isError: true } }),
      event('turn/end', 110, { turn: 1, reason: { kind: 'completed' } }),
    ],
    expect: { toolCalls: 3, toolErrors: 2, toolMs: 70, toolCallsByName: { read: 2, bash: 1 }, toolErrorsByName: { read: 1, bash: 1 } },
  },
  {
    id: 'telemetry-interrupted',
    category: 'telemetry',
    description: 'an interrupted assistant message marks the turn interrupted',
    events: [
      event('turn/start', 0, { turn: 1 }),
      event('step/start', 1, { turn: 1, step: 1 }),
      event('assistant/message', 2, { turn: 1, step: 1, message: {}, stream: [], interrupted: true, usage: { inputTokens: 1, outputTokens: 1 } }),
      event('turn/end', 3, { turn: 1, reason: { kind: 'cancelled' } }),
    ],
    expect: { steps: 1, interrupted: true, reason: 'cancelled' },
  },
  {
    id: 'telemetry-end-without-start',
    category: 'telemetry',
    description: 'a turn end without start still finalizes with zero defaults',
    events: [event('turn/end', 100, { turn: 1, reason: { kind: 'completed' } })],
    expect: { steps: 0, inputTokens: 0, outputTokens: 0, cacheHitRatio: 0, reason: 'completed' },
  },
]

const FOLD_CASES: FoldGoldenCase[] = [
  {
    id: 'fold-below-threshold',
    category: 'fold',
    description: 'summaries below foldEvery stay pending and make no model call',
    config: { foldEvery: 3 },
    summaries: ['alpha', 'beta'],
    llm: { text: 'summary' },
    expect: { llmCalls: 0, memory: null },
  },
  {
    id: 'fold-at-threshold',
    category: 'fold',
    description: 'reaching foldEvery calls the model once and stores the durable summary',
    config: { foldEvery: 2 },
    summaries: ['alpha', 'beta'],
    llm: { text: 'session summary' },
    expect: { llmCalls: 1, memory: { content: 'session summary', foldedSummaries: 2 } },
  },
  {
    id: 'fold-l2-route',
    category: 'fold',
    description: 'l2Provider and l2Model override the checkpoint route',
    config: { foldEvery: 1, l2Provider: 'local', l2Model: 'mid' },
    summaries: ['alpha'],
    llm: { text: 'routed summary' },
    expect: { llmCalls: 1, memory: { content: 'routed summary', foldedSummaries: 1 } },
  },
  {
    id: 'fold-empty-output',
    category: 'fold',
    description: 'an empty model output does not overwrite durable memory',
    config: { foldEvery: 1 },
    summaries: ['alpha'],
    llm: { text: '' },
    expect: { llmCalls: 1, memory: null },
  },
  {
    id: 'fold-llm-failure',
    category: 'fold',
    description: 'a failed fold call is tolerated and stores nothing',
    config: { foldEvery: 1 },
    summaries: ['alpha'],
    llm: { text: 'unused', fail: true },
    expect: { llmCalls: 1, memory: null },
  },
  {
    id: 'fold-dedup-keeps-version',
    category: 'fold',
    description: 'an identical fold output refreshes metadata without bumping the recall version',
    config: { foldEvery: 1 },
    summaries: ['alpha'],
    rounds: 2,
    llm: { text: 'stable summary' },
    expect: { llmCalls: 2, memory: { content: 'stable summary', foldedSummaries: 1 }, createdAtStable: true },
  },
  {
    id: 'fold-input-budget',
    category: 'fold',
    description: 'oversized checkpoint batches keep the newest checkpoints and mark the omission',
    config: { foldEvery: 5 },
    summaries: Array.from({ length: 5 }, (_, index) => `checkpoint-${index + 1} ${'x'.repeat(6_000)}`),
    llm: { text: 'folded summary' },
    expect: {
      llmCalls: 1,
      memory: { content: 'folded summary', foldedSummaries: 5 },
      promptContains: '[2 earlier checkpoint(s) omitted to fit the fold budget]',
    },
  },
]

const RECALL_CASES: RecallGoldenCase[] = [
  {
    id: 'recall-once',
    category: 'recall',
    description: 'a durable memory is injected at the first step only',
    memories: [{ sessionId: 's1', content: 'remember the auth flow', foldedSummaries: 4, createdAt: 10 }],
    steps: [{ sessionId: 's1', step: 1 }, { sessionId: 's1', step: 2 }],
    expect: { sessionId: 's1', count: 1, contains: 'remember the auth flow' },
  },
  {
    id: 'recall-new-version',
    category: 'recall',
    description: 'a newer memory version is injected again',
    memories: [{ sessionId: 's1', content: 'version one', foldedSummaries: 1, createdAt: 10 }],
    steps: [
      { sessionId: 's1', step: 1 },
      { sessionId: 's1', step: 2, updateMemory: { sessionId: 's1', content: 'version two', foldedSummaries: 2, createdAt: 20 } },
    ],
    expect: { sessionId: 's1', count: 2, contains: 'version two' },
  },
  {
    id: 'recall-disabled',
    category: 'recall',
    description: 'recall false never injects durable memory',
    recall: false,
    memories: [{ sessionId: 's1', content: 'do not inject', foldedSummaries: 1, createdAt: 10 }],
    steps: [{ sessionId: 's1', step: 1 }],
    expect: { sessionId: 's1', count: 0 },
  },
  {
    id: 'recall-session-isolation',
    category: 'recall',
    description: 'memory for one session is not injected into another',
    memories: [{ sessionId: 's1', content: 'only for s1', foldedSummaries: 1, createdAt: 10 }],
    steps: [{ sessionId: 's2', step: 1 }],
    expect: { sessionId: 's2', count: 0 },
  },
  {
    id: 'recall-first-step-only',
    category: 'recall',
    description: 'the same memory is not re-injected on later steps of the turn',
    memories: [{ sessionId: 's1', content: 'stable', foldedSummaries: 1, createdAt: 10 }],
    steps: [{ sessionId: 's1', step: 1 }, { sessionId: 's1', step: 2 }, { sessionId: 's1', step: 3 }],
    expect: { sessionId: 's1', count: 1, contains: 'stable' },
  },
  {
    id: 'recall-expired-ttl',
    category: 'recall',
    description: 'memory past its TTL is not injected while TTL is enabled',
    config: { memoryTtlDays: 1 },
    memories: [{ sessionId: 's1', content: 'stale memory', foldedSummaries: 1, createdAt: 10, expiresAt: 1 }],
    steps: [{ sessionId: 's1', step: 1 }],
    expect: { sessionId: 's1', count: 0 },
  },
  {
    id: 'recall-legacy-ttl',
    category: 'recall',
    description: 'legacy memory without an expiry ages out from its creation time once TTL is enabled',
    config: { memoryTtlDays: 1 },
    memories: [{ sessionId: 's1', content: 'legacy memory', foldedSummaries: 1, createdAt: 10 }],
    steps: [{ sessionId: 's1', step: 1 }],
    expect: { sessionId: 's1', count: 0 },
  },
  {
    id: 'recall-truncates-output',
    category: 'recall',
    description: 'model-authored memory above the recall budget is truncated with an explicit marker',
    memories: [{ sessionId: 's1', content: `head ${'y'.repeat(13_000)}`, foldedSummaries: 1, createdAt: 10 }],
    steps: [{ sessionId: 's1', step: 1 }],
    expect: { sessionId: 's1', count: 1, contains: '[durable memory truncated at 12000 characters]' },
  },
]

const FILES_CASES: FilesGoldenCase[] = [
  {
    id: 'files-index-off',
    category: 'files',
    description: 'index_file is not registered while fileIndex is off',
    files: [],
    steps: [],
    expect: { sessionId: 's1', count: 0 },
  },
  {
    id: 'files-recall-once',
    category: 'files',
    description: 'the marked-file list is injected once while its signature is stable',
    fileRecall: true,
    files: [{ key: 'k1', path: '/repo/a.ts', note: 'entry point', content: 'a', truncated: false, createdAt: 10 }],
    steps: [{ sessionId: 's1', step: 1 }, { sessionId: 's1', step: 2 }],
    expect: { sessionId: 's1', count: 1, contains: '/repo/a.ts' },
  },
  {
    id: 'files-recall-change',
    category: 'files',
    description: 'a new marked file changes the signature and triggers a fresh list',
    fileRecall: true,
    files: [{ key: 'k1', path: '/repo/a.ts', note: 'entry point', content: 'a', truncated: false, createdAt: 10 }],
    steps: [
      { sessionId: 's1', step: 1 },
      {
        sessionId: 's1',
        step: 2,
        updateFiles: [
          { key: 'k1', path: '/repo/a.ts', note: 'entry point', content: 'a', truncated: false, createdAt: 10 },
          { key: 'k2', path: '/repo/b.ts', note: 'config', content: 'b', truncated: false, createdAt: 20 },
        ],
      },
    ],
    expect: { sessionId: 's1', count: 2, contains: '/repo/b.ts' },
  },
  {
    id: 'files-index-writes',
    category: 'files',
    description: 'index_file stores path, note, and bounded content in the files table',
    fileIndex: true,
    files: [],
    steps: [],
    expect: { sessionId: 's1', count: 0 },
    index: { note: 'the main entry', body: 'export const answer = 42\n', expectTruncated: false },
  },
  {
    id: 'files-recall-budget',
    category: 'files',
    description: 'a large marked-file list is capped and reports the omitted remainder',
    fileRecall: true,
    files: Array.from({ length: 60 }, (_, index) => ({
      key: `k${index}`,
      path: `/repo/${'nested/'.repeat(4)}file-${index}.ts`,
      note: 'important module for the current task '.repeat(4),
      content: '',
      truncated: false,
      createdAt: index + 1,
    })),
    steps: [{ sessionId: 's1', step: 1 }],
    expect: { sessionId: 's1', count: 1, contains: 'more file(s) omitted to fit the recall budget' },
  },
]

const LOOP_CASES: LoopGoldenCase[] = [
  {
    id: 'loop-step-budget',
    category: 'loop',
    description: 'reaching maxStepsPerTurn rejects the step and steers a reset',
    config: { maxStepsPerTurn: 4, askOnAmbiguity: false },
    preSteps: [{ step: 4 }],
    expect: ['reject'],
  },
  {
    id: 'loop-wallclock-budget',
    category: 'loop',
    description: 'exceeding maxTurnWallMs rejects the step and steers a reset',
    config: { maxTurnWallMs: 60_000, askOnAmbiguity: false },
    preSteps: [{ step: 1 }, { step: 2, advanceMs: 60_001 }],
    expect: ['allow', 'reject'],
  },
]

export const GOLDEN_CASES: readonly GoldenCase[] = [
  ...TELEMETRY_CASES,
  ...FOLD_CASES,
  ...RECALL_CASES,
  ...FILES_CASES,
  ...LOOP_CASES,
]
