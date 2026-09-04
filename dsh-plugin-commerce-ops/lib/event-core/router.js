export class EventRouter {
    ledger;
    routes = [];
    constructor(ledger) {
        this.ledger = ledger;
    }
    register(route, handler) {
        this.routes.push(route);
        this.ledger.subscribe(route.eventType, handler);
    }
    routesFor(eventType) {
        return this.routes.filter(route => route.eventType === eventType);
    }
}
