import { describe, expect, it } from 'vitest'
import { runApprovedCompetitorPriceChangeSimulation, runCompetitorPriceChangeSimulation } from '../src/event-core/simulation.js'
import { EventLedger } from '../src/event-core/ledger.js'

describe('event-first commerce operations skeleton', () => {
  it('routes a competitor price event into a human-owned case', async () => {
    const result = await runCompetitorPriceChangeSimulation()
    expect(result.triggerEvent.eventType).toBe('competitor.price.changed')
    expect(result.routes).toEqual(['event-coordinator', 'competitor-intelligence', 'product-intelligence', 'brand-strategy', 'coordination'])
    expect(result.caseStatus).toBe('WAITING_HUMAN')
    expect(result.ownerId).toBe('human_brand_owner_001')
    expect(result.humanApprovalRequired).toBe(true)
    expect(result.events).toHaveLength(1)
  })

  it('is idempotent for duplicate event ids and isolates tenant projections', async () => {
    const ledger = new EventLedger()
    const event = {
      eventId: 'evt_1', eventType: 'demo.signal.created', tenantId: 'tenant_a', enterpriseId: 'ent_a', brandId: 'brand_a',
      subject: { type: 'product', id: 'p1' }, payload: {}, source: { type: 'mock', ref: 'fixture' }, evidenceRefs: [], confidence: 1,
      occurredAt: '2026-09-04T10:00:00+08:00', observedAt: '2026-09-04T10:00:00+08:00', correlationId: 'case_1', causationId: null, schemaVersion: 'event.v1',
    } as const
    await ledger.append(event)
    await ledger.append(event)
    expect(ledger.list({ tenantId: 'tenant_a' })).toHaveLength(1)
    expect(ledger.list({ tenantId: 'tenant_b' })).toHaveLength(0)
  })

  it('closes the case only after human approval, mock execution and receipt verification', async () => {
    const result = await runApprovedCompetitorPriceChangeSimulation()
    expect(result.eventTypes).toEqual([
      'competitor.price.changed',
      'approval.requested',
      'approval.approved',
      'action.execution.started',
      'action.receipt.received',
      'outcome.recorded',
    ])
    expect(result.receipt).toMatchObject({ status: 'succeeded', mode: 'mock', externalWrite: false })
    expect(result.finalCaseStatus).toBe('CLOSED')
    expect(result.responsibilityStatus).toBe('RELEASED')
  })
})
