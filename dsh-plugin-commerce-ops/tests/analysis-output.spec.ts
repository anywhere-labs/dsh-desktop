import { describe, expect, it } from 'vitest'
import { AnalysisService } from '../src/analysis/service.js'

describe('AnalysisService', () => {
  it('turns an acquisition bundle into dashboard cards and a human-readable insight', () => {
    const result = new AnalysisService().analyze({ acquisitionId: 'acq_001', metrics: [{ metricId: 'shop.gmv', value: 12880, unit: 'CNY', source: { platform: 'taobao', shopId: 'shop_001', evidenceId: 'ev_gmv' } }, { metricId: 'shop.conversion_rate', value: 0.047, unit: 'ratio', source: { platform: 'taobao', shopId: 'shop_001', evidenceId: 'ev_conversion' } }], source: { kind: 'browser', platform: 'taobao', pageUrl: 'https://seller.example.invalid', capturedAt: '2026-09-02T00:00:00Z' } } as never)
    expect(result.dashboard.cards.map(card => card.metricId)).toEqual(['shop.gmv', 'shop.conversion_rate'])
    expect(result.insight.status).toBe('ready_for_human_review')
    expect(result.insight.evidenceIds).toContain('acq_001')
  })
})
