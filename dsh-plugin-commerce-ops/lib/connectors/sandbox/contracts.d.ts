import { z } from 'zod';
import type { ActionProposal } from '../../contracts/index.js';
export declare const PLATFORM_CONNECTOR_VERSION: "commerce.connector.v1";
export declare const SANDBOX_EVENT_VERSION: "commerce.sandbox.event.v1";
export declare const platformIdSchema: z.ZodEnum<["douyin", "xiaohongshu"]>;
export declare const sandboxEnvironmentSchema: z.ZodEnum<["demo", "sandbox", "production"]>;
export declare const sandboxCapabilitySchema: z.ZodEnum<["read_metrics", "preview_product_content", "preview_inventory_sync"]>;
export declare const sandboxScenarioSchema: z.ZodEnum<["success", "failure", "action_failed", "approval_rejected", "credential_missing", "rate_limited", "unavailable"]>;
export type PlatformId = z.infer<typeof platformIdSchema>;
export type SandboxEnvironment = z.infer<typeof sandboxEnvironmentSchema>;
export type SandboxCapability = z.infer<typeof sandboxCapabilitySchema>;
export type SandboxScenario = z.infer<typeof sandboxScenarioSchema>;
export declare const platformCapabilitySchema: z.ZodObject<{
    capability: z.ZodEnum<["read_metrics", "preview_product_content", "preview_inventory_sync"]>;
    description: z.ZodString;
    inputSchema: z.ZodString;
    outputSchema: z.ZodString;
    riskLevel: z.ZodEnum<["L0", "L1", "L2", "L3", "L4", "L5"]>;
    approvalRequired: z.ZodBoolean;
    idempotencyKeyTemplate: z.ZodString;
}, "strip", z.ZodTypeAny, {
    capability: "read_metrics" | "preview_product_content" | "preview_inventory_sync";
    description: string;
    inputSchema: string;
    outputSchema: string;
    riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
    approvalRequired: boolean;
    idempotencyKeyTemplate: string;
}, {
    capability: "read_metrics" | "preview_product_content" | "preview_inventory_sync";
    description: string;
    inputSchema: string;
    outputSchema: string;
    riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
    approvalRequired: boolean;
    idempotencyKeyTemplate: string;
}>;
export declare const platformConnectorContractSchema: z.ZodObject<{
    contractVersion: z.ZodLiteral<"commerce.connector.v1">;
    platformId: z.ZodEnum<["douyin", "xiaohongshu"]>;
    displayName: z.ZodString;
    supportedEnvironments: z.ZodArray<z.ZodEnum<["demo", "sandbox", "production"]>, "many">;
    credentialRef: z.ZodNullable<z.ZodString>;
    credentialStorage: z.ZodLiteral<"external_reference_only">;
    scopes: z.ZodArray<z.ZodString, "many">;
    capabilities: z.ZodArray<z.ZodObject<{
        capability: z.ZodEnum<["read_metrics", "preview_product_content", "preview_inventory_sync"]>;
        description: z.ZodString;
        inputSchema: z.ZodString;
        outputSchema: z.ZodString;
        riskLevel: z.ZodEnum<["L0", "L1", "L2", "L3", "L4", "L5"]>;
        approvalRequired: z.ZodBoolean;
        idempotencyKeyTemplate: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        capability: "read_metrics" | "preview_product_content" | "preview_inventory_sync";
        description: string;
        inputSchema: string;
        outputSchema: string;
        riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
        approvalRequired: boolean;
        idempotencyKeyTemplate: string;
    }, {
        capability: "read_metrics" | "preview_product_content" | "preview_inventory_sync";
        description: string;
        inputSchema: string;
        outputSchema: string;
        riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
        approvalRequired: boolean;
        idempotencyKeyTemplate: string;
    }>, "many">;
    allowedActions: z.ZodArray<z.ZodString, "many">;
    forbiddenActions: z.ZodArray<z.ZodString, "many">;
    auditEventTypes: z.ZodArray<z.ZodString, "many">;
    externalWrite: z.ZodLiteral<false>;
    officialSandboxStatus: z.ZodLiteral<"NOT_VERIFIED_LOCAL_DEMO_ONLY">;
}, "strip", z.ZodTypeAny, {
    capabilities: {
        capability: "read_metrics" | "preview_product_content" | "preview_inventory_sync";
        description: string;
        inputSchema: string;
        outputSchema: string;
        riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
        approvalRequired: boolean;
        idempotencyKeyTemplate: string;
    }[];
    contractVersion: "commerce.connector.v1";
    platformId: "douyin" | "xiaohongshu";
    displayName: string;
    supportedEnvironments: ("demo" | "sandbox" | "production")[];
    credentialRef: string | null;
    credentialStorage: "external_reference_only";
    scopes: string[];
    allowedActions: string[];
    forbiddenActions: string[];
    auditEventTypes: string[];
    externalWrite: false;
    officialSandboxStatus: "NOT_VERIFIED_LOCAL_DEMO_ONLY";
}, {
    capabilities: {
        capability: "read_metrics" | "preview_product_content" | "preview_inventory_sync";
        description: string;
        inputSchema: string;
        outputSchema: string;
        riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
        approvalRequired: boolean;
        idempotencyKeyTemplate: string;
    }[];
    contractVersion: "commerce.connector.v1";
    platformId: "douyin" | "xiaohongshu";
    displayName: string;
    supportedEnvironments: ("demo" | "sandbox" | "production")[];
    credentialRef: string | null;
    credentialStorage: "external_reference_only";
    scopes: string[];
    allowedActions: string[];
    forbiddenActions: string[];
    auditEventTypes: string[];
    externalWrite: false;
    officialSandboxStatus: "NOT_VERIFIED_LOCAL_DEMO_ONLY";
}>;
export type PlatformConnectorContract = z.infer<typeof platformConnectorContractSchema>;
export declare const platformConnectorCatalog: readonly PlatformConnectorContract[];
export interface SandboxActionOptions {
    readonly platformId: PlatformId;
    readonly capability: SandboxCapability;
    readonly actionId: string;
    readonly idempotencyKey: string;
    readonly caseId?: string;
}
export declare function createSandboxActionProposal(options: SandboxActionOptions): Omit<ActionProposal, 'approvalId'>;
export declare function findPlatformContract(platformId: PlatformId): PlatformConnectorContract;
