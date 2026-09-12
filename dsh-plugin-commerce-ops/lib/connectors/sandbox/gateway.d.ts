import type { ApprovalService } from '../../approvals/service.js';
import type { ActionProposal } from '../../contracts/index.js';
import { type PlatformId, type SandboxCapability, type SandboxEnvironment, type SandboxScenario } from './contracts.js';
export interface SandboxExecutionRequest {
    readonly platformId: PlatformId;
    readonly environment: SandboxEnvironment;
    readonly capability: SandboxCapability;
    readonly credentialRef?: string;
    readonly idempotencyKey: string;
    readonly actionProposal: ActionProposal;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly scenario?: SandboxScenario;
}
export interface SandboxReceipt {
    readonly receiptId: string;
    readonly auditId: string;
    readonly actionId: string;
    readonly platformId: PlatformId;
    readonly environment: SandboxEnvironment;
    readonly capability: SandboxCapability;
    readonly status: 'succeeded' | 'failed' | 'blocked';
    readonly failureCode?: string;
    readonly externalWrite: false;
    readonly isSimulated: boolean;
    readonly output: Readonly<Record<string, unknown>>;
}
export declare class PlatformSandboxGateway {
    private readonly approvals;
    private readonly receipts;
    private readonly executor;
    constructor(approvals: ApprovalService);
    execute(request: SandboxExecutionRequest): SandboxReceipt;
    private blocked;
    private failed;
    private store;
}
