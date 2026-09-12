import type { BusinessEvent } from './contracts.js';
import { type MockActionReceipt } from '../actions/mock-executor.js';
export type SimulationResult = {
    readonly triggerEvent: BusinessEvent;
    readonly caseId: string;
    readonly events: readonly BusinessEvent[];
    readonly routes: readonly string[];
    readonly caseStatus: string;
    readonly ownerId: string | null;
    readonly humanApprovalRequired: true;
};
export type CompletedSimulationResult = SimulationResult & {
    readonly approvalId: string;
    readonly actionId: string;
    readonly receipt: MockActionReceipt;
    readonly finalCaseStatus: 'CLOSED';
    readonly responsibilityStatus: 'RELEASED';
    readonly eventTypes: readonly string[];
};
export declare function runCompetitorPriceChangeSimulation(): Promise<SimulationResult>;
export declare function runApprovedCompetitorPriceChangeSimulation(): Promise<CompletedSimulationResult>;
