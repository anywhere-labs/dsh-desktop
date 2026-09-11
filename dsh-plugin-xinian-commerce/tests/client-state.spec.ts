import { describe, expect, it } from 'vitest'
import { closeDrawer, initialWorkspaceState, navigate, openDrawer, setTaskFilter } from '../src/client/state.js'

describe('工作台交互状态', () => {
  it('支持模块导航和任务筛选', () => {
    const state = navigate(setTaskFilter(initialWorkspaceState, 'waiting'), 'agent')
    expect(state.activeModule).toBe('agent'); expect(state.taskFilter).toBe('waiting')
  })
  it('支持打开和关闭任务抽屉', () => {
    const opened = openDrawer(initialWorkspaceState, 'task', 'task-1')
    expect(opened.drawer).toBe('task'); expect(opened.selectedTaskId).toBe('task-1')
    expect(closeDrawer(opened).drawer).toBe('none')
  })
})
