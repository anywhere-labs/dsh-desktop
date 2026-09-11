export class AnalyticsService {
    overview() { return { source: 'mock', cached: true, updatedAt: new Date().toISOString(), metrics: [{ label: '生成素材', value: 128 }, { label: '待审批任务', value: 4 }, { label: '店铺健康度', value: 98 }] }; }
}
