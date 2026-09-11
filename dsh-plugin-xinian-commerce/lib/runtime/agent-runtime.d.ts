import type { ArtifactRef, CommerceTask, VerificationResult } from '../contracts/index.js';
import { TaskStore } from './control-plane.js';
export type AgentRunResult = {
    state: CommerceTask['state'];
    verification: VerificationResult;
    artifacts: readonly ArtifactRef[];
};
export declare class AgentRuntime {
    private readonly tasks;
    constructor(tasks: TaskStore);
    run(taskId: string): Promise<AgentRunResult>;
}
