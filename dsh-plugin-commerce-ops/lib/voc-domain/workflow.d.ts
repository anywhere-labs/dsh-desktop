import { ApprovalService, type ApprovalRecord } from '../approvals/service.js';
import { type MockActionReceipt } from '../actions/mock-executor.js';
import type { BusinessEvent } from '../event-core/contracts.js';
import { EventLedger } from '../event-core/ledger.js';
import { type Evidence, type SceneCluster, type SceneDictionaryNode, type SceneInstance, type VOCInsight, type VOCRecord } from './contracts.js';
export type VocWorkflowScenario = 'normal' | 'low_evidence';
interface VocWorkflowState {
    sceneStatus: 'PENDING_HUMAN_REVIEW' | 'APPROVED' | 'BLOCKED';
    caseStatus: 'OPEN' | 'WAITING_HUMAN' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'BLOCKED';
    taskStatus: 'OPEN' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'BLOCKED';
    ownerId: string;
    receiptStatus: 'succeeded' | 'failed' | null;
    outcomeStatus: 'succeeded' | 'blocked' | null;
    retroRecorded: boolean;
    blockedReason: string | null;
}
export interface Voc3WorkflowResult {
    readonly scenario: VocWorkflowScenario;
    readonly records: readonly VOCRecord[];
    readonly evidences: readonly Evidence[];
    readonly dictionaryNodes: readonly SceneDictionaryNode[];
    readonly sceneInstances: readonly SceneInstance[];
    readonly cluster: SceneCluster | null;
    readonly insight: VOCInsight | null;
    readonly approval: ApprovalRecord | null;
    readonly receipt: MockActionReceipt | null;
    readonly events: readonly BusinessEvent[];
    readonly eventTypes: readonly string[];
    readonly final: {
        readonly sceneStatus: VocWorkflowState['sceneStatus'];
        readonly caseStatus: VocWorkflowState['caseStatus'];
        readonly taskStatus: VocWorkflowState['taskStatus'];
        readonly ownerId: string;
        readonly receiptStatus: VocWorkflowState['receiptStatus'];
        readonly outcomeStatus: VocWorkflowState['outcomeStatus'];
        readonly retroRecorded: boolean;
        readonly blockedReason: string | null;
        readonly externalWrite: false;
    };
}
export declare class Voc3Workflow {
    private readonly ledger;
    private readonly approvals;
    private readonly router;
    private readonly cases;
    private readonly state;
    private readonly executor;
    constructor(ledger: EventLedger, approvals: ApprovalService);
    run(scenario?: VocWorkflowScenario): Promise<Voc3WorkflowResult>;
    private handle;
    private append;
    private readonly makeEvent;
}
export declare function createVoc3Workflow(): Voc3Workflow;
export declare function runVoc3Workflow(scenario?: VocWorkflowScenario): Promise<Voc3WorkflowResult>;
export {};
