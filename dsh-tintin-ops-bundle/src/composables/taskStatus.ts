// 任务响应解包与状态映射——自媒体包 copywritingMontageCommonLogic 一比一拷贝
// （2026-10-17 快照；独立 bundle 不交叉导入源码）。仅迁运营域使用的两个纯函数。
export function extractTaskObj(resp: unknown): Record<string, unknown> {
  if (!resp || typeof resp !== 'object') return {}
  const r = resp as Record<string, unknown>
  if (r.data && typeof r.data === 'object') return r.data as Record<string, unknown>
  return r
}

export interface TaskStatusInfo {
  phase: 'running' | 'done' | 'failed'
  error: string
}

/** 任务状态映射（终态/失败态/进行中，与 unified 轮询口径一致） */
export function mapTaskStatus(status: unknown, task: Record<string, unknown> = {}): TaskStatusInfo {
  const s = String(status || '').toLowerCase()
  if (['completed', 'done', 'success', 'finished'].includes(s)) return { phase: 'done', error: '' }
  if (['failed', 'error', 'cancelled'].includes(s)) {
    const err = task.error_msg || task.error || task.message
      // cancelled 且无 error_msg：服务端运行中重启会把任务置 cancelled（实测 705：
      // result={cancelled:true}）——报「未知错误」误导，改为可行动的文案
      || (s === 'cancelled' ? '服务端任务被取消（可能因服务端重启中断），请重新提交' : '未知错误')
    return { phase: 'failed', error: String(err) }
  }
  return { phase: 'running', error: '' }
}
