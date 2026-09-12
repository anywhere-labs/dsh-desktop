import { describe, expect, it } from 'vitest'
import { ApprovalService } from '../src/approvals/service.js'

describe('ApprovalService', () => {
  it('requires approval before a risky action can execute', () => {
    const service = new ApprovalService()
    const action = { actionId: 'act_001', actionType: 'update_price', riskLevel: 'L3' as const, target: { platform: 'mock', shopId: 'shop_001' }, payload: { price: 99 } }
    expect(() => service.assertExecutable(action)).toThrow('approval required')
    const approval = service.create(action, 'user_001')
    service.approve(approval.approvalId, 'manager_001')
    expect(() => service.assertExecutable({ ...action, approvalId: approval.approvalId })).not.toThrow()
  })

  it('lists pending approvals without exposing unrelated actions', () => {
    const service = new ApprovalService()
    service.create({ actionId: 'act_002', actionType: 'update_title', riskLevel: 'L2', target: { platform: 'mock', shopId: 'shop_001' }, payload: {} }, 'user_001')
    expect(service.list()).toHaveLength(1)
    expect(service.list()[0]?.status).toBe('pending')
  })

  it('rejects an approved id reused with a different action payload', () => {
    const service = new ApprovalService()
    const action = { actionId: 'act_003', actionType: 'update_price', riskLevel: 'L3' as const, target: { platform: 'mock', shopId: 'shop_001' }, payload: { price: 99 } }
    const approval = service.create(action, 'user_001')
    service.approve(approval.approvalId, 'manager_001')
    expect(() => service.assertExecutable({ ...action, payload: { price: 1 }, approvalId: approval.approvalId })).toThrow('payload does not match')
  })
})
