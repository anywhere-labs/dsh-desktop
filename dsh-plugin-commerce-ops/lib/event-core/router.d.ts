import type { BusinessEvent } from './contracts.js';
import { EventLedger } from './ledger.js';
export type EventRoute = {
    readonly eventType: string;
    readonly agentId: string;
    readonly riskLevel: 'low' | 'medium' | 'high';
    readonly humanGate: boolean;
};
export declare class EventRouter {
    private readonly ledger;
    private readonly routes;
    constructor(ledger: EventLedger);
    register(route: EventRoute, handler: (event: BusinessEvent) => void | Promise<void>): void;
    routesFor(eventType: string): readonly EventRoute[];
}
