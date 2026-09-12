import { z } from 'zod';
import { runInventoryThresholdAtom } from './atoms.js';
export const inventoryAlertSkillInputSchema = z.object({
    triggerEventId: z.string().min(1),
    caseId: z.string().min(1).optional(),
    inventory: z.object({ skuId: z.string().min(1), available: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(), reorderPoint: z.number().int().nonnegative(), safetyStock: z.number().int().nonnegative(), evidenceRefs: z.array(z.string().min(1)) }),
    sku: z.object({ skuId: z.string().min(1), productId: z.string().min(1), title: z.string().min(1), evidenceRefs: z.array(z.string().min(1)) }),
    product: z.object({ productId: z.string().min(1), name: z.string().min(1), evidenceRefs: z.array(z.string().min(1)) }),
});
export const inventoryAlertSkillOutputSchema = z.object({
    recommendedQuantity: z.number().int().nonnegative(),
    reason: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)),
    actionProposal: z.object({ actionId: z.string().min(1), actionType: z.literal('create_replenishment_proposal'), riskLevel: z.literal('L3'), target: z.object({ platform: z.literal('mock'), shopId: z.string().min(1), productId: z.string().min(1) }), payload: z.record(z.unknown()) }),
});
export const inventoryAlertSkillDefinition = {
    skillId: 'product.inventory_threshold.v1',
    version: '1.0.0',
    description: '将库存阈值事件转换为带证据的补货建议，不执行外部写入',
    inputSchema: inventoryAlertSkillInputSchema,
    outputSchema: inventoryAlertSkillOutputSchema,
    permissionScope: ['evidence.read', 'case.create', 'approval.request'],
    allowedTools: [],
    qaPolicy: 'required_evidence_and_deterministic_quantity',
    approvalPolicy: 'L3_human_approval_required',
    idempotencyKey: 'inventory-alert:{triggerEventId}:{skuId}',
    failureCodes: ['ATOM_MISSING_EVIDENCE', 'ATOM_INVALID_INVENTORY', 'ATOM_DUPLICATE_TRIGGER'],
    acceptanceCriteria: ['输出建议数量', '输出 evidenceRefs', 'actionProposal.externalWrite=false'],
    externalWrite: false,
};
export function runInventoryAlertSkill(input) {
    const result = runInventoryThresholdAtom(input);
    return inventoryAlertSkillOutputSchema.parse(result.output);
}
export function getProductSkill(skillId) {
    if (skillId !== inventoryAlertSkillDefinition.skillId)
        throw new Error(`product_skill_not_found:${skillId}`);
    return inventoryAlertSkillDefinition;
}
