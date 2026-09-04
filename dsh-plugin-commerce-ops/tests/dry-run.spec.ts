import { describe, expect, it } from 'vitest'
import { CommerceOpsService } from '../src/host/commerce-ops-service.js'

describe('CommerceOpsService dry run', () => {
  it('returns policy findings without executing a platform write', () => {
    const result = new CommerceOpsService().dryRun({ title: '全网第一的产品', price: 99 })
    expect(result.executed).toBe(false)
    expect(result.policy.status).toBe('blocked')
  })
})
