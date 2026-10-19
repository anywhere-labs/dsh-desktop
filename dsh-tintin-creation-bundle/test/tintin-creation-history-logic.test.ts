// test/tintin-creation-history-logic.test.ts — 创作会话历史纯函数回归（2026-10-18）
// 用户裁决：结果本地保存（发送/结果成对入史、上限新进旧出、坏数据容错、
// 重载恢复最近一轮）。覆盖：条目清洗、load/save 往返、入史上限、清空、
// 时间标签/摘要/来源标签。
import { describe, expect, it } from 'vitest'
import {
  appendCreationHistory,
  clearCreationHistory,
  CREATION_HISTORY_CAP,
  historySnippet,
  historySourceLabel,
  historyTimeLabel,
  loadCreationHistory,
  newHistoryId,
  sanitizeHistoryEntry,
  saveCreationHistory,
  type CreationHistoryEntry,
} from '../src/composables/creationHistoryLogic'

function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    dump: () => Object.fromEntries(m),
  }
}

function entry(partial: Partial<CreationHistoryEntry>): CreationHistoryEntry {
  return { id: 'his-x', ts: 1760000000000, source: 'llm', input: '想法', resultText: '结果', ...partial }
}

describe('sanitizeHistoryEntry 条目清洗', () => {
  it('非对象/输入结果全空 → null 丢弃', () => {
    expect(sanitizeHistoryEntry(null)).toBeNull()
    expect(sanitizeHistoryEntry('x')).toBeNull()
    expect(sanitizeHistoryEntry({ input: '  ', resultText: '' })).toBeNull()
  })
  it('缺 id/ts 补算；source 非法回 llm', () => {
    const s = sanitizeHistoryEntry({ input: 'a', resultText: 'b', source: 'hack' })
    expect(s).not.toBeNull()
    expect(s!.id).toBeTruthy()
    expect(s!.ts).toBeGreaterThan(0)
    expect(s!.source).toBe('llm')
  })
  it('可选字段空值不出键；数组逐项清洗', () => {
    const s = sanitizeHistoryEntry({ input: 'a', resultText: 'b', skillName: ' ', subjects: [' x ', '', 42], references: [] })!
    expect('skillName' in s).toBe(false)
    expect(s.subjects).toEqual(['x', '42'])
    expect('references' in s).toBe(false)
  })
  it('合法条目原样保留（source=voiceover/copy 直通）', () => {
    const s = sanitizeHistoryEntry(entry({ source: 'voiceover', formula: '悬念式' }))!
    expect(s.source).toBe('voiceover')
    expect(s.formula).toBe('悬念式')
  })
})

describe('load/save 往返（注入 storage）', () => {
  it('写入后读回等值；坏 JSON/非数组/缺存储 → 空表', () => {
    const store = fakeStorage()
    expect(loadCreationHistory(store)).toEqual([])
    const list = [entry({ id: 'a' }), entry({ id: 'b', source: 'copy' })]
    saveCreationHistory(list, store)
    expect(loadCreationHistory(store).map((e) => e.id)).toEqual(['a', 'b'])
    store.setItem('tintin.creationStudio.history.v1', '{bad json')
    expect(loadCreationHistory(store)).toEqual([])
    store.setItem('tintin.creationStudio.history.v1', '{"a":1}')
    expect(loadCreationHistory(store)).toEqual([])
  })
  it('逐条容错：坏条目丢弃好条目保留；超上限截断', () => {
    const store = fakeStorage()
    const many = Array.from({ length: CREATION_HISTORY_CAP + 5 }, (_, i) => entry({ id: `e${i}` }))
    saveCreationHistory(many, store)
    const loaded = loadCreationHistory(store)
    expect(loaded).toHaveLength(CREATION_HISTORY_CAP)
    expect(loaded[0]!.id).toBe('e0')
    store.setItem('tintin.creationStudio.history.v1', JSON.stringify([null, 'x', entry({ id: 'ok' })]))
    expect(loadCreationHistory(store).map((e) => e.id)).toEqual(['ok'])
  })
})

describe('appendCreationHistory 入史', () => {
  it('新条目置顶、超限从尾部丢、不改入参', () => {
    const a = entry({ id: 'a' })
    const b = entry({ id: 'b' })
    const c = entry({ id: 'c' })
    const prev = [a, b]
    const next = appendCreationHistory(prev, c, 2)
    expect(next.map((e) => e.id)).toEqual(['c', 'a'])
    expect(prev.map((e) => e.id)).toEqual(['a', 'b'])
    expect(newHistoryId()).not.toBe(newHistoryId())
  })
})

describe('clearCreationHistory 清空', () => {
  it('移除存储键', () => {
    const store = fakeStorage()
    saveCreationHistory([entry({})], store)
    clearCreationHistory(store)
    expect(store.getItem('tintin.creationStudio.history.v1')).toBeNull()
  })
})

describe('展示辅助', () => {
  const now = new Date('2026-10-18T17:40:00').getTime()
  it('historyTimeLabel：同年不带年份，跨年带', () => {
    expect(historyTimeLabel(new Date('2026-10-18T09:05:00').getTime(), now)).toBe('10-18 09:05')
    expect(historyTimeLabel(new Date('2025-01-02T08:30:00').getTime(), now)).toBe('2025-01-02 08:30')
  })
  it('historySnippet：优先输入、折叠空白、超长截断、回落结果', () => {
    expect(historySnippet({ input: ' 第一行\n第二行 ', resultText: 'r' })).toBe('第一行 第二行')
    expect(historySnippet({ input: 'x'.repeat(70), resultText: 'r' })).toBe(`${'x'.repeat(60)}…`)
    expect(historySnippet({ input: '  ', resultText: '结果文本' })).toBe('结果文本')
  })
  it('historySourceLabel：口播带写法、提示词、llm 回落类型/技能/Agent', () => {
    expect(historySourceLabel(entry({ source: 'voiceover', formula: '悬念式' }))).toBe('口播 · 悬念式')
    expect(historySourceLabel(entry({ source: 'copy' }))).toBe('提示词')
    expect(historySourceLabel(entry({ source: 'voiceover' }))).toBe('口播')
    expect(historySourceLabel(entry({ typeLabel: '视频生成' }))).toBe('视频生成')
    expect(historySourceLabel(entry({ skillName: '风格大师' }))).toBe('风格大师')
    expect(historySourceLabel(entry({}))).toBe('Agent')
  })
})
