import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runVoc3Workflow } from '../src/voc-domain/workflow.js'
import { VOC_OBJECT_CATALOG, VOC_SCENE_VERSION, vocEventTypes } from '../src/voc-domain/contracts.js'
import { CommerceOpsService } from '../src/host/commerce-ops-service.js'

describe('VOC 3.0 integration run', () => {
  it('runs the local VOC scene chain through case, approval, mock action, outcome and retro', async () => {
    expect(VOC_SCENE_VERSION).toBe('voc.scene.v3')
    expect(VOC_OBJECT_CATALOG.map(item => item.objectType)).toEqual(['VOCRecord', 'Evidence', 'SceneDictionaryNode', 'SceneInstance', 'SceneCluster', 'VOCInsight', 'BusinessCase', 'Task', 'Decision', 'Outcome', 'Retro'])
    expect(vocEventTypes).toContain('voc.scene.instance.created')
    expect(vocEventTypes).toContain('voc.cluster.updated')
    const result = await runVoc3Workflow('normal')
    expect(result.final).toMatchObject({ sceneStatus: 'APPROVED', caseStatus: 'CLOSED', taskStatus: 'CLOSED', receiptStatus: 'succeeded', outcomeStatus: 'succeeded', retroRecorded: true, externalWrite: false })
    expect(result.sceneInstances).toHaveLength(2)
    expect(result.cluster.signalCount).toBe(2)
    expect(result.eventTypes).toContain('human.decision.recorded')
    expect(result.eventTypes).toContain('action.receipt.received')
  })

  it('blocks low-evidence VOC before action and preserves an actionable reason', async () => {
    const result = await runVoc3Workflow('low_evidence')
    expect(result.final).toMatchObject({ sceneStatus: 'BLOCKED', caseStatus: 'BLOCKED', taskStatus: 'BLOCKED', receiptStatus: null, outcomeStatus: 'blocked', externalWrite: false })
    expect(result.final.blockedReason).toBe('VOC_EVIDENCE_INSUFFICIENT')
    expect(result.eventTypes).not.toContain('action.execution.started')
  })

  it('runs through the CommerceOps backend service and restores the event log', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-voc-integration-'))
    const eventLogPath = join(directory, 'events.jsonl')
    const first = new CommerceOpsService({ eventLogPath })
    const result = await first.runVocDemo('normal')
    expect(result.final).toMatchObject({ caseStatus: 'CLOSED', taskStatus: 'CLOSED', outcomeStatus: 'succeeded', externalWrite: false })
    const restarted = new CommerceOpsService({ eventLogPath })
    const replay = await restarted.runVocDemo('normal')
    expect(replay.events).toHaveLength(result.events.length)
    expect(replay.final).toMatchObject({ caseStatus: 'CLOSED', taskStatus: 'CLOSED', externalWrite: false })
  })
})
