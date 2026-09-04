import { describe, expect, it } from 'vitest'
import { SkillRuntime } from '../src/skills/runtime.js'

describe('SkillRuntime', () => {
  it('runs ordered steps and records every transition', async () => {
    const runtime = new SkillRuntime()
    const result = await runtime.run({
      skillId: 'shop.daily_report',
      input: { shopId: 'shop_001' },
      steps: [
        { id: 'collect', run: async input => ({ ...input, metrics: [1, 2, 3] }) },
        { id: 'report', run: async input => ({ ...input, report: 'ready' }) },
      ],
    })
    expect(result.status).toBe('completed')
    expect(result.output.report).toBe('ready')
    expect(result.transitions.map(item => item.stepId)).toEqual(['collect', 'report'])
  })
})
