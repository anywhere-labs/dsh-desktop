import { describe, expect, it } from 'vitest'
import { normalizeShopMetric } from '../src/connectors/field-mapping.js'

describe('platform field mapping', () => {
  it('normalizes a platform metric into the shared contract', () => {
    const metric = normalizeShopMetric({ name: '支付转化率', value: '0.047', unit: 'ratio', evidenceId: 'official-response-1' }, { platform: 'taobao', shopId: 'shop_001', period: { from: '2026-09-01', to: '2026-09-01' } })
    expect(metric).toMatchObject({ metricId: 'shop.conversion_rate', value: 0.047, source: { platform: 'taobao', evidenceId: 'official-response-1' } })
  })
})
