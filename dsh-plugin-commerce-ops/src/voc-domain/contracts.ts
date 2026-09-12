import { z } from 'zod'

export const VOC_SCENE_VERSION = 'voc.scene.v3' as const
export const VOC_RECORD_VERSION = 'voc.record.v1' as const

export const VOC_OBJECT_CATALOG = [
  { objectType: 'VOCRecord', purpose: '保存未经改写的用户声音和来源', ownerRole: '客服/用户研究负责人', notResponsibleFor: ['Agent改写原文'] },
  { objectType: 'Evidence', purpose: '保存来源、时间、链接和原始证据引用', ownerRole: '数据负责人', notResponsibleFor: ['用推测替代来源'] },
  { objectType: 'SceneDictionaryNode', purpose: '版本化标准场景词典', ownerRole: '用户研究负责人', notResponsibleFor: ['未经审核发布新节点'] },
  { objectType: 'SceneInstance', purpose: '单条VOC映射出的具体场景实例', ownerRole: 'VOC分析负责人', notResponsibleFor: ['冒充已确认事实'] },
  { objectType: 'SceneCluster', purpose: '多条场景实例的证据聚合', ownerRole: '经营分析负责人', notResponsibleFor: ['直接推断市场规模'] },
  { objectType: 'VOCInsight', purpose: '从场景聚类形成经营洞察', ownerRole: '经营分析负责人', notResponsibleFor: ['直接执行高风险动作'] },
  { objectType: 'BusinessCase', purpose: '跨部门经营协同单', ownerRole: '运营协调人', notResponsibleFor: ['替代人工决策'] },
  { objectType: 'Task', purpose: '分派给部门的可验收任务', ownerRole: '部门负责人', notResponsibleFor: ['无Owner关闭'] },
  { objectType: 'Decision', purpose: '人工确认、修改或拒绝记录', ownerRole: '业务负责人', notResponsibleFor: ['Agent代签'] },
  { objectType: 'Outcome', purpose: '动作后的可核验结果', ownerRole: '经营分析负责人', notResponsibleFor: ['把模拟回执当业务结果'] },
  { objectType: 'Retro', purpose: '复盘结论和后续任务', ownerRole: '经营负责人', notResponsibleFor: ['篡改原始证据'] },
] as const

export const vocEventTypes = [
  'voc.record.ingested', 'voc.record.normalized', 'voc.scene.instance.created', 'voc.scene.review.requested', 'voc.scene.approved',
  'voc.cluster.updated', 'voc.insight.proposed', 'case.created', 'task.status.changed', 'human.decision.recorded',
  'approval.requested', 'approval.approved', 'approval.rejected', 'action.execution.started', 'action.receipt.received',
  'outcome.recorded', 'retro.recorded', 'case.status.changed',
] as const

export type VocEventType = typeof vocEventTypes[number]

const evidenceRefs = z.array(z.string().min(1))
const shared = {
  tenantId: z.string().min(1), enterpriseId: z.string().min(1), brandId: z.string().min(1), ownerId: z.string().min(1), evidenceRefs, updatedAt: z.string().datetime({ offset: true }),
}

export const vocRecordSchema = z.object({
  vocId: z.string().min(1), recordVersion: z.literal(VOC_RECORD_VERSION), sourceType: z.enum(['review', 'customer_service', 'after_sale', 'survey', 'live_comment']), sourceRef: z.string().min(1), rawText: z.string().min(1), productId: z.string().min(1).nullable(), capturedAt: z.string().datetime({ offset: true }), status: z.enum(['RAW', 'NORMALIZED', 'CLASSIFIED']), ...shared,
})

export const evidenceSchema = z.object({
  evidenceId: z.string().min(1), kind: z.enum(['raw_voc', 'source_url', 'order_context', 'aggregate_metric']), sourceRef: z.string().min(1), capturedAt: z.string().datetime({ offset: true }), contentHash: z.string().min(1), ...shared,
})

export const sceneDictionaryNodeSchema = z.object({
  nodeId: z.string().min(1), version: z.literal(VOC_SCENE_VERSION), dimension: z.enum(['space', 'time', 'life_stage', 'trigger', 'task_jtbd', 'pain', 'constraint', 'emotion', 'social', 'decision_stage']), label: z.string().min(1), status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']), ownerId: z.string().min(1), evidenceRefs,
})

export const sceneInstanceSchema = z.object({
  instanceId: z.string().min(1), vocId: z.string().min(1), dictionaryVersion: z.literal(VOC_SCENE_VERSION), dimensions: z.object({ trigger: z.string().min(1), taskJtbd: z.string().min(1), pain: z.array(z.string().min(1)), constraint: z.array(z.string().min(1)), emotion: z.string().min(1), decisionStage: z.string().min(1) }), confidence: z.number().min(0).max(1), status: z.enum(['DRAFT', 'PENDING_HUMAN_REVIEW', 'APPROVED', 'BLOCKED']), ownerId: z.string().min(1), evidenceRefs,
})

export const sceneClusterSchema = z.object({
  clusterId: z.string().min(1), dictionaryVersion: z.literal(VOC_SCENE_VERSION), instanceIds: z.array(z.string().min(1)).min(1), signalCount: z.number().int().positive(), topPain: z.string().min(1), status: z.enum(['PROPOSED', 'CONFIRMED', 'BLOCKED']), ownerId: z.string().min(1), evidenceRefs,
})

export const vocInsightSchema = z.object({
  insightId: z.string().min(1), clusterId: z.string().min(1), conclusion: z.string().min(1), recommendations: z.array(z.string().min(1)).min(1), confidence: z.number().min(0).max(1), status: z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED']), ownerId: z.string().min(1), evidenceRefs,
})

export type VOCRecord = z.infer<typeof vocRecordSchema>
export type Evidence = z.infer<typeof evidenceSchema>
export type SceneDictionaryNode = z.infer<typeof sceneDictionaryNodeSchema>
export type SceneInstance = z.infer<typeof sceneInstanceSchema>
export type SceneCluster = z.infer<typeof sceneClusterSchema>
export type VOCInsight = z.infer<typeof vocInsightSchema>

