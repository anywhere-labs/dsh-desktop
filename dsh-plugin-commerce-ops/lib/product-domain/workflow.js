import { EventLedger } from '../event-core/ledger.js';
import { EventRouter } from '../event-core/router.js';
import { CaseStore } from '../event-core/cases.js';
import { JsonlEventStore } from '../event-core/persistence.js';
import { ApprovalService } from '../approvals/service.js';
import { MockActionExecutor } from '../actions/mock-executor.js';
import { COMMERCE_EVENT_VERSION, parseCommerceEvent } from './events.js';
import { inventoryAlertAtomDefinition, orchestrateProductEvent } from './atoms.js';
import { COMMERCE_OBJECT_VERSION } from './contracts.js';
const TENANT = 'tenant_demo_group';
const ENTERPRISE = 'enterprise_demo_a';
const BRAND = 'brand_demo_alpha';
const OWNER = 'human_product_owner_001';
const NOW = '2026-09-08T10:00:00+08:00';
const SLA_DUE_AT = '2026-09-08T18:00:00+08:00';
export class InventoryAlertWorkflow {
    ledger;
    approvals;
    router;
    cases = new CaseStore();
    state = new WorkflowStateProjection();
    executor;
    constructor(ledger, approvals) {
        this.ledger = ledger;
        this.approvals = approvals;
        this.executor = new MockActionExecutor(approvals);
        this.router = new EventRouter(ledger);
        this.router.register({ eventType: '*', agentId: 'product-workflow-projector', riskLevel: 'low', humanGate: false }, event => this.handleEvent(event));
        for (const event of ledger.list())
            this.handleEvent(event);
    }
    async run(scenario = 'normal') {
        const fixture = createFixture(scenario);
        await this.append(fixture.trigger);
        await this.append(makeEvent(fixture.trigger, 'case.created', `evt_case_created_${scenario}`, { type: 'BusinessCase', id: fixture.objectIds.caseId }, { caseId: fixture.objectIds.caseId, title: '库存阈值预警：示例洗衣液', ownerId: OWNER }));
        await this.append(makeEvent(fixture.trigger, 'task.status.changed', `evt_task_open_${scenario}`, { type: 'Task', id: fixture.objectIds.taskId }, { taskId: fixture.objectIds.taskId, status: 'OPEN', ownerId: OWNER, dueAt: SLA_DUE_AT, acceptanceCriteria: ['完成补货建议审批并形成可核验回执'] }));
        let atom = null;
        let action = null;
        let approval = null;
        let receipt = null;
        let outcome = null;
        let retro = null;
        try {
            atom = orchestrateProductEvent(fixture.trigger, fixture.atomInput);
            action = atom.output.actionProposal;
            this.state.setAction(action.actionId);
            const approvalId = `approval_inventory_${scenario}`;
            approval = this.approvals.create(action, 'product-operations-agent', approvalId);
            if (scenario === 'approval_rejected') {
                if (approval.status === 'pending')
                    approval = this.approvals.reject(approval.approvalId, OWNER);
                await this.append(makeEvent(fixture.trigger, 'task.status.changed', `evt_task_blocked_${scenario}`, { type: 'Task', id: fixture.objectIds.taskId }, { taskId: fixture.objectIds.taskId, status: 'BLOCKED', ownerId: OWNER, reason: 'approval_rejected' }));
                outcome = await this.appendOutcome(fixture.trigger, scenario, 'blocked', '人工驳回补货建议，等待重新制定方案');
                retro = await this.appendRetro(fixture.trigger, scenario, 'blocked', null, ['审批被驳回，需人工重新制定补货方案']);
                await this.appendCaseStatus(fixture.trigger, scenario, 'BLOCKED', 'approval_rejected');
            }
            else {
                if (approval.status === 'pending')
                    approval = this.approvals.approve(approval.approvalId, OWNER);
                await this.append(makeEvent(fixture.trigger, 'task.status.changed', `evt_task_approved_${scenario}`, { type: 'Task', id: fixture.objectIds.taskId }, { taskId: fixture.objectIds.taskId, status: 'APPROVED', ownerId: OWNER }));
                await this.append(makeEvent(fixture.trigger, 'action.execution.started', `evt_action_started_${scenario}`, { type: 'Action', id: action.actionId }, { actionId: action.actionId, caseId: fixture.objectIds.caseId, mode: 'mock', externalWrite: false, approvalId: approval.approvalId }));
                if (scenario === 'action_failed') {
                    const failedReceipt = { receiptId: `receipt_${action.actionId}`, actionId: action.actionId, status: 'failed', mode: 'mock', externalWrite: false };
                    receipt = failedReceipt;
                    await this.append(makeEvent(fixture.trigger, 'action.execution.failed', `evt_action_failed_${scenario}`, { type: 'Action', id: action.actionId }, { actionId: action.actionId, caseId: fixture.objectIds.caseId, mode: 'mock', externalWrite: false, errorCode: 'MOCK_CONNECTOR_TIMEOUT' }));
                    await this.append(makeEvent(fixture.trigger, 'action.receipt.received', `evt_receipt_failed_${scenario}`, { type: 'Receipt', id: failedReceipt.receiptId }, { ...failedReceipt }));
                    await this.append(makeEvent(fixture.trigger, 'task.status.changed', `evt_task_failed_${scenario}`, { type: 'Task', id: fixture.objectIds.taskId }, { taskId: fixture.objectIds.taskId, status: 'FAILED', ownerId: OWNER, reason: 'MOCK_CONNECTOR_TIMEOUT' }));
                    outcome = await this.appendOutcome(fixture.trigger, scenario, 'failed', 'mock 连接器超时，未发生外部写入');
                    retro = await this.appendRetro(fixture.trigger, scenario, 'failed', `task_followup_${scenario}`, ['mock action 失败，需人工接管并重试']);
                    await this.appendCaseStatus(fixture.trigger, scenario, 'BLOCKED', 'mock_action_failed');
                }
                else {
                    const approvedAction = { ...action, approvalId: approval.approvalId };
                    const existingReceipt = this.ledger.list({ correlationId: fixture.objectIds.caseId }).find(event => event.eventType === 'action.receipt.received');
                    const executed = existingReceipt ? existingReceipt.payload : this.executor.execute(approvedAction);
                    receipt = executed;
                    await this.append(makeEvent(fixture.trigger, 'action.execution.completed', `evt_action_completed_${scenario}`, { type: 'Action', id: action.actionId }, { actionId: action.actionId, caseId: fixture.objectIds.caseId, mode: 'mock', externalWrite: false, receiptId: executed.receiptId }));
                    await this.append(makeEvent(fixture.trigger, 'action.receipt.received', `evt_receipt_${scenario}`, { type: 'Receipt', id: executed.receiptId }, { ...executed }));
                    await this.append(makeEvent(fixture.trigger, 'task.status.changed', `evt_task_verifying_${scenario}`, { type: 'Task', id: fixture.objectIds.taskId }, { taskId: fixture.objectIds.taskId, status: 'VERIFYING', ownerId: OWNER }));
                    outcome = await this.appendOutcome(fixture.trigger, scenario, 'succeeded', '补货建议已通过 mock 执行验证，未写入外部平台');
                    retro = await this.appendRetro(fixture.trigger, scenario, 'succeeded', null, ['建议数量计算和人工审批链路已完成']);
                    await this.appendCaseStatus(fixture.trigger, scenario, 'CLOSED', null);
                }
            }
        }
        catch (cause) {
            const code = cause instanceof Error ? cause.message : String(cause);
            await this.append(makeEvent(fixture.trigger, 'task.status.changed', `evt_task_blocked_${scenario}`, { type: 'Task', id: fixture.objectIds.taskId }, { taskId: fixture.objectIds.taskId, status: 'BLOCKED', ownerId: OWNER, reason: code }));
            outcome = await this.appendOutcome(fixture.trigger, scenario, 'blocked', `原子执行被阻断：${code}`);
            retro = await this.appendRetro(fixture.trigger, scenario, 'blocked', `task_followup_${scenario}`, ['证据不足，禁止继续生成或执行动作']);
            await this.appendCaseStatus(fixture.trigger, scenario, 'BLOCKED', code);
        }
        const final = this.state.snapshot(fixture.objectIds.caseId, fixture.objectIds.taskId);
        return { scenario, agentId: 'product-operations-agent', atomId: inventoryAlertAtomDefinition.atomId, objectIds: fixture.objectIds, events: this.ledger.list({ tenantId: TENANT, correlationId: fixture.objectIds.caseId }), eventTypes: this.ledger.list({ tenantId: TENANT, correlationId: fixture.objectIds.caseId }).map(event => event.eventType), approval, action, receipt, outcome, retro, final };
    }
    handleEvent(event) {
        if (!event.correlationId.startsWith('case_inventory_'))
            return;
        if (event.eventType === 'inventory.threshold.breached') {
            try {
                this.cases.createFromEvent(event, '库存阈值预警：示例洗衣液', OWNER);
            }
            catch { /* duplicate replay */ }
        }
        if (event.eventType === 'case.status.changed') {
            const status = event.payload.status;
            if (typeof status === 'string')
                this.cases.patch(event.correlationId, { status: status });
        }
        this.state.apply(event);
    }
    async append(event) {
        parseCommerceEvent(event);
        return this.ledger.append(event);
    }
    async appendOutcome(trigger, scenario, status, summary) {
        const event = await this.append(makeEvent(trigger, 'outcome.recorded', `evt_outcome_${scenario}`, { type: 'Outcome', id: `outcome_${scenario}` }, { caseId: trigger.correlationId, status, externalWrite: false, summary }));
        return { status: event.payload.status, externalWrite: false };
    }
    async appendRetro(trigger, scenario, outcomeStatus, followUpTaskId, lessons) {
        await this.append(makeEvent(trigger, 'retro.recorded', `evt_retro_${scenario}`, { type: 'Retro', id: `retro_${scenario}` }, { caseId: trigger.correlationId, outcomeStatus, followUpTaskId, lessons }));
        return { recorded: true, followUpTaskId };
    }
    async appendCaseStatus(trigger, scenario, status, reason) {
        await this.append(makeEvent(trigger, 'case.status.changed', `evt_case_status_${scenario}`, { type: 'BusinessCase', id: trigger.correlationId }, { caseId: trigger.correlationId, status, reason: reason ?? undefined }));
    }
}
class WorkflowStateProjection {
    current = { caseId: '', caseStatus: 'OPEN', taskId: '', taskStatus: 'OPEN', ownerId: OWNER, responsibilityStatus: 'CLAIMED', approvalStatus: 'pending', actionId: null, receiptStatus: null, outcomeStatus: null, retroRecorded: false, blockedReason: null, slaDueAt: SLA_DUE_AT, slaStatus: 'OPEN' };
    setAction(actionId) { this.current = { ...this.current, actionId }; }
    apply(event) {
        const payload = event.payload;
        if (event.eventType === 'inventory.threshold.breached')
            this.current = { ...this.current, caseId: event.correlationId, caseStatus: 'OPEN', ownerId: OWNER, responsibilityStatus: 'CLAIMED' };
        if (event.eventType === 'case.created')
            this.current = { ...this.current, caseId: event.correlationId, caseStatus: 'OPEN', ownerId: stringValue(payload.ownerId) ?? OWNER };
        if (event.eventType === 'task.status.changed')
            this.current = { ...this.current, taskId: stringValue(payload.taskId) ?? this.current.taskId, taskStatus: payload.status, ownerId: stringValue(payload.ownerId) ?? this.current.ownerId, blockedReason: stringValue(payload.reason) ?? this.current.blockedReason };
        if (event.eventType === 'approval.requested')
            this.current = { ...this.current, approvalStatus: 'pending', caseStatus: 'WAITING_HUMAN', responsibilityStatus: 'WAITING_INPUT' };
        if (event.eventType === 'approval.approved')
            this.current = { ...this.current, approvalStatus: 'approved', caseStatus: 'APPROVED', responsibilityStatus: 'ACCEPTED' };
        if (event.eventType === 'approval.rejected')
            this.current = { ...this.current, approvalStatus: 'rejected', caseStatus: 'BLOCKED', responsibilityStatus: 'WAITING_INPUT', blockedReason: 'approval_rejected' };
        if (event.eventType === 'action.execution.started')
            this.current = { ...this.current, caseStatus: 'EXECUTING', actionId: stringValue(payload.actionId) ?? this.current.actionId };
        if (event.eventType === 'action.receipt.received')
            this.current = { ...this.current, caseStatus: 'VERIFYING', receiptStatus: payload.status === 'succeeded' || payload.status === 'failed' ? payload.status : this.current.receiptStatus };
        if (event.eventType === 'outcome.recorded')
            this.current = { ...this.current, outcomeStatus: payload.status === 'succeeded' || payload.status === 'failed' || payload.status === 'blocked' ? payload.status : this.current.outcomeStatus, responsibilityStatus: payload.status === 'succeeded' ? 'RELEASED' : 'ESCALATED', slaStatus: payload.status === 'succeeded' ? 'MET' : 'ESCALATED' };
        if (event.eventType === 'retro.recorded')
            this.current = { ...this.current, retroRecorded: true };
        if (event.eventType === 'case.status.changed')
            this.current = { ...this.current, caseStatus: payload.status, blockedReason: stringValue(payload.reason) ?? this.current.blockedReason, taskStatus: payload.status === 'CLOSED' ? 'CLOSED' : this.current.taskStatus };
    }
    snapshot(caseId, taskId) {
        const current = { ...this.current, caseId, taskId };
        return { ...current, externalWrite: false };
    }
}
function stringValue(value) { return typeof value === 'string' ? value : undefined; }
function createFixture(scenario) {
    const evidence = scenario === 'missing_evidence' ? [] : ['ev_inventory_001'];
    const shared = { version: COMMERCE_OBJECT_VERSION, tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND, ownerId: OWNER, updatedAt: NOW };
    const product = { objectType: 'Product', objectId: 'product_001', ...shared, name: '示例洗衣液', categoryId: 'category_laundry', status: 'ACTIVE', evidenceRefs: scenario === 'missing_evidence' ? [] : ['ev_product_001'] };
    const sku = { objectType: 'SKU', objectId: 'sku_001', ...shared, skuId: 'sku_001', productId: product.objectId, title: '示例洗衣液 1kg', status: 'ACTIVE', evidenceRefs: scenario === 'missing_evidence' ? [] : ['ev_sku_001'] };
    const category = { objectType: 'Category', objectId: 'category_laundry', ...shared, name: '家庭清洁', parentId: null, status: 'ACTIVE', evidenceRefs: ['ev_category_001'] };
    const inventory = { objectType: 'Inventory', objectId: 'inventory_001', ...shared, skuId: sku.skuId, warehouseId: 'warehouse_001', available: 8, reserved: 2, reorderPoint: 20, safetyStock: 12, status: 'LOW', evidenceRefs: evidence };
    const warehouse = { objectType: 'Warehouse', objectId: 'warehouse_001', ...shared, warehouseId: 'warehouse_001', name: '华东一号仓', status: 'ACTIVE', evidenceRefs: ['ev_warehouse_001'] };
    const channel = { objectType: 'Channel', objectId: 'channel_tmall_001', ...shared, channelId: 'channel_tmall_001', platform: 'mock', shopId: 'shop_demo_alpha', status: 'READ_ONLY', evidenceRefs: ['ev_channel_001'] };
    const caseId = `case_inventory_${scenario}`;
    const taskId = `task_inventory_${scenario}`;
    const triggerEventId = `evt_inventory_low_${scenario}`;
    const atomInput = { triggerEventId, caseId, inventory: { skuId: inventory.skuId, available: inventory.available, reserved: inventory.reserved, reorderPoint: inventory.reorderPoint, safetyStock: inventory.safetyStock, evidenceRefs: inventory.evidenceRefs }, sku: { skuId: sku.skuId, productId: sku.productId, title: sku.title, evidenceRefs: sku.evidenceRefs }, product: { productId: product.objectId, name: product.name, evidenceRefs: product.evidenceRefs } };
    const trigger = { eventId: triggerEventId, eventType: 'inventory.threshold.breached', tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND, subject: { type: 'Inventory', id: inventory.objectId }, payload: { skuId: inventory.skuId, available: inventory.available, reserved: inventory.reserved, reorderPoint: inventory.reorderPoint, safetyStock: inventory.safetyStock, threshold: 'reorder_point', evidenceRefs: inventory.evidenceRefs }, source: { type: 'fixture', ref: 'inventory-alert-fixture-v1' }, evidenceRefs: inventory.evidenceRefs, confidence: scenario === 'missing_evidence' ? 0.2 : 1, occurredAt: NOW, observedAt: NOW, correlationId: caseId, causationId: null, schemaVersion: COMMERCE_EVENT_VERSION };
    return { product, sku, category, inventory, warehouse, channel, atomInput, trigger, objectIds: { productId: product.objectId, skuId: sku.skuId, categoryId: category.objectId, inventoryId: inventory.objectId, warehouseId: warehouse.warehouseId, channelId: channel.channelId, caseId, taskId } };
}
function makeEvent(parent, eventType, eventId, subject, payload) {
    return { ...parent, eventId, eventType, subject, payload, source: { type: 'product-domain-demo', ref: eventId }, evidenceRefs: parent.evidenceRefs, confidence: 1, occurredAt: NOW, observedAt: NOW, correlationId: parent.correlationId, causationId: parent.eventId, schemaVersion: COMMERCE_EVENT_VERSION };
}
export function createInventoryAlertDemoRunner(options = {}) {
    const ledger = new EventLedger(options.eventLogPath ? new JsonlEventStore(options.eventLogPath, ['event.v1', COMMERCE_EVENT_VERSION]) : undefined);
    const approvals = new ApprovalService({ ledger, tenantId: TENANT, enterpriseId: ENTERPRISE, brandId: BRAND, schemaVersion: COMMERCE_EVENT_VERSION });
    return new InventoryAlertWorkflow(ledger, approvals);
}
export async function runInventoryAlertDemo(scenario = 'normal') {
    return createInventoryAlertDemoRunner().run(scenario);
}
