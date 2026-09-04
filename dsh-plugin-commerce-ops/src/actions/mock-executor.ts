import type { ApprovalService } from '../approvals/service.js'
import type { ActionProposal } from '../contracts/index.js'

export interface MockActionReceipt {
  readonly receiptId: string
  readonly actionId: string
  readonly approvalId: string
  readonly status: 'succeeded'
  readonly mode: 'mock'
  readonly externalWrite: false
  readonly executedAt: string
  readonly result: Readonly<Record<string, unknown>>
}

export class MockActionExecutor {
  constructor(private readonly approvals: ApprovalService) {}

  execute(action: ActionProposal): MockActionReceipt {
    if (action.target.platform !== 'mock') throw new Error('mock executor refuses non-mock targets')
    this.approvals.assertExecutable(action)
    if (!action.approvalId) throw new Error('approved action must include approvalId')
    return {
      receiptId: `receipt_${action.actionId}`,
      actionId: action.actionId,
      approvalId: action.approvalId,
      status: 'succeeded',
      mode: 'mock',
      externalWrite: false,
      executedAt: new Date().toISOString(),
      result: { simulation: 'price-response-test-created', ...action.payload },
    }
  }
}
