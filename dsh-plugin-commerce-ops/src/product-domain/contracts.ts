import { z } from 'zod'

export const COMMERCE_OBJECT_VERSION = 'commerce.object.v1' as const

const objectBase = {
  objectId: z.string().min(1),
  version: z.literal(COMMERCE_OBJECT_VERSION),
  tenantId: z.string().min(1),
  enterpriseId: z.string().min(1),
  brandId: z.string().min(1),
  ownerId: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
  updatedAt: z.string().datetime({ offset: true }),
}

const lifecycleStatus = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'])

export const productObjectSchema = z.object({
  objectType: z.literal('Product'),
  ...objectBase,
  name: z.string().min(1),
  categoryId: z.string().min(1),
  status: lifecycleStatus,
})

export const skuObjectSchema = z.object({
  objectType: z.literal('SKU'),
  ...objectBase,
  skuId: z.string().min(1),
  productId: z.string().min(1),
  title: z.string().min(1),
  status: lifecycleStatus,
})

export const categoryObjectSchema = z.object({
  objectType: z.literal('Category'),
  ...objectBase,
  name: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  status: lifecycleStatus,
})

export const inventoryObjectSchema = z.object({
  objectType: z.literal('Inventory'),
  ...objectBase,
  skuId: z.string().min(1),
  warehouseId: z.string().min(1),
  available: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  reorderPoint: z.number().int().nonnegative(),
  safetyStock: z.number().int().nonnegative(),
  status: z.enum(['HEALTHY', 'LOW', 'OUT_OF_STOCK', 'FROZEN']),
})

export const channelObjectSchema = z.object({
  objectType: z.literal('Channel'),
  ...objectBase,
  channelId: z.string().min(1),
  platform: z.string().min(1),
  shopId: z.string().min(1),
  status: z.enum(['CONNECTED', 'READ_ONLY', 'DISCONNECTED', 'BLOCKED']),
})

export const orderObjectSchema = z.object({
  objectType: z.literal('Order'),
  ...objectBase,
  orderId: z.string().min(1),
  channelId: z.string().min(1),
  status: z.enum(['CREATED', 'PAID', 'FULFILLING', 'COMPLETED', 'REFUNDED', 'CANCELLED']),
  totalAmount: z.number().nonnegative(),
})

export const businessCaseObjectSchema = z.object({
  objectType: z.literal('BusinessCase'),
  ...objectBase,
  caseId: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['OPEN', 'INVESTIGATING', 'PROPOSED', 'WAITING_HUMAN', 'APPROVED', 'EXECUTING', 'VERIFYING', 'CLOSED', 'BLOCKED']),
  triggerEventId: z.string().min(1),
})

export const campaignObjectSchema = z.object({
  objectType: z.literal('Campaign'),
  ...objectBase,
  campaignId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['PLANNED', 'RUNNING', 'PAUSED', 'ENDED']),
  channelIds: z.array(z.string().min(1)),
})

export const liveSessionObjectSchema = z.object({
  objectType: z.literal('LiveSession'),
  ...objectBase,
  liveSessionId: z.string().min(1),
  channelId: z.string().min(1),
  status: z.enum(['PLANNED', 'LIVE', 'ENDED', 'CANCELLED']),
  scheduledAt: z.string().datetime({ offset: true }),
})

export const warehouseObjectSchema = z.object({
  objectType: z.literal('Warehouse'),
  ...objectBase,
  warehouseId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']),
})

export const customerVocObjectSchema = z.object({
  objectType: z.literal('CustomerVOC'),
  ...objectBase,
  vocId: z.string().min(1),
  source: z.string().min(1),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'UNKNOWN']),
  topic: z.string().min(1),
  status: z.enum(['NEW', 'CLASSIFIED', 'ASSIGNED', 'CLOSED']),
})

export const customerLifecycleObjectSchema = z.object({
  objectType: z.literal('CustomerLifecycle'),
  ...objectBase,
  customerId: z.string().min(1),
  stage: z.enum(['PROSPECT', 'NEW', 'ACTIVE', 'AT_RISK', 'CHURNED', 'REACTIVATED']),
  status: z.enum(['OBSERVED', 'REVIEW_REQUIRED', 'ACTIONED']),
})

export const commerceObjectSchema = z.union([
  productObjectSchema,
  skuObjectSchema,
  categoryObjectSchema,
  inventoryObjectSchema,
  channelObjectSchema,
  orderObjectSchema,
  businessCaseObjectSchema,
  campaignObjectSchema,
  liveSessionObjectSchema,
  warehouseObjectSchema,
  customerVocObjectSchema,
  customerLifecycleObjectSchema,
])

export const productTaskStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CLOSED'])
export const productTaskSchema = z.object({
  taskId: z.string().min(1),
  caseId: z.string().min(1),
  status: productTaskStatusSchema,
  ownerId: z.string().min(1),
  dueAt: z.string().datetime({ offset: true }),
  acceptanceCriteria: z.array(z.string().min(1)),
  evidenceRefs: z.array(z.string().min(1)),
})

export type ProductTask = z.infer<typeof productTaskSchema>

export type ProductObject = z.infer<typeof productObjectSchema>
export type SkuObject = z.infer<typeof skuObjectSchema>
export type CategoryObject = z.infer<typeof categoryObjectSchema>
export type InventoryObject = z.infer<typeof inventoryObjectSchema>
export type ChannelObject = z.infer<typeof channelObjectSchema>
export type OrderObject = z.infer<typeof orderObjectSchema>
export type BusinessCaseObject = z.infer<typeof businessCaseObjectSchema>
export type CampaignObject = z.infer<typeof campaignObjectSchema>
export type LiveSessionObject = z.infer<typeof liveSessionObjectSchema>
export type WarehouseObject = z.infer<typeof warehouseObjectSchema>
export type CustomerVocObject = z.infer<typeof customerVocObjectSchema>
export type CustomerLifecycleObject = z.infer<typeof customerLifecycleObjectSchema>
export type CommerceObject = z.infer<typeof commerceObjectSchema>

export const commerceObjectCatalog = [
  { objectType: 'Product', purpose: '品牌商品主档与经营状态', keyFields: ['productId', 'name', 'categoryId', 'status'], statuses: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'], ownerRole: '商品负责人', notResponsibleFor: ['直接发布平台商品'], eventTypes: ['product.created', 'product.updated'] },
  { objectType: 'SKU', purpose: '可售规格、条码和商品关联', keyFields: ['skuId', 'productId', 'title', 'status'], statuses: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'], ownerRole: '商品负责人', notResponsibleFor: ['绕过库存校验上架'], eventTypes: ['sku.created', 'sku.updated'] },
  { objectType: 'Category', purpose: '商品类目与类目基线', keyFields: ['categoryId', 'name', 'parentId', 'status'], statuses: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'], ownerRole: '类目负责人', notResponsibleFor: ['擅自变更平台类目'], eventTypes: ['category.updated'] },
  { objectType: 'Inventory', purpose: '仓库 SKU 库存与补货阈值', keyFields: ['skuId', 'warehouseId', 'available', 'reorderPoint', 'safetyStock'], statuses: ['HEALTHY', 'LOW', 'OUT_OF_STOCK', 'FROZEN'], ownerRole: '供应链负责人', notResponsibleFor: ['直接下采购单', '直接修改库存'], eventTypes: ['inventory.updated', 'inventory.threshold.breached'] },
  { objectType: 'Channel', purpose: '销售平台、店铺和授权能力', keyFields: ['channelId', 'platform', 'shopId', 'status'], statuses: ['CONNECTED', 'READ_ONLY', 'DISCONNECTED', 'BLOCKED'], ownerRole: '渠道负责人', notResponsibleFor: ['使用未授权凭证写入平台'], eventTypes: ['channel.connected', 'channel.authorization.changed'] },
  { objectType: 'Order', purpose: '订单与经营结果事实', keyFields: ['orderId', 'channelId', 'status', 'totalAmount'], statuses: ['CREATED', 'PAID', 'FULFILLING', 'COMPLETED', 'REFUNDED', 'CANCELLED'], ownerRole: '订单运营负责人', notResponsibleFor: ['伪造销售结果'], eventTypes: ['order.created', 'order.signal.created'] },
  { objectType: 'BusinessCase', purpose: '跨部门经营协同单', keyFields: ['caseId', 'title', 'status', 'triggerEventId'], statuses: ['OPEN', 'INVESTIGATING', 'PROPOSED', 'WAITING_HUMAN', 'APPROVED', 'EXECUTING', 'VERIFYING', 'CLOSED', 'BLOCKED'], ownerRole: '运营协调人', notResponsibleFor: ['替代人工决策'], eventTypes: ['case.created', 'case.status.changed'] },
  { objectType: 'Campaign', purpose: '促销活动及投流活动', keyFields: ['campaignId', 'name', 'status', 'channelIds'], statuses: ['PLANNED', 'RUNNING', 'PAUSED', 'ENDED'], ownerRole: '营销负责人', notResponsibleFor: ['未经批准投放或改预算'], eventTypes: ['campaign.created', 'campaign.status.changed'] },
  { objectType: 'LiveSession', purpose: '直播场次与直播经营信号', keyFields: ['liveSessionId', 'channelId', 'status', 'scheduledAt'], statuses: ['PLANNED', 'LIVE', 'ENDED', 'CANCELLED'], ownerRole: '直播负责人', notResponsibleFor: ['未经确认发布直播排期'], eventTypes: ['live.started', 'live.ended'] },
  { objectType: 'Warehouse', purpose: '仓储节点与履约能力', keyFields: ['warehouseId', 'name', 'status'], statuses: ['ACTIVE', 'PAUSED', 'CLOSED'], ownerRole: '仓储负责人', notResponsibleFor: ['直接调整仓储主数据'], eventTypes: ['warehouse.updated'] },
  { objectType: 'CustomerVOC', purpose: '客户声音、主题和情绪事实', keyFields: ['vocId', 'source', 'sentiment', 'topic', 'status'], statuses: ['NEW', 'CLASSIFIED', 'ASSIGNED', 'CLOSED'], ownerRole: '客服负责人', notResponsibleFor: ['伪造用户反馈'], eventTypes: ['voc.signal.created'] },
  { objectType: 'CustomerLifecycle', purpose: '客户生命周期阶段判断', keyFields: ['customerId', 'stage', 'status'], statuses: ['OBSERVED', 'REVIEW_REQUIRED', 'ACTIONED'], ownerRole: '用户运营负责人', notResponsibleFor: ['未经授权触达客户'], eventTypes: ['customer.lifecycle.changed'] },
] as const
