export class MockActionExecutor {
    approvals;
    constructor(approvals) {
        this.approvals = approvals;
    }
    execute(action) {
        if (action.target.platform !== 'mock')
            throw new Error('mock executor refuses non-mock targets');
        this.approvals.assertExecutable(action);
        if (!action.approvalId)
            throw new Error('approved action must include approvalId');
        return {
            receiptId: `receipt_${action.actionId}`,
            actionId: action.actionId,
            approvalId: action.approvalId,
            status: 'succeeded',
            mode: 'mock',
            externalWrite: false,
            executedAt: new Date().toISOString(),
            result: { simulation: 'price-response-test-created', ...action.payload },
        };
    }
}
