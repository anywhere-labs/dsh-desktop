import { describe, expect, it } from 'vitest'
import { actionProposalSchema, metricSnapshotSchema } from '../src/contracts/index.js'

describe('commerce operations contracts', () => {
  it('accepts a traceable metric snapshot', () => {
    const result = metricSnapshotSchema.safeParse({
      metricId: 'shop.conversion_rate',
      value: 0.047,
      unit: 'ratio',
      period: { from: '2026-09-01', to: '2026-09-01' },
      source: { platform: 'mock', shopId: 'shop_001', evidenceId: 'ev_001' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an execution proposal without approval for risky actions', () => {
    const result = actionProposalSchema.safeParse({
      actionId: 'act_001',
      actionType: 'update_price',
      riskLevel: 'L3',
      target: { platform: 'mock', shopId: 'shop_001', productId: 'p_001' },
      payload: { price: 99 },
    })
    expect(result.success).toBe(false)
  })
})
