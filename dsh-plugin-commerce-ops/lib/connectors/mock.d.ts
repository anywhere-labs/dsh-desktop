import type { MetricSnapshot } from '../contracts/index.js';
export interface ShopMetricsQuery {
    readonly shopId: string;
    readonly from: string;
    readonly to: string;
}
export interface ShopMetricsResult {
    readonly shopId: string;
    readonly period: {
        readonly from: string;
        readonly to: string;
    };
    readonly metrics: readonly MetricSnapshot[];
}
export declare class MockCommerceConnector {
    getShopMetrics(query: ShopMetricsQuery): Promise<ShopMetricsResult>;
}
