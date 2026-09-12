export type SkillStep = {
  readonly id: string
  readonly run: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export interface SkillRunRequest {
  readonly skillId: string
  readonly input: Record<string, unknown>
  readonly steps: readonly SkillStep[]
}

export interface SkillTransition {
  readonly stepId: string
  readonly status: 'completed'
  readonly at: string
}

export interface SkillRunResult {
  readonly runId: string
  readonly skillId: string
  readonly status: 'completed'
  readonly output: Record<string, unknown>
  readonly transitions: readonly SkillTransition[]
}

export class SkillRuntime {
  async run(request: SkillRunRequest): Promise<SkillRunResult> {
    let output = { ...request.input }
    const transitions: SkillTransition[] = []
    for (const step of request.steps) {
      output = await step.run(output)
      transitions.push({ stepId: step.id, status: 'completed', at: new Date().toISOString() })
    }
    return { runId: `run_${Date.now()}`, skillId: request.skillId, status: 'completed', output, transitions }
  }
}
