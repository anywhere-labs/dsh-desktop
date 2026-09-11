import { randomUUID } from 'node:crypto';
import { verifyArtifacts } from './verifier.js';
export class AgentRuntime {
    tasks;
    constructor(tasks) {
        this.tasks = tasks;
    }
    async run(taskId) {
        let task = this.tasks.get(taskId);
        if (task.state === 'INTAKE')
            task = this.tasks.transition(taskId, 'PLANNED', 'planner');
        if (task.state === 'PLANNED')
            task = this.tasks.transition(taskId, 'READY', 'planner');
        task = this.tasks.transition(taskId, 'RUNNING', 'executor');
        const artifacts = [{ id: randomUUID(), kind: task.type === 'content' ? 'copy' : 'manifest', path: `artifacts/${task.id}/result.json`, valid: true }];
        this.tasks.attachOutputs(task.id, artifacts);
        task = this.tasks.transition(taskId, 'VERIFYING', 'verifier');
        const verification = verifyArtifacts(artifacts, !task.approvalRequired);
        if (verification.business !== 'BUSINESS_ACCEPTED')
            return { state: task.state, verification, artifacts };
        task = this.tasks.transition(taskId, 'ACCEPTED', 'verifier');
        task = this.tasks.transition(taskId, 'DELIVERED', 'delivery');
        return { state: task.state, verification, artifacts };
    }
}
