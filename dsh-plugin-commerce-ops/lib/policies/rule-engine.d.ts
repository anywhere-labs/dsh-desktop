export type RuleRiskLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export interface ForbiddenTermRule {
    readonly ruleId: string;
    readonly riskLevel: RuleRiskLevel;
    readonly field: string;
    readonly forbidden: readonly string[];
}
export interface RuleMatch {
    readonly ruleId: string;
    readonly riskLevel: RuleRiskLevel;
    readonly field: string;
    readonly terms: readonly string[];
}
export interface RuleEvaluation {
    readonly status: 'passed' | 'blocked';
    readonly matches: readonly RuleMatch[];
}
export declare class RuleEngine {
    private readonly rules;
    constructor(rules?: readonly ForbiddenTermRule[]);
    evaluate(input: Record<string, unknown>): RuleEvaluation;
}
