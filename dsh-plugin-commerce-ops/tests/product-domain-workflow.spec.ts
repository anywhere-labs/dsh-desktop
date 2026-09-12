import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventoryAlertAtomDefinition, runInventoryThresholdAtom } from '../src/product-domain/atoms.js'
import { inventoryAlertSkillDefinition, runInventoryAlertSkill } from '../src/product-domain/skills.js'
import { commerceObjectCatalog, productObjectSchema, inventoryObjectSchema } from '../src/product-domain/contracts.js'
import { commerceEventTypes, parseCommerceEvent } from '../src/product-domain/events.js'
import { createInventoryAlertDemoRunner, runInventoryAlertDemo } from '../src/product-domain/workflow.js'

describe('product domain contracts and inventory alert workflow', () => {
  it('defines versioned commerce objects with ownership and evidence boundaries', () => {
    expect(commerceObjectCatalog.map(item => item.objectType)).toEqual([
      'Product', 'SKU', 'Category', 'Inventory', 'Channel', 'Order', 'BusinessCase', 'Campaign', 'LiveSession', 'Warehouse', 'CustomerVOC', 'CustomerLifecycle',
    ])
    expect(productObjectSchema.parse({
      objectType: 'Product', objectId: 'product_001', version: 'commerce.object.v1', tenantId: 'tenant_demo_group', enterpriseId: 'enterprise_demo_a', brandId: 'brand_demo_alpha',
      name: '示例洗衣液', categoryId: 'category_laundry', status: 'ACTIVE', ownerId: 'product-owner', evidenceRefs: ['ev_product_001'], updatedAt: '2026-09-08T10:00:00+08:00',
    }).status).toBe('ACTIVE')
    expect(inventoryObjectSchema.parse({
      objectType: 'Inventory', objectId: 'inventory_001', version: 'commerce.object.v1', tenantId: 'tenant_demo_group', enterpriseId: 'enterprise_demo_a', brandId: 'brand_demo_alpha',
      skuId: 'sku_001', warehouseId: 'warehouse_001', available: 8, reserved: 2, reorderPoint: 20, safetyStock: 12, status: 'LOW', ownerId: 'warehouse-owner', evidenceRefs: ['ev_inventory_001'], updatedAt: '2026-09-08T10:00:00+08:00',
    }).available).toBe(8)
  })

  it('keeps the inventory alert atom single-action and human-gated', () => {
    expect(inventoryAlertAtomDefinition.action).toBe('create_replenishment_proposal')
    expect(inventoryAlertAtomDefinition.receiverDepartment).toBe('商品运营部')
    expect(inventoryAlertAtomDefinition.notResponsibleFor).toContain('直接下采购单')
    const result = runInventoryThresholdAtom({
      triggerEventId: 'evt_inventory_low_001',
      inventory: { skuId: 'sku_001', available: 8, reserved: 2, reorderPoint: 20, safetyStock: 12, evidenceRefs: ['ev_inventory_001'] },
      sku: { skuId: 'sku_001', productId: 'product_001', title: '示例洗衣液 1kg', evidenceRefs: ['ev_sku_001'] },
      product: { productId: 'product_001', name: '示例洗衣液', evidenceRefs: ['ev_product_001'] },
    })
    expect(result.output.recommendedQuantity).toBe(24)
    expect(result.output.actionProposal.riskLevel).toBe('L3')
    expect(result.output.actionProposal.payload.externalWrite).toBe(false)
  })

  it('runs the reusable Skill contract independently with schema-checked output', () => {
    const output = runInventoryAlertSkill({
      triggerEventId: 'evt_inventory_low_skill_001', caseId: 'case_inventory_skill_001',
      inventory: { skuId: 'sku_001', available: 8, reserved: 2, reorderPoint: 20, safetyStock: 12, evidenceRefs: ['ev_inventory_001'] },
      sku: { skuId: 'sku_001', productId: 'product_001', title: '示例洗衣液', evidenceRefs: ['ev_sku_001'] },
      product: { productId: 'product_001', name: '示例洗衣液', evidenceRefs: ['ev_product_001'] },
    })
    expect(inventoryAlertSkillDefinition.externalWrite).toBe(false)
    expect(inventoryAlertSkillDefinition.approvalPolicy).toBe('L3_human_approval_required')
    expect(output.recommendedQuantity).toBe(24)
    expect(output.actionProposal.payload.externalWrite).toBe(false)
  })

  it('validates the versioned event catalog and runs the normal closed loop', async () => {
    expect(commerceEventTypes).toContain('inventory.threshold.breached')
    expect(commerceEventTypes).toContain('retro.recorded')
    const parsed = parseCommerceEvent({
      eventId: 'evt_inventory_low_001', eventType: 'inventory.threshold.breached', tenantId: 'tenant_demo_group', enterpriseId: 'enterprise_demo_a', brandId: 'brand_demo_alpha',
      subject: { type: 'Inventory', id: 'inventory_001' }, payload: { skuId: 'sku_001', available: 8, reserved: 2, reorderPoint: 20, safetyStock: 12, threshold: 'reorder_point', evidenceRefs: ['ev_inventory_001'] },
      source: { type: 'fixture', ref: 'inventory-alert-fixture-v1' }, evidenceRefs: ['ev_inventory_001'], confidence: 1, occurredAt: '2026-09-08T10:00:00+08:00', observedAt: '2026-09-08T10:00:00+08:00', correlationId: 'case_inventory_001', causationId: null, schemaVersion: 'commerce.event.v1',
    })
    expect(parsed.eventType).toBe('inventory.threshold.breached')
    const result = await runInventoryAlertDemo('normal')
    expect(result.final.caseStatus).toBe('CLOSED')
    expect(result.final.taskStatus).toBe('CLOSED')
    expect(result.final.externalWrite).toBe(false)
    expect(result.eventTypes).toEqual([
      'inventory.threshold.breached', 'case.created', 'task.status.changed', 'approval.requested', 'approval.approved', 'task.status.changed',
      'action.execution.started', 'action.execution.completed', 'action.receipt.received', 'task.status.changed', 'outcome.recorded', 'retro.recorded', 'case.status.changed',
    ])
  })

  it('records rejected approval and failed mock action as terminal human-visible branches', async () => {
    const rejected = await runInventoryAlertDemo('approval_rejected')
    expect(rejected.final.caseStatus).toBe('BLOCKED')
    expect(rejected.final.taskStatus).toBe('BLOCKED')
    expect(rejected.final.blockedReason).toBe('approval_rejected')
    expect(rejected.eventTypes).toContain('approval.rejected')
    const failed = await runInventoryAlertDemo('action_failed')
    expect(failed.final.caseStatus).toBe('BLOCKED')
    expect(failed.final.taskStatus).toBe('FAILED')
    expect(failed.final.receiptStatus).toBe('failed')
    expect(failed.eventTypes).toContain('action.execution.failed')
    expect(failed.eventTypes).toContain('retro.recorded')
  })

  it('fails closed on missing evidence and is deterministic under replay', async () => {
    expect(() => runInventoryThresholdAtom({
      triggerEventId: 'evt_inventory_low_missing_evidence',
      inventory: { skuId: 'sku_001', available: 8, reserved: 2, reorderPoint: 20, safetyStock: 12, evidenceRefs: [] },
      sku: { skuId: 'sku_001', productId: 'product_001', title: '示例洗衣液', evidenceRefs: ['ev_sku_001'] },
      product: { productId: 'product_001', name: '示例洗衣液', evidenceRefs: ['ev_product_001'] },
    })).toThrow('ATOM_MISSING_EVIDENCE')
    const first = await runInventoryAlertDemo('normal')
    const replay = await runInventoryAlertDemo('normal')
    expect(replay.eventTypes).toEqual(first.eventTypes)
    expect(replay.events).toHaveLength(first.events.length)
    expect(new Set(replay.events.map(event => event.eventId)).size).toBe(replay.events.length)
  })

  it('restores the dynamic workflow from the event log without duplicating actions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'commerce-product-workflow-'))
    const eventLogPath = join(directory, 'events.jsonl')
    const first = await createInventoryAlertDemoRunner({ eventLogPath }).run('normal')
    const restarted = await createInventoryAlertDemoRunner({ eventLogPath }).run('normal')
    expect(restarted.final).toMatchObject({ caseStatus: 'CLOSED', taskStatus: 'CLOSED', receiptStatus: 'succeeded', externalWrite: false })
    expect(restarted.events).toHaveLength(first.events.length)
    expect(new Set(restarted.events.map(event => event.eventId)).size).toBe(first.events.length)
  })
})
