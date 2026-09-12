import { describe, expect, it } from 'vitest'
import { replayShopMetrics } from '../src/replay/replay.js'

describe('shop metric replay', () => {
  it('replays a redacted response into normalized metrics', () => {
    const result = replayShopMetrics({ platform: 'taobao', shopId: 'shop_001', period: { from: '2026-09-01', to: '2026-09-01' }, response: { data: [{ name: '支付转化率', value: 0.047, unit: 'ratio' }] } })
    expect(result.metrics[0]?.metricId).toBe('shop.conversion_rate')
    expect(result.replay.replayed).toBe(true)
    expect(result.replay.source).toBe('redacted-fixture')
  })
})
