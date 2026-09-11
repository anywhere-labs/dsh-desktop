import { AgentRuntime } from '../runtime/agent-runtime.js';
import { EventStore } from '../runtime/event-store.js';
import { TaskStore } from '../runtime/control-plane.js';
import { ProductService } from '../domain/product-service.js';
import { ContentService } from '../domain/content-service.js';
import { PublishService } from '../domain/publish-service.js';
import { AnalyticsService } from '../domain/analytics-service.js';
export declare class XinianService {
    readonly events: EventStore;
    readonly tasks: TaskStore;
    readonly runtime: AgentRuntime;
    readonly products: ProductService;
    readonly content: ContentService;
    readonly publish: PublishService;
    readonly analytics: AnalyticsService;
    health(): {
        status: string;
        mode: string;
        plugin: string;
        version: string;
    };
    dashboard(): {
        products: number;
        source: string;
        cached: boolean;
        updatedAt: string;
        metrics: {
            label: string;
            value: number;
        }[];
    };
}
