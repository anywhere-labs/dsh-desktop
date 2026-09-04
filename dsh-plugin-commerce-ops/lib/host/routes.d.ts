import type { IncomingMessage, ServerResponse } from 'node:http';
import { CommerceOpsService } from './commerce-ops-service.js';
export interface CommerceWebServer {
    readonly port: number;
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
export declare function registerCommerceOpsRoutes(webServer: CommerceWebServer, service?: CommerceOpsService): () => void;
export declare function registerCommerceOpsWorkbenchPage(webServer: CommerceWebServer): () => void;
