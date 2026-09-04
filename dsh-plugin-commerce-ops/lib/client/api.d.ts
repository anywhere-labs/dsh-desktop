export interface ApprovalView {
    readonly approvalId: string;
    readonly action: {
        readonly actionId: string;
        readonly actionType: string;
        readonly riskLevel: string;
        readonly target: {
            readonly platform: string;
            readonly shopId: string;
        };
    };
    readonly requesterId: string;
    readonly status: 'pending' | 'approved' | 'rejected';
}
export interface BoardResponsibility {
    readonly caseId: string;
    readonly brandId: string;
    readonly title: string;
    readonly ownerId: string | null;
    readonly caseStatus: 'OPEN' | 'INVESTIGATING' | 'PROPOSED' | 'WAITING_HUMAN' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'BLOCKED';
    readonly responsibilityStatus: 'UNASSIGNED' | 'CLAIMED' | 'IN_PROGRESS' | 'WAITING_INPUT' | 'ESCALATED' | 'ACCEPTED' | 'RELEASED';
    readonly blocked: boolean;
    readonly timeout: boolean;
}
export interface BoardApproval {
    readonly approvalId: string;
    readonly actionId: string;
    readonly caseId: string;
    readonly status: 'pending' | 'approved' | 'rejected';
    readonly approverId?: string;
}
export interface BoardReceipt {
    readonly receiptId: string;
    readonly actionId: string;
    readonly caseId: string;
    readonly status: string;
    readonly mode: string;
    readonly externalWrite: boolean;
}
export interface AgentSpaceSnapshot {
    readonly events: readonly {
        readonly eventId: string;
        readonly eventType: string;
        readonly correlationId: string;
        readonly brandId: string;
    }[];
    readonly responsibilities: readonly BoardResponsibility[];
    readonly approvals: readonly BoardApproval[];
    readonly receipts: readonly BoardReceipt[];
}
export interface HumanBoardView {
    readonly key: 'all' | 'waiting-confirm' | 'waiting-approval' | 'owned' | 'blocked-timeout';
    readonly label: string;
    readonly responsibilities: readonly BoardResponsibility[];
    readonly approvals: readonly BoardApproval[];
}
export type ResponsibilityAction = 'claim' | 'accept' | 'release' | 'transfer';
export declare function getAgentSpaceSnapshot(): Promise<AgentSpaceSnapshot>;
export declare function getHumanBoard(actorId?: string): Promise<readonly HumanBoardView[]>;
export declare function decideApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<ApprovalView>;
export declare function decideResponsibility(caseId: string, action: ResponsibilityAction, actorId?: string, toUserId?: string): Promise<unknown>;
export declare function seedAgentSpaceDemo(): Promise<AgentSpaceSnapshot>;
export declare function runDryRun(input: Record<string, unknown>): Promise<{
    readonly executed: false;
    readonly policy: {
        readonly status: string;
        readonly matches: readonly unknown[];
    };
}>;
export declare function listApprovals(): Promise<readonly ApprovalView[]>;
