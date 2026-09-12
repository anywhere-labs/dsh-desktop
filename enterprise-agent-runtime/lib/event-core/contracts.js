import { z } from 'zod';
export const eventTypeSchema = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9_-]+)+$/);
export const businessEventSchema = z.object({
    eventId: z.string().min(1),
    eventType: eventTypeSchema,
    tenantId: z.string().min(1),
    enterpriseId: z.string().min(1),
    brandId: z.string().min(1),
    subject: z.object({ type: z.string().min(1), id: z.string().min(1) }),
    payload: z.record(z.unknown()),
    source: z.object({ type: z.string().min(1), ref: z.string().min(1) }),
    evidenceRefs: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1),
    occurredAt: z.string().datetime({ offset: true }),
    observedAt: z.string().datetime({ offset: true }),
    correlationId: z.string().min(1),
    causationId: z.string().min(1).nullable(),
    schemaVersion: z.string().min(1),
});
export const caseStatusSchema = z.enum(['OPEN', 'INVESTIGATING', 'PROPOSED', 'WAITING_HUMAN', 'APPROVED', 'EXECUTING', 'VERIFYING', 'CLOSED', 'BLOCKED']);
export const responsibilityStatusSchema = z.enum(['UNASSIGNED', 'CLAIMED', 'IN_PROGRESS', 'WAITING_INPUT', 'ESCALATED', 'ACCEPTED', 'RELEASED']);
export const caseRecordSchema = z.object({
    caseId: z.string().min(1),
    tenantId: z.string().min(1),
    enterpriseId: z.string().min(1),
    brandId: z.string().min(1),
    title: z.string().min(1),
    triggerEventId: z.string().min(1),
    status: caseStatusSchema,
    ownerId: z.string().min(1).nullable(),
    responsibilityStatus: responsibilityStatusSchema,
    taskIds: z.array(z.string().min(1)),
    evidenceRefs: z.array(z.string().min(1)),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
});
