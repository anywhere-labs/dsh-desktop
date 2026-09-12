import { businessEventSchema } from './contracts.js';
export class EventLedger {
    store;
    events = [];
    handlers = new Map();
    constructor(store) {
        this.store = store;
        this.events.push(...(store?.read() ?? []));
    }
    subscribe(eventType, handler) {
        const list = this.handlers.get(eventType) ?? [];
        list.push(handler);
        this.handlers.set(eventType, list);
        return () => {
            const current = this.handlers.get(eventType) ?? [];
            this.handlers.set(eventType, current.filter(item => item !== handler));
        };
    }
    async append(input) {
        const event = businessEventSchema.parse(input);
        if (this.events.some(item => item.eventId === event.eventId))
            return event;
        this.store?.append(event);
        this.events.push(event);
        const handlers = [...(this.handlers.get(event.eventType) ?? []), ...(this.handlers.get('*') ?? [])];
        await Promise.all(handlers.map(handler => handler(event)));
        return event;
    }
    list(filter) {
        return this.events.filter(event => (!filter?.tenantId || event.tenantId === filter.tenantId) && (!filter?.correlationId || event.correlationId === filter.correlationId));
    }
}
