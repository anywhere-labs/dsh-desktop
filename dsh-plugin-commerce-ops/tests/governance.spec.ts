import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApprovalService } from '../src/approvals/service.js'
import { EventLedger } from '../src/event-core/ledger.js'
import { JsonlEventStore } from '../src/event-core/persistence.js'
import { NotificationService, PermissionService, ResponsibilityService, SlaService } from '../src/governance/service.js'

function context(filePath: string) {
  return { ledger: new EventLedger(new JsonlEventStore(filePath)), tenantId: 'tenant_a', enterpriseId: 'enterprise_a', brandId: 'brand_a' }
}

describe('event-backed governance', () => {
  it('rebuilds approval state from approval events after restart', () => {
    const filePath = join(mkdtempSync(join(tmpdir(), 'commerce-approval-')), 'events.jsonl')
    const firstContext = context(filePath)
    const action = { actionId: 'act_approval_001', actionType: 'create_test', riskLevel: 'L3' as const, target: { platform: 'mock', shopId: 'shop_001' }, payload: {} }
    const first = new ApprovalService(firstContext)
    const record = first.create(action, 'user_001')
    first.approve(record.approvalId, 'manager_001')
    const restored = new ApprovalService(context(filePath))
    expect(restored.list()[0]).toMatchObject({ approvalId: record.approvalId, status: 'approved', approverId: 'manager_001' })
  })

  it('enforces tenant role permissions for responsibility transfer', () => {
    const permissions = new PermissionService()
    permissions.registerMember('manager', 'tenant_a', ['transfer_responsibility'])
    permissions.registerMember('operator', 'tenant_a', ['accept_responsibility'])
    const responsibility = new ResponsibilityService(context(join(mkdtempSync(join(tmpdir(), 'commerce-responsibility-')), 'events.jsonl')), permissions)
    expect(responsibility.transfer('case_001', 'manager', 'operator')).toMatchObject({ caseId: 'case_001', ownerId: 'operator', status: 'CLAIMED' })
    expect(() => responsibility.transfer('case_002', 'operator', 'manager')).toThrow('permission_denied:transfer_responsibility')
  })

  it('escalates an overdue SLA through a notification event', () => {
    const serviceContext = context(join(mkdtempSync(join(tmpdir(), 'commerce-sla-')), 'events.jsonl'))
    const notifications = new NotificationService(serviceContext)
    const sla = new SlaService(serviceContext, notifications)
    const start = new Date('2026-09-04T10:00:00Z')
    sla.start('case_003', 'operator', 60_000, start)
    expect(sla.evaluate(new Date('2026-09-04T10:02:00Z'))[0]).toMatchObject({ caseId: 'case_003', status: 'ESCALATED' })
    expect(notifications.list()[0]).toMatchObject({ kind: 'sla.escalation', caseId: 'case_003', recipientId: 'operator' })
    expect(serviceContext.ledger.list().map(event => event.eventType)).toContain('notification.requested')
  })
})
