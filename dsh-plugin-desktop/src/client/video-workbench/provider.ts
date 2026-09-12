import type {
  AssetManifest,
  AssetManifestEntry,
  CostConfirmation,
  CostQuote,
  GenerationAuthorization,
  GenerationRequest,
} from './contracts.ts'
import type { TaskStatus } from './state-machine.ts'

export type { CostQuote, GenerationRequest } from './contracts.ts'

export interface IdempotencyQuery {
  readonly taskId: string
  readonly idempotencyKey: string
}

export interface ProviderTaskRecord extends IdempotencyQuery {
  readonly status: TaskStatus
  readonly providerJobId?: string
  readonly updatedAt?: string
}

export interface ProviderSubmission {
  readonly providerJobId: string
  readonly status: Extract<TaskStatus, 'QUEUED' | 'GENERATING'>
}

/** Host-owned adapter boundary; implementations may perform I/O outside this contract module. */
export interface VideoProviderAdapter {
  readonly providerId: string
  readonly supportedModels: readonly string[]
  estimateCost(request: GenerationRequest): Promise<CostQuote>
  submit(request: GenerationRequest): Promise<ProviderSubmission>
  queryTask(query: IdempotencyQuery): Promise<ProviderTaskRecord | undefined>
}

export interface GenerationGateInput {
  readonly providerId: string
  readonly model: string
  readonly allowedProviderIds: readonly string[]
  readonly allowedModels: readonly string[]
  readonly requestedAssetIds: readonly string[]
  readonly authorizedAssetIds: readonly string[]
  readonly quote: CostQuote
  readonly costConfirmation?: CostConfirmation | undefined
  readonly authorization?: GenerationAuthorization | undefined
}

export type GenerationGateReason =
  | 'provider_not_authorized'
  | 'model_not_authorized'
  | 'asset_not_authorized'
  | 'cost_not_confirmed'
  | 'cost_mismatch'
  | 'authorization_not_granted'
  | 'approval_mismatch'

export type GenerationGateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: GenerationGateReason }

/** Return the first missing piece of evidence; absence always denies generation. */
export function evaluateGenerationGates(input: GenerationGateInput): GenerationGateResult {
  if (!input.allowedProviderIds.includes(input.providerId)) {
    return { allowed: false, reason: 'provider_not_authorized' }
  }
  if (!input.allowedModels.includes(input.model)) {
    return { allowed: false, reason: 'model_not_authorized' }
  }

  const authorizedAssets = new Set(input.authorizedAssetIds)
  if (input.requestedAssetIds.some(assetId => !authorizedAssets.has(assetId))) {
    return { allowed: false, reason: 'asset_not_authorized' }
  }

  const confirmation = input.costConfirmation
  if (confirmation === undefined) return { allowed: false, reason: 'cost_not_confirmed' }
  if (
    confirmation.quoteId !== input.quote.quoteId
    || confirmation.amount !== input.quote.amount
    || confirmation.currency !== input.quote.currency
    || confirmation.confirmedBy.trim().length === 0
    || confirmation.confirmedAt.trim().length === 0
  ) {
    return { allowed: false, reason: 'cost_mismatch' }
  }

  const authorization = input.authorization
  if (authorization?.approved !== true) {
    return { allowed: false, reason: 'authorization_not_granted' }
  }
  if (
    authorization.approvalId.trim().length === 0
    || confirmation.approvalId !== authorization.approvalId
  ) {
    return { allowed: false, reason: 'approval_mismatch' }
  }
  return { allowed: true }
}

export function createAssetManifest(
  taskId: string,
  assets: readonly AssetManifestEntry[],
): AssetManifest {
  const assetIds = new Set<string>()
  for (const asset of assets) {
    if (assetIds.has(asset.assetId)) throw new Error(`duplicate asset id: ${asset.assetId}`)
    assetIds.add(asset.assetId)
  }
  return { taskId, assets: [...assets] }
}

export function toIdempotencyQuery(request: Pick<GenerationRequest, 'taskId' | 'idempotencyKey'>): IdempotencyQuery {
  return {
    taskId: request.taskId,
    idempotencyKey: request.idempotencyKey,
  }
}

export function findIdempotentTask(
  records: readonly ProviderTaskRecord[],
  query: IdempotencyQuery,
): ProviderTaskRecord | undefined {
  return records.find(record => (
    record.taskId === query.taskId && record.idempotencyKey === query.idempotencyKey
  ))
}
