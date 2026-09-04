const metricNames = { '支付转化率': 'shop.conversion_rate', 'GMV': 'shop.gmv', '支付订单数': 'shop.paid_orders', '访客数': 'shop.unique_visitors', '客单价': 'shop.average_order_value' };
export function normalizeShopMetric(raw, context) {
    const metricId = metricNames[raw.name];
    if (!metricId)
        throw new Error(`unmapped platform metric: ${raw.name}`);
    const value = typeof raw.value === 'number' ? raw.value : Number(raw.value);
    if (!Number.isFinite(value))
        throw new Error(`invalid metric value: ${raw.name}`);
    return { metricId, value, unit: raw.unit, period: context.period, source: { platform: context.platform, shopId: context.shopId, evidenceId: raw.evidenceId } };
}
