export type SkillDefinition = {
    readonly skillId: string;
    readonly description: string;
    readonly input: readonly string[];
    readonly output: readonly string[];
    readonly mode: 'read_only' | 'proposal' | 'execute';
    readonly ownerAgentId: string;
};
export declare const skillDefinitions: readonly SkillDefinition[];
export declare function getSkill(skillId: string): SkillDefinition;
