import type { ActionProposal } from '../contracts/index.js';
import type { BusinessEvent } from '../event-core/contracts.js';
export type AgentAtomDefinition = {
    readonly atomId: string;
    readonly domain: 'product-operations';
    readonly input: readonly string[];
    readonly action: 'create_replenishment_proposal';
    readonly output: readonly string[];
    readonly receiverDepartment: string;
    readonly humanOwnerRole: string;
    readonly notResponsibleFor: readonly string[];
    readonly permissionScope: readonly string[];
    readonly idempotencyKey: string;
    readonly failureCodes: readonly string[];
    readonly acceptanceCriteria: readonly string[];
};
export declare const inventoryAlertAtomDefinition: AgentAtomDefinition;
export declare const productOperationsAgent: {
    agentId: string;
    subscribesTo: string[];
    allowedAtomIds: string[];
    allowedSkillIds: string[];
    receiverDepartment: string;
    humanOwnerRole: string;
    credentials: string;
    externalWrite: false;
};
export interface InventoryThresholdAtomInput {
    readonly triggerEventId: string;
    readonly caseId?: string;
    readonly inventory: {
        readonly skuId: string;
        readonly available: number;
        readonly reserved: number;
        readonly reorderPoint: number;
        readonly safetyStock: number;
        readonly evidenceRefs: readonly string[];
    };
    readonly sku: {
        readonly skuId: string;
        readonly productId: string;
        readonly title: string;
        readonly evidenceRefs: readonly string[];
    };
    readonly product: {
        readonly productId: string;
        readonly name: string;
        readonly evidenceRefs: readonly string[];
    };
}
export interface InventoryThresholdAtomOutput {
    readonly recommendedQuantity: number;
    readonly reason: string;
    readonly evidenceRefs: readonly string[];
    readonly actionProposal: Omit<ActionProposal, 'approvalId'>;
}
export interface AgentAtomRunResult<T> {
    readonly atomId: string;
    readonly status: 'completed';
    readonly inputSummary: Readonly<Record<string, string>>;
    readonly output: T;
    readonly externalWrite: false;
}
export declare function runInventoryThresholdAtom(input: InventoryThresholdAtomInput): AgentAtomRunResult<InventoryThresholdAtomOutput>;
export declare function orchestrateProductEvent(event: Pick<BusinessEvent, 'eventType' | 'eventId'>, input: InventoryThresholdAtomInput): AgentAtomRunResult<InventoryThresholdAtomOutput>;
