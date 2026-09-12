export class HumanDecisionService {
    eventContext;
    constructor(eventContext) {
        this.eventContext = eventContext;
    }
    record(decision) {
        if (this.eventContext) {
            const now = new Date().toISOString();
            void this.eventContext.ledger.append({ eventId: `human.decision.recorded:${decision.insightId}:${decision.decidedBy}`, eventType: 'human.decision.recorded', tenantId: this.eventContext.tenantId, enterpriseId: this.eventContext.enterpriseId, brandId: this.eventContext.brandId, subject: { type: 'insight', id: decision.insightId }, payload: { ...decision }, source: { type: 'human_decision_service', ref: decision.insightId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: decision.insightId, causationId: null, schemaVersion: 'event.v1' });
        }
        return { status: 'recorded', decision, externalActionExecuted: false };
    }
}
