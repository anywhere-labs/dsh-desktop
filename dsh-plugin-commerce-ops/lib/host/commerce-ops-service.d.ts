import { type ShopMetricsResult } from '../connectors/mock.js';
import { type RuleEvaluation } from '../policies/rule-engine.js';
import { ApprovalService, type ApprovalRecord } from '../approvals/service.js';
import { type CapturePage } from '../connectors/browser-capture.js';
import { type AgentSpaceSnapshot, type HumanBoardView, type BoardViewKey } from '../event-core/space.js';
import { HumanDecisionService, type HumanDecision } from '../decision/service.js';
import { type ResponsibilityRecord, type SlaRecord, type NotificationRecord } from '../governance/service.js';
export interface CommerceOpsRuntime {
    readonly state: 'READY';
    readonly mode: 'mock';
    readonly connector: 'mock';
}
export declare class CommerceOpsService {
    readonly runtime: CommerceOpsRuntime;
    private readonly connector;
    private readonly skillRuntime;
    private readonly approvalService;
    private readonly ruleEngine;
    private readonly browserCapture;
    private readonly eventLedger;
    private readonly humanDecisionService;
    private readonly permissionService;
    private readonly responsibilityService;
    private readonly notificationService;
    private readonly slaService;
    constructor(options?: {
        readonly eventLogPath?: string;
        readonly eventLogDir?: string;
    });
    getShopMetrics(shopId: string, from: string, to: string): Promise<ShopMetricsResult>;
    runDailyReport(shopId: string, date: string): Promise<{
        readonly status: 'completed';
        readonly report: {
            readonly metrics: readonly ShopMetricsResult['metrics'][number][];
            readonly evidenceIds: readonly string[];
        };
        readonly trace: {
            readonly skillId: string;
            readonly runId: string;
        };
    }>;
    dryRun(input: Record<string, unknown>): {
        readonly executed: false;
        readonly policy: RuleEvaluation;
    };
    createApproval(action: Parameters<ApprovalService['create']>[0], requesterId: string): ApprovalRecord;
    listApprovals(): readonly ApprovalRecord[];
    approve(approvalId: string, approverId: string): ApprovalRecord;
    reject(approvalId: string, approverId: string): ApprovalRecord;
    assertExecutable(action: Parameters<ApprovalService['assertExecutable']>[0]): void;
    getAgentSpaceSnapshot(tenantId?: string): AgentSpaceSnapshot;
    recordHumanDecision(decision: HumanDecision): ReturnType<HumanDecisionService['record']>;
    transferResponsibility(caseId: string, fromUserId: string, toUserId: string): ResponsibilityRecord;
    claimResponsibility(caseId: string, actorId: string): ResponsibilityRecord;
    acceptResponsibility(caseId: string, actorId: string): ResponsibilityRecord;
    releaseResponsibility(caseId: string, ownerId: string): ResponsibilityRecord;
    startSla(caseId: string, ownerId: string, durationMs: number, now?: Date): SlaRecord;
    evaluateSla(now?: Date): readonly SlaRecord[];
    listNotifications(): readonly NotificationRecord[];
    getHumanBoard(actorId: string): HumanBoardView[];
    getBoardView(actorId: string, key: BoardViewKey): HumanBoardView;
    seedAgentSpaceDemo(): Promise<AgentSpaceSnapshot>;
    captureBrowserPage(page: CapturePage, options: {
        readonly userAuthorized: boolean;
        readonly shopId: string;
        readonly period: {
            readonly from: string;
            readonly to: string;
        };
    }): Promise<{
        readonly metrics: readonly import('../contracts/index.js').MetricSnapshot[];
        readonly links: readonly string[];
        readonly evidence: {
            readonly kind: 'browser-visible-dom';
            readonly capturedAt: string;
        };
    }>;
}
