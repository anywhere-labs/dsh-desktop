import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CommerceOpsService } from '../src/host/commerce-ops-service.js'

describe('CommerceOpsService Agent Space persistence', () => {
  it('restores event, responsibility, approval and receipt projections after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-ops-space-'))
    const eventLogPath = join(directory, 'events.jsonl')
    const first = new CommerceOpsService({ eventLogPath })
    const seeded = await first.seedAgentSpaceDemo()
    expect(seeded.events).toHaveLength(6)
    expect(seeded.responsibilities[0]).toMatchObject({ caseStatus: 'CLOSED', responsibilityStatus: 'RELEASED' })
    expect(seeded.approvals[0]).toMatchObject({ status: 'approved' })
    expect(seeded.receipts[0]).toMatchObject({ mode: 'mock', externalWrite: false })

    const restarted = new CommerceOpsService({ eventLogPath })
    expect(restarted.getAgentSpaceSnapshot('tenant_demo_group')).toEqual(seeded)
  })
})
