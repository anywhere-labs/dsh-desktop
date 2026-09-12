import { EventLedger } from '../event-core/ledger.js';
import { ApprovalService, type ApprovalRecord } from '../approvals/service.js';
import { type MockActionReceipt } from '../actions/mock-executor.js';
import type { ActionProposal } from '../contracts/index.js';
import type { BusinessEvent } from '../event-core/contracts.js';
export type InventoryAlertScenario = 'normal' | 'approval_rejected' | 'action_failed' | 'missing_evidence';
type WorkflowState = {
    caseId: string;
    caseStatus: 'OPEN' | 'INVESTIGATING' | 'PROPOSED' | 'WAITING_HUMAN' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'BLOCKED';
    taskId: string;
    taskStatus: 'OPEN' | 'IN_PROGRESS' | 'WAITING_APPROVAL' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CLOSED';
    ownerId: string;
    responsibilityStatus: 'CLAIMED' | 'WAITING_INPUT' | 'ACCEPTED' | 'ESCALATED' | 'RELEASED';
    approvalStatus: 'pending' | 'approved' | 'rejected';
    actionId: string | null;
    receiptStatus: 'succeeded' | 'failed' | null;
    outcomeStatus: 'succeeded' | 'failed' | 'blocked' | null;
    retroRecorded: boolean;
    blockedReason: string | null;
    slaDueAt: string;
    slaStatus: 'OPEN' | 'MET' | 'ESCALATED';
};
export interface InventoryAlertDemoResult {
    readonly scenario: InventoryAlertScenario;
    readonly agentId: string;
    readonly atomId: string;
    readonly objectIds: Readonly<Record<string, string>>;
    readonly events: readonly BusinessEvent[];
    readonly eventTypes: readonly string[];
    readonly approval: ApprovalRecord | null;
    readonly action: ActionProposal | null;
    readonly receipt: MockActionReceipt | {
        readonly status: 'failed';
        readonly mode: 'mock';
        readonly externalWrite: false;
        readonly receiptId: string;
        readonly actionId: string;
    } | null;
    readonly outcome: {
        readonly status: 'succeeded' | 'failed' | 'blocked';
        readonly externalWrite: false;
    } | null;
    readonly retro: {
        readonly recorded: true;
        readonly followUpTaskId: string | null;
    } | null;
    readonly final: {
        readonly caseId: string;
        readonly caseStatus: WorkflowState['caseStatus'];
        readonly taskId: string;
        readonly taskStatus: WorkflowState['taskStatus'];
        readonly ownerId: string;
        readonly responsibilityStatus: WorkflowState['responsibilityStatus'];
        readonly approvalStatus: WorkflowState['approvalStatus'];
        readonly receiptStatus: WorkflowState['receiptStatus'];
        readonly outcomeStatus: WorkflowState['outcomeStatus'];
        readonly retroRecorded: boolean;
        readonly blockedReason: string | null;
        readonly slaDueAt: string;
        readonly slaStatus: WorkflowState['slaStatus'];
        readonly externalWrite: false;
    };
}
export declare class InventoryAlertWorkflow {
    private readonly ledger;
    private readonly approvals;
    private readonly router;
    private readonly cases;
    private readonly state;
    private readonly executor;
    constructor(ledger: EventLedger, approvals: ApprovalService);
    run(scenario?: InventoryAlertScenario): Promise<InventoryAlertDemoResult>;
    private handleEvent;
    private append;
    private appendOutcome;
    private appendRetro;
    private appendCaseStatus;
}
export declare function createInventoryAlertDemoRunner(options?: {
    readonly eventLogPath?: string;
}): InventoryAlertWorkflow;
export declare function runInventoryAlertDemo(scenario?: InventoryAlertScenario): Promise<InventoryAlertDemoResult>;
export {};
