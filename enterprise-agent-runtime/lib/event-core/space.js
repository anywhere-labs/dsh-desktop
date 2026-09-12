export function buildAgentSpaceSnapshot(events) {
    const cases = new Map();
    const approvals = new Map();
    const receipts = [];
    const caseFor = (event) => {
        const existing = cases.get(event.correlationId);
        if (existing)
            return existing;
        const created = { caseId: event.correlationId, brandId: event.brandId, title: titleFrom(event), ownerId: null, caseStatus: 'OPEN', responsibilityStatus: 'UNASSIGNED', blocked: false, timeout: false };
        cases.set(event.correlationId, created);
        return created;
    };
    for (const event of events) {
        const payload = event.payload;
        const current = caseFor(event);
        if (event.eventType === 'competitor.price.changed') {
            current.caseStatus = 'WAITING_HUMAN';
            const owner = stringValue(payload.ownerId);
            if (owner) {
                current.ownerId = owner;
                current.responsibilityStatus = 'CLAIMED';
            }
        }
        if (event.eventType === 'case.status.changed') {
            const status = stringValue(payload.status);
            if (isCaseStatus(status))
                current.caseStatus = status;
            const owner = stringValue(payload.ownerId);
            if (owner) {
                current.ownerId = owner;
                current.responsibilityStatus = 'CLAIMED';
            }
        }
        if (event.eventType === 'approval.requested' || event.eventType === 'approval.approved' || event.eventType === 'approval.rejected') {
            const approvalId = event.subject.id;
            const previous = approvals.get(approvalId);
            approvals.set(approvalId, { approvalId, actionId: stringValue(payload.actionId) ?? previous?.actionId ?? 'unknown', caseId: event.correlationId, status: event.eventType === 'approval.approved' ? 'approved' : event.eventType === 'approval.rejected' ? 'rejected' : 'pending', ...(stringValue(payload.approverId) ? { approverId: stringValue(payload.approverId) } : previous?.approverId ? { approverId: previous.approverId } : {}) });
        }
        if (event.eventType === 'approval.approved') {
            current.caseStatus = 'APPROVED';
            current.responsibilityStatus = 'ACCEPTED';
            current.blocked = false;
            const approverId = stringValue(payload.approverId);
            if (approverId)
                current.ownerId = approverId;
        }
        if (event.eventType === 'approval.rejected') {
            current.caseStatus = 'BLOCKED';
            current.responsibilityStatus = 'WAITING_INPUT';
            current.blocked = true;
        }
        if (event.eventType === 'responsibility.claimed') {
            current.ownerId = stringValue(payload.actorId) ?? current.ownerId ?? null;
            current.responsibilityStatus = 'CLAIMED';
        }
        if (event.eventType === 'responsibility.accepted') {
            current.responsibilityStatus = 'ACCEPTED';
        }
        if (event.eventType === 'responsibility.transferred') {
            current.ownerId = stringValue(payload.toUserId) ?? current.ownerId ?? null;
            current.responsibilityStatus = 'CLAIMED';
        }
        if (event.eventType === 'responsibility.released') {
            current.ownerId = null;
            current.responsibilityStatus = 'RELEASED';
        }
        if (event.eventType === 'case.blocked') {
            current.caseStatus = 'BLOCKED';
            current.blocked = true;
        }
        if (event.eventType === 'case.unblocked') {
            current.caseStatus = 'WAITING_HUMAN';
            current.blocked = false;
        }
        if (event.eventType === 'notification.requested' && payload.kind === 'sla.escalation') {
            current.responsibilityStatus = 'ESCALATED';
            current.timeout = true;
        }
        if (event.eventType === 'action.execution.started')
            current.caseStatus = 'EXECUTING';
        if (event.eventType === 'action.receipt.received') {
            current.caseStatus = 'VERIFYING';
            receipts.push({ receiptId: stringValue(payload.receiptId) ?? event.subject.id, actionId: stringValue(payload.actionId) ?? 'unknown', caseId: event.correlationId, status: stringValue(payload.status) ?? 'unknown', mode: stringValue(payload.mode) ?? 'unknown', externalWrite: payload.externalWrite === true });
        }
        if (event.eventType === 'outcome.recorded') {
            current.caseStatus = 'CLOSED';
            current.responsibilityStatus = 'RELEASED';
            current.blocked = false;
            current.timeout = false;
        }
        cases.set(event.correlationId, current);
    }
    return { events, responsibilities: [...cases.values()], approvals: [...approvals.values()], receipts };
}
export function getHumanBoard(snapshot, actorId) {
    const all = { key: 'all', label: '全部', responsibilities: snapshot.responsibilities, approvals: snapshot.approvals };
    const waitingConfirm = {
        key: 'waiting-confirm', label: '待我确认',
        responsibilities: snapshot.responsibilities.filter(item => (item.caseStatus === 'WAITING_HUMAN' || item.caseStatus === 'INVESTIGATING') && item.ownerId === null),
        approvals: snapshot.approvals.filter(() => false),
    };
    const waitingApproval = {
        key: 'waiting-approval', label: '待我审核',
        responsibilities: snapshot.responsibilities.filter(() => false),
        approvals: snapshot.approvals.filter(item => item.status === 'pending'),
    };
    const owned = { key: 'owned', label: '我负责', responsibilities: snapshot.responsibilities.filter(item => item.ownerId === actorId), approvals: snapshot.approvals.filter(() => false) };
    const blockedTimeout = { key: 'blocked-timeout', label: '被阻塞超时', responsibilities: snapshot.responsibilities.filter(item => item.blocked || item.timeout), approvals: snapshot.approvals.filter(() => false) };
    return [all, waitingConfirm, waitingApproval, owned, blockedTimeout];
}
function titleFrom(event) {
    return stringValue(event.payload?.title) ?? (event.eventType === 'competitor.price.changed' ? '竞品降价响应' : `Case ${event.correlationId}`);
}
function isCaseStatus(value) {
    return value === 'OPEN' || value === 'INVESTIGATING' || value === 'PROPOSED' || value === 'WAITING_HUMAN' || value === 'APPROVED' || value === 'EXECUTING' || value === 'VERIFYING' || value === 'CLOSED' || value === 'BLOCKED';
}
function stringValue(value) { return typeof value === 'string' ? value : undefined; }
