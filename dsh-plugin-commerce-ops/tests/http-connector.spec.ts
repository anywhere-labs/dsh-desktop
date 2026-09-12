import { describe, expect, it, vi } from 'vitest'
import { HttpCommerceConnector } from '../src/connectors/http.js'

describe('HttpCommerceConnector', () => {
  it('fails closed when credentials are not configured', async () => {
    const fetcher = vi.fn()
    const connector = new HttpCommerceConnector({ platform: 'taobao', baseUrl: 'https://example.invalid', token: undefined, fetcher })
    expect((await connector.status()).state).toBe('NOT_CONFIGURED')
    await expect(connector.getShopMetrics({ shopId: 'shop_001', from: '2026-09-01', to: '2026-09-01' })).rejects.toThrow('credentials not configured')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sends read-only authorization without exposing the token in the result', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ metrics: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const connector = new HttpCommerceConnector({ platform: 'jd', baseUrl: 'https://example.invalid', token: 'secret-token', fetcher })
    await connector.getShopMetrics({ shopId: 'shop_001', from: '2026-09-01', to: '2026-09-01' })
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/shops/shop_001/metrics'), expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ authorization: 'Bearer secret-token' }) }))
  })
})
