import type { ApprovalService } from '../approvals/service.js';
import type { ActionProposal } from '../contracts/index.js';
export interface MockActionReceipt {
    readonly receiptId: string;
    readonly actionId: string;
    readonly approvalId: string;
    readonly status: 'succeeded';
    readonly mode: 'mock';
    readonly externalWrite: false;
    readonly executedAt: string;
    readonly result: Readonly<Record<string, unknown>>;
}
export declare class MockActionExecutor {
    private readonly approvals;
    constructor(approvals: ApprovalService);
    execute(action: ActionProposal): MockActionReceipt;
}
