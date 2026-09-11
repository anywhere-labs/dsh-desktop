import { describe, expect, it } from 'vitest'
import { ProductRecordSchema, CommerceTaskSchema, safeAssetPath } from '../src/contracts/index.js'

describe('昔年电商公共契约', () => {
  it('接受完整商品档案', () => {
    expect(ProductRecordSchema.parse({ id: 'p1', title: '春季风衣', category: '女装', price: 299, assetPaths: ['products/p1/cover.png'] }).title).toBe('春季风衣')
  })

  it('拒绝缺少标题的商品档案', () => {
    expect(() => ProductRecordSchema.parse({ id: 'p1', category: '女装', price: 299, assetPaths: [] })).toThrow()
  })

  it('拒绝未知任务状态和目录穿越素材路径', () => {
    expect(() => CommerceTaskSchema.parse({ id: 't1', type: 'content', storeIds: [], state: 'done', input: {}, outputs: [], approvalRequired: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })).toThrow()
    expect(() => safeAssetPath('../secret.png')).toThrow()
  })
})
