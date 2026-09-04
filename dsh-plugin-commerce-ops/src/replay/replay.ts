import { normalizeShopMetric } from '../connectors/field-mapping.js'
import type { MetricSnapshot } from '../contracts/index.js'

export interface ShopMetricReplayFixture {
  readonly platform: string
  readonly shopId: string
  readonly period: { readonly from: string; readonly to: string }
  readonly response: { readonly data: readonly { readonly name: string; readonly value: string | number; readonly unit: string }[] }
}

export function replayShopMetrics(fixture: ShopMetricReplayFixture): { readonly metrics: readonly MetricSnapshot[]; readonly replay: { readonly replayed: true; readonly source: 'redacted-fixture' } } {
  return { metrics: fixture.response.data.map((item, index) => normalizeShopMetric({ ...item, evidenceId: `replay:${fixture.platform}:${fixture.shopId}:${String(index + 1)}` }, fixture)), replay: { replayed: true, source: 'redacted-fixture' } }
}
