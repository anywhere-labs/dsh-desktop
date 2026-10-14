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
