import { z } from 'zod';
export declare const inventoryAlertSkillInputSchema: z.ZodObject<{
    triggerEventId: z.ZodString;
    caseId: z.ZodOptional<z.ZodString>;
    inventory: z.ZodObject<{
        skuId: z.ZodString;
        available: z.ZodNumber;
        reserved: z.ZodNumber;
        reorderPoint: z.ZodNumber;
        safetyStock: z.ZodNumber;
        evidenceRefs: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        evidenceRefs: string[];
        skuId: string;
        available: number;
        reserved: number;
        reorderPoint: number;
        safetyStock: number;
    }, {
        evidenceRefs: string[];
        skuId: string;
        available: number;
        reserved: number;
        reorderPoint: number;
        safetyStock: number;
    }>;
    sku: z.ZodObject<{
        skuId: z.ZodString;
        productId: z.ZodString;
        title: z.ZodString;
        evidenceRefs: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        title: string;
        productId: string;
        evidenceRefs: string[];
        skuId: string;
    }, {
        title: string;
        productId: string;
        evidenceRefs: string[];
        skuId: string;
    }>;
    product: z.ZodObject<{
        productId: z.ZodString;
        name: z.ZodString;
        evidenceRefs: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        productId: string;
        evidenceRefs: string[];
        name: string;
    }, {
        productId: string;
        evidenceRefs: string[];
        name: string;
    }>;
}, "strip", z.ZodTypeAny, {
    triggerEventId: string;
    inventory: {
        evidenceRefs: string[];
        skuId: string;
        available: number;
        reserved: number;
        reorderPoint: number;
        safetyStock: number;
    };
    sku: {
        title: string;
        productId: string;
        evidenceRefs: string[];
        skuId: string;
    };
    product: {
        productId: string;
        evidenceRefs: string[];
        name: string;
    };
    caseId?: string | undefined;
}, {
    triggerEventId: string;
    inventory: {
        evidenceRefs: string[];
        skuId: string;
        available: number;
        reserved: number;
        reorderPoint: number;
        safetyStock: number;
    };
    sku: {
        title: string;
        productId: string;
        evidenceRefs: string[];
        skuId: string;
    };
    product: {
        productId: string;
        evidenceRefs: string[];
        name: string;
    };
    caseId?: string | undefined;
}>;
export declare const inventoryAlertSkillOutputSchema: z.ZodObject<{
    recommendedQuantity: z.ZodNumber;
    reason: z.ZodString;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
    actionProposal: z.ZodObject<{
        actionId: z.ZodString;
        actionType: z.ZodLiteral<"create_replenishment_proposal">;
        riskLevel: z.ZodLiteral<"L3">;
        target: z.ZodObject<{
            platform: z.ZodLiteral<"mock">;
            shopId: z.ZodString;
            productId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            shopId: string;
            productId: string;
            platform: "mock";
        }, {
            shopId: string;
            productId: string;
            platform: "mock";
        }>;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        riskLevel: "L3";
        actionId: string;
        actionType: "create_replenishment_proposal";
        target: {
            shopId: string;
            productId: string;
            platform: "mock";
        };
        payload: Record<string, unknown>;
    }, {
        riskLevel: "L3";
        actionId: string;
        actionType: "create_replenishment_proposal";
        target: {
            shopId: string;
            productId: string;
            platform: "mock";
        };
        payload: Record<string, unknown>;
    }>;
}, "strip", z.ZodTypeAny, {
    evidenceRefs: string[];
    reason: string;
    recommendedQuantity: number;
    actionProposal: {
        riskLevel: "L3";
        actionId: string;
        actionType: "create_replenishment_proposal";
        target: {
            shopId: string;
            productId: string;
            platform: "mock";
        };
        payload: Record<string, unknown>;
    };
}, {
    evidenceRefs: string[];
    reason: string;
    recommendedQuantity: number;
    actionProposal: {
        riskLevel: "L3";
        actionId: string;
        actionType: "create_replenishment_proposal";
        target: {
            shopId: string;
            productId: string;
            platform: "mock";
        };
        payload: Record<string, unknown>;
    };
}>;
export declare const inventoryAlertSkillDefinition: {
    skillId: string;
    version: string;
    description: string;
    inputSchema: z.ZodObject<{
        triggerEventId: z.ZodString;
        caseId: z.ZodOptional<z.ZodString>;
        inventory: z.ZodObject<{
            skuId: z.ZodString;
            available: z.ZodNumber;
            reserved: z.ZodNumber;
            reorderPoint: z.ZodNumber;
            safetyStock: z.ZodNumber;
            evidenceRefs: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            evidenceRefs: string[];
            skuId: string;
            available: number;
            reserved: number;
            reorderPoint: number;
            safetyStock: number;
        }, {
            evidenceRefs: string[];
            skuId: string;
            available: number;
            reserved: number;
            reorderPoint: number;
            safetyStock: number;
        }>;
        sku: z.ZodObject<{
            skuId: z.ZodString;
            productId: z.ZodString;
            title: z.ZodString;
            evidenceRefs: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            title: string;
            productId: string;
            evidenceRefs: string[];
            skuId: string;
        }, {
            title: string;
            productId: string;
            evidenceRefs: string[];
            skuId: string;
        }>;
        product: z.ZodObject<{
            productId: z.ZodString;
            name: z.ZodString;
            evidenceRefs: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            productId: string;
            evidenceRefs: string[];
            name: string;
        }, {
            productId: string;
            evidenceRefs: string[];
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        triggerEventId: string;
        inventory: {
            evidenceRefs: string[];
            skuId: string;
            available: number;
            reserved: number;
            reorderPoint: number;
            safetyStock: number;
        };
        sku: {
            title: string;
            productId: string;
            evidenceRefs: string[];
            skuId: string;
        };
        product: {
            productId: string;
            evidenceRefs: string[];
            name: string;
        };
        caseId?: string | undefined;
    }, {
        triggerEventId: string;
        inventory: {
            evidenceRefs: string[];
            skuId: string;
            available: number;
            reserved: number;
            reorderPoint: number;
            safetyStock: number;
        };
        sku: {
            title: string;
            productId: string;
            evidenceRefs: string[];
            skuId: string;
        };
        product: {
            productId: string;
            evidenceRefs: string[];
            name: string;
        };
        caseId?: string | undefined;
    }>;
    outputSchema: z.ZodObject<{
        recommendedQuantity: z.ZodNumber;
        reason: z.ZodString;
        evidenceRefs: z.ZodArray<z.ZodString, "many">;
        actionProposal: z.ZodObject<{
            actionId: z.ZodString;
            actionType: z.ZodLiteral<"create_replenishment_proposal">;
            riskLevel: z.ZodLiteral<"L3">;
            target: z.ZodObject<{
                platform: z.ZodLiteral<"mock">;
                shopId: z.ZodString;
                productId: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                shopId: string;
                productId: string;
                platform: "mock";
            }, {
                shopId: string;
                productId: string;
                platform: "mock";
            }>;
            payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            riskLevel: "L3";
            actionId: string;
            actionType: "create_replenishment_proposal";
            target: {
                shopId: string;
                productId: string;
                platform: "mock";
            };
            payload: Record<string, unknown>;
        }, {
            riskLevel: "L3";
            actionId: string;
            actionType: "create_replenishment_proposal";
            target: {
                shopId: string;
                productId: string;
                platform: "mock";
            };
            payload: Record<string, unknown>;
        }>;
    }, "strip", z.ZodTypeAny, {
        evidenceRefs: string[];
        reason: string;
        recommendedQuantity: number;
        actionProposal: {
            riskLevel: "L3";
            actionId: string;
            actionType: "create_replenishment_proposal";
            target: {
                shopId: string;
                productId: string;
                platform: "mock";
            };
            payload: Record<string, unknown>;
        };
    }, {
        evidenceRefs: string[];
        reason: string;
        recommendedQuantity: number;
        actionProposal: {
            riskLevel: "L3";
            actionId: string;
            actionType: "create_replenishment_proposal";
            target: {
                shopId: string;
                productId: string;
                platform: "mock";
            };
            payload: Record<string, unknown>;
        };
    }>;
    permissionScope: readonly ["evidence.read", "case.create", "approval.request"];
    allowedTools: readonly [];
    qaPolicy: "required_evidence_and_deterministic_quantity";
    approvalPolicy: "L3_human_approval_required";
    idempotencyKey: string;
    failureCodes: readonly ["ATOM_MISSING_EVIDENCE", "ATOM_INVALID_INVENTORY", "ATOM_DUPLICATE_TRIGGER"];
    acceptanceCriteria: readonly ["输出建议数量", "输出 evidenceRefs", "actionProposal.externalWrite=false"];
    externalWrite: false;
};
export type InventoryAlertSkillInput = z.infer<typeof inventoryAlertSkillInputSchema>;
export type InventoryAlertSkillOutput = z.infer<typeof inventoryAlertSkillOutputSchema>;
export declare function runInventoryAlertSkill(input: InventoryAlertSkillInput): InventoryAlertSkillOutput;
export declare function getProductSkill(skillId: string): typeof inventoryAlertSkillDefinition;
