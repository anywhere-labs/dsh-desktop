import type { ShopMetricsQuery, ShopMetricsResult } from './mock.js';
export interface ConnectorStatus {
    readonly platform: string;
    readonly state: 'READY' | 'NOT_CONFIGURED';
    readonly capabilities: {
        readonly read: true;
        readonly write: false;
    };
}
export interface HttpCommerceConnectorOptions {
    readonly platform: string;
    readonly baseUrl: string;
    readonly token: string | undefined;
    readonly fetcher?: typeof fetch;
}
export declare class HttpCommerceConnector {
    private readonly options;
    private readonly fetcher;
    constructor(options: HttpCommerceConnectorOptions);
    status(): ConnectorStatus;
    getShopMetrics(query: ShopMetricsQuery): Promise<ShopMetricsResult>;
}
