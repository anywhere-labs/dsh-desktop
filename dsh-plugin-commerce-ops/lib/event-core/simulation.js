import { CaseStore } from './cases.js';
import { EventLedger } from './ledger.js';
import { EventRouter } from './router.js';
import { ApprovalService } from '../approvals/service.js';
import { MockActionExecutor } from '../actions/mock-executor.js';
const now = '2026-09-04T10:00:00+08:00';
export async function runCompetitorPriceChangeSimulation() {
    const ledger = new EventLedger();
    const cases = new CaseStore();
    const router = new EventRouter(ledger);
    const trigger = {
        eventId: 'evt_demo_competitor_price_001',
        eventType: 'competitor.price.changed',
        tenantId: 'tenant_demo_group',
        enterpriseId: 'enterprise_demo_a',
        brandId: 'brand_demo_alpha',
        subject: { type: 'competitor_product', id: 'competitor_product_001' },
        payload: { competitorBrand: '示例竞品B', oldPrice: 59, newPrice: 52, changeRate: -0.12, platform: 'mock' },
        source: { type: 'mock_connector', ref: 'fixture:competitor-price-001' },
        evidenceRefs: ['ev_demo_price_snapshot_001'],
        confidence: 0.86,
        occurredAt: now,
        observedAt: now,
        correlationId: 'case_demo_competitor_price_001',
        causationId: null,
        schemaVersion: 'event.v1',
    };
    router.register({ eventType: 'competitor.price.changed', agentId: 'event-coordinator', riskLevel: 'low', humanGate: false }, event => {
        cases.createFromEvent(event, '竞品降价响应：示例竞品B商品降价12%');
    });
    router.register({ eventType: 'competitor.price.changed', agentId: 'competitor-intelligence', riskLevel: 'medium', humanGate: false }, event => {
        cases.patch(event.correlationId, { status: 'INVESTIGATING', evidenceRefs: [...event.evidenceRefs, 'ev_demo_product_mapping_001'] });
    });
    router.register({ eventType: 'competitor.price.changed', agentId: 'product-intelligence', riskLevel: 'medium', humanGate: false }, event => {
        cases.patch(event.correlationId, { status: 'PROPOSED', taskIds: ['task_demo_product_impact_001'] });
    });
    router.register({ eventType: 'competitor.price.changed', agentId: 'brand-strategy', riskLevel: 'high', humanGate: true }, event => {
        cases.patch(event.correlationId, { status: 'WAITING_HUMAN', ownerId: 'human_brand_owner_001', responsibilityStatus: 'CLAIMED', taskIds: ['task_demo_product_impact_001', 'task_demo_approval_001'] });
    });
    router.register({ eventType: 'competitor.price.changed', agentId: 'coordination', riskLevel: 'high', humanGate: true }, event => {
        cases.patch(event.correlationId, { status: 'WAITING_HUMAN', ownerId: 'human_brand_owner_001', responsibilityStatus: 'CLAIMED' });
    });
    await ledger.append(trigger);
    const record = cases.require(trigger.correlationId);
    return { triggerEvent: trigger, caseId: record.caseId, events: ledger.list(), routes: router.routesFor(trigger.eventType).map(route => route.agentId), caseStatus: record.status, ownerId: record.ownerId, humanApprovalRequired: true };
}
export async function runApprovedCompetitorPriceChangeSimulation() {
    const ledger = new EventLedger();
    const cases = new CaseStore();
    const router = new EventRouter(ledger);
    const approvals = new ApprovalService();
    const executor = new MockActionExecutor(approvals);
    const trigger = {
        eventId: 'evt_demo_competitor_price_001',
        eventType: 'competitor.price.changed',
        tenantId: 'tenant_demo_group',
        enterpriseId: 'enterprise_demo_a',
        brandId: 'brand_demo_alpha',
        subject: { type: 'competitor_product', id: 'competitor_product_001' },
        payload: { competitorBrand: '示例竞品B', oldPrice: 59, newPrice: 52, changeRate: -0.12, platform: 'mock' },
        source: { type: 'mock_connector', ref: 'fixture:competitor-price-001' },
        evidenceRefs: ['ev_demo_price_snapshot_001'],
        confidence: 0.86,
        occurredAt: now,
        observedAt: now,
        correlationId: 'case_demo_competitor_price_001',
        causationId: null,
        schemaVersion: 'event.v1',
    };
    router.register({ eventType: 'competitor.price.changed', agentId: 'event-coordinator', riskLevel: 'low', humanGate: false }, event => {
        cases.createFromEvent(event, '竞品降价响应：示例竞品B商品降价12%');
    });
    router.register({ eventType: 'competitor.price.changed', agentId: 'competitor-intelligence', riskLevel: 'medium', humanGate: false }, event => {
        cases.patch(event.correlationId, { status: 'INVESTIGATING', evidenceRefs: [...event.evidenceRefs, 'ev_demo_product_mapping_001'] });
    });
    router.register({ eventType: 'competitor.price.changed', agentId: 'product-intelligence', riskLevel: 'medium', humanGate: false }, event => {
        cases.patch(event.correlationId, { status: 'PROPOSED', taskIds: ['task_demo_product_impact_001'] });
    });
    router.register({ eventType: 'competitor.price.changed', agentId: 'brand-strategy', riskLevel: 'high', humanGate: true }, event => {
        cases.patch(event.correlationId, { status: 'WAITING_HUMAN', ownerId: 'human_brand_owner_001', responsibilityStatus: 'CLAIMED', taskIds: ['task_demo_product_impact_001', 'task_demo_approval_001'] });
    });
    router.register({ eventType: 'competitor.price.changed', agentId: 'coordination', riskLevel: 'high', humanGate: true }, event => {
        cases.patch(event.correlationId, { status: 'WAITING_HUMAN', ownerId: 'human_brand_owner_001', responsibilityStatus: 'CLAIMED' });
    });
    router.register({ eventType: 'approval.approved', agentId: 'coordination', riskLevel: 'high', humanGate: true }, event => {
        cases.patch(event.correlationId, { status: 'APPROVED', responsibilityStatus: 'ACCEPTED' });
    });
    router.register({ eventType: 'action.execution.started', agentId: 'action-executor', riskLevel: 'high', humanGate: false }, event => {
        cases.patch(event.correlationId, { status: 'EXECUTING' });
    });
    router.register({ eventType: 'action.receipt.received', agentId: 'receipt-verifier', riskLevel: 'low', humanGate: false }, event => {
        cases.patch(event.correlationId, { status: 'VERIFYING' });
    });
    router.register({ eventType: 'outcome.recorded', agentId: 'retro', riskLevel: 'low', humanGate: false }, event => {
        cases.patch(event.correlationId, { status: 'CLOSED', responsibilityStatus: 'RELEASED' });
    });
    await ledger.append(trigger);
    const actionWithoutApproval = {
        actionId: 'act_demo_price_response_test_001',
        actionType: 'create_price_response_test',
        riskLevel: 'L3',
        target: { platform: 'mock', shopId: 'shop_demo_alpha', productId: 'product_demo_alpha_001' },
        payload: { strategy: 'content-differentiation', durationDays: 7 },
    };
    const approval = approvals.create(actionWithoutApproval, 'brand-strategy');
    await ledger.append(deriveEvent(trigger, {
        eventId: 'evt_demo_approval_requested_001', eventType: 'approval.requested', causationId: trigger.eventId,
        subject: { type: 'approval', id: approval.approvalId }, payload: { actionId: actionWithoutApproval.actionId, requesterId: approval.requesterId },
    }));
    approvals.approve(approval.approvalId, 'human_brand_owner_001');
    await ledger.append(deriveEvent(trigger, {
        eventId: 'evt_demo_approval_approved_001', eventType: 'approval.approved', causationId: 'evt_demo_approval_requested_001',
        subject: { type: 'approval', id: approval.approvalId }, payload: { actionId: actionWithoutApproval.actionId, approverId: 'human_brand_owner_001' },
    }));
    const action = { ...actionWithoutApproval, approvalId: approval.approvalId };
    await ledger.append(deriveEvent(trigger, {
        eventId: 'evt_demo_action_started_001', eventType: 'action.execution.started', causationId: 'evt_demo_approval_approved_001',
        subject: { type: 'action', id: action.actionId }, payload: { approvalId: approval.approvalId, mode: 'mock' },
    }));
    const receipt = executor.execute(action);
    await ledger.append(deriveEvent(trigger, {
        eventId: 'evt_demo_action_receipt_001', eventType: 'action.receipt.received', causationId: 'evt_demo_action_started_001',
        subject: { type: 'receipt', id: receipt.receiptId }, payload: { ...receipt },
    }));
    await ledger.append(deriveEvent(trigger, {
        eventId: 'evt_demo_outcome_001', eventType: 'outcome.recorded', causationId: 'evt_demo_action_receipt_001',
        subject: { type: 'case', id: trigger.correlationId }, payload: { receiptId: receipt.receiptId, outcome: 'mock_test_created', externalWrite: false },
    }));
    const record = cases.require(trigger.correlationId);
    if (record.status !== 'CLOSED' || record.responsibilityStatus !== 'RELEASED')
        throw new Error('simulation did not close the case');
    const events = ledger.list({ tenantId: trigger.tenantId, correlationId: trigger.correlationId });
    return {
        triggerEvent: trigger,
        caseId: record.caseId,
        events,
        routes: router.routesFor(trigger.eventType).map(route => route.agentId),
        caseStatus: record.status,
        ownerId: record.ownerId,
        humanApprovalRequired: true,
        approvalId: approval.approvalId,
        actionId: action.actionId,
        receipt,
        finalCaseStatus: 'CLOSED',
        responsibilityStatus: 'RELEASED',
        eventTypes: events.map(event => event.eventType),
    };
}
function deriveEvent(parent, overrides) {
    return {
        ...parent,
        ...overrides,
        source: { type: 'simulation_runtime', ref: overrides.eventId },
        evidenceRefs: parent.evidenceRefs,
        confidence: 1,
        occurredAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
    };
}
