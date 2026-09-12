export class RuleEngine {
    rules;
    constructor(rules = []) {
        this.rules = rules;
    }
    evaluate(input) {
        const matches = [];
        for (const rule of this.rules) {
            const value = input[rule.field];
            if (typeof value !== 'string')
                continue;
            const terms = rule.forbidden.filter(term => value.includes(term));
            if (terms.length > 0)
                matches.push({ ruleId: rule.ruleId, riskLevel: rule.riskLevel, field: rule.field, terms });
        }
        return { status: matches.some(match => ['L3', 'L4', 'L5'].includes(match.riskLevel)) ? 'blocked' : 'passed', matches };
    }
}
