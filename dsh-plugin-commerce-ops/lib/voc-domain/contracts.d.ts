import { z } from 'zod';
export declare const VOC_SCENE_VERSION: "voc.scene.v3";
export declare const VOC_RECORD_VERSION: "voc.record.v1";
export declare const VOC_OBJECT_CATALOG: readonly [{
    readonly objectType: "VOCRecord";
    readonly purpose: "保存未经改写的用户声音和来源";
    readonly ownerRole: "客服/用户研究负责人";
    readonly notResponsibleFor: readonly ["Agent改写原文"];
}, {
    readonly objectType: "Evidence";
    readonly purpose: "保存来源、时间、链接和原始证据引用";
    readonly ownerRole: "数据负责人";
    readonly notResponsibleFor: readonly ["用推测替代来源"];
}, {
    readonly objectType: "SceneDictionaryNode";
    readonly purpose: "版本化标准场景词典";
    readonly ownerRole: "用户研究负责人";
    readonly notResponsibleFor: readonly ["未经审核发布新节点"];
}, {
    readonly objectType: "SceneInstance";
    readonly purpose: "单条VOC映射出的具体场景实例";
    readonly ownerRole: "VOC分析负责人";
    readonly notResponsibleFor: readonly ["冒充已确认事实"];
}, {
    readonly objectType: "SceneCluster";
    readonly purpose: "多条场景实例的证据聚合";
    readonly ownerRole: "经营分析负责人";
    readonly notResponsibleFor: readonly ["直接推断市场规模"];
}, {
    readonly objectType: "VOCInsight";
    readonly purpose: "从场景聚类形成经营洞察";
    readonly ownerRole: "经营分析负责人";
    readonly notResponsibleFor: readonly ["直接执行高风险动作"];
}, {
    readonly objectType: "BusinessCase";
    readonly purpose: "跨部门经营协同单";
    readonly ownerRole: "运营协调人";
    readonly notResponsibleFor: readonly ["替代人工决策"];
}, {
    readonly objectType: "Task";
    readonly purpose: "分派给部门的可验收任务";
    readonly ownerRole: "部门负责人";
    readonly notResponsibleFor: readonly ["无Owner关闭"];
}, {
    readonly objectType: "Decision";
    readonly purpose: "人工确认、修改或拒绝记录";
    readonly ownerRole: "业务负责人";
    readonly notResponsibleFor: readonly ["Agent代签"];
}, {
    readonly objectType: "Outcome";
    readonly purpose: "动作后的可核验结果";
    readonly ownerRole: "经营分析负责人";
    readonly notResponsibleFor: readonly ["把模拟回执当业务结果"];
}, {
    readonly objectType: "Retro";
    readonly purpose: "复盘结论和后续任务";
    readonly ownerRole: "经营负责人";
    readonly notResponsibleFor: readonly ["篡改原始证据"];
}];
export declare const vocEventTypes: readonly ["voc.record.ingested", "voc.record.normalized", "voc.scene.instance.created", "voc.scene.review.requested", "voc.scene.approved", "voc.cluster.updated", "voc.insight.proposed", "case.created", "task.status.changed", "human.decision.recorded", "approval.requested", "approval.approved", "approval.rejected", "action.execution.started", "action.receipt.received", "outcome.recorded", "retro.recorded", "case.status.changed"];
export type VocEventType = typeof vocEventTypes[number];
export declare const vocRecordSchema: z.ZodObject<{
    tenantId: z.ZodString;
    enterpriseId: z.ZodString;
    brandId: z.ZodString;
    ownerId: z.ZodString;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
    updatedAt: z.ZodString;
    vocId: z.ZodString;
    recordVersion: z.ZodLiteral<"voc.record.v1">;
    sourceType: z.ZodEnum<["review", "customer_service", "after_sale", "survey", "live_comment"]>;
    sourceRef: z.ZodString;
    rawText: z.ZodString;
    productId: z.ZodNullable<z.ZodString>;
    capturedAt: z.ZodString;
    status: z.ZodEnum<["RAW", "NORMALIZED", "CLASSIFIED"]>;
}, "strip", z.ZodTypeAny, {
    status: "CLASSIFIED" | "RAW" | "NORMALIZED";
    tenantId: string;
    enterpriseId: string;
    brandId: string;
    productId: string | null;
    ownerId: string;
    evidenceRefs: string[];
    updatedAt: string;
    vocId: string;
    recordVersion: "voc.record.v1";
    sourceType: "review" | "customer_service" | "after_sale" | "survey" | "live_comment";
    sourceRef: string;
    rawText: string;
    capturedAt: string;
}, {
    status: "CLASSIFIED" | "RAW" | "NORMALIZED";
    tenantId: string;
    enterpriseId: string;
    brandId: string;
    productId: string | null;
    ownerId: string;
    evidenceRefs: string[];
    updatedAt: string;
    vocId: string;
    recordVersion: "voc.record.v1";
    sourceType: "review" | "customer_service" | "after_sale" | "survey" | "live_comment";
    sourceRef: string;
    rawText: string;
    capturedAt: string;
}>;
export declare const evidenceSchema: z.ZodObject<{
    tenantId: z.ZodString;
    enterpriseId: z.ZodString;
    brandId: z.ZodString;
    ownerId: z.ZodString;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
    updatedAt: z.ZodString;
    evidenceId: z.ZodString;
    kind: z.ZodEnum<["raw_voc", "source_url", "order_context", "aggregate_metric"]>;
    sourceRef: z.ZodString;
    capturedAt: z.ZodString;
    contentHash: z.ZodString;
}, "strip", z.ZodTypeAny, {
    tenantId: string;
    enterpriseId: string;
    brandId: string;
    ownerId: string;
    evidenceRefs: string[];
    updatedAt: string;
    sourceRef: string;
    capturedAt: string;
    evidenceId: string;
    kind: "raw_voc" | "source_url" | "order_context" | "aggregate_metric";
    contentHash: string;
}, {
    tenantId: string;
    enterpriseId: string;
    brandId: string;
    ownerId: string;
    evidenceRefs: string[];
    updatedAt: string;
    sourceRef: string;
    capturedAt: string;
    evidenceId: string;
    kind: "raw_voc" | "source_url" | "order_context" | "aggregate_metric";
    contentHash: string;
}>;
export declare const sceneDictionaryNodeSchema: z.ZodObject<{
    nodeId: z.ZodString;
    version: z.ZodLiteral<"voc.scene.v3">;
    dimension: z.ZodEnum<["space", "time", "life_stage", "trigger", "task_jtbd", "pain", "constraint", "emotion", "social", "decision_stage"]>;
    label: z.ZodString;
    status: z.ZodEnum<["DRAFT", "ACTIVE", "RETIRED"]>;
    ownerId: z.ZodString;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    label: string;
    status: "DRAFT" | "ACTIVE" | "RETIRED";
    ownerId: string;
    evidenceRefs: string[];
    version: "voc.scene.v3";
    nodeId: string;
    dimension: "time" | "space" | "life_stage" | "trigger" | "task_jtbd" | "pain" | "constraint" | "emotion" | "social" | "decision_stage";
}, {
    label: string;
    status: "DRAFT" | "ACTIVE" | "RETIRED";
    ownerId: string;
    evidenceRefs: string[];
    version: "voc.scene.v3";
    nodeId: string;
    dimension: "time" | "space" | "life_stage" | "trigger" | "task_jtbd" | "pain" | "constraint" | "emotion" | "social" | "decision_stage";
}>;
export declare const sceneInstanceSchema: z.ZodObject<{
    instanceId: z.ZodString;
    vocId: z.ZodString;
    dictionaryVersion: z.ZodLiteral<"voc.scene.v3">;
    dimensions: z.ZodObject<{
        trigger: z.ZodString;
        taskJtbd: z.ZodString;
        pain: z.ZodArray<z.ZodString, "many">;
        constraint: z.ZodArray<z.ZodString, "many">;
        emotion: z.ZodString;
        decisionStage: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        trigger: string;
        pain: string[];
        constraint: string[];
        emotion: string;
        taskJtbd: string;
        decisionStage: string;
    }, {
        trigger: string;
        pain: string[];
        constraint: string[];
        emotion: string;
        taskJtbd: string;
        decisionStage: string;
    }>;
    confidence: z.ZodNumber;
    status: z.ZodEnum<["DRAFT", "PENDING_HUMAN_REVIEW", "APPROVED", "BLOCKED"]>;
    ownerId: z.ZodString;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    status: "APPROVED" | "BLOCKED" | "DRAFT" | "PENDING_HUMAN_REVIEW";
    ownerId: string;
    evidenceRefs: string[];
    confidence: number;
    vocId: string;
    instanceId: string;
    dictionaryVersion: "voc.scene.v3";
    dimensions: {
        trigger: string;
        pain: string[];
        constraint: string[];
        emotion: string;
        taskJtbd: string;
        decisionStage: string;
    };
}, {
    status: "APPROVED" | "BLOCKED" | "DRAFT" | "PENDING_HUMAN_REVIEW";
    ownerId: string;
    evidenceRefs: string[];
    confidence: number;
    vocId: string;
    instanceId: string;
    dictionaryVersion: "voc.scene.v3";
    dimensions: {
        trigger: string;
        pain: string[];
        constraint: string[];
        emotion: string;
        taskJtbd: string;
        decisionStage: string;
    };
}>;
export declare const sceneClusterSchema: z.ZodObject<{
    clusterId: z.ZodString;
    dictionaryVersion: z.ZodLiteral<"voc.scene.v3">;
    instanceIds: z.ZodArray<z.ZodString, "many">;
    signalCount: z.ZodNumber;
    topPain: z.ZodString;
    status: z.ZodEnum<["PROPOSED", "CONFIRMED", "BLOCKED"]>;
    ownerId: z.ZodString;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    status: "PROPOSED" | "BLOCKED" | "CONFIRMED";
    ownerId: string;
    evidenceRefs: string[];
    dictionaryVersion: "voc.scene.v3";
    clusterId: string;
    instanceIds: string[];
    signalCount: number;
    topPain: string;
}, {
    status: "PROPOSED" | "BLOCKED" | "CONFIRMED";
    ownerId: string;
    evidenceRefs: string[];
    dictionaryVersion: "voc.scene.v3";
    clusterId: string;
    instanceIds: string[];
    signalCount: number;
    topPain: string;
}>;
export declare const vocInsightSchema: z.ZodObject<{
    insightId: z.ZodString;
    clusterId: z.ZodString;
    conclusion: z.ZodString;
    recommendations: z.ZodArray<z.ZodString, "many">;
    confidence: z.ZodNumber;
    status: z.ZodEnum<["PROPOSED", "ACCEPTED", "REJECTED"]>;
    ownerId: z.ZodString;
    evidenceRefs: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    status: "PROPOSED" | "ACCEPTED" | "REJECTED";
    ownerId: string;
    evidenceRefs: string[];
    confidence: number;
    clusterId: string;
    insightId: string;
    conclusion: string;
    recommendations: string[];
}, {
    status: "PROPOSED" | "ACCEPTED" | "REJECTED";
    ownerId: string;
    evidenceRefs: string[];
    confidence: number;
    clusterId: string;
    insightId: string;
    conclusion: string;
    recommendations: string[];
}>;
export type VOCRecord = z.infer<typeof vocRecordSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type SceneDictionaryNode = z.infer<typeof sceneDictionaryNodeSchema>;
export type SceneInstance = z.infer<typeof sceneInstanceSchema>;
export type SceneCluster = z.infer<typeof sceneClusterSchema>;
export type VOCInsight = z.infer<typeof vocInsightSchema>;
