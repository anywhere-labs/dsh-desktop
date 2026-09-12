import type { MetricSnapshot } from '../contracts/index.js';
export declare function normalizeShopMetric(raw: {
    readonly name: string;
    readonly value: string | number;
    readonly unit: string;
    readonly evidenceId: string;
}, context: {
    readonly platform: string;
    readonly shopId: string;
    readonly period: {
        readonly from: string;
        readonly to: string;
    };
}): MetricSnapshot;
