export class HttpCommerceConnector {
    options;
    fetcher;
    constructor(options) {
        this.options = options;
        this.fetcher = options.fetcher ?? fetch;
    }
    status() {
        return { platform: this.options.platform, state: this.options.token ? 'READY' : 'NOT_CONFIGURED', capabilities: { read: true, write: false } };
    }
    async getShopMetrics(query) {
        if (!this.options.token)
            throw new Error(`${this.options.platform}: credentials not configured`);
        const url = new URL(`/shops/${encodeURIComponent(query.shopId)}/metrics`, this.options.baseUrl);
        url.searchParams.set('from', query.from);
        url.searchParams.set('to', query.to);
        const response = await this.fetcher(url.href, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${this.options.token}` } });
        if (!response.ok)
            throw new Error(`${this.options.platform}: read metrics failed with HTTP ${String(response.status)}`);
        const body = await response.json();
        return { shopId: query.shopId, period: { from: query.from, to: query.to }, metrics: body.metrics ?? [] };
    }
}
