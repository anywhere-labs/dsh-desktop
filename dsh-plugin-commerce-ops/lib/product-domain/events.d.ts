import { z } from 'zod';
import { type BusinessEvent } from '../event-core/contracts.js';
export declare const COMMERCE_EVENT_VERSION: "commerce.event.v1";
export declare const commerceEventTypes: readonly ["product.created", "product.updated", "sku.created", "sku.updated", "category.updated", "inventory.updated", "inventory.threshold.breached", "channel.connected", "channel.authorization.changed", "order.created", "order.signal.created", "campaign.created", "campaign.status.changed", "live.started", "live.ended", "warehouse.updated", "voc.signal.created", "customer.lifecycle.changed", "case.created", "case.status.changed", "price.changed", "competitor.price.changed", "approval.requested", "approval.approved", "approval.rejected", "task.status.changed", "action.execution.started", "action.execution.completed", "action.execution.failed", "action.receipt.received", "outcome.recorded", "retro.recorded"];
export type CommerceEventType = typeof commerceEventTypes[number];
export declare const commerceEventPayloadSchemas: Record<CommerceEventType, z.ZodTypeAny>;
export declare function parseCommerceEvent(input: unknown): BusinessEvent;
