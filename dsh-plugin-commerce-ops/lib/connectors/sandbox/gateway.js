import { MockActionExecutor } from '../../actions/mock-executor.js';
import { findPlatformContract, platformIdSchema, sandboxCapabilitySchema, sandboxEnvironmentSchema, sandboxScenarioSchema } from './contracts.js';
export class PlatformSandboxGateway {
    approvals;
    receipts = new Map();
    executor;
    constructor(approvals) {
        this.approvals = approvals;
        this.executor = new MockActionExecutor(approvals);
    }
    execute(request) {
        platformIdSchema.parse(request.platformId);
        sandboxEnvironmentSchema.parse(request.environment);
        sandboxCapabilitySchema.parse(request.capability);
        sandboxScenarioSchema.parse(request.scenario ?? 'success');
        const contract = findPlatformContract(request.platformId);
        const capability = contract.capabilities.find(item => item.capability === request.capability);
        const isSimulated = request.environment !== 'production';
        if (!capability || !contract.allowedActions.includes(request.capability))
            return this.blocked(request, isSimulated, 'ACTION_FORBIDDEN');
        if (request.environment === 'production')
            return this.blocked(request, false, 'PRODUCTION_DISABLED');
        if (!request.credentialRef)
            return this.blocked(request, true, 'CREDENTIAL_REF_MISSING');
        if (request.scenario === 'rate_limited')
            return this.failed(request, 'RATE_LIMITED');
        if (request.scenario === 'unavailable')
            return this.failed(request, 'CONNECTOR_UNAVAILABLE');
        const existing = this.receipts.get(request.idempotencyKey);
        if (existing)
            return existing;
        try {
            this.approvals.assertExecutable(request.actionProposal);
        }
        catch (cause) {
            const status = this.approvals.list().find(item => item.approvalId === request.actionProposal.approvalId)?.status;
            return this.blocked(request, true, status === 'rejected' ? 'APPROVAL_REJECTED' : 'APPROVAL_REQUIRED');
        }
        if (request.scenario === 'failure' || request.scenario === 'action_failed')
            return this.store(this.failed(request, 'MOCK_CONNECTOR_FAILURE'));
        const mockReceipt = this.executor.execute(request.actionProposal);
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
        });
    }
    blocked(request, isSimulated, failureCode) {
        return { receiptId: `receipt_${request.idempotencyKey}`, auditId: `audit_${request.idempotencyKey}`, actionId: request.actionProposal.actionId, platformId: request.platformId, environment: request.environment, capability: request.capability, status: 'blocked', failureCode, externalWrite: false, isSimulated, output: { preview: false, execution: 'blocked' } };
    }
    failed(request, failureCode) {
        return this.store({ receiptId: `receipt_${request.idempotencyKey}`, auditId: `audit_${request.idempotencyKey}`, actionId: request.actionProposal.actionId, platformId: request.platformId, environment: request.environment, capability: request.capability, status: 'failed', failureCode, externalWrite: false, isSimulated: true, output: { preview: false, execution: 'simulated_failure' } });
    }
    store(receipt) { this.receipts.set(receipt.auditId.replace(/^audit_/, ''), receipt); return receipt; }
}
