import { z } from 'zod';
export declare const metricSnapshotSchema: z.ZodObject<{
    metricId: z.ZodString;
    value: z.ZodNumber;
    unit: z.ZodString;
    period: z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        from: string;
        to: string;
    }, {
        from: string;
        to: string;
    }>;
    source: z.ZodObject<{
        platform: z.ZodString;
        shopId: z.ZodString;
        evidenceId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        platform: string;
        shopId: string;
        evidenceId: string;
    }, {
        platform: string;
        shopId: string;
        evidenceId: string;
    }>;
}, "strip", z.ZodTypeAny, {
    value: number;
    metricId: string;
    unit: string;
    period: {
        from: string;
        to: string;
    };
    source: {
        platform: string;
        shopId: string;
        evidenceId: string;
    };
}, {
    value: number;
    metricId: string;
    unit: string;
    period: {
        from: string;
        to: string;
    };
    source: {
        platform: string;
        shopId: string;
        evidenceId: string;
    };
}>;
export declare const actionProposalSchema: z.ZodEffects<z.ZodObject<{
    actionId: z.ZodString;
    actionType: z.ZodString;
    riskLevel: z.ZodEnum<["L0", "L1", "L2", "L3", "L4", "L5"]>;
    target: z.ZodObject<{
        platform: z.ZodString;
        shopId: z.ZodString;
        productId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        platform: string;
        shopId: string;
        productId?: string | undefined;
    }, {
        platform: string;
        shopId: string;
        productId?: string | undefined;
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    approvalId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    actionId: string;
    actionType: string;
    riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
    target: {
        platform: string;
        shopId: string;
        productId?: string | undefined;
    };
    payload: Record<string, unknown>;
    approvalId?: string | undefined;
}, {
    actionId: string;
    actionType: string;
    riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
    target: {
        platform: string;
        shopId: string;
        productId?: string | undefined;
    };
    payload: Record<string, unknown>;
    approvalId?: string | undefined;
}>, {
    actionId: string;
    actionType: string;
    riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
    target: {
        platform: string;
        shopId: string;
        productId?: string | undefined;
    };
    payload: Record<string, unknown>;
    approvalId?: string | undefined;
}, {
    actionId: string;
    actionType: string;
    riskLevel: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
    target: {
        platform: string;
        shopId: string;
        productId?: string | undefined;
    };
    payload: Record<string, unknown>;
    approvalId?: string | undefined;
}>;
export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>;
export type ActionProposal = z.infer<typeof actionProposalSchema>;
