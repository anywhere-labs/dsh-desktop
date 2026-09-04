import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EventLedger } from '../src/event-core/ledger.js'
import { JsonlEventStore } from '../src/event-core/persistence.js'

describe('JsonlEventStore', () => {
  it('persists events and restores them after a new ledger is created', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-ops-'))
    const filePath = join(directory, 'events.jsonl')
    const event = { eventId: 'evt_persist_001', eventType: 'demo.signal.created', tenantId: 'tenant_a', enterpriseId: 'ent_a', brandId: 'brand_a', subject: { type: 'product', id: 'p1' }, payload: { value: 1 }, source: { type: 'test', ref: 'fixture' }, evidenceRefs: [], confidence: 1, occurredAt: '2026-09-04T10:00:00+08:00', observedAt: '2026-09-04T10:00:00+08:00', correlationId: 'case_persist_001', causationId: null, schemaVersion: 'event.v1' } as const
    await new EventLedger(new JsonlEventStore(filePath)).append(event)
    const restored = new EventLedger(new JsonlEventStore(filePath))
    expect(restored.list({ tenantId: 'tenant_a' })).toEqual([event])
    expect(readFileSync(filePath, 'utf8').trim().split('\n')).toHaveLength(1)
  })
})
