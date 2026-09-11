import { z } from 'zod';
export const TaskStateSchema = z.enum([
    'INTAKE', 'PLANNED', 'READY', 'RUNNING', 'VERIFYING', 'ACCEPTED', 'DELIVERED', 'ARCHIVED',
    'WAITING_INPUT', 'REPAIRING', 'BLOCKED', 'FAILED', 'CANCELLED', 'EXPIRED',
]);
export const ProductRecordSchema = z.object({
    id: z.string().min(1),
    title: z.string().trim().min(1),
    category: z.string().trim().min(1),
    price: z.number().nonnegative(),
    assetPaths: z.array(z.string().min(1)),
    description: z.string().optional(),
    updatedAt: z.string().datetime().optional(),
});
export const ArtifactRefSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['image', 'detail', 'video', 'copy', 'manifest']),
    path: z.string().min(1),
    valid: z.boolean(),
});
export const CommerceTaskSchema = z.object({
    id: z.string().min(1),
    type: z.enum(['content', 'publish', 'analytics', 'full_workflow']),
    productId: z.string().min(1).optional(),
    storeIds: z.array(z.string().min(1)),
    state: TaskStateSchema,
    input: z.record(z.unknown()),
    outputs: z.array(ArtifactRefSchema),
    checkpoint: z.object({ step: z.string(), updatedAt: z.string().datetime() }).optional(),
    approvalRequired: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});
export const VerificationResultSchema = z.object({
    process: z.enum(['PROCESS_EXITED', 'PROCESS_RUNNING', 'PROCESS_FAILED']),
    output: z.enum(['OUTPUT_VALID', 'OUTPUT_INVALID', 'OUTPUT_MISSING']),
    business: z.enum(['BUSINESS_ACCEPTED', 'BUSINESS_PENDING', 'BUSINESS_REJECTED']),
    delivery: z.enum(['DELIVERED', 'DELIVERY_PENDING', 'DELIVERY_BLOCKED']),
    reasons: z.array(z.string()),
});
export function safeAssetPath(value) {
    if (!value || value.includes('\u0000') || value.includes('..') || value.includes('\\') || value.startsWith('/')) {
        throw new Error('asset path must stay within the relative workspace');
    }
    return value;
}
