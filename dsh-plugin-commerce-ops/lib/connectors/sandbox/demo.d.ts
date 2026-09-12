import { type ApprovalRecord } from '../../approvals/service.js';
import type { BusinessEvent } from '../../event-core/contracts.js';
import { type PlatformId, type SandboxEnvironment, type SandboxScenario } from './contracts.js';
import { type SandboxReceipt } from './gateway.js';
export type PlatformDemoScenario = SandboxScenario;
export interface PlatformSandboxDemoResult {
    readonly platformId: PlatformId;
    readonly scenario: PlatformDemoScenario;
    readonly environment: SandboxEnvironment;
    readonly caseId: string;
    readonly approval: ApprovalRecord | null;
    readonly receipt: SandboxReceipt;
    readonly eventTypes: readonly string[];
    readonly events: readonly BusinessEvent[];
    readonly final: {
        readonly outcomeStatus: 'succeeded' | 'failed' | 'blocked';
        readonly externalWrite: false;
        readonly isSimulated: boolean;
    };
}
export declare function runPlatformSandboxDemo(platformId: PlatformId, scenario?: PlatformDemoScenario, environment?: SandboxEnvironment): Promise<PlatformSandboxDemoResult>;
