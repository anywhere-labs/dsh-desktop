import type { AcquisitionBundle } from '../browser-acquisition/contracts.js';
export type AnalysisSubscriber = (bundle: AcquisitionBundle) => void | Promise<void>;
export declare class ParallelBus {
    private readonly subscribers;
    subscribe(subscriber: AnalysisSubscriber): () => void;
    publish(bundle: AcquisitionBundle): Promise<{
        readonly delivered: number;
        readonly failures: readonly string[];
    }>;
}
