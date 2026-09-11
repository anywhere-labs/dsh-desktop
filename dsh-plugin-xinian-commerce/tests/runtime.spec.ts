import { describe, expect, it } from 'vitest'
import { AgentRuntime, EventStore, MessageBus, TaskStore } from '../src/runtime/index.js'

describe('昔年电商 Agent 运行时', () => {
  it('只允许合法状态迁移并保持事件记录', () => {
    const tasks = new TaskStore(new EventStore())
    const task = tasks.create({ type: 'content', storeIds: [], input: { productId: 'p1' }, approvalRequired: false })
    tasks.transition(task.id, 'PLANNED', 'planner')
    expect(() => tasks.transition(task.id, 'DELIVERED', 'planner')).toThrow(/illegal task transition/)
    expect(tasks.events(task.id)).toHaveLength(1)
  })

  it('没有匹配消息时返回 NO_PENDING_WORK', () => {
    const bus = new MessageBus()
    expect(bus.claim('content-agent')).toEqual({ status: 'NO_PENDING_WORK' })
  })

  it('完成 mock 内容任务并生成四级验证结果', async () => {
    const events = new EventStore()
    const tasks = new TaskStore(events)
    const runtime = new AgentRuntime(tasks)
    const task = tasks.create({ type: 'content', storeIds: [], input: { productId: 'p1' }, approvalRequired: false })
    const result = await runtime.run(task.id)
    expect(result.state).toBe('DELIVERED')
    expect(result.verification).toMatchObject({ process: 'PROCESS_EXITED', output: 'OUTPUT_VALID', business: 'BUSINESS_ACCEPTED', delivery: 'DELIVERED' })
    expect(tasks.events(task.id).length).toBeGreaterThan(3)
  })
})
