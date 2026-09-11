export declare class PublishService {
    preview(productId: string, storeIds: string[]): {
        productId: string;
        storeIds: string[];
        approvalRequired: boolean;
        status: string;
        mode: "sandbox";
    };
    execute(productId: string, storeIds: string[], approved: boolean): {
        productId: string;
        storeIds: string[];
        status: string;
        reason: string;
    };
}
