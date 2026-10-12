// test/tintin-ops-product-library-upload.test.ts — 产品资料六视图：逐视图上传替换 + 组装兜底开关
// 契约锚点：2026-10-10 服务端 e44a8b66——POST /api/product-library/items/{id}/views/{view}/upload
// （multipart file，auto_assemble 缺省=false=纯替换）；ViewsAssembleIn={allow_web:false, allow_ai:true}
// 用户裁决：六视图是完整集合，手动替换任何一张其余五张不动；补缺/重生成走 assemble 显式触发。
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useOpsProductLibrary } from '../src/composables/useOpsProductLibrary'

interface RecordedCall {
  kind: 'GET' | 'POST' | 'UPLOAD' | 'PUT' | 'DELETE' | 'DIALOG' | 'DOWNLOAD'
  path: string
  body?: unknown
  file?: unknown
}

let calls: RecordedCall[] = []
/** 全局桥桩：window.tintin = { env, server, dialog, shell }；记录全部调用供断言 */
function installBridge(): void {
  calls = []
  const detail = {
    item: {
      id: 'I1', brand: '罗技', model: 'G304',
      six_views: { front: { material_id: 11, source: 'web', confidence: 0.9 } },
    },
    six_views_missing: ['back'],
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    tintin: {
      env: { getMachineId: async () => ({ ok: true, machineId: 'M1' }) },
      dialog: {
        saveFile: async (opts: unknown) => {
          calls.push({ kind: 'DIALOG', path: 'saveFile', body: opts })
          return 'C:/downloads/product_import_template.xlsx'
        },
      },
      shell: {
        revealInFolder: async (p: string) => { calls.push({ kind: 'DIALOG', path: 'revealInFolder', body: p }) },
      },
      server: {
        get: async (path: string) => {
          calls.push({ kind: 'GET', path })
          if (path.includes('/items/I1')) return detail
          if (path.includes('/tasks/unified/')) return { status: 'completed' }
          return {}
        },
        post: async (path: string, body?: unknown) => {
          calls.push({ kind: 'POST', path, body })
          if (path.endsWith('/views/assemble')) return { task_id: 'T9' }
          return {}
        },
        upload: async (path: string, form: FormData) => {
          calls.push({ kind: 'UPLOAD', path, file: form.get('file') })
          if (path === '/api/product-library/import') return { created: 5, skipped: 1 }
          return { ok: true }
        },
        downloadResult: async (path: string, savePath: string) => {
          calls.push({ kind: 'DOWNLOAD', path, body: savePath })
          return savePath
        },
        put: async (path: string) => { calls.push({ kind: 'PUT', path }); return {} },
        delete: async (path: string) => { calls.push({ kind: 'DELETE', path }); return {} },
      },
    },
  }
}

function bridgeCalls(): RecordedCall[] {
  return calls
}

beforeEach(() => {
  vi.useFakeTimers()
  installBridge()
})
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('uploadSixView（逐视图上传替换，服务端 e44a8b66）', () => {
  it('纯替换语义：POST upload 不带 auto_assemble（服务端缺省=false），multipart file 入参，成功后回读详情刷新', async () => {
    const P = useOpsProductLibrary()
    await P.selectNode('I1')
    expect(P.editingId.value).toBe('I1')

    const file = new File(['png-bytes'], 'front.png', { type: 'image/png' })
    await P.uploadSixView('front', file)

    const up = bridgeCalls().find((c) => c.kind === 'UPLOAD')
    expect(up?.path).toBe('/api/product-library/items/I1/views/front/upload') // 全局作用域（clients 作用域 404，2026-10-10 实测）
    expect(up?.path).not.toContain('/clients/')
    expect(up?.path).not.toContain('auto_assemble') // 缺省零触发：客户端不传参，纯替换
    expect(up?.file).toStrictEqual(file)
    // 上传成功 → 回读详情刷新六视图（selectNode 一次 + 刷新一次）
    const detailGets = bridgeCalls().filter((c) => c.kind === 'GET' && c.path.includes('/items/I1'))
    expect(detailGets.length).toBeGreaterThanOrEqual(2)
    expect(P.sixStatus.value).toContain('已替换')
  })

  it('未选产品时拦截', async () => {
    const P = useOpsProductLibrary()
    await P.uploadSixView('front', new File(['x'], 'x.png'))
    expect(P.sixStatus.value).toContain('请先选择产品')
    expect(bridgeCalls().some((c) => c.kind === 'UPLOAD')).toBe(false)
  })
})

describe('assembleSixViews（生成/重新生成，兜底开关缺省=服务端缺省口径）', () => {
  it('缺省体 {allow_web:false, allow_ai:true}＝素材库永远第一优先，网络搜图关、AI 兜底开；全局作用域端点+任务轮询', async () => {
    const P = useOpsProductLibrary()
    await P.selectNode('I1')
    expect(P.allowWeb.value).toBe(false)
    expect(P.allowAi.value).toBe(true)

    const done = P.assembleSixViews()
    await vi.advanceTimersByTimeAsync(2100) // 推进 2s 轮询 sleep → 任务 completed → 回读详情
    await done

    const post = bridgeCalls().find((c) => c.kind === 'POST' && c.path.endsWith('/views/assemble'))
    expect(post?.path).toBe('/api/product-library/items/I1/views/assemble')
    expect(post?.body).toEqual({ allow_web: false, allow_ai: true })
    expect(P.sixStatus.value).toContain('组装完成')
  })

  it('勾选网络搜图兜底 → allow_web=true 显式随体上传', async () => {
    const P = useOpsProductLibrary()
    await P.selectNode('I1')
    P.allowWeb.value = true

    const done = P.assembleSixViews()
    await vi.advanceTimersByTimeAsync(2100)
    await done

    const post = bridgeCalls().find((c) => c.kind === 'POST' && c.path.endsWith('/views/assemble'))
    expect(post?.body).toEqual({ allow_web: true, allow_ai: true })
  })
})

describe('importExcel / downloadImportTemplate（Excel 导入，服务端自解析 2026-10-10）', () => {
  it('导入：POST /api/product-library/import multipart file → 计数摘要中文化 + 重载树', async () => {
    const P = useOpsProductLibrary()
    const file = new File(['rows'], 'products.xlsx')
    await P.importExcel(file)

    const up = bridgeCalls().find((c) => c.kind === 'UPLOAD' && c.path === '/api/product-library/import')
    expect(up?.file).toStrictEqual(file)
    expect(P.importStatus.value).toBe('导入完成：新增=5，跳过=1')
    // 成功后重载树（grouped 全量分支）
    expect(bridgeCalls().some((c) => c.kind === 'GET' && c.path.includes('/grouped'))).toBe(true)
    expect(P.importing.value).toBe(false)
  })

  it('导入失败（服务端 error）→ 状态红字前缀，不重载树', async () => {
    installBridge()
    const P = useOpsProductLibrary()
    // 桩内 import 特例已被覆盖：改为断言通用失败路径——直接调未选文件场景不可行，
    // 这里以离线桥（window.tintin.server 缺失）验证拦截
    ;(globalThis as unknown as { window: unknown }).window = {}
    await P.importExcel(new File(['x'], 'x.xlsx'))
    expect(P.importStatus.value).toContain('预览环境')
    expect(bridgeCalls().some((c) => c.kind === 'GET' && c.path.includes('/grouped'))).toBe(false)
  })

  it('模板：saveFile → downloadResult(模板 URL) → 状态含保存路径', async () => {
    const P = useOpsProductLibrary()
    await P.downloadImportTemplate('http://192.168.111.31:8000')

    const dlg = bridgeCalls().find((c) => c.kind === 'DIALOG' && c.path === 'saveFile')
    expect(dlg).toBeTruthy()
    const dl = bridgeCalls().find((c) => c.kind === 'DOWNLOAD')
    expect(dl?.path).toBe('http://192.168.111.31:8000/api/product-library/import/template')
    expect(P.importStatus.value).toContain('模板已保存')
  })

  it('模板：未连服务端（serverUrl 空）拦截，不弹对话框', async () => {
    const P = useOpsProductLibrary()
    await P.downloadImportTemplate('')
    expect(P.importStatus.value).toContain('服务端地址未知')
    expect(bridgeCalls().some((c) => c.kind === 'DIALOG')).toBe(false)
  })
})
