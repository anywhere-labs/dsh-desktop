export class AnalysisService {
    analyze(bundle) {
        const cards = bundle.metrics.map(metric => ({ metricId: metric.metricId, value: metric.value, unit: metric.unit }));
        const charts = bundle.metrics.map(metric => ({ type: 'trend', metricId: metric.metricId, points: [{ label: bundle.source.capturedAt, value: metric.value }] }));
        return { dashboard: { cards, charts }, insight: { status: 'ready_for_human_review', conclusion: `已从${bundle.source.platform}页面采集 ${String(cards.length)} 项指标，等待人工判断。`, evidenceIds: [bundle.acquisitionId, ...bundle.metrics.map(metric => metric.source.evidenceId)] } };
    }
}
