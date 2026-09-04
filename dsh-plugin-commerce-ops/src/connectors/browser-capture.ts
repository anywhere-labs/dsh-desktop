export interface CapturePage {
  readonly url: () => string
  readonly evaluate: <T>(pageFunction: () => T) => Promise<T>
}

export interface BrowserCaptureResult {
  readonly pageUrl: string
  readonly title: string
  readonly metrics: readonly { readonly name: string; readonly value: string | number; readonly unit: string }[]
  readonly links: readonly string[]
  readonly source: { readonly kind: 'browser-visible-dom'; readonly capturedAt: string }
  readonly capabilities: { readonly read: true; readonly write: false }
}

export class BrowserCapture {
  async capture(page: CapturePage, options: { readonly userAuthorized?: boolean } = {}): Promise<BrowserCaptureResult> {
    if (options.userAuthorized !== true) throw new Error('browser capture authorization required')
    const pageUrl = page.url()
    const visible = await page.evaluate(() => {
      const metrics = [...document.querySelectorAll('[data-commerce-metric]')].map(element => ({ name: element.getAttribute('data-name') ?? element.textContent?.trim() ?? '', value: Number(element.getAttribute('data-value') ?? '0'), unit: element.getAttribute('data-unit') ?? 'count' }))
      return { title: document.title, metrics, links: [...document.querySelectorAll('a[href]')].map(element => (element as HTMLAnchorElement).href).filter(Boolean) }
    })
    return { pageUrl, title: visible.title, metrics: visible.metrics, links: visible.links, source: { kind: 'browser-visible-dom', capturedAt: new Date().toISOString() }, capabilities: { read: true, write: false } }
  }
}
