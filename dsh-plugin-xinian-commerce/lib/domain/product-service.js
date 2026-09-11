import { randomUUID } from 'node:crypto';
import { ProductRecordSchema, safeAssetPath } from '../contracts/index.js';
export class ProductService {
    products = new Map();
    list() { return [...this.products.values()]; }
    create(input) {
        input.assetPaths.forEach(safeAssetPath);
        const product = ProductRecordSchema.parse({ ...input, id: randomUUID(), updatedAt: new Date().toISOString() });
        this.products.set(product.id, product);
        return product;
    }
}
