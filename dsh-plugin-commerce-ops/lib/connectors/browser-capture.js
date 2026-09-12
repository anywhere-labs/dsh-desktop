export class BrowserCapture {
    async capture(page, options = {}) {
        if (options.userAuthorized !== true)
            throw new Error('browser capture authorization required');
        const pageUrl = page.url();
        const visible = await page.evaluate(() => {
            const metrics = [...document.querySelectorAll('[data-commerce-metric]')].map(element => ({ name: element.getAttribute('data-name') ?? element.textContent?.trim() ?? '', value: Number(element.getAttribute('data-value') ?? '0'), unit: element.getAttribute('data-unit') ?? 'count' }));
            return { title: document.title, metrics, links: [...document.querySelectorAll('a[href]')].map(element => element.href).filter(Boolean) };
        });
        return { pageUrl, title: visible.title, metrics: visible.metrics, links: visible.links, source: { kind: 'browser-visible-dom', capturedAt: new Date().toISOString() }, capabilities: { read: true, write: false } };
    }
}
