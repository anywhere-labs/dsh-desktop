import { describe, expect, it } from 'vitest'
import { BrowserCapture } from '../src/connectors/browser-capture.js'

describe('BrowserCapture', () => {
  it('captures visible same-page metrics and links without browser writes', async () => {
    const page = { url: () => 'https://seller.example.invalid/shop/001', evaluate: async () => ({ title: '店铺经营', metrics: [{ name: '支付转化率', value: 0.047, unit: 'ratio' }], links: ['https://seller.example.invalid/shop/001/products'] }) }
    const result = await new BrowserCapture().capture(page, { userAuthorized: true })
    expect(result.source.kind).toBe('browser-visible-dom')
    expect(result.metrics[0]?.name).toBe('支付转化率')
    expect(result.links).toHaveLength(1)
    expect(result.capabilities.write).toBe(false)
  })

  it('rejects a page that is not user-authorized for capture', async () => {
    const page = { url: () => 'https://seller.example.invalid', evaluate: async () => ({ title: '登录', metrics: [], links: [] }) }
    await expect(new BrowserCapture().capture(page, { userAuthorized: false })).rejects.toThrow('browser capture authorization required')
  })
})
