import { z } from 'zod';
export declare const eventTypeSchema: z.ZodString;
export declare const businessEventSchema: z.ZodObject<{
    eventId: z.ZodString;
    eventType: z.ZodString;
    tenantId: z.ZodString;
    enterpriseId: z.ZodString;
    brandId: z.ZodString;
    subject: z.ZodObject<{
        type: z.ZodString;
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        id: string;
    }, {
        type: string;
        id: string;
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    source: z.ZodObject<{
        type: z.ZodString;
        ref: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        ref: string;
    }, {
        type: string;
        ref: string;
    }>;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
    confidence: z.ZodNumber;
    occurredAt: z.ZodString;
    observedAt: z.ZodString;
    correlationId: z.ZodString;
    causationId: z.ZodNullable<z.ZodString>;
    schemaVersion: z.ZodString;
}, "strip", z.ZodTypeAny, {
    source: {
        type: string;
        ref: string;
    };
    payload: Record<string, unknown>;
    eventId: string;
    eventType: string;
    tenantId: string;
    enterpriseId: string;
    brandId: string;
    subject: {
        type: string;
        id: string;
    };
    evidenceRefs: string[];
    confidence: number;
    occurredAt: string;
    observedAt: string;
    correlationId: string;
    causationId: string | null;
    schemaVersion: string;
}, {
    source: {
        type: string;
        ref: string;
    };
    payload: Record<string, unknown>;
    eventId: string;
    eventType: string;
    tenantId: string;
    enterpriseId: string;
    brandId: string;
    subject: {
        type: string;
        id: string;
    };
    evidenceRefs: string[];
    confidence: number;
    occurredAt: string;
    observedAt: string;
    correlationId: string;
    causationId: string | null;
    schemaVersion: string;
}>;
export type BusinessEvent = z.infer<typeof businessEventSchema>;
export declare const caseStatusSchema: z.ZodEnum<["OPEN", "INVESTIGATING", "PROPOSED", "WAITING_HUMAN", "APPROVED", "EXECUTING", "VERIFYING", "CLOSED", "BLOCKED"]>;
export declare const responsibilityStatusSchema: z.ZodEnum<["UNASSIGNED", "CLAIMED", "IN_PROGRESS", "WAITING_INPUT", "ESCALATED", "ACCEPTED", "RELEASED"]>;
export declare const caseRecordSchema: z.ZodObject<{
    caseId: z.ZodString;
    tenantId: z.ZodString;
    enterpriseId: z.ZodString;
    brandId: z.ZodString;
    title: z.ZodString;
    triggerEventId: z.ZodString;
    status: z.ZodEnum<["OPEN", "INVESTIGATING", "PROPOSED", "WAITING_HUMAN", "APPROVED", "EXECUTING", "VERIFYING", "CLOSED", "BLOCKED"]>;
    ownerId: z.ZodNullable<z.ZodString>;
    responsibilityStatus: z.ZodEnum<["UNASSIGNED", "CLAIMED", "IN_PROGRESS", "WAITING_INPUT", "ESCALATED", "ACCEPTED", "RELEASED"]>;
    taskIds: z.ZodArray<z.ZodString, "many">;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "OPEN" | "INVESTIGATING" | "PROPOSED" | "WAITING_HUMAN" | "APPROVED" | "EXECUTING" | "VERIFYING" | "CLOSED" | "BLOCKED";
    title: string;
    tenantId: string;
    enterpriseId: string;
    brandId: string;
    evidenceRefs: string[];
    caseId: string;
    triggerEventId: string;
    ownerId: string | null;
    responsibilityStatus: "UNASSIGNED" | "CLAIMED" | "IN_PROGRESS" | "WAITING_INPUT" | "ESCALATED" | "ACCEPTED" | "RELEASED";
    taskIds: string[];
    createdAt: string;
    updatedAt: string;
}, {
    status: "OPEN" | "INVESTIGATING" | "PROPOSED" | "WAITING_HUMAN" | "APPROVED" | "EXECUTING" | "VERIFYING" | "CLOSED" | "BLOCKED";
    title: string;
    tenantId: string;
    enterpriseId: string;
    brandId: string;
    evidenceRefs: string[];
    caseId: string;
    triggerEventId: string;
    ownerId: string | null;
    responsibilityStatus: "UNASSIGNED" | "CLAIMED" | "IN_PROGRESS" | "WAITING_INPUT" | "ESCALATED" | "ACCEPTED" | "RELEASED";
    taskIds: string[];
    createdAt: string;
    updatedAt: string;
}>;
export type CaseRecord = z.infer<typeof caseRecordSchema>;
export type CasePatch = Partial<Pick<CaseRecord, 'status' | 'ownerId' | 'responsibilityStatus' | 'taskIds' | 'evidenceRefs'>>;
