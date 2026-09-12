import { z } from 'zod'
import type { ActionProposal } from '../../contracts/index.js'

export const PLATFORM_CONNECTOR_VERSION = 'commerce.connector.v1' as const
export const SANDBOX_EVENT_VERSION = 'commerce.sandbox.event.v1' as const

export const platformIdSchema = z.enum(['douyin', 'xiaohongshu'])
export const sandboxEnvironmentSchema = z.enum(['demo', 'sandbox', 'production'])
export const sandboxCapabilitySchema = z.enum(['read_metrics', 'preview_product_content', 'preview_inventory_sync'])
export const sandboxScenarioSchema = z.enum(['success', 'failure', 'action_failed', 'approval_rejected', 'credential_missing', 'rate_limited', 'unavailable'])

export type PlatformId = z.infer<typeof platformIdSchema>
export type SandboxEnvironment = z.infer<typeof sandboxEnvironmentSchema>
export type SandboxCapability = z.infer<typeof sandboxCapabilitySchema>
export type SandboxScenario = z.infer<typeof sandboxScenarioSchema>

export const platformCapabilitySchema = z.object({
  capability: sandboxCapabilitySchema,
  description: z.string().min(1),
  inputSchema: z.string().min(1),
  outputSchema: z.string().min(1),
  riskLevel: z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']),
  approvalRequired: z.boolean(),
  idempotencyKeyTemplate: z.string().min(1),
})

export const platformConnectorContractSchema = z.object({
  contractVersion: z.literal(PLATFORM_CONNECTOR_VERSION),
  platformId: platformIdSchema,
  displayName: z.string().min(1),
  supportedEnvironments: z.array(sandboxEnvironmentSchema).min(1),
  credentialRef: z.string().min(1).nullable(),
  credentialStorage: z.literal('external_reference_only'),
  scopes: z.array(z.string().min(1)),
  capabilities: z.array(platformCapabilitySchema).min(1),
  allowedActions: z.array(z.string().min(1)),
  forbiddenActions: z.array(z.string().min(1)),
  auditEventTypes: z.array(z.string().min(1)),
  externalWrite: z.literal(false),
  officialSandboxStatus: z.literal('NOT_VERIFIED_LOCAL_DEMO_ONLY'),
})

export type PlatformConnectorContract = z.infer<typeof platformConnectorContractSchema>

export const platformConnectorCatalog: readonly PlatformConnectorContract[] = [
  {
    contractVersion: PLATFORM_CONNECTOR_VERSION,
    platformId: 'douyin',
    displayName: '抖音平台（本地演示沙箱）',
    supportedEnvironments: ['demo', 'sandbox', 'production'],
    credentialRef: null,
    credentialStorage: 'external_reference_only',
    scopes: ['product.read', 'content.read', 'inventory.read'],
    capabilities: [
      { capability: 'read_metrics', description: '读取本地 fixture 指标', inputSchema: 'PlatformMetricsQuery.v1', outputSchema: 'PlatformMetricsSnapshot.v1', riskLevel: 'L0', approvalRequired: false, idempotencyKeyTemplate: 'douyin:metrics:{shopId}:{period}' },
      { capability: 'preview_product_content', description: '生成商品内容写入预览，不发布', inputSchema: 'ProductContentPreviewInput.v1', outputSchema: 'ProductContentPreviewOutput.v1', riskLevel: 'L3', approvalRequired: true, idempotencyKeyTemplate: 'douyin:content-preview:{productId}:{contentHash}' },
      { capability: 'preview_inventory_sync', description: '生成库存同步预览，不改变平台库存', inputSchema: 'InventorySyncPreviewInput.v1', outputSchema: 'InventorySyncPreviewOutput.v1', riskLevel: 'L3', approvalRequired: true, idempotencyKeyTemplate: 'douyin:inventory-preview:{skuId}:{quantity}' },
    ],
    allowedActions: ['read_metrics', 'preview_product_content', 'preview_inventory_sync'],
    forbiddenActions: ['production_write', 'publish_content', 'update_price', 'change_inventory', 'send_message', 'spend_budget'],
    auditEventTypes: ['platform.action.requested', 'approval.requested', 'approval.approved', 'approval.rejected', 'action.execution.started', 'action.receipt.received', 'outcome.recorded'],
    externalWrite: false,
    officialSandboxStatus: 'NOT_VERIFIED_LOCAL_DEMO_ONLY',
  },
  {
    contractVersion: PLATFORM_CONNECTOR_VERSION,
    platformId: 'xiaohongshu',
    displayName: '小红书平台（本地演示沙箱）',
    supportedEnvironments: ['demo', 'sandbox', 'production'],
    credentialRef: null,
    credentialStorage: 'external_reference_only',
    scopes: ['note.read', 'product.read', 'inventory.read'],
    capabilities: [
      { capability: 'read_metrics', description: '读取本地 fixture 指标', inputSchema: 'PlatformMetricsQuery.v1', outputSchema: 'PlatformMetricsSnapshot.v1', riskLevel: 'L0', approvalRequired: false, idempotencyKeyTemplate: 'xiaohongshu:metrics:{shopId}:{period}' },
      { capability: 'preview_product_content', description: '生成笔记/商品内容预览，不发布', inputSchema: 'ProductContentPreviewInput.v1', outputSchema: 'ProductContentPreviewOutput.v1', riskLevel: 'L3', approvalRequired: true, idempotencyKeyTemplate: 'xiaohongshu:content-preview:{productId}:{contentHash}' },
      { capability: 'preview_inventory_sync', description: '生成库存同步预览，不改变平台库存', inputSchema: 'InventorySyncPreviewInput.v1', outputSchema: 'InventorySyncPreviewOutput.v1', riskLevel: 'L3', approvalRequired: true, idempotencyKeyTemplate: 'xiaohongshu:inventory-preview:{skuId}:{quantity}' },
    ],
    allowedActions: ['read_metrics', 'preview_product_content', 'preview_inventory_sync'],
    forbiddenActions: ['production_write', 'publish_note', 'update_price', 'change_inventory', 'send_message', 'spend_budget'],
    auditEventTypes: ['platform.action.requested', 'approval.requested', 'approval.approved', 'approval.rejected', 'action.execution.started', 'action.receipt.received', 'outcome.recorded'],
    externalWrite: false,
    officialSandboxStatus: 'NOT_VERIFIED_LOCAL_DEMO_ONLY',
  },
]

export interface SandboxActionOptions {
  readonly platformId: PlatformId
  readonly capability: SandboxCapability
  readonly actionId: string
  readonly idempotencyKey: string
  readonly caseId?: string
}

export function createSandboxActionProposal(options: SandboxActionOptions): Omit<ActionProposal, 'approvalId'> {
  const capability = findPlatformContract(options.platformId).capabilities.find(item => item.capability === options.capability)
  if (!capability) throw new Error(`sandbox_capability_not_found:${options.platformId}:${options.capability}`)
  return {
    actionId: options.actionId,
    actionType: `platform.${options.capability}`,
    riskLevel: capability.riskLevel,
    target: { platform: 'mock', shopId: `sandbox_${options.platformId}` },
    payload: { platformId: options.platformId, capability: options.capability, caseId: options.caseId ?? `case_platform_${options.platformId}`, idempotencyKey: options.idempotencyKey, externalWrite: false },
  }
}

export function findPlatformContract(platformId: PlatformId): PlatformConnectorContract {
  const contract = platformConnectorCatalog.find(item => item.platformId === platformId)
  if (!contract) throw new Error(`sandbox_platform_not_found:${platformId}`)
  return contract
}
