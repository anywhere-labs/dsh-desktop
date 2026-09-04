import type { MetricSnapshot } from '../contracts/index.js'

export interface ShopMetricsQuery {
  readonly shopId: string
  readonly from: string
  readonly to: string
}

export interface ShopMetricsResult {
  readonly shopId: string
  readonly period: { readonly from: string; readonly to: string }
  readonly metrics: readonly MetricSnapshot[]
}

export class MockCommerceConnector {
  async getShopMetrics(query: ShopMetricsQuery): Promise<ShopMetricsResult> {
    const source = (metricId: string) => ({
      metricId,
      value: {
        'shop.gmv': 12880,
        'shop.paid_orders': 146,
        'shop.unique_visitors': 3100,
        'shop.conversion_rate': 0.047,
        'shop.average_order_value': 88.22,
      }[metricId] ?? 0,
      unit: metricId.endsWith('rate') ? 'ratio' : metricId.endsWith('gmv') || metricId.endsWith('value') ? 'CNY' : 'count',
      period: { from: query.from, to: query.to },
      source: { platform: 'mock', shopId: query.shopId, evidenceId: `mock:${query.shopId}:${query.from}:${metricId}` },
    })

    return {
      shopId: query.shopId,
      period: { from: query.from, to: query.to },
      metrics: ['shop.gmv', 'shop.paid_orders', 'shop.unique_visitors', 'shop.conversion_rate', 'shop.average_order_value'].map(metricId => source(metricId)),
    }
  }
}
