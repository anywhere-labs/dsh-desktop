export type RuleRiskLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

export interface ForbiddenTermRule {
  readonly ruleId: string
  readonly riskLevel: RuleRiskLevel
  readonly field: string
  readonly forbidden: readonly string[]
}

export interface RuleMatch {
  readonly ruleId: string
  readonly riskLevel: RuleRiskLevel
  readonly field: string
  readonly terms: readonly string[]
}

export interface RuleEvaluation {
  readonly status: 'passed' | 'blocked'
  readonly matches: readonly RuleMatch[]
}

export class RuleEngine {
  constructor(private readonly rules: readonly ForbiddenTermRule[] = []) {}

  evaluate(input: Record<string, unknown>): RuleEvaluation {
    const matches: RuleMatch[] = []
    for (const rule of this.rules) {
      const value = input[rule.field]
      if (typeof value !== 'string') continue
      const terms = rule.forbidden.filter(term => value.includes(term))
      if (terms.length > 0) matches.push({ ruleId: rule.ruleId, riskLevel: rule.riskLevel, field: rule.field, terms })
    }
    return { status: matches.some(match => ['L3', 'L4', 'L5'].includes(match.riskLevel)) ? 'blocked' : 'passed', matches }
  }
}
