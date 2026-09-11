export class PublishService {
    preview(productId, storeIds) { return { productId, storeIds, approvalRequired: true, status: 'preview', mode: 'sandbox' }; }
    execute(productId, storeIds, approved) {
        if (!approved)
            throw new Error('publish requires human approval');
        return { productId, storeIds, status: 'blocked', reason: 'real platform connector is not configured' };
    }
}
