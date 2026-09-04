import type { AcquisitionBundle } from '../browser-acquisition/contracts.js';
export declare class AnalysisService {
    analyze(bundle: Pick<AcquisitionBundle, 'acquisitionId' | 'metrics' | 'source'>): {
        readonly dashboard: {
            readonly cards: readonly {
                readonly metricId: string;
                readonly value: number;
                readonly unit: string;
            }[];
            readonly charts: readonly {
                readonly type: 'trend';
                readonly metricId: string;
                readonly points: readonly {
                    readonly label: string;
                    readonly value: number;
                }[];
            }[];
        };
        readonly insight: {
            readonly status: 'ready_for_human_review';
            readonly conclusion: string;
            readonly evidenceIds: readonly string[];
        };
    };
}
