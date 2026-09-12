import { describe, expect, it } from 'vitest'
import { BrowserAcquisitionAgent } from '../src/browser-acquisition/agent.js'

describe('BrowserAcquisitionAgent', () => {
  it('produces one evidence-backed acquisition bundle for parallel analysis', async () => {
    const page = { url: () => 'http://127.0.0.1:4179/seller-metrics.html', evaluate: async () => ({ title: 'Mock 卖家后台', metrics: [{ name: 'GMV', value: 12880, unit: 'CNY' }], links: ['/products'] }) }
    const result = await new BrowserAcquisitionAgent().capture(page, { userAuthorized: true, platform: 'taobao', shopId: 'shop_001', period: { from: '2026-09-01', to: '2026-09-01' } })
    expect(result.status).toBe('ready')
    expect(result.bundle.source.kind).toBe('browser')
    expect(result.bundle.evidence.length).toBe(1)
    expect(result.bundle.metrics[0]?.metricId).toBe('shop.gmv')
  })
})
