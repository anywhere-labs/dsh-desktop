// test/tintin-creation-reference-logic.test.ts — 上传引用池纯函数回归（2026-10-17）
// 用户裁决：@ 双线路（工具栏=选产品；输入 @=从上传引用选择），上传池多文件
// 缩略图块。覆盖：预览 URL/类型判定、@ 过滤词与引用名解析、池合并去重、
// 过滤、上下文附注组包。
import { describe, expect, it } from 'vitest'
import {
  atQueryFrom,
  atReferencesIn,
  extOf,
  filterReferences,
  isImageRef,
  isVideoRef,
  mergeReferencePaths,
  referenceUrl,
  referencesBlock,
  type CreationReference,
} from '../src/composables/creationReferenceLogic'

const pool: CreationReference[] = [
  { path: 'D:/refs/49.matting', name: '49.matting' },
  { path: 'D:/refs/咖啡杯.png', name: '咖啡杯.png' },
]

describe('预览 URL 与类型判定', () => {
  it('referenceUrl：路径编码进宿主 /tintin/media 代理', () => {
    expect(referenceUrl('D:/refs/咖啡杯.png')).toBe('/tintin/media?path=' + encodeURIComponent('D:/refs/咖啡杯.png'))
  })
  it('extOf/isImageRef/isVideoRef：按扩展名判定（大小写不敏感）', () => {
    expect(extOf('A.PNG')).toBe('png')
    expect(isImageRef('a.jpg')).toBe(true)
    expect(isImageRef('b.webp')).toBe(true)
    expect(isVideoRef('c.MOV')).toBe(true)
    expect(isImageRef('d.pdf')).toBe(false)
    expect(isVideoRef('e.txt')).toBe(false)
    expect(extOf('无扩展名')).toBe('')
  })
})

describe('atQueryFrom / atReferencesIn（输入 @ 解析）', () => {
  it('atQueryFrom：最后一个 @ 后的过滤词（到空白或 / 为止）', () => {
    expect(atQueryFrom('用 @咖')).toBe('咖')
    expect(atQueryFrom('用 @')).toBe('')
    expect(atQueryFrom('没有触发')).toBeNull()
    expect(atQueryFrom('')).toBeNull()
  })
  it('atReferencesIn：按出现顺序去重收集 @名', () => {
    expect(atReferencesIn('主视觉 @49.matting 配 @咖啡杯.png')).toEqual(['49.matting', '咖啡杯.png'])
    expect(atReferencesIn('重复 @a 与 @a')).toEqual(['a'])
    expect(atReferencesIn('没有引用')).toEqual([])
  })
})

describe('池合并与过滤', () => {
  it('mergeReferencePaths：新路径追加并从路径提取文件名，已存在去重', () => {
    const merged = mergeReferencePaths(pool, ['D:/refs/49.matting', 'D:/refs/new.mp4'])
    expect(merged).toHaveLength(3)
    expect(merged.filter((r) => r.path === 'D:/refs/49.matting')).toHaveLength(1)
    expect(merged[merged.length - 1]).toEqual({ path: 'D:/refs/new.mp4', name: 'new.mp4' })
  })
  it('filterReferences：空串=全部；子串命中文件名', () => {
    expect(filterReferences(pool, '')).toHaveLength(2)
    expect(filterReferences(pool, '咖啡').map((r) => r.name)).toEqual(['咖啡杯.png'])
    expect(filterReferences(pool, 'zzz')).toHaveLength(0)
  })
})

describe('referencesBlock 上下文附注组包', () => {
  it('非空 → （附参考文件：a、b）；空 → 空串', () => {
    expect(referencesBlock(['49.matting', '咖啡杯.png'])).toBe('\n（附参考文件：49.matting、咖啡杯.png）')
    expect(referencesBlock([])).toBe('')
    expect(referencesBlock(['  ', ''])).toBe('')
  })
})
