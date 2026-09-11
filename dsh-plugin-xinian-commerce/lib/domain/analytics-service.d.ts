export declare class AnalyticsService {
    overview(): {
        source: string;
        cached: boolean;
        updatedAt: string;
        metrics: {
            label: string;
            value: number;
        }[];
    };
}
