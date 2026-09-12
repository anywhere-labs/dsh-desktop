import { describe, expect, it } from 'vitest'
import { CommerceOpsService } from '../src/host/commerce-ops-service.js'

describe('browser capture workflow', () => {
  it('maps browser-visible metrics into the shared evidence contract', async () => {
    const page = { url: () => 'http://127.0.0.1:4179/seller-metrics.html', evaluate: async () => ({ title: 'Mock 卖家后台', metrics: [{ name: '支付转化率', value: 0.047, unit: 'ratio' }, { name: 'GMV', value: 12880, unit: 'CNY' }], links: ['http://127.0.0.1:4179/products'] }) }
    const result = await new CommerceOpsService().captureBrowserPage(page, { userAuthorized: true, shopId: 'shop_001', period: { from: '2026-09-01', to: '2026-09-01' } })
    expect(result.metrics.map(item => item.metricId)).toEqual(['shop.conversion_rate', 'shop.gmv'])
    expect(result.evidence.kind).toBe('browser-visible-dom')
    expect(result.links).toHaveLength(1)
  })
})
