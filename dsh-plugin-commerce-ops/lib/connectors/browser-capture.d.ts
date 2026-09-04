export interface CapturePage {
    readonly url: () => string;
    readonly evaluate: <T>(pageFunction: () => T) => Promise<T>;
}
export interface BrowserCaptureResult {
    readonly pageUrl: string;
    readonly title: string;
    readonly metrics: readonly {
        readonly name: string;
        readonly value: string | number;
        readonly unit: string;
    }[];
    readonly links: readonly string[];
    readonly source: {
        readonly kind: 'browser-visible-dom';
        readonly capturedAt: string;
    };
    readonly capabilities: {
        readonly read: true;
        readonly write: false;
    };
}
export declare class BrowserCapture {
    capture(page: CapturePage, options?: {
        readonly userAuthorized?: boolean;
    }): Promise<BrowserCaptureResult>;
}
