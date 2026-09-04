import { describe, expect, it } from 'vitest'
import { ApprovalService } from '../src/approvals/service.js'
import { MockActionExecutor } from '../src/actions/mock-executor.js'

describe('MockActionExecutor', () => {
  it('executes an approved mock action without external writes', () => {
    const approvals = new ApprovalService()
    const executor = new MockActionExecutor(approvals)
    const action = { actionId: 'act_001', actionType: 'create_test', riskLevel: 'L3' as const, target: { platform: 'mock', shopId: 'shop_001' }, payload: { durationDays: 7 } }
    const approval = approvals.create(action, 'agent_001')
    approvals.approve(approval.approvalId, 'human_001')
    expect(executor.execute({ ...action, approvalId: approval.approvalId })).toMatchObject({ status: 'succeeded', mode: 'mock', externalWrite: false })
  })

  it('refuses non-mock targets even when an approval exists', () => {
    const approvals = new ApprovalService()
    const executor = new MockActionExecutor(approvals)
    const action = { actionId: 'act_002', actionType: 'update_price', riskLevel: 'L3' as const, target: { platform: 'real-platform', shopId: 'shop_001' }, payload: { price: 52 } }
    const approval = approvals.create(action, 'agent_001')
    approvals.approve(approval.approvalId, 'human_001')
    expect(() => executor.execute({ ...action, approvalId: approval.approvalId })).toThrow('refuses non-mock targets')
  })
})
