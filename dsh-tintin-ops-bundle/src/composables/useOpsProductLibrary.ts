// ═══════════════════════════════════════════════════════════════
// useOpsProductLibrary — 产品资料域 composable（运营工具 · P1 实装）
// 对照原客户端 gui/product_library_page.py + utils/product_library_manager.py：
//   · 树：grouped（空关键词）/ search?q=（关键词）→ 渲染层建树（纯函数）
//   · 同步：POST /sync → 轮询 GET /sync/status（2s，对齐 StockSyncWorker L70-86）
//   · 智能挖掘（单条）：POST /mine {item_ids:[id]} → 轮询 /mine/status →
//     GET /items/{id} 回填（L118-166，含 10 分钟上限与重试回读）
//   · 全量挖掘：POST /mine {item_ids:[]} → 轮询（BulkMineWorker L185-218）
//   · 增删改：POST /items、PUT /items/{id}、DELETE /items/{id}（必填校验前置）
//   · 详情：缓存命中直读 / 未命中 GET /items/{id}（L664-674）
// 服务端契约（API-GUIDE 已核实）：/api/product-library/clients/{machine_id}/*
//   全套端点存在；X-Machine-ID 头由主进程 server-proxy 自动注入，machine_id 路径
//   参数经 env:getMachineId 获取（与头同值，同一 config-store 口径）。
// 分层（IRON-06）：本层只做 HTTP 编排与轮询；树/校验/摘要等纯逻辑在
// opsProductLibraryLogic.ts（有单测）；组件零 URL 拼装。
// Excel 导入导出：导入=POST /import multipart 服务端自解析（2026-10-10 实装）；
// 导出：服务端无 /export 端点，未实装。
// ═══════════════════════════════════════════════════════════════

import { ref, onUnmounted } from 'vue'
import { getTintin } from './useSettingsConfig'
import { API_PATHS } from '../types/apiPaths'
import { extractTaskObj, mapTaskStatus } from './taskStatus'
import {
  buildProductTree,
  fieldLockMap,
  isWarehouseItem,
  normalizeItem,
  normalizeProductSixViews,
  parseImportRows,
  productViewLabel,
  summarizeImportResult,
  parseMineStatus,
  parseSyncStatus,
  searchResultLabel,
  treeToNodes,
  validateItem,
  type ProductItem,
  type ProductSixViewEntry,
  type ProductTreeNode,
} from './opsProductLibraryLogic'

/** 轮询间隔（原版 time.sleep(2)）与挖掘上限（原版 10 分钟） */
const POLL_MS = 2000
const MINE_TIMEOUT_MS = 10 * 60 * 1000
/** 搜索防抖（原版 QTimer 300ms） */
const SEARCH_DEBOUNCE_MS = 300

export function useOpsProductLibrary() {
  /* ── 树 / 搜索状态 ── */
  const keyword = ref('')
  const nodes = ref<ProductTreeNode[]>([])
  const searchHits = ref<{ id: string; label: string }[]>([])
  const treeLoading = ref(false)
  const treeError = ref('')

  /* ── 表单状态 ── */
  const form = ref<Record<string, string>>({})
  const editingId = ref<string | null>(null)
  const lockedFields = ref<Record<string, boolean>>(fieldLockMap(false))
  const formStatus = ref('')
  const saving = ref(false)

  /* ── 同步 / 挖掘状态 ── */
  const syncing = ref(false)
  const syncStatus = ref('')
  const mining = ref(false)          // 单条挖掘中
  const bulkMining = ref(false)      // 全量挖掘中（再点=停止）
  const mineStatus = ref('')

  /* ── 六视图（2026-10-09 服务端 8f073bbf：详情内嵌 item.six_views + assemble 生成
       + DELETE 单视图；组装走全局作用域端点，machine 绑定靠 X-Machine-ID 头。
       2026-10-10 服务端 e44a8b66：+ views/{view}/upload 逐视图上传替换，
       auto_assemble 缺省=false=纯替换——用户裁决：六视图是完整集合，手动替换
       任何一张其余五张不动，补缺/重生成走 assemble 显式触发） ── */
  const sixViews = ref<ProductSixViewEntry[]>([])
  const sixMissing = ref<string[]>([])
  const sixLoading = ref(false)
  const sixAssembling = ref(false)
  const sixUploading = ref('')       // 正在上传替换的视角名（''=空闲）
  const sixStatus = ref('')
  // 组装兜底开关（ViewsAssembleIn，客户端缺省=服务端缺省口径 2026-10-10 对齐）：
  // 素材库匹配永远第一优先且不可关；allow_web 网络搜图缺省关、allow_ai AI 生成缺省开
  const allowWeb = ref(false)
  const allowAi = ref(true)

  /* ── machine_id 路径参数（懒加载缓存） ── */
  let machineId = ''
  async function ensureMachineId(): Promise<string> {
    if (machineId) return machineId
    const t = getTintin()
    const r = await t?.env?.getMachineId?.()
    machineId = r?.ok ? String(r.machineId || '') : ''
    return machineId
  }

  function base(machineId: string): string {
    return `/api/product-library/clients/${encodeURIComponent(machineId)}`
  }

  /** 离线（null）→ Error；{error} → Error；其余原样返回 */
  async function callJson<T>(fn: () => Promise<T>): Promise<T> {
    const data = await fn()
    if (data === null || data === undefined) throw new Error('无法连接服务端，请检查服务端地址配置。')
    if (typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
      const msg = String((data as Record<string, unknown>).error || '')
      if (msg) throw new Error(msg)
    }
    return data
  }

  /* ── 树加载（对齐 refresh_tree / _fetch_tree_data） ─────────── */

  async function loadTree(): Promise<void> {
    const t = getTintin()
    if (!t?.server) { treeError.value = '预览环境：无 IPC'; return }
    const mid = await ensureMachineId()
    if (!mid) { treeError.value = '机器码获取失败'; return }
    const kw = keyword.value.trim()
    treeLoading.value = true
    treeError.value = ''
    try {
      if (kw) {
        // 搜索：结果为平铺列表（对齐原 search 分支 L639-647）
        const data = await callJson(() => t.server.get(`${base(mid)}/search`, { q: kw }))
        const items = extractItems(data)
        searchHits.value = items.map((it) => ({ id: String(it.id ?? ''), label: searchResultLabel(it) }))
        nodes.value = []
      } else {
        // 全量树：grouped（服务端 tree 缺失时渲染层降级建树，对齐 manager L333-344）
        const data = await callJson(() => t.server.get(`${base(mid)}/grouped`, {}))
        const tree = (data && typeof data === 'object' && 'tree' in data && typeof data.tree === 'object')
          ? data.tree as Record<string, Record<string, ProductItem[]>>
          : buildProductTree(extractItems(data))
        searchHits.value = []
        nodes.value = treeToNodes(tree)
      }
    } catch (e) {
      nodes.value = []
      searchHits.value = []
      treeError.value = (e as Error)?.message || String(e)
    } finally {
      treeLoading.value = false
    }
  }

  /** {items}|{data}|{results}|裸数组 容错展开（同 workbenchChatContext.pickListItems 口径） */
  function extractItems(data: unknown): ProductItem[] {
    if (Array.isArray(data)) return data as ProductItem[]
    if (data && typeof data === 'object') {
      for (const key of ['items', 'data', 'results']) {
        const v = (data as Record<string, unknown>)[key]
        if (Array.isArray(v)) return v as ProductItem[]
      }
    }
    return []
  }

  /* ── 搜索防抖（对齐原 QTimer 300ms） ─────────────────────────── */

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  function onKeywordInput(v: string): void {
    keyword.value = v
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { void loadTree() }, SEARCH_DEBOUNCE_MS)
  }

  /* ── 详情 / 表单（对齐 _on_tree_clicked / clear_form） ───────── */

  /** 详情响应 → 六视图状态（详情内嵌 item.six_views + 顶层 six_views_missing，零二跳） */
  function applySixViews(data: unknown): void {
    if (!data || typeof data !== 'object') return
    const d = data as Record<string, unknown>
    const item = (d.item ?? null) as Record<string, unknown> | null
    sixViews.value = normalizeProductSixViews(item?.six_views)
    sixMissing.value = Array.isArray(d.six_views_missing) ? d.six_views_missing.map(String) : []
  }

  async function selectNode(id: string): Promise<void> {
    const t = getTintin()
    if (!t?.server || !id) return
    const mid = await ensureMachineId()
    if (!mid) return
    try {
      // 缓存未命中兜底：直接向服务端取单条（对齐 _fetch_item_direct）
      const data = await callJson(() => t.server.get(`${base(mid)}/items/${encodeURIComponent(id)}`, {}))
      const item = (data && typeof data === 'object' && 'item' in data ? data.item : data) as ProductItem | null
      if (!item) { formStatus.value = `未找到产品（id=${id}），请稍后重试或先同步。`; return }
      editingId.value = id
      form.value = normalizeItem(item)
      const warehouse = isWarehouseItem(item)
      lockedFields.value = fieldLockMap(warehouse)
      formStatus.value = `正在编辑：${item.brand ?? ''} ${item.model ?? ''}`
        + (warehouse ? '（仓库产品：仅可改 商品名称/品类/备注）' : '')
      applySixViews(data)
    } catch (e) {
      formStatus.value = `读取产品失败：${(e as Error)?.message || e}`
    }
  }

  function clearForm(): void {
    editingId.value = null
    form.value = {}
    lockedFields.value = fieldLockMap(false)
    sixViews.value = []
    sixMissing.value = []
    sixStatus.value = ''
    formStatus.value = '新增模式'
  }

  /* ── 保存 / 删除（对齐 _on_save / _on_delete） ───────────────── */

  async function save(): Promise<void> {
    if (saving.value) return
    const check = validateItem(form.value)
    if (!check.ok) { formStatus.value = check.message; return }
    const t = getTintin()
    if (!t?.server) { formStatus.value = '预览环境：无 IPC'; return }
    const mid = await ensureMachineId()
    if (!mid) { formStatus.value = '机器码获取失败'; return }
    saving.value = true
    try {
      const body = normalizeItem(form.value)
      if (editingId.value) {
        const id = editingId.value // 闭包内 .value 收窄失效，先落地常量
        const r = await callJson<{ message?: string }>(() => t.server.put(`${base(mid)}/items/${encodeURIComponent(id)}`, body))
        formStatus.value = String(r?.message ?? '已保存。')
      } else {
        const r = await callJson<{ message?: string; item?: { id?: string | number } }>(() => t.server.post(`${base(mid)}/items`, body))
        const newItem = r?.item
        editingId.value = newItem?.id ? String(newItem.id) : null
        formStatus.value = String(r?.message ?? '已添加。')
      }
      await loadTree()
    } catch (e) {
      formStatus.value = (e as Error)?.message || String(e)
    } finally {
      saving.value = false
    }
  }

  async function remove(): Promise<void> {
    if (!editingId.value) { formStatus.value = '当前为新增模式，无可删除条目。'; return }
    const id = editingId.value // 闭包内 .value 收窄失效，先落地常量
    const t = getTintin()
    if (!t?.server) return
    const mid = await ensureMachineId()
    if (!mid) return
    try {
      await callJson(() => t.server.delete(`${base(mid)}/items/${encodeURIComponent(id)}`, {}))
      formStatus.value = '已删除。'
      clearForm()
      await loadTree()
    } catch (e) {
      formStatus.value = `删除失败：${(e as Error)?.message || e}`
    }
  }

  /* ── 仓库同步（对齐 StockSyncWorker：触发 + 2s 轮询） ────────── */

  let syncTimer: ReturnType<typeof setTimeout> | null = null

  async function startSync(): Promise<void> {
    if (syncing.value) return
    const t = getTintin()
    if (!t?.server) { syncStatus.value = '预览环境：无 IPC'; return }
    const mid = await ensureMachineId()
    if (!mid) { syncStatus.value = '机器码获取失败'; return }
    syncing.value = true
    syncStatus.value = '正在触发服务端 ERP 同步...'
    try {
      await callJson(() => t.server.post(`${base(mid)}/sync`, {}))
      syncStatus.value = '正在等待服务端同步完成...'
      pollSync(mid)
    } catch (e) {
      syncing.value = false
      syncStatus.value = `同步失败：${(e as Error)?.message || e}`
    }
  }

  function pollSync(mid: string): void {
    const t = getTintin()
    syncTimer = setTimeout(async () => {
      try {
        const st = await t.server.get(`${base(mid)}/sync/status`, {})
        const parsed = parseSyncStatus(st === null ? {} : st)
        if (parsed.state === 'running') {
          syncStatus.value = parsed.text
          pollSync(mid)
          return
        }
        syncing.value = false
        syncStatus.value = parsed.state === 'error' ? parsed.text : `${parsed.text}`
        await loadTree()
      } catch (e) {
        syncing.value = false
        syncStatus.value = `同步失败：${(e as Error)?.message || e}`
      }
    }, POLL_MS)
  }

  /* ── 智能挖掘（单条，对齐 SingleMineWorker L118-166） ────────── */

  let mineTimer: ReturnType<typeof setTimeout> | null = null
  let mineDeadline = 0

  async function mineSingle(): Promise<void> {
    if (mining.value) return
    const brand = (form.value.brand || '').trim()
    const model = (form.value.model || '').trim()
    if (!brand || !model) { formStatus.value = '请确保产品“品牌”和“型号/货品名称”已填写！'; return }
    const t = getTintin()
    if (!t?.server) { formStatus.value = '预览环境：无 IPC'; return }
    const mid = await ensureMachineId()
    if (!mid) { formStatus.value = '机器码获取失败'; return }
    // 新增模式 → 先自动保存获得 item_id（挖掘即持久化前提，对齐 L520-533）
    let itemId = editingId.value || ''
    if (!itemId) {
      const check = validateItem(form.value)
      if (!check.ok) { formStatus.value = check.message; return }
      try {
        const r = await callJson<{ item?: { id?: string | number } }>(() => t.server.post(`${base(mid)}/items`, normalizeItem(form.value)))
        itemId = r?.item?.id ? String(r.item.id) : ''
        if (itemId) {
          editingId.value = itemId
          formStatus.value = '已自动保存新产品，正在挖掘...'
          await loadTree()
        }
      } catch { /* 自动保存失败不中断挖掘（原版 L532 同口径） */ }
    }
    mining.value = true
    mineStatus.value = '正在调用服务端 AI 挖掘（挖掘即持久化）...'
    mineDeadline = Date.now() + MINE_TIMEOUT_MS
    try {
      /* 契约口径（openapi MineRequest）：model 默认 'deepseek-v4-flash'，服务端按名称查模型表。
         2026-09-05 修复：不可显式传 model:'' —— 空串覆盖 pydantic 默认值，
         服务端报「未找到模型:」；省略字段让服务端默认值生效（与原客户端不传同口径） */
      await callJson(() => t.server.post(`${base(mid)}/mine`, { item_ids: [itemId] }))
      pollMine(mid, itemId)
    } catch (e) {
      mining.value = false
      mineStatus.value = `挖掘失败：${(e as Error)?.message || e}`
    }
  }

  function pollMine(mid: string, itemId: string): void {
    const t = getTintin()
    mineTimer = setTimeout(async () => {
      if (Date.now() > mineDeadline) {
        mining.value = false
        mineStatus.value = '服务端挖掘超时（10 分钟），请稍后在批量挖掘中查看。'
        return
      }
      try {
        const st = await t.server.get(`${base(mid)}/mine/status`, {})
        const parsed = parseMineStatus(st === null ? {} : st)
        if (parsed.state === 'running') {
          mineStatus.value = parsed.text
          pollMine(mid, itemId)
          return
        }
        if (parsed.state === 'error') {
          mining.value = false
          mineStatus.value = parsed.text
          return
        }
        await refillMined(mid, itemId)
      } catch (e) {
        mining.value = false
        mineStatus.value = `挖掘失败：${(e as Error)?.message || e}`
      }
    }, POLL_MS)
  }

  /** 挖掘完成回读单条（小幅重试兼容服务端落库时序，对齐 L146-154） */
  async function refillMined(mid: string, itemId: string): Promise<void> {
    const t = getTintin()
    for (let attempt = 0; attempt < 8; attempt++) {
      const data = await t.server.get(`${base(mid)}/items/${encodeURIComponent(itemId)}`, {})
      const item = (data && typeof data === 'object' && 'item' in data ? data.item : data) as ProductItem | null
      if (item && (String(item.features ?? '').trim() || String(item.selling_points ?? '').trim())) {
        form.value = normalizeItem(item)
        mining.value = false
        mineStatus.value = 'AI 挖掘成功，已自动持久化。'
        return
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    mining.value = false
    mineStatus.value = 'AI 挖掘未返回有效结果，请重试或手动填写。'
  }

  /* ── 全量挖掘（对齐 BulkMineWorker：再点停止） ───────────────── */

  let bulkStop = false

  async function mineAll(): Promise<void> {
    if (bulkMining.value) { bulkStop = true; bulkMining.value = false; mineStatus.value = '已请求停止…'; return }
    const t = getTintin()
    if (!t?.server) { mineStatus.value = '预览环境：无 IPC'; return }
    const mid = await ensureMachineId()
    if (!mid) { mineStatus.value = '机器码获取失败'; return }
    bulkStop = false
    bulkMining.value = true
    mineStatus.value = '正在触发服务端批量挖掘...'
    try {
      await callJson(() => t.server.post(`${base(mid)}/mine`, { item_ids: [] }))
      pollBulk(mid)
    } catch (e) {
      bulkMining.value = false
      mineStatus.value = `无法连接服务端：${(e as Error)?.message || e}`
    }
  }

  function pollBulk(mid: string): void {
    const t = getTintin()
    mineTimer = setTimeout(async () => {
      if (bulkStop) { mineStatus.value = '已停止。'; return }
      try {
        const st = await t.server.get(`${base(mid)}/mine/status`, {})
        const parsed = parseMineStatus(st === null ? {} : st)
        if (parsed.state === 'running') {
          mineStatus.value = parsed.text
          pollBulk(mid)
          return
        }
        bulkMining.value = false
        if (parsed.state === 'error') { mineStatus.value = parsed.text; return }
        mineStatus.value = `一键挖掘完成：处理 ${parsed.done}/${parsed.total} 条。`
        await loadTree()
      } catch (e) {
        bulkMining.value = false
        mineStatus.value = `一键挖掘出错：${(e as Error)?.message || e}`
      }
    }, POLL_MS)
  }

  /* ── 六视图动作（2026-10-09 服务端 8f073bbf） ────────────────── */

  /** 重新读取详情刷新六视图（machine 作用域详情同一序列化器，item.six_views 同样内嵌） */
  async function loadSixViews(itemId: string): Promise<void> {
    const t = getTintin()
    if (!t?.server || !itemId) return
    const mid = await ensureMachineId()
    if (!mid) return
    sixLoading.value = true
    try {
      const data = await callJson(() => t.server.get(`${base(mid)}/items/${encodeURIComponent(itemId)}`, {}))
      applySixViews(data)
    } catch (e) {
      sixStatus.value = `六视图读取失败：${(e as Error)?.message || e}`
    } finally {
      sixLoading.value = false
    }
  }

  /** 生成六视图：POST /api/product-library/items/{id}/views/assemble（全局作用域，
   *  views 子集缺省=六视角全集）→ 轮询 /tasks/unified/{task_id}（extractTaskObj+
   *  mapTaskStatus 同仿视频口径）→ 完成回读详情。超时 10 分钟（同挖掘上限）。 */
  async function assembleSixViews(): Promise<void> {
    if (sixAssembling.value) return
    const itemId = editingId.value || ''
    if (!itemId) { sixStatus.value = '请先选择产品（新增模式请先保存）。'; return }
    const t = getTintin()
    if (!t?.server) { sixStatus.value = '预览环境：无 IPC'; return }
    sixAssembling.value = true
    const fallbacks = [allowWeb.value ? '网络搜图兜底' : '', allowAi.value ? 'AI 生成兜底' : '']
      .filter(Boolean).join('，')
    sixStatus.value = `正在触发六视图组装（素材库优先${fallbacks ? '，' + fallbacks : ''}）...`
    const deadline = Date.now() + MINE_TIMEOUT_MS
    try {
      const r = await callJson<{ task_id?: string }>(() => t.server.post(
        `/api/product-library/items/${encodeURIComponent(itemId)}/views/assemble`,
        { allow_web: allowWeb.value, allow_ai: allowAi.value },
      ))
      const taskId = String(r?.task_id ?? '')
      if (!taskId) throw new Error(`组装响应缺 task_id（实得字段：${r ? Object.keys(r).join(',') : 'null'}）`)
      for (;;) {
        if (Date.now() > deadline) {
          sixAssembling.value = false
          sixStatus.value = '六视图组装超时（10 分钟），请稍后重新选择产品查看。'
          return
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        const resp = await t.server.get(API_PATHS.tasks.unifiedItem(taskId), {})
        const task = extractTaskObj(resp)
        const info = mapTaskStatus(task.status ?? task.state, task)
        if (info.phase === 'running') {
          sixStatus.value = `六视图组装中：${String(task.last_message || '服务端处理中').slice(0, 50)}`
          continue
        }
        if (info.phase === 'failed') {
          sixAssembling.value = false
          sixStatus.value = `六视图组装失败：${info.error}`
          return
        }
        break
      }
      sixAssembling.value = false
      sixStatus.value = '六视图组装完成。'
      await loadSixViews(itemId)
    } catch (e) {
      sixAssembling.value = false
      sixStatus.value = `六视图组装失败：${(e as Error)?.message || e}`
    }
  }

  /** 删除单个视图（服务端物理删绑定；错图清理后可重新组装补齐） */
  async function deleteSixView(view: string): Promise<void> {
    const itemId = editingId.value || ''
    if (!itemId) return
    const t = getTintin()
    if (!t?.server) return
    try {
      await callJson(() => t.server.delete(
        `/api/product-library/items/${encodeURIComponent(itemId)}/views/${encodeURIComponent(view)}`, {},
      ))
      sixStatus.value = `已删除「${view}」视图。`
      await loadSixViews(itemId)
    } catch (e) {
      sixStatus.value = `删除视图失败：${(e as Error)?.message || e}`
    }
  }

  /** 上传替换单个视图：POST views/{view}/upload（multipart file）。
   *  纯替换语义（用户裁决 2026-10-10）：客户端不传 auto_assemble（服务端缺省
   *  false）——只换这张，其余五张一张不动；补缺/重生成由用户点「生成/重新生成」
   *  显式走 assemble。上传图照旧入素材库（source=client），成功后回读详情刷新。
   *  注意 views 三件套（assemble/upload/DELETE）均为全局作用域端点（无
   *  /clients/{machine_id}/ 前缀，2026-10-10 实测：clients 作用域 404），machine
   *  绑定靠代理自动注入的 X-Machine-ID 头。 */
  async function uploadSixView(view: string, file: File): Promise<void> {
    const itemId = editingId.value || ''
    if (!itemId) { sixStatus.value = '请先选择产品（新增模式请先保存）。'; return }
    const t = getTintin()
    if (!t?.server) { sixStatus.value = '预览环境：无 IPC'; return }
    if (sixUploading.value) return
    sixUploading.value = view
    sixStatus.value = `正在上传「${productViewLabel(view)}」视图...`
    try {
      const form = new FormData()
      form.append('file', file, file.name || `${view}.png`)
      await callJson(() => t.server.upload(
        `/api/product-library/items/${encodeURIComponent(itemId)}/views/${encodeURIComponent(view)}/upload`,
        form,
      ))
      sixStatus.value = `已替换「${productViewLabel(view)}」视图（其余五张未变动）。`
      await loadSixViews(itemId)
    } catch (e) {
      sixStatus.value = `上传替换失败：${(e as Error)?.message || e}`
    } finally {
      sixUploading.value = ''
    }
  }

  /* ── Excel 导入（2026-10-10：服务端 POST /import multipart 自解析，
       客户端只传文件不解析（原「待引入 SheetJS」待办作废）；模板 GET /import/template
       直下 .xlsx，走 dialog.saveFile→server.downloadResult→revealInFolder 既有链） ── */
  const importing = ref(false)
  const importStatus = ref('')

  /** 上传 Excel 产品表：POST /api/product-library/import（全局作用域端点，
   *  machine 绑定靠代理自动注入的 X-Machine-ID 头，同 assemble）；成功后重载树。 */
  async function importExcel(file: File): Promise<void> {
    if (importing.value) return
    const t = getTintin()
    if (!t?.server) { importStatus.value = '预览环境：无 IPC'; return }
    importing.value = true
    importStatus.value = `正在导入「${file.name}」...`
    try {
      const form = new FormData()
      form.append('file', file, file.name || 'import.xlsx')
      const r = await callJson(() => t.server.upload('/api/product-library/import', form))
      importStatus.value = summarizeImportResult(r)
      await loadTree()
    } catch (e) {
      importStatus.value = `导入失败：${(e as Error)?.message || e}`
    } finally {
      importing.value = false
    }
  }

  /** 下载服务端标准导入模板（product_import_template.xlsx 实测为 .xlsx 附件） */
  async function downloadImportTemplate(serverUrl: string): Promise<void> {
    const t = getTintin()
    if (!t?.server) { importStatus.value = '预览环境：无 IPC'; return }
    if (!serverUrl) { importStatus.value = '服务端地址未知，请先连接服务端。'; return }
    try {
      const savePath = await t.dialog?.saveFile?.({
        title: '保存导入模板',
        defaultPath: 'product_import_template.xlsx',
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
      })
      if (!savePath) return // 用户取消
      const saved = await t.server.downloadResult(`${serverUrl}/api/product-library/import/template`, savePath)
      if (!saved) throw new Error('下载失败（服务端离线或网络异常）')
      importStatus.value = `模板已保存：${saved}`
      try { t.shell?.revealInFolder?.(String(saved)) } catch { /* 无壳环境静默 */ }
    } catch (e) {
      importStatus.value = `模板下载失败：${(e as Error)?.message || e}`
    }
  }

  /* ── 组件卸载清理（轮询定时器） ──────────────────────────────── */

  onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer)
    if (syncTimer) clearTimeout(syncTimer)
    if (mineTimer) clearTimeout(mineTimer)
  })

  /* ── Excel 导入解析：parseImportRows 为原版客户端解析纯函数（有单测）；
       现行导入走服务端自解析，此函数保留作格式校验备胎 ── */
  void parseImportRows

  return {
    // 树/搜索
    keyword, nodes, searchHits, treeLoading, treeError, loadTree, onKeywordInput,
    // 表单
    form, editingId, lockedFields, formStatus, saving, selectNode, clearForm, save, remove,
    // 同步
    syncing, syncStatus, startSync,
    // 挖掘
    mining, bulkMining, mineStatus, mineSingle, mineAll,
    // 六视图
    sixViews, sixMissing, sixLoading, sixAssembling, sixUploading, sixStatus,
    allowWeb, allowAi, assembleSixViews, deleteSixView, uploadSixView,
    // Excel 导入
    importing, importStatus, importExcel, downloadImportTemplate,
  }
}

export type OpsProductLibrary = ReturnType<typeof useOpsProductLibrary>
