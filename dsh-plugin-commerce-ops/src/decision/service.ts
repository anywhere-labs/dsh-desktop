export interface HumanDecision {
  readonly insightId: string
  readonly decision: 'accept' | 'modify' | 'reject'
  readonly decidedBy: string
  readonly note?: string
}

export class HumanDecisionService {
  constructor(private readonly eventContext?: { readonly ledger: EventLedger; readonly tenantId: string; readonly enterpriseId: string; readonly brandId: string }) {}

  record(decision: HumanDecision): { readonly status: 'recorded'; readonly decision: HumanDecision; readonly externalActionExecuted: false } {
    if (this.eventContext) {
      const now = new Date().toISOString()
      void this.eventContext.ledger.append({ eventId: `human.decision.recorded:${decision.insightId}:${decision.decidedBy}`, eventType: 'human.decision.recorded', tenantId: this.eventContext.tenantId, enterpriseId: this.eventContext.enterpriseId, brandId: this.eventContext.brandId, subject: { type: 'insight', id: decision.insightId }, payload: { ...decision }, source: { type: 'human_decision_service', ref: decision.insightId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: decision.insightId, causationId: null, schemaVersion: 'event.v1' })
    }
    return { status: 'recorded', decision, externalActionExecuted: false }
  }
}
import type { EventLedger } from '../event-core/ledger.js'
