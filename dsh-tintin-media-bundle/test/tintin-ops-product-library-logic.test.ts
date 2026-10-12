// test/tintin-ops-product-library-logic.test.ts — 产品资料域纯函数回归
// 契约锚点：产品六视图（2026-10-09 服务端 8f073bbf：详情 item.six_views 内嵌 +
// 列表 six_view_counts + assemble 生成 + DELETE 单视图；条目形态=当日实弹探针）
// 2026-10-10：+summarizeImportResult（POST /import 响应无 schema 的摘要）
import { describe, expect, it } from 'vitest'
import {
  normalizeProductSixViews,
  productViewLabel,
  PRODUCT_SIX_VIEW_ORDER,
  summarizeImportResult,
} from '../src/composables/opsProductLibraryLogic'

describe('normalizeProductSixViews（产品六视图键控对象 → 规范序条目）', () => {
  it('实弹形态：乱序键控对象按 front/back/left/right/top/bottom 规范序输出', () => {
    const real = {
      bottom: { material_id: 813066, url: '/material/serve?material_id=813066', thumbnail: '/material/thumbnail?material_id=813066', source: 'web', confidence: 0 },
      front: { material_id: 813063, url: '/material/serve?material_id=813063', thumbnail: '/material/thumbnail?material_id=813063', source: 'web', confidence: 0.9 },
      right: { material_id: 813064, url: '', thumbnail: '', source: 'local', confidence: 0.5 },
      top: { material_id: 813065, url: '/material/serve?material_id=813065', thumbnail: '', source: 'web', confidence: 0 },
    }
    expect(normalizeProductSixViews(real).map((e) => e.view)).toEqual(['front', 'right', 'top', 'bottom'])
    const front = normalizeProductSixViews(real)[0]
    expect(front).toMatchObject({ view: 'front', materialId: '813063', source: 'web', confidence: 0.9 })
    expect(front.url).toBe('/material/serve?material_id=813063')
    expect(front.thumbnail).toBe('/material/thumbnail?material_id=813063')
  })

  it('url/thumbnail 缺省回退 material_id 拼装（服务端省略键时展示不空）', () => {
    const [e] = normalizeProductSixViews({ top: { material_id: 42 } })
    expect(e?.materialId).toBe('42')
    expect(e?.url).toBe('/material/serve?material_id=42')
    expect(e?.thumbnail).toBe('/material/thumbnail?material_id=42')
  })

  it('空态与脏数据：null/非对象/空对象 → 空数组；无 material_id 的条目剔除', () => {
    expect(normalizeProductSixViews(null)).toEqual([])
    expect(normalizeProductSixViews({})).toEqual([])
    expect(normalizeProductSixViews('bad')).toEqual([])
    expect(normalizeProductSixViews({ front: { source: 'web' } })).toEqual([])
  })

  it('规范序常量六视角齐全（missing 清单渲染用）', () => {
    expect(PRODUCT_SIX_VIEW_ORDER).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom'])
  })

  it('视角中文标签（缺省视角名原样返回）', () => {
    expect(productViewLabel('front')).toBe('正面')
    expect(productViewLabel('back')).toBe('背面')
    expect(productViewLabel('left')).toBe('左侧')
    expect(productViewLabel('right')).toBe('右侧')
    expect(productViewLabel('top')).toBe('顶部')
    expect(productViewLabel('bottom')).toBe('底部')
    expect(productViewLabel('custom')).toBe('custom')
  })
})

describe('summarizeImportResult（Excel 导入响应摘要，服务端响应无 schema）', () => {
  it('message 字符串优先原样透出', () => {
    expect(summarizeImportResult({ message: '已导入 12 条', extra: 1 })).toBe('已导入 12 条')
  })
  it('无 message：常见计数键中文化平铺，未知/非标量键忽略', () => {
    expect(summarizeImportResult({ created: 5, skipped: 1, items: [{ id: 1 }], total: 6 }))
      .toBe('导入完成：新增=5，跳过=1，总计=6')
  })
  it('空/非对象响应兜底「导入完成。」', () => {
    expect(summarizeImportResult(null)).toBe('导入完成。')
    expect(summarizeImportResult({})).toBe('导入完成。')
    expect(summarizeImportResult('bad')).toBe('导入完成。')
  })
})
