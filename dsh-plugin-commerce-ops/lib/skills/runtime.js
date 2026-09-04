export class SkillRuntime {
    async run(request) {
        let output = { ...request.input };
        const transitions = [];
        for (const step of request.steps) {
            output = await step.run(output);
            transitions.push({ stepId: step.id, status: 'completed', at: new Date().toISOString() });
        }
        return { runId: `run_${Date.now()}`, skillId: request.skillId, status: 'completed', output, transitions };
    }
}
