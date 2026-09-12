import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EventLedger } from '../src/event-core/ledger.js'
import { PartitionedJsonlEventStore, JsonlEventStore } from '../src/event-core/persistence.js'
import { CommerceOpsService } from '../src/host/commerce-ops-service.js'

const baseEvent = { eventId: 'evt_p_001', eventType: 'demo.signal.created', tenantId: 'tenant_a', enterpriseId: 'ent_a', brandId: 'brand_a', subject: { type: 'product', id: 'p1' }, payload: { value: 1 }, source: { type: 'test', ref: 'fixture' }, evidenceRefs: [], confidence: 1, occurredAt: '2026-09-04T10:00:00+08:00', observedAt: '2026-09-04T10:00:00+08:00', correlationId: 'case_p_001', causationId: null, schemaVersion: 'event.v1' } as const

describe('partitioned event store', () => {
  it('writes one file per tenant and restores across partitions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'commerce-ops-partition-'))
    const store = new PartitionedJsonlEventStore(dir)
    const ledger = new EventLedger(store)
    await ledger.append(baseEvent)
    await ledger.append({ ...baseEvent, eventId: 'evt_p_002', tenantId: 'tenant_b', correlationId: 'case_p_002' })

    // two partition files
    expect(readFileSync(join(dir, 'tenant_a.events.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(readFileSync(join(dir, 'tenant_b.events.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)

    const restored = new EventLedger(new PartitionedJsonlEventStore(dir))
    expect(restored.list({ tenantId: 'tenant_a' })).toHaveLength(1)
    expect(restored.list({ tenantId: 'tenant_b' })).toHaveLength(1)
    expect(restored.list()).toHaveLength(2)
  })

  it('rejects unknown schema versions on read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'commerce-ops-version-'))
    const file = join(dir, 'events.jsonl')
    const store = new JsonlEventStore(file)
    const ledger = new EventLedger(store)
    await ledger.append(baseEvent)
    // append a future-version event (bypass validation on append by writing raw)
    const { appendFileSync } = await import('node:fs')
    appendFileSync(file, `${JSON.stringify({ ...baseEvent, eventId: 'evt_future', schemaVersion: 'event.v99' })}\n`, 'utf8')
    expect(() => new EventLedger(new JsonlEventStore(file))).toThrow(/unsupported event schema version/)
  })
})

describe('demo idempotency', () => {
  it('seedAgentSpaceDemo is idempotent across repeated calls on one service', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'commerce-ops-demo-'))
    const service = new CommerceOpsService({ eventLogDir: dir })
    const first = await service.seedAgentSpaceDemo()
    const second = await service.seedAgentSpaceDemo()
    expect(second.events).toHaveLength(first.events.length)
    expect(service.getAgentSpaceSnapshot().events.length).toBe(first.events.length)
  })
})
