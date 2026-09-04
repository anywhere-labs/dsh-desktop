import { describe, expect, it } from 'vitest'
import { CommerceOpsService } from '../src/host/commerce-ops-service.js'

describe('CommerceOpsService workflow', () => {
  it('builds a traceable daily report from connector data through Skill Runtime', async () => {
    const result = await new CommerceOpsService().runDailyReport('shop_001', '2026-09-01')
    expect(result.status).toBe('completed')
    expect(result.report.metrics).toHaveLength(5)
    expect(result.report.evidenceIds.length).toBe(5)
    expect(result.trace.skillId).toBe('shop.daily_report')
  })
})
