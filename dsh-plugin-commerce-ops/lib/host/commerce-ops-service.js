import { MockCommerceConnector } from '../connectors/mock.js';
import { SkillRuntime } from '../skills/runtime.js';
import { RuleEngine } from '../policies/rule-engine.js';
import { ApprovalService } from '../approvals/service.js';
import { BrowserCapture } from '../connectors/browser-capture.js';
import { normalizeShopMetric } from '../connectors/field-mapping.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EventLedger } from '../event-core/ledger.js';
import { JsonlEventStore, PartitionedJsonlEventStore } from '../event-core/persistence.js';
import { buildAgentSpaceSnapshot, getHumanBoard } from '../event-core/space.js';
import { runApprovedCompetitorPriceChangeSimulation } from '../event-core/simulation.js';
import { HumanDecisionService } from '../decision/service.js';
import { NotificationService, PermissionService, ResponsibilityService, SlaService } from '../governance/service.js';
import { InventoryAlertWorkflow } from '../product-domain/workflow.js';
import { runPlatformSandboxDemo } from '../connectors/sandbox/index.js';
import { Voc3Workflow } from '../voc-domain/workflow.js';
export class CommerceOpsService {
    runtime = { state: 'READY', mode: 'mock', connector: 'mock' };
    connector = new MockCommerceConnector();
    skillRuntime = new SkillRuntime();
    approvalService;
    ruleEngine = new RuleEngine([{ ruleId: 'content.absolute.001', riskLevel: 'L3', field: 'title', forbidden: ['绝对有效', '第一', '顶级'] }]);
    browserCapture = new BrowserCapture();
    eventLedger;
    humanDecisionService;
    permissionService;
    responsibilityService;
    notificationService;
    slaService;
    inventoryAlertWorkflow;
    voc3Workflow;
    constructor(options = {}) {
        const supportedEventVersions = ['event.v1', 'commerce.event.v1'];
        const store = options.eventLogPath
            ? new JsonlEventStore(options.eventLogPath, supportedEventVersions)
            : new PartitionedJsonlEventStore(options.eventLogDir ?? join(homedir(), '.commerce-ops', 'events'), supportedEventVersions);
        this.eventLedger = new EventLedger(store);
        const context = { ledger: this.eventLedger, tenantId: 'tenant_demo_group', enterpriseId: 'enterprise_demo_a', brandId: 'brand_demo_alpha', schemaVersion: 'commerce.event.v1' };
        this.approvalService = new ApprovalService(context);
        this.humanDecisionService = new HumanDecisionService(context);
        this.permissionService = new PermissionService(context);
        this.permissionService.registerMember('human_brand_owner_001', context.tenantId, ['owner', 'approve_action', 'transfer_responsibility', 'accept_responsibility'], { persist: false });
        this.permissionService.registerMember('local-user', context.tenantId, ['approve_action', 'claim_responsibility', 'accept_responsibility', 'transfer_responsibility'], { persist: false });
        this.notificationService = new NotificationService(context);
        this.responsibilityService = new ResponsibilityService(context, this.permissionService);
        this.slaService = new SlaService(context, this.notificationService);
        this.inventoryAlertWorkflow = new InventoryAlertWorkflow(this.eventLedger, this.approvalService);
        this.voc3Workflow = new Voc3Workflow(this.eventLedger, this.approvalService);
    }
    getShopMetrics(shopId, from, to) {
        return this.connector.getShopMetrics({ shopId, from, to });
    }
    async runDailyReport(shopId, date) {
        const result = await this.skillRuntime.run({
            skillId: 'shop.daily_report',
            input: { shopId, date },
            steps: [{
                    id: 'collect',
                    run: async (input) => {
                        const metrics = await this.getShopMetrics(String(input.shopId), String(input.date), String(input.date));
                        return { ...input, metrics: metrics.metrics };
                    },
                }, {
                    id: 'render',
                    run: async (input) => ({ ...input, report: { metrics: input.metrics, evidenceIds: input.metrics.map(metric => metric.source.evidenceId) } }),
                }],
        });
        return { status: 'completed', report: result.output.report, trace: { skillId: result.skillId, runId: result.runId } };
    }
    dryRun(input) {
        return { executed: false, policy: this.ruleEngine.evaluate(input) };
    }
    createApproval(action, requesterId) {
        return this.approvalService.create(action, requesterId);
    }
    listApprovals() {
        return this.approvalService.list();
    }
    approve(approvalId, approverId) {
        this.permissionService.assertCan(approverId, 'tenant_demo_group', 'approve_action');
        return this.approvalService.approve(approvalId, approverId);
    }
    reject(approvalId, approverId) {
        this.permissionService.assertCan(approverId, 'tenant_demo_group', 'approve_action');
        return this.approvalService.reject(approvalId, approverId);
    }
    assertExecutable(action) {
        this.approvalService.assertExecutable(action);
    }
    getAgentSpaceSnapshot(tenantId) {
        return buildAgentSpaceSnapshot(this.eventLedger.list(tenantId ? { tenantId } : undefined));
    }
    recordHumanDecision(decision) { return this.humanDecisionService.record(decision); }
    transferResponsibility(caseId, fromUserId, toUserId) { return this.responsibilityService.transfer(caseId, fromUserId, toUserId); }
    claimResponsibility(caseId, actorId) { return this.responsibilityService.claim(caseId, actorId); }
    acceptResponsibility(caseId, actorId) { return this.responsibilityService.accept(caseId, actorId); }
    releaseResponsibility(caseId, ownerId) { return this.responsibilityService.release(caseId, ownerId); }
    startSla(caseId, ownerId, durationMs, now) { return this.slaService.start(caseId, ownerId, durationMs, now); }
    evaluateSla(now) { return this.slaService.evaluate(now); }
    listNotifications() { return this.notificationService.list(); }
    runInventoryAlertDemo(scenario = 'normal') {
        return this.inventoryAlertWorkflow.run(scenario);
    }
    runPlatformSandboxDemo(platformId, scenario = 'success', environment = 'demo') {
        return runPlatformSandboxDemo(platformId, scenario, environment);
    }
    runVocDemo(scenario = 'normal') {
        return this.voc3Workflow.run(scenario);
    }
    getHumanBoard(actorId) {
        return getHumanBoard(this.getAgentSpaceSnapshot(), actorId);
    }
    getBoardView(actorId, key) {
        const view = this.getHumanBoard(actorId).find(item => item.key === key);
        if (!view)
            throw new Error(`board_view_not_found:${key}`);
        return view;
    }
    async seedAgentSpaceDemo() {
        const result = await runApprovedCompetitorPriceChangeSimulation();
        // Idempotent: re-appending the same demo events must not grow the ledger.
        const existing = this.eventLedger.list({ tenantId: result.triggerEvent.tenantId }).map(event => event.eventId);
        const seen = new Set(existing);
        for (const event of result.events) {
            if (seen.has(event.eventId))
                continue;
            await this.eventLedger.append(event);
            seen.add(event.eventId);
        }
        return this.getAgentSpaceSnapshot(result.triggerEvent.tenantId);
    }
    async captureBrowserPage(page, options) {
        const captured = await this.browserCapture.capture(page, { userAuthorized: options.userAuthorized });
        const metrics = captured.metrics.map(item => normalizeShopMetric({ ...item, evidenceId: `browser:${options.shopId}:${captured.source.capturedAt}:${item.name}` }, { platform: 'browser', shopId: options.shopId, period: options.period }));
        return { metrics, links: captured.links, evidence: captured.source };
    }
}
