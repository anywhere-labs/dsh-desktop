import { ApprovalService, type ApprovalRecord } from '../approvals/service.js'
import { MockActionExecutor, type MockActionReceipt } from '../actions/mock-executor.js'
import type { ActionProposal } from '../contracts/index.js'
import { CaseStore } from '../event-core/cases.js'
import type { BusinessEvent } from '../event-core/contracts.js'
import { EventLedger } from '../event-core/ledger.js'
import { EventRouter } from '../event-core/router.js'
import { parseVocEvent } from './events.js'
import { VOC_RECORD_VERSION, VOC_SCENE_VERSION, evidenceSchema, sceneClusterSchema, sceneDictionaryNodeSchema, sceneInstanceSchema, vocInsightSchema, vocRecordSchema, type Evidence, type SceneCluster, type SceneDictionaryNode, type SceneInstance, type VOCInsight, type VOCRecord } from './contracts.js'

export type VocWorkflowScenario = 'normal' | 'low_evidence'

interface VocWorkflowState {
  sceneStatus: 'PENDING_HUMAN_REVIEW' | 'APPROVED' | 'BLOCKED'
  caseStatus: 'OPEN' | 'WAITING_HUMAN' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'BLOCKED'
  taskStatus: 'OPEN' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'BLOCKED'
  ownerId: string
  receiptStatus: 'succeeded' | 'failed' | null
  outcomeStatus: 'succeeded' | 'blocked' | null
  retroRecorded: boolean
  blockedReason: string | null
}

export interface Voc3WorkflowResult {
  readonly scenario: VocWorkflowScenario
  readonly records: readonly VOCRecord[]
  readonly evidences: readonly Evidence[]
  readonly dictionaryNodes: readonly SceneDictionaryNode[]
  readonly sceneInstances: readonly SceneInstance[]
  readonly cluster: SceneCluster | null
  readonly insight: VOCInsight | null
  readonly approval: ApprovalRecord | null
  readonly receipt: MockActionReceipt | null
  readonly events: readonly BusinessEvent[]
  readonly eventTypes: readonly string[]
  readonly final: {
    readonly sceneStatus: VocWorkflowState['sceneStatus']
    readonly caseStatus: VocWorkflowState['caseStatus']
    readonly taskStatus: VocWorkflowState['taskStatus']
    readonly ownerId: string
    readonly receiptStatus: VocWorkflowState['receiptStatus']
    readonly outcomeStatus: VocWorkflowState['outcomeStatus']
    readonly retroRecorded: boolean
    readonly blockedReason: string | null
    readonly externalWrite: false
  }
}

const TENANT = 'tenant_demo_group'
const ENTERPRISE = 'enterprise_demo_a'
const BRAND = 'brand_demo_alpha'
const OWNER = 'human_voc_owner_001'
const CASE_ID = 'case_voc_scene_001'
const TASK_ID = 'task_voc_scene_001'
const NOW = '2026-09-08T10:00:00+08:00'

export class Voc3Workflow {
  private readonly router: EventRouter
  private readonly cases = new CaseStore()
  private readonly state = new VocProjection()
  private readonly executor: MockActionExecutor

  constructor(private readonly ledger: EventLedger, private readonly approvals: ApprovalService) {
    this.executor = new MockActionExecutor(approvals)
    this.router = new EventRouter(ledger)
    this.router.register({ eventType: '*', agentId: 'voc-projection', riskLevel: 'low', humanGate: false }, event => this.handle(event))
    for (const event of ledger.list()) this.handle(event)
  }

  async run(scenario: VocWorkflowScenario = 'normal'): Promise<Voc3WorkflowResult> {
    const fixture = createFixture(scenario)
    for (const record of fixture.records) await this.append(makeEvent('voc.record.ingested', `evt_${record.vocId}_ingested`, { type: 'VOCRecord', id: record.vocId }, { ...record }))
    for (const record of fixture.records) await this.append(makeEvent('voc.record.normalized', `evt_${record.vocId}_normalized`, { type: 'VOCRecord', id: record.vocId }, { vocId: record.vocId, status: 'NORMALIZED', evidenceRefs: record.evidenceRefs }))
    for (const scene of fixture.sceneInstances) await this.append(makeEvent('voc.scene.instance.created', `evt_${scene.instanceId}_created`, { type: 'SceneInstance', id: scene.instanceId }, { ...scene }))
    await this.append(makeEvent('voc.scene.review.requested', 'evt_voc_scene_review_requested_001', { type: 'BusinessCase', id: CASE_ID }, { caseId: CASE_ID, sceneIds: fixture.sceneInstances.map(item => item.instanceId), ownerId: OWNER }))
    await this.append(makeEvent('case.created', 'evt_voc_case_created_001', { type: 'BusinessCase', id: CASE_ID }, { caseId: CASE_ID, title: 'VOC 场景聚类经营机会', ownerId: OWNER }))
    await this.append(makeEvent('task.status.changed', 'evt_voc_task_open_001', { type: 'Task', id: TASK_ID }, { taskId: TASK_ID, status: 'OPEN', ownerId: OWNER, acceptanceCriteria: ['确认场景证据并形成商品/客服改进建议'] }))

    if (scenario === 'low_evidence') {
      await this.append(makeEvent('task.status.changed', 'evt_voc_task_blocked_001', { type: 'Task', id: TASK_ID }, { taskId: TASK_ID, status: 'BLOCKED', ownerId: OWNER, reason: 'VOC_EVIDENCE_INSUFFICIENT' }))
      await this.append(makeEvent('outcome.recorded', 'evt_voc_outcome_blocked_001', { type: 'Outcome', id: 'outcome_voc_blocked_001' }, { caseId: CASE_ID, status: 'blocked', summary: '证据不足，未生成可执行动作', externalWrite: false }))
      await this.append(makeEvent('retro.recorded', 'evt_voc_retro_blocked_001', { type: 'Retro', id: 'retro_voc_blocked_001' }, { caseId: CASE_ID, outcomeStatus: 'blocked', lessons: ['补齐原始 VOC 来源和样本上下文'], followUpTaskId: TASK_ID }))
      await this.append(makeEvent('case.status.changed', 'evt_voc_case_blocked_001', { type: 'BusinessCase', id: CASE_ID }, { caseId: CASE_ID, status: 'BLOCKED', reason: 'VOC_EVIDENCE_INSUFFICIENT' }))
    } else {
      for (const scene of fixture.sceneInstances) await this.append(makeEvent('voc.scene.approved', `evt_${scene.instanceId}_approved`, { type: 'SceneInstance', id: scene.instanceId }, { instanceId: scene.instanceId, status: 'APPROVED', approverId: OWNER }))
      await this.append(makeEvent('voc.cluster.updated', 'evt_voc_cluster_updated_001', { type: 'SceneCluster', id: fixture.cluster.clusterId }, { ...fixture.cluster }))
      await this.append(makeEvent('voc.insight.proposed', 'evt_voc_insight_proposed_001', { type: 'VOCInsight', id: fixture.insight.insightId }, { ...fixture.insight }))
      await this.append(makeEvent('human.decision.recorded', 'evt_voc_decision_accepted_001', { type: 'VOCInsight', id: fixture.insight.insightId }, { insightId: fixture.insight.insightId, decision: 'accept', decidedBy: OWNER, note: '确认进入商品和客服协同评估' }))
      const action = fixture.action
      const approval = this.approvals.create(action, 'voc-agent', 'approval_voc_scene_001')
      const approved = approval.status === 'pending' ? this.approvals.approve(approval.approvalId, OWNER) : approval
      await this.append(makeEvent('task.status.changed', 'evt_voc_task_approved_001', { type: 'Task', id: TASK_ID }, { taskId: TASK_ID, status: 'APPROVED', ownerId: OWNER }))
      await this.append(makeEvent('action.execution.started', 'evt_voc_action_started_001', { type: 'Action', id: action.actionId }, { actionId: action.actionId, caseId: CASE_ID, mode: 'mock', externalWrite: false }))
      const receipt = this.executor.execute({ ...action, approvalId: approved.approvalId })
      await this.append(makeEvent('action.receipt.received', 'evt_voc_receipt_001', { type: 'Receipt', id: receipt.receiptId }, { ...receipt }))
      await this.append(makeEvent('task.status.changed', 'evt_voc_task_closed_001', { type: 'Task', id: TASK_ID }, { taskId: TASK_ID, status: 'CLOSED', ownerId: OWNER }))
      await this.append(makeEvent('outcome.recorded', 'evt_voc_outcome_succeeded_001', { type: 'Outcome', id: 'outcome_voc_succeeded_001' }, { caseId: CASE_ID, status: 'succeeded', summary: '已完成本地商品/客服改进建议演示，未执行外部写入', externalWrite: false }))
      await this.append(makeEvent('retro.recorded', 'evt_voc_retro_succeeded_001', { type: 'Retro', id: 'retro_voc_succeeded_001' }, { caseId: CASE_ID, outcomeStatus: 'succeeded', lessons: ['场景证据可支持进入人工审批'], followUpTaskId: null }))
      await this.append(makeEvent('case.status.changed', 'evt_voc_case_closed_001', { type: 'BusinessCase', id: CASE_ID }, { caseId: CASE_ID, status: 'CLOSED' }))
    }

    const events = this.ledger.list({ tenantId: TENANT, correlationId: CASE_ID })
    return { scenario, records: fixture.records, evidences: fixture.evidences, dictionaryNodes: fixture.dictionaryNodes, sceneInstances: fixture.sceneInstances, cluster: scenario === 'normal' ? fixture.cluster : null, insight: scenario === 'normal' ? fixture.insight : null, approval: this.approvals.list()[0] ?? null, receipt: events.find(event => event.eventType === 'action.receipt.received')?.payload as unknown as MockActionReceipt ?? null, events, eventTypes: events.map(event => event.eventType), final: this.state.snapshot() }
  }

  private handle(event: BusinessEvent): void {
    if (event.eventType === 'voc.scene.instance.created') this.state.sceneStatus = 'PENDING_HUMAN_REVIEW'
    if (event.eventType === 'voc.scene.approved') this.state.sceneStatus = 'APPROVED'
    if (event.eventType === 'case.created') { this.state.caseStatus = 'OPEN'; this.cases.createFromEvent(event, 'VOC 场景聚类经营机会', OWNER) }
    if (event.eventType === 'task.status.changed') this.state.taskStatus = event.payload.status as VocWorkflowState['taskStatus']
    if (event.eventType === 'approval.requested') this.state.caseStatus = 'WAITING_HUMAN'
    if (event.eventType === 'approval.approved') this.state.caseStatus = 'APPROVED'
    if (event.eventType === 'action.execution.started') this.state.caseStatus = 'EXECUTING'
    if (event.eventType === 'action.receipt.received') { this.state.caseStatus = 'VERIFYING'; this.state.receiptStatus = event.payload.status === 'succeeded' ? 'succeeded' : 'failed' }
    if (event.eventType === 'outcome.recorded') this.state.outcomeStatus = event.payload.status === 'succeeded' ? 'succeeded' : 'blocked'
    if (event.eventType === 'retro.recorded') this.state.retroRecorded = true
    if (event.eventType === 'case.status.changed') { this.state.caseStatus = event.payload.status as VocWorkflowState['caseStatus']; this.state.blockedReason = typeof event.payload.reason === 'string' ? event.payload.reason : this.state.blockedReason; if (this.state.caseStatus === 'CLOSED') this.state.taskStatus = 'CLOSED' }
    if (event.eventType === 'task.status.changed' && event.payload.reason === 'VOC_EVIDENCE_INSUFFICIENT') { this.state.blockedReason = 'VOC_EVIDENCE_INSUFFICIENT'; this.state.sceneStatus = 'BLOCKED' }
  }

  private async append(event: BusinessEvent): Promise<void> { parseVocEvent(event); await this.ledger.append(event) }

  private readonly makeEvent = makeEvent
}

function makeEvent(eventType: string, eventId: string, subject: BusinessEvent['subject'], payload: Record<string, unknown>): BusinessEvent {
  return { eventId, eventType, tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND, subject, payload, source: { type: 'voc-fixture', ref: eventId }, evidenceRefs: ['evidence_voc_fixture_001'], confidence: 1, occurredAt: NOW, observedAt: NOW, correlationId: CASE_ID, causationId: null, schemaVersion: 'event.v1' }
}

function createFixture(scenario: VocWorkflowScenario): { records: readonly VOCRecord[]; evidences: readonly Evidence[]; dictionaryNodes: readonly SceneDictionaryNode[]; sceneInstances: readonly SceneInstance[]; cluster: SceneCluster; insight: VOCInsight; action: Omit<ActionProposal, 'approvalId'> } {
  const evidenceRefs = scenario === 'low_evidence' ? [] : ['evidence_voc_001', 'evidence_voc_002']
  const records = [
    vocRecordSchema.parse({ vocId: 'voc_001', recordVersion: VOC_RECORD_VERSION, sourceType: 'customer_service', sourceRef: 'fixture:cs:001', rawText: '换季衣物上的顽固污渍很难一次洗干净，希望有更快的解决办法。', productId: 'product_001', capturedAt: NOW, status: 'NORMALIZED', tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND, ownerId: OWNER, evidenceRefs, updatedAt: NOW }),
    vocRecordSchema.parse({ vocId: 'voc_002', recordVersion: VOC_RECORD_VERSION, sourceType: 'review', sourceRef: 'fixture:review:002', rawText: '低温天气使用时需要重复清洗，想要更省时间。', productId: 'product_001', capturedAt: NOW, status: 'NORMALIZED', tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND, ownerId: OWNER, evidenceRefs, updatedAt: NOW }),
  ]
  const evidences = evidenceRefs.map((evidenceId, index) => evidenceSchema.parse({ evidenceId, kind: 'raw_voc', sourceRef: records[index % records.length]!.sourceRef, capturedAt: NOW, contentHash: `hash_${evidenceId}`, tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND, ownerId: OWNER, evidenceRefs: [evidenceId], updatedAt: NOW }))
  const dictionaryNodes = [
    sceneDictionaryNodeSchema.parse({ nodeId: 'trigger_season_change', version: VOC_SCENE_VERSION, dimension: 'trigger', label: '换季衣物集中清洗', status: 'ACTIVE', ownerId: OWNER, evidenceRefs }),
    sceneDictionaryNodeSchema.parse({ nodeId: 'pain_repeated_cleaning', version: VOC_SCENE_VERSION, dimension: 'pain', label: '需要重复清洗', status: 'ACTIVE', ownerId: OWNER, evidenceRefs }),
  ]
  const sceneInstances = records.map((record, index) => sceneInstanceSchema.parse({ instanceId: `scene_instance_00${index + 1}`, vocId: record.vocId, dictionaryVersion: VOC_SCENE_VERSION, dimensions: { trigger: '换季衣物集中清洗', taskJtbd: '快速去除顽固污渍', pain: ['需要重复清洗'], constraint: ['低温环境'], emotion: '焦虑', decisionStage: 'comparison' }, confidence: scenario === 'low_evidence' ? 0.35 : 0.84, status: 'PENDING_HUMAN_REVIEW', ownerId: OWNER, evidenceRefs }))
  const cluster = sceneClusterSchema.parse({ clusterId: 'scene_cluster_001', dictionaryVersion: VOC_SCENE_VERSION, instanceIds: sceneInstances.map(item => item.instanceId), signalCount: sceneInstances.length, topPain: '低温环境下需要重复清洗', status: 'PROPOSED', ownerId: OWNER, evidenceRefs })
  const insight = vocInsightSchema.parse({ insightId: 'voc_insight_001', clusterId: cluster.clusterId, conclusion: '用户在换季和低温场景中需要更省时的去污方案', recommendations: ['商品运营评估低温去污卖点', '客服建立低温使用指引'], confidence: scenario === 'low_evidence' ? 0.35 : 0.81, status: 'PROPOSED', ownerId: OWNER, evidenceRefs })
  const action: Omit<ActionProposal, 'approvalId'> = { actionId: 'act_voc_content_brief_001', actionType: 'create_voc_improvement_brief', riskLevel: 'L3', target: { platform: 'mock', shopId: 'shop_demo_alpha', productId: 'product_001' }, payload: { caseId: CASE_ID, clusterId: cluster.clusterId, externalWrite: false, evidenceRefs } }
  return { records, evidences, dictionaryNodes, sceneInstances, cluster, insight, action }
}

class VocProjection {
  sceneStatus: VocWorkflowState['sceneStatus'] = 'PENDING_HUMAN_REVIEW'
  caseStatus: VocWorkflowState['caseStatus'] = 'OPEN'
  taskStatus: VocWorkflowState['taskStatus'] = 'OPEN'
  ownerId = OWNER
  receiptStatus: VocWorkflowState['receiptStatus'] = null
  outcomeStatus: VocWorkflowState['outcomeStatus'] = null
  retroRecorded = false
  blockedReason: string | null = null
  snapshot(): Voc3WorkflowResult['final'] { return { sceneStatus: this.sceneStatus, caseStatus: this.caseStatus, taskStatus: this.taskStatus, ownerId: this.ownerId, receiptStatus: this.receiptStatus, outcomeStatus: this.outcomeStatus, retroRecorded: this.retroRecorded, blockedReason: this.blockedReason, externalWrite: false } }
}

export function createVoc3Workflow(): Voc3Workflow {
  const ledger = new EventLedger()
  const approvals = new ApprovalService({ ledger, tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND })
  return new Voc3Workflow(ledger, approvals)
}

export async function runVoc3Workflow(scenario: VocWorkflowScenario = 'normal'): Promise<Voc3WorkflowResult> { return createVoc3Workflow().run(scenario) }

