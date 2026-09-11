import { AgentRuntime } from '../runtime/agent-runtime.js'
import { TaskStore } from '../runtime/control-plane.js'

export class ContentService {
  constructor(private readonly tasks: TaskStore, private readonly runtime: AgentRuntime) {}
  async generate(productId: string) {
    const task = this.tasks.create({ type: 'content', productId, storeIds: [], input: { productId }, approvalRequired: false })
    return this.runtime.run(task.id)
  }
}
