export type SkillStep = {
    readonly id: string;
    readonly run: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
export interface SkillRunRequest {
    readonly skillId: string;
    readonly input: Record<string, unknown>;
    readonly steps: readonly SkillStep[];
}
export interface SkillTransition {
    readonly stepId: string;
    readonly status: 'completed';
    readonly at: string;
}
export interface SkillRunResult {
    readonly runId: string;
    readonly skillId: string;
    readonly status: 'completed';
    readonly output: Record<string, unknown>;
    readonly transitions: readonly SkillTransition[];
}
export declare class SkillRuntime {
    run(request: SkillRunRequest): Promise<SkillRunResult>;
}
