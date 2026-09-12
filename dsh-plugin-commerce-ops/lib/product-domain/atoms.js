export const inventoryAlertAtomDefinition = {
    atomId: 'product.inventory_threshold.v1',
    domain: 'product-operations',
    input: ['inventory_snapshot', 'sku_snapshot', 'product_snapshot', 'trigger_event_id'],
    action: 'create_replenishment_proposal',
    output: ['recommended_quantity', 'reason', 'evidence_refs', 'action_proposal'],
    receiverDepartment: '商品运营部',
    humanOwnerRole: '商品负责人',
    notResponsibleFor: ['直接下采购单', '直接修改库存', '直接改价', '绕过审批执行'],
    permissionScope: ['evidence.read', 'case.create', 'approval.request'],
    idempotencyKey: 'inventory-alert:{triggerEventId}:{skuId}',
    failureCodes: ['ATOM_MISSING_EVIDENCE', 'ATOM_INVALID_INVENTORY', 'ATOM_DUPLICATE_TRIGGER'],
    acceptanceCriteria: ['建议数量可由输入确定性计算', '输出必须带证据引用', '高风险动作必须进入审批', 'externalWrite 必须为 false'],
};
export const productOperationsAgent = {
    agentId: 'product-operations-agent',
    subscribesTo: ['inventory.threshold.breached'],
    allowedAtomIds: [inventoryAlertAtomDefinition.atomId],
    allowedSkillIds: ['product.inventory_threshold.v1'],
    receiverDepartment: '商品运营部',
    humanOwnerRole: '商品负责人',
    credentials: 'none',
    externalWrite: false,
};
export function runInventoryThresholdAtom(input) {
    const evidenceRefs = [...new Set([...input.inventory.evidenceRefs, ...input.sku.evidenceRefs, ...input.product.evidenceRefs])];
    if (input.inventory.evidenceRefs.length === 0)
        throw new Error('ATOM_MISSING_EVIDENCE');
    const values = [input.inventory.available, input.inventory.reserved, input.inventory.reorderPoint, input.inventory.safetyStock];
    if (values.some(value => !Number.isInteger(value) || value < 0))
        throw new Error('ATOM_INVALID_INVENTORY');
    if (input.inventory.skuId !== input.sku.skuId || input.sku.productId !== input.product.productId)
        throw new Error('ATOM_INVALID_INVENTORY');
    const recommendedQuantity = Math.max(0, input.inventory.reorderPoint + input.inventory.safetyStock - input.inventory.available);
    const actionId = `act_replenishment_${input.inventory.skuId}_${input.triggerEventId}`;
    return {
        atomId: inventoryAlertAtomDefinition.atomId,
        status: 'completed',
        inputSummary: { triggerEventId: input.triggerEventId, skuId: input.inventory.skuId, productId: input.product.productId },
        output: {
            recommendedQuantity,
            reason: `可用库存${String(input.inventory.available)}低于补货阈值${String(input.inventory.reorderPoint)}，建议补足安全库存`,
            evidenceRefs,
            actionProposal: {
                actionId,
                actionType: 'create_replenishment_proposal',
                riskLevel: 'L3',
                target: { platform: 'mock', shopId: 'shop_demo_alpha', productId: input.product.productId },
                payload: { caseId: input.caseId ?? `case_inventory_${input.inventory.skuId}`, skuId: input.inventory.skuId, recommendedQuantity, externalWrite: false, evidenceRefs },
            },
        },
        externalWrite: false,
    };
}
export function orchestrateProductEvent(event, input) {
    if (event.eventType !== 'inventory.threshold.breached')
        throw new Error(`AGENT_UNSUPPORTED_EVENT:${event.eventType}`);
    if (event.eventId !== input.triggerEventId)
        throw new Error('AGENT_TRIGGER_MISMATCH');
    return runInventoryThresholdAtom(input);
}
