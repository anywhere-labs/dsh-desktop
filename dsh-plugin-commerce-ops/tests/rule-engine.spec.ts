import { describe, expect, it } from 'vitest'
import { RuleEngine } from '../src/policies/rule-engine.js'

describe('RuleEngine', () => {
  it('blocks a product title containing a configured risk term', () => {
    const result = new RuleEngine([{ ruleId: 'content.absolute.001', riskLevel: 'L3', field: 'title', forbidden: ['绝对有效', '第一'] }]).evaluate({ title: '全网第一绝对有效的产品' })
    expect(result.status).toBe('blocked')
    expect(result.matches[0]?.ruleId).toBe('content.absolute.001')
  })
})
