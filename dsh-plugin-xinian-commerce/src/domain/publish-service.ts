export class PublishService {
  preview(productId: string, storeIds: string[]) { return { productId, storeIds, approvalRequired: true, status: 'preview', mode: 'sandbox' as const } }
  execute(productId: string, storeIds: string[], approved: boolean) {
    if (!approved) throw new Error('publish requires human approval')
    return { productId, storeIds, status: 'blocked', reason: 'real platform connector is not configured' }
  }
}
