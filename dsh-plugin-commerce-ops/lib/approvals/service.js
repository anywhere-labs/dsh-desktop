export class ApprovalService {
    eventContext;
    records = new Map();
    constructor(eventContext) {
        this.eventContext = eventContext;
        this.rehydrate();
    }
    create(action, requesterId) {
        const approvalId = `approval_${Date.now()}_${this.records.size + 1}`;
        const record = { approvalId, action, requesterId, status: 'pending' };
        this.records.set(approvalId, record);
        this.emit('approval.requested', record, requesterId);
        return record;
    }
    approve(approvalId, approverId) {
        const current = this.require(approvalId);
        if (current.status !== 'pending')
            throw new Error('approval is no longer pending');
        const record = { ...current, status: 'approved', approverId };
        this.records.set(approvalId, record);
        this.emit('approval.approved', record, approverId);
        return record;
    }
    reject(approvalId, approverId) {
        const current = this.require(approvalId);
        const record = { ...current, status: 'rejected', approverId };
        this.records.set(approvalId, record);
        this.emit('approval.rejected', record, approverId);
        return record;
    }
    list() {
        return [...this.records.values()];
    }
    assertExecutable(action) {
        if (!['L2', 'L3', 'L4', 'L5'].includes(action.riskLevel))
            return;
        if (!action.approvalId)
            throw new Error('approval required for risky action');
        const record = this.require(action.approvalId);
        if (record.status !== 'approved')
            throw new Error('approval is not approved');
        if (record.action.actionId !== action.actionId)
            throw new Error('approval does not match action');
        if (stableJson(record.action) !== stableJson({ ...action, approvalId: undefined }))
            throw new Error('approval action payload does not match');
    }
    require(approvalId) {
        const record = this.records.get(approvalId);
        if (!record)
            throw new Error(`approval not found: ${approvalId}`);
        return record;
    }
    emit(eventType, record, actorId) {
        if (!this.eventContext)
            return;
        const now = new Date().toISOString();
        void this.eventContext.ledger.append({ eventId: `${eventType}:${record.approvalId}`, eventType, tenantId: this.eventContext.tenantId, enterpriseId: this.eventContext.enterpriseId, brandId: this.eventContext.brandId, subject: { type: 'approval', id: record.approvalId }, payload: { approvalId: record.approvalId, actionId: record.action.actionId, action: record.action, actorId }, source: { type: 'approval_service', ref: record.approvalId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: `approval:${record.approvalId}`, causationId: null, schemaVersion: 'event.v1' });
    }
    rehydrate() {
        for (const event of this.eventContext?.ledger.list() ?? []) {
            if (!event.eventType.startsWith('approval.'))
                continue;
            const payload = event.payload;
            const action = payload.action;
            if (typeof action !== 'object' || action === null || Array.isArray(action))
                continue;
            const approvalId = typeof payload.approvalId === 'string' ? payload.approvalId : event.subject.id;
            const previous = this.records.get(approvalId);
            const requesterId = previous?.requesterId ?? (typeof payload.actorId === 'string' ? payload.actorId : 'event-replay');
            this.records.set(approvalId, { approvalId, action: action, requesterId, status: event.eventType === 'approval.approved' ? 'approved' : event.eventType === 'approval.rejected' ? 'rejected' : 'pending', ...(event.eventType !== 'approval.requested' && typeof payload.actorId === 'string' ? { approverId: payload.actorId } : {}) });
        }
    }
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value !== null && typeof value === 'object')
        return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
    return JSON.stringify(value);
}
