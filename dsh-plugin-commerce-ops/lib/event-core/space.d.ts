import type { BusinessEvent } from './contracts.js';
export type BoardCaseStatus = 'OPEN' | 'INVESTIGATING' | 'PROPOSED' | 'WAITING_HUMAN' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'BLOCKED';
export type BoardResponsibilityStatus = 'UNASSIGNED' | 'CLAIMED' | 'IN_PROGRESS' | 'WAITING_INPUT' | 'ESCALATED' | 'ACCEPTED' | 'RELEASED';
export type BoardResponsibility = {
    readonly caseId: string;
    readonly brandId: string;
    readonly title: string;
    readonly ownerId: string | null;
    readonly caseStatus: BoardCaseStatus;
    readonly responsibilityStatus: BoardResponsibilityStatus;
    readonly blocked: boolean;
    readonly timeout: boolean;
};
export type BoardApproval = {
    readonly approvalId: string;
    readonly actionId: string;
    readonly caseId: string;
    readonly status: 'pending' | 'approved' | 'rejected';
    readonly approverId?: string;
};
export type BoardReceipt = {
    readonly receiptId: string;
    readonly actionId: string;
    readonly caseId: string;
    readonly status: string;
    readonly mode: string;
    readonly externalWrite: boolean;
};
export type AgentSpaceSnapshot = {
    readonly events: readonly BusinessEvent[];
    readonly responsibilities: readonly BoardResponsibility[];
    readonly approvals: readonly BoardApproval[];
    readonly receipts: readonly BoardReceipt[];
};
export type BoardViewKey = 'all' | 'waiting-confirm' | 'waiting-approval' | 'owned' | 'blocked-timeout';
export interface HumanBoardView {
    readonly key: BoardViewKey;
    readonly label: string;
    readonly responsibilities: readonly BoardResponsibility[];
    readonly approvals: readonly BoardApproval[];
}
export declare function buildAgentSpaceSnapshot(events: readonly BusinessEvent[]): AgentSpaceSnapshot;
export declare function getHumanBoard(snapshot: AgentSpaceSnapshot, actorId: string): HumanBoardView[];
