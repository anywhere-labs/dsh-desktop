import { z } from 'zod'
import { businessEventSchema, type BusinessEvent } from '../event-core/contracts.js'

export const COMMERCE_EVENT_VERSION = 'commerce.event.v1' as const

export const commerceEventTypes = [
  'product.created', 'product.updated', 'sku.created', 'sku.updated', 'category.updated',
  'inventory.updated', 'inventory.threshold.breached', 'channel.connected', 'channel.authorization.changed',
  'order.created', 'order.signal.created', 'campaign.created', 'campaign.status.changed', 'live.started', 'live.ended',
  'warehouse.updated', 'voc.signal.created', 'customer.lifecycle.changed', 'case.created', 'case.status.changed',
  'price.changed', 'competitor.price.changed', 'approval.requested', 'approval.approved', 'approval.rejected',
  'task.status.changed', 'action.execution.started', 'action.execution.completed', 'action.execution.failed',
  'action.receipt.received', 'outcome.recorded', 'retro.recorded',
] as const

export type CommerceEventType = typeof commerceEventTypes[number]

const refList = z.array(z.string().min(1))
const objectChangePayload = z.object({ objectId: z.string().min(1), status: z.string().min(1), evidenceRefs: refList }).passthrough()
const inventoryThresholdPayload = z.object({
  skuId: z.string().min(1), available: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(), reorderPoint: z.number().int().nonnegative(), safetyStock: z.number().int().nonnegative(), threshold: z.enum(['reorder_point', 'safety_stock', 'out_of_stock']), evidenceRefs: refList,
}).passthrough()
const signalPayload = z.object({ signal: z.string().min(1), evidenceRefs: refList }).passthrough()
const approvalPayload = z.object({ approvalId: z.string().min(1), actionId: z.string().min(1), actorId: z.string().min(1).optional() }).passthrough()
const taskPayload = z.object({ taskId: z.string().min(1), status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CLOSED']), ownerId: z.string().min(1), reason: z.string().min(1).optional() }).passthrough()
const actionPayload = z.object({ actionId: z.string().min(1), caseId: z.string().min(1), mode: z.enum(['mock', 'dry_run']), externalWrite: z.literal(false) }).passthrough()
const receiptPayload = z.object({ receiptId: z.string().min(1), actionId: z.string().min(1), status: z.enum(['succeeded', 'failed']), mode: z.enum(['mock', 'dry_run']), externalWrite: z.literal(false) }).passthrough()
const outcomePayload = z.object({ caseId: z.string().min(1), status: z.enum(['succeeded', 'failed', 'blocked']), externalWrite: z.literal(false), summary: z.string().min(1) }).passthrough()
const retroPayload = z.object({ caseId: z.string().min(1), outcomeStatus: z.enum(['succeeded', 'failed', 'blocked']), lessons: z.array(z.string().min(1)), followUpTaskId: z.string().min(1).nullable() }).passthrough()

export const commerceEventPayloadSchemas: Record<CommerceEventType, z.ZodTypeAny> = {
  'product.created': objectChangePayload,
  'product.updated': objectChangePayload,
  'sku.created': objectChangePayload,
  'sku.updated': objectChangePayload,
  'category.updated': objectChangePayload,
  'inventory.updated': inventoryThresholdPayload,
  'inventory.threshold.breached': inventoryThresholdPayload,
  'channel.connected': objectChangePayload,
  'channel.authorization.changed': objectChangePayload,
  'order.created': objectChangePayload,
  'order.signal.created': signalPayload,
  'campaign.created': objectChangePayload,
  'campaign.status.changed': objectChangePayload,
  'live.started': objectChangePayload,
  'live.ended': objectChangePayload,
  'warehouse.updated': objectChangePayload,
  'voc.signal.created': signalPayload,
  'customer.lifecycle.changed': objectChangePayload,
  'case.created': z.object({ caseId: z.string().min(1), title: z.string().min(1), ownerId: z.string().min(1) }).passthrough(),
  'case.status.changed': z.object({ caseId: z.string().min(1), status: z.string().min(1) }).passthrough(),
  'price.changed': signalPayload,
  'competitor.price.changed': signalPayload,
  'approval.requested': approvalPayload,
  'approval.approved': approvalPayload,
  'approval.rejected': approvalPayload,
  'task.status.changed': taskPayload,
  'action.execution.started': actionPayload,
  'action.execution.completed': actionPayload,
  'action.execution.failed': actionPayload.extend({ errorCode: z.string().min(1) }),
  'action.receipt.received': receiptPayload,
  'outcome.recorded': outcomePayload,
  'retro.recorded': retroPayload,
}

export function parseCommerceEvent(input: unknown): BusinessEvent {
  const event = businessEventSchema.parse(input)
  if (!commerceEventTypes.includes(event.eventType as CommerceEventType)) throw new Error(`unsupported_commerce_event:${event.eventType}`)
  if (event.schemaVersion !== COMMERCE_EVENT_VERSION) throw new Error(`unsupported_commerce_event_schema:${event.schemaVersion}`)
  commerceEventPayloadSchemas[event.eventType as CommerceEventType].parse(event.payload)
  return event
}

