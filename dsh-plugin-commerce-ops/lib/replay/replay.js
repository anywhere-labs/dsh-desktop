import { normalizeShopMetric } from '../connectors/field-mapping.js';
export function replayShopMetrics(fixture) {
    return { metrics: fixture.response.data.map((item, index) => normalizeShopMetric({ ...item, evidenceId: `replay:${fixture.platform}:${fixture.shopId}:${String(index + 1)}` }, fixture)), replay: { replayed: true, source: 'redacted-fixture' } };
}
