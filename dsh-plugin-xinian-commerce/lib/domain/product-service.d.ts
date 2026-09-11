import { type ProductRecord } from '../contracts/index.js';
export declare class ProductService {
    private readonly products;
    list(): ProductRecord[];
    create(input: Omit<ProductRecord, 'id' | 'updatedAt'>): ProductRecord;
}
