import { describe, expect, it } from 'vitest'
import { EventLedger } from '../src/event-core/ledger.js'
import { EventRouter } from '../src/event-core/router.js'
import { CaseStore } from '../src/event-core/cases.js'
import { ApprovalService } from '../src/approvals/service.js'
import { MockActionExecutor } from '../src/actions/mock-executor.js'
import { buildAgentSpaceSnapshot } from '../src/event-core/space.js'
import { PermissionService, ResponsibilityService } from '../src/governance/service.js'

describe('enterprise-agent-runtime (domain-agnostic)', () => {
  it('runs a generic event -> case -> approval -> execution -> projection chain without domain code', async () => {
    const ledger = new EventLedger()
    const cases = new CaseStore()
    const router = new EventRouter(ledger)
    const approvals = new ApprovalService({ ledger, tenantId: 'tenant_x', enterpriseId: 'ent_x', brandId: 'brand_x' })
    const executor = new MockActionExecutor(approvals)

    const event = { eventId: 'evt_runtime_001', eventType: 'signal.price.changed', tenantId: 'tenant_x', enterpriseId: 'ent_x', brandId: 'brand_x', subject: { type: 'product', id: 'p1' }, payload: { platform: 'mock' }, source: { type: 'connector', ref: 'src' }, evidenceRefs: ['ev_1'], confidence: 0.8, occurredAt: '2026-09-04T10:00:00+08:00', observedAt: '2026-09-04T10:00:00+08:00', correlationId: 'case_x', causationId: null, schemaVersion: 'event.v1' } as const
    router.register({ eventType: 'signal.price.changed', agentId: 'coordinator', riskLevel: 'low', humanGate: false }, e => { cases.createFromEvent(e, 'generic case') })
    await ledger.append(event)
    expect(cases.require('case_x').status).toBe('OPEN')

    const action = { actionId: 'act_1', actionType: 'test', riskLevel: 'L3' as const, target: { platform: 'mock', shopId: 'shop_1' }, payload: {} }
    const approval = approvals.create(action, 'requester')
    approvals.approve(approval.approvalId, 'user_a')
    const receipt = executor.execute({ ...action, approvalId: approval.approvalId })
    expect(receipt.status).toBe('succeeded')
    expect(receipt.externalWrite).toBe(false)

    // responsibility transfer requires permission
    const perms = new PermissionService()
    perms.registerMember('user_a', 'tenant_x', ['transfer_responsibility', 'accept_responsibility'])
    const resp = new ResponsibilityService({ ledger, tenantId: 'tenant_x', enterpriseId: 'ent_x', brandId: 'brand_x' }, perms)
    resp.transfer('case_x', 'user_a', 'user_b')
  })
})
