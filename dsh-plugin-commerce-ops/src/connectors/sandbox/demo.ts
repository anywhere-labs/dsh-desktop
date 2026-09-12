import { ApprovalService, type ApprovalRecord } from '../../approvals/service.js'
import { EventLedger } from '../../event-core/ledger.js'
import type { BusinessEvent } from '../../event-core/contracts.js'
import { createSandboxActionProposal, SANDBOX_EVENT_VERSION, type PlatformId, type SandboxEnvironment, type SandboxScenario } from './contracts.js'
import { PlatformSandboxGateway, type SandboxReceipt } from './gateway.js'

export type PlatformDemoScenario = SandboxScenario

export interface PlatformSandboxDemoResult {
  readonly platformId: PlatformId
  readonly scenario: PlatformDemoScenario
  readonly environment: SandboxEnvironment
  readonly caseId: string
  readonly approval: ApprovalRecord | null
  readonly receipt: SandboxReceipt
  readonly eventTypes: readonly string[]
  readonly events: readonly BusinessEvent[]
  readonly final: { readonly outcomeStatus: 'succeeded' | 'failed' | 'blocked'; readonly externalWrite: false; readonly isSimulated: boolean }
}

const TENANT = 'tenant_demo_group'
const ENTERPRISE = 'enterprise_demo_a'
const BRAND = 'brand_demo_alpha'
const OWNER = 'human_platform_owner_001'
const NOW = '2026-09-08T10:00:00+08:00'

export async function runPlatformSandboxDemo(platformId: PlatformId, scenario: PlatformDemoScenario = 'success', environment: SandboxEnvironment = 'demo'): Promise<PlatformSandboxDemoResult> {
  const ledger = new EventLedger()
  const approvals = new ApprovalService({ ledger, tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND })
  const gateway = new PlatformSandboxGateway(approvals)
  const caseId = `case_platform_${platformId}_${scenario}`
  const action = createSandboxActionProposal({ platformId, capability: 'preview_product_content', actionId: `act_${platformId}_sandbox_001`, idempotencyKey: `idem_${platformId}_sandbox_001`, caseId })
  await append(ledger, event({ eventId: `evt_platform_action_requested_${platformId}_${environment}_${scenario}`, eventType: 'platform.action.requested', caseId, subject: { type: 'Action', id: action.actionId }, payload: { platformId, environment, capability: 'preview_product_content', actionId: action.actionId, idempotencyKey: `idem_${platformId}_sandbox_001`, externalWrite: false } }))

  let approval: ApprovalRecord | null = null
  if (scenario !== 'credential_missing') {
    approval = approvals.create(action, 'platform-agent', `approval_${platformId}_sandbox_001`)
    if (scenario === 'approval_rejected') {
      if (approval.status === 'pending') approval = approvals.reject(approval.approvalId, OWNER)
    } else if (approval.status === 'pending') {
      approval = approvals.approve(approval.approvalId, OWNER)
    }
  }

  if (environment !== 'production' && approval?.status === 'approved' && ['success', 'failure', 'action_failed'].includes(scenario)) {
    await append(ledger, event({ eventId: `evt_platform_action_started_${platformId}_${scenario}`, eventType: 'action.execution.started', caseId, subject: { type: 'Action', id: action.actionId }, payload: { actionId: action.actionId, caseId, mode: 'mock', externalWrite: false } }))
  }

  const receipt = gateway.execute({
    platformId,
    environment,
    capability: 'preview_product_content',
    credentialRef: scenario === 'credential_missing' ? undefined : `credref_demo_${platformId}`,
    idempotencyKey: `idem_${platformId}_sandbox_001`,
    actionProposal: approval ? { ...action, approvalId: approval.approvalId } : action,
    payload: { productId: 'product_001', contentRef: `fixture_${platformId}_content_v1` },
    scenario: scenario === 'action_failed' ? 'failure' : scenario,
  })
  await append(ledger, event({ eventId: `evt_platform_receipt_${platformId}_${scenario}`, eventType: 'action.receipt.received', caseId, subject: { type: 'Receipt', id: receipt.receiptId }, payload: { ...receipt } }))
  const outcomeStatus = receipt.status === 'succeeded' ? 'succeeded' : receipt.status === 'failed' ? 'failed' : 'blocked'
  await append(ledger, event({ eventId: `evt_platform_outcome_${platformId}_${scenario}`, eventType: 'outcome.recorded', caseId, subject: { type: 'Outcome', id: `outcome_${platformId}_${scenario}` }, payload: { caseId, status: outcomeStatus, externalWrite: false, isSimulated: receipt.isSimulated, summary: receipt.status === 'succeeded' ? '本地平台内容预览完成，未发送平台请求' : `本地平台演示未执行：${receipt.failureCode ?? 'UNKNOWN'}` } }))
  const events = ledger.list({ tenantId: TENANT, correlationId: caseId })
  return { platformId, scenario, environment, caseId, approval, receipt, eventTypes: events.map(item => item.eventType), events, final: { outcomeStatus, externalWrite: false, isSimulated: receipt.isSimulated } }
}

function event(input: { readonly eventId: string; readonly eventType: string; readonly caseId: string; readonly subject: BusinessEvent['subject']; readonly payload: Record<string, unknown> }): BusinessEvent {
  return { eventId: input.eventId, eventType: input.eventType, tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND, subject: input.subject, payload: input.payload, source: { type: 'platform-sandbox-fixture', ref: input.eventId }, evidenceRefs: ['evidence_platform_fixture_v1'], confidence: 1, occurredAt: NOW, observedAt: NOW, correlationId: input.caseId, causationId: null, schemaVersion: SANDBOX_EVENT_VERSION }
}

async function append(ledger: EventLedger, input: BusinessEvent): Promise<void> {
  await ledger.append({ ...input, schemaVersion: 'event.v1' })
}
