import { describe, expect, it } from 'vitest'
import { MockCommerceConnector } from '../src/connectors/mock.js'

describe('MockCommerceConnector', () => {
  it('returns deterministic shop metrics with evidence metadata', async () => {
    const result = await new MockCommerceConnector().getShopMetrics({
      shopId: 'shop_001',
      from: '2026-09-01',
      to: '2026-09-01',
    })
    expect(result.shopId).toBe('shop_001')
    expect(result.metrics.length).toBeGreaterThan(3)
    expect(result.metrics.every(metric => metric.source.evidenceId)).toBe(true)
  })
})
