export type Dashboard = {
    status?: string;
    source?: string;
    products?: number;
    metrics: Array<{
        label: string;
        value: string | number;
    }>;
};
export declare const api: {
    dashboard: () => Promise<Dashboard>;
    products: () => Promise<{
        products: Array<{
            id: string;
            title: string;
            category: string;
            price: number;
            assetPaths: string[];
        }>;
    }>;
    createProduct: (data: unknown) => Promise<{
        product: {
            id: string;
            title: string;
        };
    }>;
    createTask: (data: unknown) => Promise<{
        task: {
            id: string;
            state: string;
        };
    }>;
    generate: (productId: string) => Promise<{
        state: string;
        verification: {
            delivery: string;
        };
    }>;
};
