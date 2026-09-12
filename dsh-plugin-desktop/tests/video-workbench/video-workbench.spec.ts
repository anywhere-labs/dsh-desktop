import { describe, expect, it } from 'vitest'
import {
  TaskStatus,
  canTransitionTask,
  transitionStatus,
  transitionTask,
  InvalidTaskTransitionError,
} from '../../src/client/video-workbench/state-machine.ts'
import {
  parseSseChunks,
  type ParsedSseEvent,
} from '../../src/client/video-workbench/sse.ts'
import {
  createAssetManifest,
  evaluateGenerationGates,
  findIdempotentTask,
  toIdempotencyQuery,
  type CostQuote,
  type GenerationGateInput,
  type GenerationRequest,
  type ProviderTaskRecord,
} from '../../src/client/video-workbench/provider.ts'
import type {
  AgentDescriptor,
  HookDefinition,
  HotspotSignal,
  SkillDescriptor,
} from '../../src/client/video-workbench/contracts.ts'

describe('video workbench task state machine', () => {
  it('accepts the real generation lifecycle from draft to completion', () => {
    const path: TaskStatus[] = [
      'DRAFT',
      'ANALYZING',
      'READY',
      'AWAITING_APPROVAL',
      'QUEUED',
      'GENERATING',
      'POST_PROCESSING',
      'QA_RUNNING',
      'COMPLETED',
    ]

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(transitionStatus(path[index]!, path[index + 1]!)).toBe(path[index + 1])
    }
  })

  it('rejects an illegal transition and preserves the original task', () => {
    const task = {
      taskId: 'task-1',
      status: 'DRAFT' as const,
      history: [],
    }

    expect(canTransitionTask('DRAFT', 'GENERATING')).toBe(false)
    expect(() => transitionTask(task, 'GENERATING', '2026-08-31T00:00:00.000Z'))
      .toThrow(InvalidTaskTransitionError)
    expect(task.status).toBe('DRAFT')
    expect(task.history).toHaveLength(0)
  })

  it('supports retrying a partial task through approval without mutating history', () => {
    const task = transitionTask(
      {
        taskId: 'task-2',
        status: 'PARTIAL' as const,
        history: [],
      },
      'AWAITING_APPROVAL',
      '2026-08-31T00:00:00.000Z',
    )

    expect(task.status).toBe('AWAITING_APPROVAL')
    expect(task.history).toEqual([
      {
        from: 'PARTIAL',
        to: 'AWAITING_APPROVAL',
        changedAt: '2026-08-31T00:00:00.000Z',
      },
    ])
  })
})

describe('SSE parsing', () => {
  it('reassembles split frames, joins multiline data, and parses JSON payloads', () => {
    const events = parseSseChunks([
      ': keep-alive\n\n' +
        'event: progress\n' +
        'id: 7\n' +
        'data: {"status":"GENERATING",\n',
      'data: "progress":0.4}\n\n' +
        'event: done\n' +
        'data: {"status":"COMPLETED"}\n\n',
    ])

    expect(events).toEqual([
      {
        event: 'progress',
        id: '7',
        data: { status: 'GENERATING', progress: 0.4 },
        rawData: '{"status":"GENERATING",\n"progress":0.4}',
      },
      {
        event: 'done',
        data: { status: 'COMPLETED' },
        rawData: '{"status":"COMPLETED"}',
      },
    ] satisfies ParsedSseEvent[])
  })

  it('keeps non-JSON data and ignores comments and retry metadata', () => {
    const events = parseSseChunks([
      'retry: 5000\n' +
        ': server comment\n' +
        'data: provider is warming up\n\n',
    ])

    expect(events).toEqual([
      {
        data: 'provider is warming up',
        rawData: 'provider is warming up',
      },
    ])
  })
})

describe('generation gates and idempotent task lookup', () => {
  const quote: CostQuote = {
    quoteId: 'quote-1',
    amount: 0.12,
    currency: 'USD',
  }

  const baseGateInput: GenerationGateInput = {
    providerId: 'provider-a',
    model: 'video-v1',
    allowedProviderIds: ['provider-a'],
    allowedModels: ['video-v1'],
    requestedAssetIds: ['source-1'],
    authorizedAssetIds: ['source-1'],
    quote,
    costConfirmation: {
      quoteId: 'quote-1',
      amount: 0.12,
      currency: 'USD',
      confirmedBy: 'operator-1',
      confirmedAt: '2026-08-31T00:00:00.000Z',
      approvalId: 'approval-1',
    },
    authorization: {
      approved: true,
      approvalId: 'approval-1',
      scope: 'task',
    },
  }

  it('allows generation only when provider, model, assets, cost, and approval all match', () => {
    expect(evaluateGenerationGates(baseGateInput)).toEqual({ allowed: true })
  })

  it('fails closed when any cost or authorization evidence is absent or mismatched', () => {
    expect(evaluateGenerationGates({
      ...baseGateInput,
      costConfirmation: undefined,
    })).toEqual({ allowed: false, reason: 'cost_not_confirmed' })

    expect(evaluateGenerationGates({
      ...baseGateInput,
      authorization: { ...baseGateInput.authorization!, approved: false },
    })).toEqual({ allowed: false, reason: 'authorization_not_granted' })

    expect(evaluateGenerationGates({
      ...baseGateInput,
      authorizedAssetIds: [],
    })).toEqual({ allowed: false, reason: 'asset_not_authorized' })

    expect(evaluateGenerationGates({
      ...baseGateInput,
      model: 'unapproved-model',
    })).toEqual({ allowed: false, reason: 'model_not_authorized' })
  })

  it('creates a duplicate-free asset manifest and rejects duplicate asset ids', () => {
    expect(createAssetManifest('task-1', [
      {
        assetId: 'source-1',
        kind: 'SOURCE_VIDEO',
        uri: '/tmp/source.mp4',
        mimeType: 'video/mp4',
        authorized: true,
      },
    ])).toEqual({
      taskId: 'task-1',
      assets: [{
        assetId: 'source-1',
        kind: 'SOURCE_VIDEO',
        uri: '/tmp/source.mp4',
        mimeType: 'video/mp4',
        authorized: true,
      }],
    })

    expect(() => createAssetManifest('task-1', [
      {
        assetId: 'same',
        kind: 'SOURCE_VIDEO',
        uri: '/tmp/a.mp4',
        mimeType: 'video/mp4',
        authorized: true,
      },
      {
        assetId: 'same',
        kind: 'REFERENCE_IMAGE',
        uri: '/tmp/b.png',
        mimeType: 'image/png',
        authorized: true,
      },
    ])).toThrow('duplicate asset id')
  })

  it('finds an existing provider task by the full idempotency identity', () => {
    const request = {
      taskId: 'task-1',
      idempotencyKey: 'task-1:revision-1',
    } as GenerationRequest
    const records: ProviderTaskRecord[] = [
      {
        taskId: 'other',
        idempotencyKey: 'task-1:revision-1',
        status: 'GENERATING',
      },
      {
        taskId: 'task-1',
        idempotencyKey: 'task-1:revision-1',
        status: 'QUEUED',
        providerJobId: 'job-1',
      },
    ]

    expect(toIdempotencyQuery(request)).toEqual({
      taskId: 'task-1',
      idempotencyKey: 'task-1:revision-1',
    })
    expect(findIdempotentTask(records, toIdempotencyQuery(request))).toEqual(records[1])
  })
})

describe('cross-system metadata contracts', () => {
  it('accepts hook, hotspot, skill, and agent records without runtime dependencies', () => {
    const hook: HookDefinition = {
      hookId: 'hook.before-generate',
      phase: 'BEFORE_GENERATION',
      enabled: true,
      inputSchema: 'generation-request.v1',
      outputSchema: 'generation-request.v1',
    }
    const hotspot: HotspotSignal = {
      signalId: 'hotspot-1',
      source: 'local-trend-feed',
      topic: 'AI video workflow',
      score: 0.8,
      observedAt: '2026-08-31T00:00:00.000Z',
      evidence: ['local://trend/1'],
    }
    const skill: SkillDescriptor = {
      skillId: 'skill.video-qa',
      name: 'Video QA',
      version: '1.0.0',
      capabilities: ['CHECK_DURATION', 'CHECK_CODEC'],
    }
    const agent: AgentDescriptor = {
      agentId: 'agent.video-producer',
      name: 'Video Producer',
      role: 'GENERATION_COORDINATOR',
      skillIds: [skill.skillId],
    }

    expect({ hook, hotspot, skill, agent }).toMatchObject({
      hook: { phase: 'BEFORE_GENERATION' },
      hotspot: { score: 0.8 },
      skill: { capabilities: ['CHECK_DURATION', 'CHECK_CODEC'] },
      agent: { skillIds: ['skill.video-qa'] },
    })
  })
})
