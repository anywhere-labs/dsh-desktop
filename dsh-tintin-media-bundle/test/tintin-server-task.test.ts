// test/tintin-server-task.test.ts — useServerTask 完成判定回归。
// 背景：2026-10-12 实测事故 c_55435304-7（排队态回 progress=100，提交 2 秒即被
// 误判「已完成」并停止轮询）；服务端 2026-10-13 已对齐上报（排队 0/处理态真实
// 进度/编码段 90-100）——以下用例保留为 worker 回归防御契约。
import { afterEach, describe, expect, it } from 'vitest'
import { useServerTask } from '../src/composables/useServerTask'

type PollData = Record<string, unknown>

/** 挂 window.tintin 桩并返回可控的轮询序列（队列式：每次 tasksProgress 弹一条） */
function stubServer(polls: PollData[]): void {
  const queue = [...polls]
  ;(globalThis as unknown as { window: unknown }).window = {
    tintin: {
      server: {
        tasksProgress: async () => queue.shift() ?? { status: 'processing', progress: 0 },
      },
      shell: { showNotification: () => {} },
    },
  }
}
afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window })

function makeTask() {
  const t = useServerTask({ successTitle: 's', failTitle: 'f' })
  t.begin()
  return t
}

describe('useServerTask pollOnce 完成判定', () => {
  it('排队态回 progress=100：不得误判完成，进度不采信', async () => {
    stubServer([{ status: 'queued', progress: 100 }])
    const t = makeTask()
    await t.pollOnce('x')
    expect(t.status.value).toBe('queued')
    expect(t.isProcessing.value).toBe(true)
    expect(t.progress.value).toBe(0)
  })

  it('处理态 progress=100：视为完成并收结果', async () => {
    stubServer([{ status: 'processing', progress: 100, result_url: 'http://x/out.mp4' }])
    const t = makeTask()
    await t.pollOnce('x')
    expect(t.status.value).toBe('done')
    expect(t.isProcessing.value).toBe(false)
    expect(t.resultUrl.value).toBe('http://x/out.mp4')
  })

  it('服务端终态 completed：正常完成', async () => {
    stubServer([{ status: 'completed', progress: 100, result_url: 'http://x/r.mp4' }])
    const t = makeTask()
    await t.pollOnce('x')
    expect(t.status.value).toBe('done')
  })

  it('服务端 cancelled：置失败态并带终止文案', async () => {
    stubServer([{ status: 'cancelled', progress: 99 }])
    const t = makeTask()
    await t.pollOnce('x')
    expect(t.status.value).toBe('failed')
    expect(t.errorMsg.value).toContain('终止')
  })
})

// ── 轮询瞬态重试约定（2026-10-13 用户裁定：轮询遇 5xx=重试而非停在旧态；
//    服务端任务本体仍在运行，停刷会把可恢复抖动放大成「没生成/没完成」）──
describe('useServerTask pollOnce 瞬态重试约定', () => {
  function stubFlaky(failTimes: number, msg = 'HTTP 500：内部错误'): void {
    let n = 0
    ;(globalThis as unknown as { window: unknown }).window = {
      tintin: {
        server: {
          tasksProgress: async () => { n++; if (n <= failTimes) throw new Error(msg); return { status: 'completed', progress: 100, result_url: 'http://x/r' } },
        },
        shell: { showNotification: () => {} },
      },
    }
  }

  it('5xx 连续失败 < 阈值：不置失败、保持处理态继续轮询，恢复后完成', async () => {
    stubFlaky(5)
    const t = makeTask()
    for (let i = 0; i < 6; i++) await t.pollOnce('x')
    expect(t.status.value).toBe('done')
    expect(t.isProcessing.value).toBe(false)
  })

  it('4xx：任务确实没了，立即失败（瞬态豁免不适用）', async () => {
    ;(globalThis as unknown as { window: unknown }).window = {
      tintin: { server: { tasksProgress: async () => { throw new Error('HTTP 404：Not Found') } }, shell: { showNotification: () => {} } },
    }
    const t = makeTask()
    await t.pollOnce('x')
    expect(t.status.value).toBe('failed')
  })

  it('连续失败达阈值（150）：升级失败并提示可稍后重进查看', async () => {
    stubFlaky(10_000)
    const t = makeTask()
    for (let i = 0; i < 150; i++) await t.pollOnce('x')
    expect(t.status.value).toBe('failed')
    expect(t.errorMsg.value).toContain('连续失败 150 次')
  })
})
