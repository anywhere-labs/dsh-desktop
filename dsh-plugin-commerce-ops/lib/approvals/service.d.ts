import type { ActionProposal } from '../contracts/index.js';
import type { EventLedger } from '../event-core/ledger.js';
type ApprovalStatus = 'pending' | 'approved' | 'rejected';
type ApprovalAction = Omit<ActionProposal, 'approvalId'>;
export interface ApprovalRecord {
    readonly approvalId: string;
    readonly action: ApprovalAction;
    readonly requesterId: string;
    readonly status: ApprovalStatus;
    readonly approverId?: string;
}
export interface ApprovalEventContext {
    readonly ledger: EventLedger;
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly brandId: string;
}
export declare class ApprovalService {
    private readonly eventContext?;
    private readonly records;
    constructor(eventContext?: ApprovalEventContext | undefined);
    create(action: ApprovalAction, requesterId: string): ApprovalRecord;
    approve(approvalId: string, approverId: string): ApprovalRecord;
    reject(approvalId: string, approverId: string): ApprovalRecord;
    list(): readonly ApprovalRecord[];
    assertExecutable(action: ActionProposal): void;
    private require;
    private emit;
    private rehydrate;
}
export {};
