import { z } from 'zod';
const periodSchema = z.object({ from: z.string(), to: z.string() });
export const metricSnapshotSchema = z.object({
    metricId: z.string().min(1),
    value: z.number().finite(),
    unit: z.string().min(1),
    period: periodSchema,
    source: z.object({
        platform: z.string().min(1),
        shopId: z.string().min(1),
        evidenceId: z.string().min(1),
    }),
});
const actionRiskSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
export const actionProposalSchema = z
    .object({
    actionId: z.string().min(1),
    actionType: z.string().min(1),
    riskLevel: actionRiskSchema,
    target: z.object({
        platform: z.string().min(1),
        shopId: z.string().min(1),
        productId: z.string().optional(),
    }),
    payload: z.record(z.unknown()),
    approvalId: z.string().optional(),
})
    .superRefine((value, context) => {
    if (['L2', 'L3', 'L4', 'L5'].includes(value.riskLevel) && !value.approvalId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['approvalId'], message: 'approvalId is required for risky actions' });
    }
});
