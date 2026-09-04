import { type BusinessEvent } from './contracts.js';
export type EventHandler = (event: BusinessEvent) => void | Promise<void>;
export interface EventStore {
    read(): readonly BusinessEvent[];
    append(event: BusinessEvent): void;
}
export declare class EventLedger {
    private readonly store?;
    private readonly events;
    private readonly handlers;
    constructor(store?: EventStore | undefined);
    subscribe(eventType: string, handler: EventHandler): () => void;
    append(input: BusinessEvent): Promise<BusinessEvent>;
    list(filter?: {
        readonly tenantId?: string;
        readonly correlationId?: string;
    }): readonly BusinessEvent[];
}
