import { AgentRuntime } from '../runtime/agent-runtime.js';
import { TaskStore } from '../runtime/control-plane.js';
export declare class ContentService {
    private readonly tasks;
    private readonly runtime;
    constructor(tasks: TaskStore, runtime: AgentRuntime);
    generate(productId: string): Promise<import("../runtime/agent-runtime.js").AgentRunResult>;
}
