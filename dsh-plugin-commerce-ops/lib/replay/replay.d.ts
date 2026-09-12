import type { MetricSnapshot } from '../contracts/index.js';
export interface ShopMetricReplayFixture {
    readonly platform: string;
    readonly shopId: string;
    readonly period: {
        readonly from: string;
        readonly to: string;
    };
    readonly response: {
        readonly data: readonly {
            readonly name: string;
            readonly value: string | number;
            readonly unit: string;
        }[];
    };
}
export declare function replayShopMetrics(fixture: ShopMetricReplayFixture): {
    readonly metrics: readonly MetricSnapshot[];
    readonly replay: {
        readonly replayed: true;
        readonly source: 'redacted-fixture';
    };
};
