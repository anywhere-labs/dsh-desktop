import type { ApprovalService } from '../../approvals/service.js'
import { MockActionExecutor } from '../../actions/mock-executor.js'
import type { ActionProposal } from '../../contracts/index.js'
import { findPlatformContract, platformIdSchema, sandboxCapabilitySchema, sandboxEnvironmentSchema, sandboxScenarioSchema, type PlatformId, type SandboxCapability, type SandboxEnvironment, type SandboxScenario } from './contracts.js'

export interface SandboxExecutionRequest {
  readonly platformId: PlatformId
  readonly environment: SandboxEnvironment
  readonly capability: SandboxCapability
  readonly credentialRef?: string
  readonly idempotencyKey: string
  readonly actionProposal: ActionProposal
  readonly payload: Readonly<Record<string, unknown>>
  readonly scenario?: SandboxScenario
}

export interface SandboxReceipt {
  readonly receiptId: string
  readonly auditId: string
  readonly actionId: string
  readonly platformId: PlatformId
  readonly environment: SandboxEnvironment
  readonly capability: SandboxCapability
  readonly status: 'succeeded' | 'failed' | 'blocked'
  readonly failureCode?: string
  readonly externalWrite: false
  readonly isSimulated: boolean
  readonly output: Readonly<Record<string, unknown>>
}

export class PlatformSandboxGateway {
  private readonly receipts = new Map<string, SandboxReceipt>()
  private readonly executor: MockActionExecutor

  constructor(private readonly approvals: ApprovalService) {
    this.executor = new MockActionExecutor(approvals)
  }

  execute(request: SandboxExecutionRequest): SandboxReceipt {
    platformIdSchema.parse(request.platformId)
    sandboxEnvironmentSchema.parse(request.environment)
    sandboxCapabilitySchema.parse(request.capability)
    sandboxScenarioSchema.parse(request.scenario ?? 'success')
    const contract = findPlatformContract(request.platformId)
    const capability = contract.capabilities.find(item => item.capability === request.capability)
    const isSimulated = request.environment !== 'production'
    if (!capability || !contract.allowedActions.includes(request.capability)) return this.blocked(request, isSimulated, 'ACTION_FORBIDDEN')
    if (request.environment === 'production') return this.blocked(request, false, 'PRODUCTION_DISABLED')
    if (!request.credentialRef) return this.blocked(request, true, 'CREDENTIAL_REF_MISSING')
    if (request.scenario === 'rate_limited') return this.failed(request, 'RATE_LIMITED')
    if (request.scenario === 'unavailable') return this.failed(request, 'CONNECTOR_UNAVAILABLE')
    const existing = this.receipts.get(request.idempotencyKey)
    if (existing) return existing
    try {
      this.approvals.assertExecutable(request.actionProposal)
    } catch (cause) {
      const status = this.approvals.list().find(item => item.approvalId === request.actionProposal.approvalId)?.status
      return this.blocked(request, true, status === 'rejected' ? 'APPROVAL_REJECTED' : 'APPROVAL_REQUIRED')
    }
    if (request.scenario === 'failure' || request.scenario === 'action_failed') return this.store(this.failed(request, 'MOCK_CONNECTOR_FAILURE'))
    const mockReceipt = this.executor.execute(request.actionProposal)
    return this.store({
      receiptId: mockReceipt.receiptId,
      auditId: `audit_${request.idempotencyKey}`,
      actionId: request.actionProposal.actionId,
      platformId: request.platformId,
      environment: request.environment,
      capability: request.capability,
      status: 'succeeded',
      externalWrite: false,
      isSimulated: true,
      output: { preview: true, simulated: true, platformId: request.platformId, capability: request.capability, payload: request.payload },
    })
  }

  private blocked(request: SandboxExecutionRequest, isSimulated: boolean, failureCode: string): SandboxReceipt {
    return { receiptId: `receipt_${request.idempotencyKey}`, auditId: `audit_${request.idempotencyKey}`, actionId: request.actionProposal.actionId, platformId: request.platformId, environment: request.environment, capability: request.capability, status: 'blocked', failureCode, externalWrite: false, isSimulated, output: { preview: false, execution: 'blocked' } }
  }

  private failed(request: SandboxExecutionRequest, failureCode: string): SandboxReceipt {
    return this.store({ receiptId: `receipt_${request.idempotencyKey}`, auditId: `audit_${request.idempotencyKey}`, actionId: request.actionProposal.actionId, platformId: request.platformId, environment: request.environment, capability: request.capability, status: 'failed', failureCode, externalWrite: false, isSimulated: true, output: { preview: false, execution: 'simulated_failure' } })
  }

  private store(receipt: SandboxReceipt): SandboxReceipt { this.receipts.set(receipt.auditId.replace(/^audit_/, ''), receipt); return receipt }
}
