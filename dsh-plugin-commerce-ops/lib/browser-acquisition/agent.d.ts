import type { CapturePage } from '../connectors/browser-capture.js';
import type { AcquisitionBundle } from './contracts.js';
export declare class BrowserAcquisitionAgent {
    private readonly captureSkill;
    capture(page: CapturePage, options: {
        readonly userAuthorized: boolean;
        readonly platform: string;
        readonly shopId: string;
        readonly period: {
            readonly from: string;
            readonly to: string;
        };
    }): Promise<{
        readonly status: 'ready';
        readonly bundle: AcquisitionBundle;
    }>;
}
