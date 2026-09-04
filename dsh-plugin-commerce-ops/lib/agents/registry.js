export const agentDefinitions = [
    { agentId: 'event-coordinator', role: '事件接入、路由和 Case 创建', subscribesTo: ['*'], skillIds: ['event.validate'], humanOwnerRole: '运营协调人', notResponsibleFor: ['经营决策', '对外执行'] },
    { agentId: 'competitor-intelligence', role: '识别竞品关系和外部经营信号', subscribesTo: ['competitor.price.changed', 'competitor.content.published'], skillIds: ['competitor.resolve_product'], humanOwnerRole: '市场研究负责人', notResponsibleFor: ['改价', '广告投放'] },
    { agentId: 'product-intelligence', role: '评估商品、价格和 SKU 影响', subscribesTo: ['competitor.price.changed'], skillIds: ['competitor.fetch_price_history', 'product.assess_impact'], humanOwnerRole: '商品负责人', notResponsibleFor: ['未经批准改价'] },
    { agentId: 'brand-strategy', role: '形成经营假设和响应方案', subscribesTo: ['competitor.price.changed'], skillIds: ['strategy.generate_options'], humanOwnerRole: '品牌负责人', notResponsibleFor: ['替人审批'] },
    { agentId: 'coordination', role: '同步人看板、审批和责任', subscribesTo: ['competitor.price.changed'], skillIds: ['collaboration.request_approval'], humanOwnerRole: '项目负责人', notResponsibleFor: ['绕过审批执行'] },
    { agentId: 'action-executor', role: '执行已批准动作并返回可审计回执', subscribesTo: ['approval.approved'], skillIds: ['action.execute_approved'], humanOwnerRole: '执行负责人', notResponsibleFor: ['批准自己的动作', '执行未授权真实写入'] },
    { agentId: 'receipt-verifier', role: '校验动作回执并推进 Case 状态', subscribesTo: ['action.receipt.received'], skillIds: ['receipt.verify'], humanOwnerRole: '运营协调人', notResponsibleFor: ['修改外部回执'] },
    { agentId: 'retro', role: '接收回执并形成复盘事件', subscribesTo: ['action.receipt.received'], skillIds: ['outcome.record'], humanOwnerRole: '经营分析负责人', notResponsibleFor: ['篡改原始证据'] },
];
export function getAgent(agentId) {
    const definition = agentDefinitions.find(item => item.agentId === agentId);
    if (!definition)
        throw new Error(`agent_not_found:${agentId}`);
    return definition;
}
