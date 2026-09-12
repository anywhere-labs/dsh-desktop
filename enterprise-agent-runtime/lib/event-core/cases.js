import { caseRecordSchema } from './contracts.js';
export class CaseStore {
    cases = new Map();
    createFromEvent(event, title, ownerId = null) {
        const existing = this.cases.get(event.correlationId);
        if (existing)
            return existing;
        const now = new Date().toISOString();
        const record = caseRecordSchema.parse({
            caseId: event.correlationId,
            tenantId: event.tenantId,
            enterpriseId: event.enterpriseId,
            brandId: event.brandId,
            title,
            triggerEventId: event.eventId,
            status: 'OPEN',
            ownerId,
            responsibilityStatus: ownerId ? 'CLAIMED' : 'UNASSIGNED',
            taskIds: [],
            evidenceRefs: event.evidenceRefs,
            createdAt: now,
            updatedAt: now,
        });
        this.cases.set(record.caseId, record);
        return record;
    }
    patch(caseId, patch) {
        const current = this.require(caseId);
        const next = caseRecordSchema.parse({ ...current, ...patch, updatedAt: new Date().toISOString() });
        this.cases.set(caseId, next);
        return next;
    }
    require(caseId) {
        const record = this.cases.get(caseId);
        if (!record)
            throw new Error(`case_not_found:${caseId}`);
        return record;
    }
    list(tenantId) {
        return [...this.cases.values()].filter(item => !tenantId || item.tenantId === tenantId);
    }
}
