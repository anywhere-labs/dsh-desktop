import { describe, expect, it } from 'vitest'
import { HumanDecisionService } from '../src/decision/service.js'

describe('HumanDecisionService', () => {
  it('records a human decision without executing an external action', () => {
    const result = new HumanDecisionService().record({ insightId: 'ins_001', decision: 'accept', decidedBy: 'user_001', note: '进入人工运营排期' })
    expect(result.status).toBe('recorded')
    expect(result.externalActionExecuted).toBe(false)
    expect(result.decision.decidedBy).toBe('user_001')
  })
})
