import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CommerceOpsService } from '../src/host/commerce-ops-service.js'

const caseId = 'case_demo_competitor_price_001'

describe('human board responsibility write-back', () => {
  it('projects human actions into board views and writes them back to the event ledger', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-ops-human-'))
    const service = new CommerceOpsService({ eventLogPath: join(directory, 'events.jsonl') })
    await service.seedAgentSpaceDemo()

    const boardAll = service.getHumanBoard('local-user')
    expect(boardAll.find(view => view.key === 'all')?.responsibilities.length).toBe(1)

    // claim -> shows in owned view + responsibility.claimed event
    service.claimResponsibility(caseId, 'local-user')
    let responsibility = service.getAgentSpaceSnapshot().responsibilities[0]
    expect(responsibility.ownerId).toBe('local-user')
    expect(responsibility.responsibilityStatus).toBe('CLAIMED')
    expect(service.getHumanBoard('local-user').find(view => view.key === 'owned')?.responsibilities.length).toBe(1)

    // accept -> ACCEPTED
    service.acceptResponsibility(caseId, 'local-user')
    responsibility = service.getAgentSpaceSnapshot().responsibilities[0]
    expect(responsibility.responsibilityStatus).toBe('ACCEPTED')

    // transfer -> new owner CLAIMED
    service.transferResponsibility(caseId, 'local-user', 'human_brand_owner_001')
    responsibility = service.getAgentSpaceSnapshot().responsibilities[0]
    expect(responsibility.ownerId).toBe('human_brand_owner_001')
    expect(responsibility.responsibilityStatus).toBe('CLAIMED')

    // release -> owner null RELEASED
    service.releaseResponsibility(caseId, 'human_brand_owner_001')
    responsibility = service.getAgentSpaceSnapshot().responsibilities[0]
    expect(responsibility.ownerId).toBeNull()
    expect(responsibility.responsibilityStatus).toBe('RELEASED')

    // all actions are persisted as events
    const eventTypes = service.getAgentSpaceSnapshot().events.map(event => event.eventType)
    expect(eventTypes).toContain('responsibility.claimed')
    expect(eventTypes).toContain('responsibility.accepted')
    expect(eventTypes).toContain('responsibility.transferred')
    expect(eventTypes).toContain('responsibility.released')
  })

  it('exposes the five human board entry views with labels', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-ops-human-'))
    const service = new CommerceOpsService({ eventLogPath: join(directory, 'events.jsonl') })
    await service.seedAgentSpaceDemo()
    const views = service.getHumanBoard('local-user')
    expect(views.map(view => view.key)).toEqual(['all', 'waiting-confirm', 'waiting-approval', 'owned', 'blocked-timeout'])
    expect(views.map(view => view.label)).toEqual(['全部', '待我确认', '待我审核', '我负责', '被阻塞超时'])
  })
})
