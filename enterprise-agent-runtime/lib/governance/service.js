export class PermissionService {
    context;
    members = new Map();
    constructor(context) {
        this.context = context;
        this.rehydrate();
    }
    registerMember(userId, tenantId, roles, options = {}) {
        this.members.set(`${tenantId}:${userId}`, { tenantId, roles });
        if (this.context && options.persist !== false) {
            const now = new Date().toISOString();
            void this.context.ledger.append({ eventId: `membership.role.granted:${tenantId}:${userId}:${[...roles].sort().join(',')}`, eventType: 'membership.role.granted', tenantId, enterpriseId: this.context.enterpriseId, brandId: this.context.brandId, subject: { type: 'member', id: userId }, payload: { userId, tenantId, roles }, source: { type: 'permission_service', ref: userId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: `member:${tenantId}:${userId}`, causationId: null, schemaVersion: 'event.v1' });
        }
    }
    can(userId, tenantId, permission) {
        const member = this.members.get(`${tenantId}:${userId}`);
        return Boolean(member && (member.roles.includes('owner') || member.roles.includes('admin') || member.roles.includes(permission)));
    }
    assertCan(userId, tenantId, permission) { if (!this.can(userId, tenantId, permission))
        throw new Error(`permission_denied:${permission}`); }
    rehydrate() {
        for (const event of this.context?.ledger.list() ?? [])
            if (event.eventType === 'membership.role.granted' && Array.isArray(event.payload.roles) && typeof event.payload.userId === 'string' && typeof event.payload.tenantId === 'string')
                this.members.set(`${event.payload.tenantId}:${event.payload.userId}`, { tenantId: event.payload.tenantId, roles: event.payload.roles.filter((role) => typeof role === 'string') });
    }
}
export class ResponsibilityService {
    context;
    permissions;
    records = new Map();
    constructor(context, permissions) {
        this.context = context;
        this.permissions = permissions;
        this.rehydrate();
    }
    claim(caseId, actorId) { return this.apply(caseId, actorId, 'claim', actorId); }
    accept(caseId, actorId) { return this.apply(caseId, actorId, 'accept', actorId); }
    release(caseId, ownerId) { return this.apply(caseId, ownerId, 'release', ownerId); }
    transfer(caseId, fromUserId, toUserId) { return this.apply(caseId, fromUserId, 'transfer', toUserId); }
    apply(caseId, actorId, action, targetOwnerId) {
        this.permissions.assertCan(actorId, this.context.tenantId, action === 'transfer' ? 'transfer_responsibility' : action === 'accept' ? 'accept_responsibility' : 'claim_responsibility');
        const status = action === 'release' ? 'RELEASED' : action === 'accept' ? 'ACCEPTED' : 'CLAIMED';
        const record = { caseId, ownerId: targetOwnerId, status, assignedAt: new Date().toISOString() };
        this.records.set(caseId, record);
        const eventType = action === 'claim' ? 'responsibility.claimed' : action === 'accept' ? 'responsibility.accepted' : action === 'release' ? 'responsibility.released' : 'responsibility.transferred';
        this.emit(eventType, caseId, { action, actorId, toUserId: action === 'transfer' ? targetOwnerId : undefined, caseId });
        return record;
    }
    get(caseId) { return this.records.get(caseId); }
    rehydrate() { for (const event of this.context.ledger.list())
        if (event.eventType === 'responsibility.transferred' && typeof event.payload.caseId === 'string' && typeof event.payload.toUserId === 'string')
            this.records.set(event.payload.caseId, { caseId: event.payload.caseId, ownerId: event.payload.toUserId, status: 'CLAIMED', assignedAt: event.occurredAt }); }
    emit(eventType, caseId, payload) {
        const now = new Date().toISOString();
        void this.context.ledger.append({ eventId: `${eventType}:${caseId}:${now}`, eventType, tenantId: this.context.tenantId, enterpriseId: this.context.enterpriseId, brandId: this.context.brandId, subject: { type: 'case', id: caseId }, payload, source: { type: 'responsibility_service', ref: caseId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: caseId, causationId: null, schemaVersion: 'event.v1' });
    }
}
export class SlaService {
    context;
    notifications;
    records = new Map();
    constructor(context, notifications) {
        this.context = context;
        this.notifications = notifications;
        this.rehydrate();
    }
    start(caseId, ownerId, durationMs, now = new Date()) { const record = { caseId, ownerId, dueAt: new Date(now.getTime() + durationMs).toISOString(), status: 'OPEN' }; this.records.set(caseId, record); this.emit('sla.started', record); return record; }
    evaluate(now = new Date()) { const escalated = []; for (const current of this.records.values())
        if (current.status === 'OPEN' && new Date(current.dueAt) <= now) {
            const next = { ...current, status: 'ESCALATED' };
            this.records.set(current.caseId, next);
            escalated.push(next);
            this.emit('sla.escalated', next);
            this.notifications.send({ recipientId: current.ownerId, kind: 'sla.escalation', caseId: current.caseId, message: `Case ${current.caseId} 已超过 SLA` });
        } return escalated; }
    list() { return [...this.records.values()]; }
    emit(eventType, record) { const now = new Date().toISOString(); void this.context.ledger.append({ eventId: `${eventType}:${record.caseId}:${record.dueAt}`, eventType, tenantId: this.context.tenantId, enterpriseId: this.context.enterpriseId, brandId: this.context.brandId, subject: { type: 'case', id: record.caseId }, payload: { ...record }, source: { type: 'sla_service', ref: record.caseId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: record.caseId, causationId: null, schemaVersion: 'event.v1' }); }
    rehydrate() { for (const event of this.context.ledger.list())
        if ((event.eventType === 'sla.started' || event.eventType === 'sla.escalated') && typeof event.payload.caseId === 'string' && typeof event.payload.ownerId === 'string' && typeof event.payload.dueAt === 'string')
            this.records.set(event.payload.caseId, { caseId: event.payload.caseId, ownerId: event.payload.ownerId, dueAt: event.payload.dueAt, status: event.eventType === 'sla.escalated' ? 'ESCALATED' : 'OPEN' }); }
}
export class NotificationService {
    context;
    records = [];
    constructor(context) {
        this.context = context;
        this.rehydrate();
    }
    send(input) { const record = { ...input, notificationId: `notification_${this.records.length + 1}`, status: 'queued' }; this.records.push(record); const now = new Date().toISOString(); void this.context.ledger.append({ eventId: `notification.requested:${record.notificationId}`, eventType: 'notification.requested', tenantId: this.context.tenantId, enterpriseId: this.context.enterpriseId, brandId: this.context.brandId, subject: { type: 'notification', id: record.notificationId }, payload: { ...record }, source: { type: 'notification_service', ref: record.notificationId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: record.caseId, causationId: null, schemaVersion: 'event.v1' }); return record; }
    list() { return [...this.records]; }
    rehydrate() { for (const event of this.context.ledger.list())
        if (event.eventType === 'notification.requested' && typeof event.payload.notificationId === 'string' && typeof event.payload.recipientId === 'string' && typeof event.payload.kind === 'string' && typeof event.payload.caseId === 'string' && typeof event.payload.message === 'string')
            this.records.push({ notificationId: event.payload.notificationId, recipientId: event.payload.recipientId, kind: event.payload.kind, caseId: event.payload.caseId, message: event.payload.message, status: 'queued' }); }
}
