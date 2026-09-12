import type { ShopMetricsQuery, ShopMetricsResult } from './mock.js'

export interface ConnectorStatus {
  readonly platform: string
  readonly state: 'READY' | 'NOT_CONFIGURED'
  readonly capabilities: { readonly read: true; readonly write: false }
}

export interface HttpCommerceConnectorOptions {
  readonly platform: string
  readonly baseUrl: string
  readonly token: string | undefined
  readonly fetcher?: typeof fetch
}

export class HttpCommerceConnector {
  private readonly fetcher: typeof fetch

  constructor(private readonly options: HttpCommerceConnectorOptions) {
    this.fetcher = options.fetcher ?? fetch
  }

  status(): ConnectorStatus {
    return { platform: this.options.platform, state: this.options.token ? 'READY' : 'NOT_CONFIGURED', capabilities: { read: true, write: false } }
  }

  async getShopMetrics(query: ShopMetricsQuery): Promise<ShopMetricsResult> {
    if (!this.options.token) throw new Error(`${this.options.platform}: credentials not configured`)
    const url = new URL(`/shops/${encodeURIComponent(query.shopId)}/metrics`, this.options.baseUrl)
    url.searchParams.set('from', query.from)
    url.searchParams.set('to', query.to)
    const response = await this.fetcher(url.href, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${this.options.token}` } })
    if (!response.ok) throw new Error(`${this.options.platform}: read metrics failed with HTTP ${String(response.status)}`)
    const body = await response.json() as { metrics?: ShopMetricsResult['metrics'] }
    return { shopId: query.shopId, period: { from: query.from, to: query.to }, metrics: body.metrics ?? [] }
  }
}
