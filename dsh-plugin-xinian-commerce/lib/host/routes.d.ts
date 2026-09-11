import type { IncomingMessage, ServerResponse } from 'node:http';
import { XinianService } from './service.js';
export interface XinianWebServer {
    readonly port: number;
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
export declare function registerXinianRoutes(server: XinianWebServer, service?: XinianService): () => void;
export declare function registerXinianWorkbench(server: XinianWebServer): () => void;
