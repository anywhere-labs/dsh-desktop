import type { AcquisitionBundle } from '../browser-acquisition/contracts.js'

export class AnalysisService {
  analyze(bundle: Pick<AcquisitionBundle, 'acquisitionId' | 'metrics' | 'source'>): {
    readonly dashboard: { readonly cards: readonly { readonly metricId: string; readonly value: number; readonly unit: string }[]; readonly charts: readonly { readonly type: 'trend'; readonly metricId: string; readonly points: readonly { readonly label: string; readonly value: number }[] }[] }
    readonly insight: { readonly status: 'ready_for_human_review'; readonly conclusion: string; readonly evidenceIds: readonly string[] }
  } {
    const cards = bundle.metrics.map(metric => ({ metricId: metric.metricId, value: metric.value, unit: metric.unit }))
    const charts = bundle.metrics.map(metric => ({ type: 'trend' as const, metricId: metric.metricId, points: [{ label: bundle.source.capturedAt, value: metric.value }] }))
    return { dashboard: { cards, charts }, insight: { status: 'ready_for_human_review', conclusion: `已从${bundle.source.platform}页面采集 ${String(cards.length)} 项指标，等待人工判断。`, evidenceIds: [bundle.acquisitionId, ...bundle.metrics.map(metric => metric.source.evidenceId)] } }
  }
}
