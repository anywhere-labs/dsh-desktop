export const skillDefinitions = [
    { skillId: 'event.validate', description: '校验事件结构和租户边界', input: ['event'], output: ['validated_event'], mode: 'read_only', ownerAgentId: 'event-coordinator' },
    { skillId: 'competitor.resolve_product', description: '确认竞品商品身份和关系', input: ['event'], output: ['product_mapping', 'evidence_refs'], mode: 'read_only', ownerAgentId: 'competitor-intelligence' },
    { skillId: 'competitor.fetch_price_history', description: '读取公开或授权的价格快照', input: ['product_mapping'], output: ['price_history', 'evidence_refs'], mode: 'read_only', ownerAgentId: 'product-intelligence' },
    { skillId: 'product.assess_impact', description: '评估对本品牌商品的影响', input: ['price_history', 'brand_products'], output: ['impact_assessment', 'data_gaps'], mode: 'proposal', ownerAgentId: 'product-intelligence' },
    { skillId: 'strategy.generate_options', description: '生成可供人审核的响应方案', input: ['impact_assessment'], output: ['action_options'], mode: 'proposal', ownerAgentId: 'brand-strategy' },
    { skillId: 'collaboration.request_approval', description: '创建人工确认和审批事项', input: ['action_options'], output: ['approval_request'], mode: 'proposal', ownerAgentId: 'coordination' },
    { skillId: 'action.execute_approved', description: '仅执行已通过审批的动作', input: ['approved_action'], output: ['execution_receipt'], mode: 'execute', ownerAgentId: 'action-executor' },
    { skillId: 'receipt.verify', description: '校验执行回执并推进 Case 投影', input: ['execution_receipt'], output: ['verified_receipt'], mode: 'read_only', ownerAgentId: 'receipt-verifier' },
    { skillId: 'outcome.record', description: '记录执行回执和复盘结果', input: ['receipt'], output: ['outcome_event'], mode: 'read_only', ownerAgentId: 'retro' },
];
export function getSkill(skillId) {
    const definition = skillDefinitions.find(item => item.skillId === skillId);
    if (!definition)
        throw new Error(`skill_not_found:${skillId}`);
    return definition;
}
