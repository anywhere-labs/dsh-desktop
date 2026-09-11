import { z } from 'zod';
export declare const TaskStateSchema: z.ZodEnum<["INTAKE", "PLANNED", "READY", "RUNNING", "VERIFYING", "ACCEPTED", "DELIVERED", "ARCHIVED", "WAITING_INPUT", "REPAIRING", "BLOCKED", "FAILED", "CANCELLED", "EXPIRED"]>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export declare const ProductRecordSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    category: z.ZodString;
    price: z.ZodNumber;
    assetPaths: z.ZodArray<z.ZodString, "many">;
    description: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    title: string;
    category: string;
    price: number;
    assetPaths: string[];
    description?: string | undefined;
    updatedAt?: string | undefined;
}, {
    id: string;
    title: string;
    category: string;
    price: number;
    assetPaths: string[];
    description?: string | undefined;
    updatedAt?: string | undefined;
}>;
export type ProductRecord = z.infer<typeof ProductRecordSchema>;
export declare const ArtifactRefSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<["image", "detail", "video", "copy", "manifest"]>;
    path: z.ZodString;
    valid: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    valid: boolean;
    path: string;
    id: string;
    kind: "image" | "detail" | "video" | "copy" | "manifest";
}, {
    valid: boolean;
    path: string;
    id: string;
    kind: "image" | "detail" | "video" | "copy" | "manifest";
}>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export declare const CommerceTaskSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["content", "publish", "analytics", "full_workflow"]>;
    productId: z.ZodOptional<z.ZodString>;
    storeIds: z.ZodArray<z.ZodString, "many">;
    state: z.ZodEnum<["INTAKE", "PLANNED", "READY", "RUNNING", "VERIFYING", "ACCEPTED", "DELIVERED", "ARCHIVED", "WAITING_INPUT", "REPAIRING", "BLOCKED", "FAILED", "CANCELLED", "EXPIRED"]>;
    input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    outputs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<["image", "detail", "video", "copy", "manifest"]>;
        path: z.ZodString;
        valid: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        valid: boolean;
        path: string;
        id: string;
        kind: "image" | "detail" | "video" | "copy" | "manifest";
    }, {
        valid: boolean;
        path: string;
        id: string;
        kind: "image" | "detail" | "video" | "copy" | "manifest";
    }>, "many">;
    checkpoint: z.ZodOptional<z.ZodObject<{
        step: z.ZodString;
        updatedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        updatedAt: string;
        step: string;
    }, {
        updatedAt: string;
        step: string;
    }>>;
    approvalRequired: z.ZodBoolean;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "content" | "publish" | "analytics" | "full_workflow";
    id: string;
    updatedAt: string;
    storeIds: string[];
    state: "INTAKE" | "PLANNED" | "READY" | "RUNNING" | "VERIFYING" | "ACCEPTED" | "DELIVERED" | "ARCHIVED" | "WAITING_INPUT" | "REPAIRING" | "BLOCKED" | "FAILED" | "CANCELLED" | "EXPIRED";
    input: Record<string, unknown>;
    outputs: {
        valid: boolean;
        path: string;
        id: string;
        kind: "image" | "detail" | "video" | "copy" | "manifest";
    }[];
    approvalRequired: boolean;
    createdAt: string;
    productId?: string | undefined;
    checkpoint?: {
        updatedAt: string;
        step: string;
    } | undefined;
}, {
    type: "content" | "publish" | "analytics" | "full_workflow";
    id: string;
    updatedAt: string;
    storeIds: string[];
    state: "INTAKE" | "PLANNED" | "READY" | "RUNNING" | "VERIFYING" | "ACCEPTED" | "DELIVERED" | "ARCHIVED" | "WAITING_INPUT" | "REPAIRING" | "BLOCKED" | "FAILED" | "CANCELLED" | "EXPIRED";
    input: Record<string, unknown>;
    outputs: {
        valid: boolean;
        path: string;
        id: string;
        kind: "image" | "detail" | "video" | "copy" | "manifest";
    }[];
    approvalRequired: boolean;
    createdAt: string;
    productId?: string | undefined;
    checkpoint?: {
        updatedAt: string;
        step: string;
    } | undefined;
}>;
export type CommerceTask = z.infer<typeof CommerceTaskSchema>;
export declare const VerificationResultSchema: z.ZodObject<{
    process: z.ZodEnum<["PROCESS_EXITED", "PROCESS_RUNNING", "PROCESS_FAILED"]>;
    output: z.ZodEnum<["OUTPUT_VALID", "OUTPUT_INVALID", "OUTPUT_MISSING"]>;
    business: z.ZodEnum<["BUSINESS_ACCEPTED", "BUSINESS_PENDING", "BUSINESS_REJECTED"]>;
    delivery: z.ZodEnum<["DELIVERED", "DELIVERY_PENDING", "DELIVERY_BLOCKED"]>;
    reasons: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    process: "PROCESS_EXITED" | "PROCESS_RUNNING" | "PROCESS_FAILED";
    output: "OUTPUT_VALID" | "OUTPUT_INVALID" | "OUTPUT_MISSING";
    business: "BUSINESS_ACCEPTED" | "BUSINESS_PENDING" | "BUSINESS_REJECTED";
    delivery: "DELIVERED" | "DELIVERY_PENDING" | "DELIVERY_BLOCKED";
    reasons: string[];
}, {
    process: "PROCESS_EXITED" | "PROCESS_RUNNING" | "PROCESS_FAILED";
    output: "OUTPUT_VALID" | "OUTPUT_INVALID" | "OUTPUT_MISSING";
    business: "BUSINESS_ACCEPTED" | "BUSINESS_PENDING" | "BUSINESS_REJECTED";
    delivery: "DELIVERED" | "DELIVERY_PENDING" | "DELIVERY_BLOCKED";
    reasons: string[];
}>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type EventRecord = {
    eventId: string;
    taskId: string;
    type: string;
    fromState?: TaskState;
    toState?: TaskState;
    actorId: string;
    timestamp: string;
    correlationId: string;
    summary: string;
};
export type ApiError = {
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
    requestId: string;
};
export declare function safeAssetPath(value: string): string;
