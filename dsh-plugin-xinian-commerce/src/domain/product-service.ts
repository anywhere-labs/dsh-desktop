import { randomUUID } from 'node:crypto'
import { ProductRecordSchema, safeAssetPath, type ProductRecord } from '../contracts/index.js'

export class ProductService {
  private readonly products = new Map<string, ProductRecord>()
  list(): ProductRecord[] { return [...this.products.values()] }
  create(input: Omit<ProductRecord, 'id' | 'updatedAt'>): ProductRecord {
    input.assetPaths.forEach(safeAssetPath)
    const product = ProductRecordSchema.parse({ ...input, id: randomUUID(), updatedAt: new Date().toISOString() })
    this.products.set(product.id, product); return product
  }
}
