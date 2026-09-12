import { describe, expect, it } from 'vitest'
import { ApprovalService } from '../src/approvals/service.js'
import {
  createSandboxActionProposal,
  platformConnectorCatalog,
  PlatformSandboxGateway,
  runPlatformSandboxDemo,
} from '../src/connectors/sandbox/index.js'

describe('Douyin and Xiaohongshu platform sandbox layer', () => {
  it('defines versioned connector capabilities without storing credentials', () => {
    expect(platformConnectorCatalog.map(item => item.platformId)).toEqual(['douyin', 'xiaohongshu'])
    for (const connector of platformConnectorCatalog) {
      expect(connector.contractVersion).toBe('commerce.connector.v1')
      expect(connector.credentialStorage).toBe('external_reference_only')
      expect(connector.officialSandboxStatus).toBe('NOT_VERIFIED_LOCAL_DEMO_ONLY')
      expect(connector.forbiddenActions).toContain('production_write')
      expect(connector.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('runs an approved demo preview through the existing mock action boundary', () => {
    const approvals = new ApprovalService()
    const action = createSandboxActionProposal({ platformId: 'douyin', capability: 'preview_product_content', actionId: 'act_douyin_preview_001', idempotencyKey: 'idem_douyin_preview_001' })
    const approval = approvals.create(action, 'platform-agent', 'approval_douyin_preview_001')
    approvals.approve(approval.approvalId, 'human_platform_owner_001')
    const gateway = new PlatformSandboxGateway(approvals)
    const receipt = gateway.execute({ platformId: 'douyin', environment: 'demo', capability: 'preview_product_content', credentialRef: 'credref_demo_douyin', idempotencyKey: 'idem_douyin_preview_001', actionProposal: { ...action, approvalId: approval.approvalId }, payload: { productId: 'product_001' } })
    expect(receipt).toMatchObject({ status: 'succeeded', platformId: 'douyin', environment: 'demo', externalWrite: false, isSimulated: true })
    expect(receipt.output).toMatchObject({ preview: true })
    expect(gateway.execute({ platformId: 'douyin', environment: 'demo', capability: 'preview_product_content', credentialRef: 'credref_demo_douyin', idempotencyKey: 'idem_douyin_preview_001', actionProposal: { ...action, approvalId: approval.approvalId }, payload: { productId: 'product_001' } })).toEqual(receipt)
  })

  it('fails closed for production, missing credentials, and unavailable demo capability', () => {
    const gateway = new PlatformSandboxGateway(new ApprovalService())
    const action = createSandboxActionProposal({ platformId: 'xiaohongshu', capability: 'preview_product_content', actionId: 'act_xhs_preview_001', idempotencyKey: 'idem_xhs_preview_001' })
    const request = { platformId: 'xiaohongshu' as const, environment: 'production' as const, capability: 'preview_product_content' as const, credentialRef: 'credref_xhs', idempotencyKey: 'idem_xhs_preview_001', actionProposal: { ...action, approvalId: 'approval_missing' }, payload: { productId: 'product_001' } }
    expect(gateway.execute(request)).toMatchObject({ status: 'blocked', failureCode: 'PRODUCTION_DISABLED', externalWrite: false })
    expect(gateway.execute({ ...request, environment: 'demo', credentialRef: undefined })).toMatchObject({ status: 'blocked', failureCode: 'CREDENTIAL_REF_MISSING', isSimulated: true })
    expect(gateway.execute({ ...request, environment: 'demo', credentialRef: 'credref_xhs', scenario: 'rate_limited' })).toMatchObject({ status: 'failed', failureCode: 'RATE_LIMITED', isSimulated: true, externalWrite: false })
  })

  it('runs deterministic Douyin and Xiaohongshu approval-chain fixtures', async () => {
    const douyin = await runPlatformSandboxDemo('douyin', 'success')
    expect(douyin.eventTypes).toEqual(['platform.action.requested', 'approval.requested', 'approval.approved', 'action.execution.started', 'action.receipt.received', 'outcome.recorded'])
    expect(douyin.receipt).toMatchObject({ status: 'succeeded', isSimulated: true, externalWrite: false })
    const xiaohongshu = await runPlatformSandboxDemo('xiaohongshu', 'approval_rejected')
    expect(xiaohongshu.receipt).toMatchObject({ status: 'blocked', failureCode: 'APPROVAL_REJECTED', isSimulated: true, externalWrite: false })
    expect(xiaohongshu.final.outcomeStatus).toBe('blocked')
  })
})
