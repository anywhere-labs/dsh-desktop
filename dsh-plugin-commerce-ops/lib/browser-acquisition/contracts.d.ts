import type { MetricSnapshot } from '../contracts/index.js';
export interface AcquisitionBundle {
    readonly acquisitionId: string;
    readonly source: {
        readonly kind: 'browser';
        readonly platform: string;
        readonly pageUrl: string;
        readonly capturedAt: string;
    };
    readonly metrics: readonly MetricSnapshot[];
    readonly links: readonly string[];
    readonly evidence: readonly {
        readonly kind: 'browser-visible-dom';
        readonly pageUrl: string;
        readonly capturedAt: string;
    }[];
    readonly quality: {
        readonly status: 'passed' | 'blocked';
        readonly unmappedFields: readonly string[];
    };
}
