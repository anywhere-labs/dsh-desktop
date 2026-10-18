// ═══════════════════════════════════════════════════════════════
// useWorkbenchPickers — 工作台输入区·产品/素材/脚本选择弹窗搜索域
// 服务端契约（API-GUIDE 已核实，响应为自由格式 → pickListItems
// 容错解析 {items}|{data}|{results}|裸数组）：
//   · GET  /api/product-library/search?q=&limit=   产品（品类/品牌/型号）
//   · GET  /material/list?search=&brand=&model=&media_type=   图视网格（原版
//     素材检索口径；缩略图/预览走 /material/thumbnail、/material/serve）
//   · GET  /audio/library?keyword=&category=       音频库（播放走
//     /audio/library/{audio_id}/file；分类候选 GET /audio/categories）
//   · GET  /api/storyboard/scripts?topic=&page=    分镜脚本库（主题）
// HTTP 全部经主进程通用 server:get/post IPC（离线 null / 5xx 抛错），本层
// 只做调用编排与异常文案映射（searchErrorText），组件零 URL 拼装（IRON-06）。
// 异常分支（spec）：网络失败/5xx/空结果 均有提示。
// ═══════════════════════════════════════════════════════════════

import { ref } from 'vue'
import { getTintin } from './useSettingsConfig'
import { pickListItems, pickListTotal, pickDistinctValues, searchErrorText } from './workbenchChatContext'

export type PickerItem = Record<string, unknown>

/** 单次搜索调用的统一封装：离线/5xx/{error} → Error(用户可读文案)，返回原始 payload */
async function fetchJsonPayload(call: () => Promise<unknown>): Promise<unknown> {
  let data: unknown
  try {
    data = await call()
  } catch (e) {
    throw new Error(searchErrorText(e))
  }
  if (data === null || data === undefined) {
    throw new Error(searchErrorText(null)) // 离线静默 null
  }
  if (typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const msg = String((data as Record<string, unknown>).error || '')
    if (msg) throw new Error(searchErrorText(new Error(msg)))
  }
  return data
}

/** payload → 列表（pickListItems 容错解析 {items}|{data}|{results}|裸数组） */
async function fetchJsonList(call: () => Promise<unknown>): Promise<PickerItem[]> {
  return pickListItems(await fetchJsonPayload(call))
}

/* ── 三个弹窗的搜索 fetcher（组件只消费，不感知 URL） ───────── */

/** 产品详情：GET /api/product-library/items/{id}（全局作用域；详情内嵌 six_views/selling_points/features，
 *  仿视频选品与运营资料同源。search 列表 six_views 恒被投影裁剪——必须查详情） */
export async function fetchProductDetail(id: string): Promise<PickerItem> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  const data = await fetchJsonPayload(() => t.server.get(`/api/product-library/items/${encodeURIComponent(id)}`))
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return (o.item ?? o) as PickerItem
}

/** 产品库全量平铺（产品资料同源 grouped 树 → 平铺，附 category/brand 字段；会话级缓存 5 分钟）。
 *  2026-10-17 实证兜底：服务端两个 search 端点对 brand/model 均不匹配（库内「千问」品牌 25 条
 *  型号搜「千问」返回 0——根因归服务端会话修），客户端以 grouped 本地过滤兜底立即可用。 */
let flatProductsCache: { at: number; flat: PickerItem[] } | null = null
async function fetchFlatProducts(t: NonNullable<ReturnType<typeof getTintin>>): Promise<PickerItem[]> {
  if (flatProductsCache && Date.now() - flatProductsCache.at < 5 * 60_000) return flatProductsCache.flat
  const mid = await t.env?.getMachineId?.()
  const machineId = mid?.ok ? String(mid.machineId || '') : ''
  if (!machineId) return []
  const g = (await t.server.get(`/api/product-library/clients/${encodeURIComponent(machineId)}/grouped`, {})) as
    | { tree?: Record<string, Record<string, unknown[]>> }
    | null
  const tree = (g && typeof g === 'object' && g.tree) || {}
  const flat: PickerItem[] = []
  for (const [category, brands] of Object.entries(tree)) {
    for (const [brand, items] of Object.entries(brands || {})) {
      for (const it of Array.isArray(items) ? items : []) {
        if (it && typeof it === 'object') flat.push({ ...(it as PickerItem), category, brand })
      }
    }
  }
  flatProductsCache = { at: Date.now(), flat }
  return flat
}

/** 产品搜索（2026-10-17 用户报障修死：@ 下拉数据比产品资料少且搜千问无结果）：
 *  ① 客户端作用域 search（产品资料同源）② 零命中 → grouped 本地过滤（brand/model/name/goods_no
 *  包含匹配；树只拉一次缓存）③ 机器码缺失/作用域异常 → 全局 search 保底。 */
export async function fetchProducts(kw: string): Promise<PickerItem[]> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  const q = kw.trim()
  let scoped: PickerItem[] = []
  try {
    const mid = await t.env?.getMachineId?.()
    const machineId = mid?.ok ? String(mid.machineId || '') : ''
    if (machineId) {
      scoped = await fetchJsonList(() => t.server.get(
        `/api/product-library/clients/${encodeURIComponent(machineId)}/search`, { q }))
    }
  } catch { /* 机器码缺失/客户端作用域失败 → 全局 search 保底 */ }
  if (scoped.length > 0) return scoped
  if (q) {
    const lower = q.toLowerCase()
    const local = (await fetchFlatProducts(t))
      .filter((it) => ['name', 'model', 'brand', 'goods_no', 'category']
        .some((k) => String((it as Record<string, unknown>)[k] ?? '').toLowerCase().includes(lower)))
      .slice(0, 30)
    if (local.length > 0) return local
  }
  if (scoped.length === 0 && !q) {
    const head = (await fetchFlatProducts(t)).slice(0, 50)
    if (head.length > 0) return head
  }
  return fetchJsonList(() => t.server.get('/api/product-library/search', { q: kw, limit: 200 }))
}

/** 图视网格检索：GET /material/list（品牌/型号/分类/类型过滤 + 分页，原版素材检索
 *  vector_search/page.py 口径；空媒体类型=全部）；返回 items + total
 *  （total 缺失 → -1，调用方退化为单页不分页） */
export async function fetchMaterialGrid(p: {
  search?: string
  brand?: string
  model?: string
  category?: string
  mediaType?: string
  page?: number
  size?: number
  /** 2026-10-09 服务端产品图模式（opt-in，/material/list 与 /material/search 同语义）：
   *  底型白名单 white/solid/transparent+强制 media_type=image+宽高比闸 0.4~2.6+
   *  白底→透明底→其余排序；缺省=不带，行为与旧版逐字节一致 */
  purpose?: string
}): Promise<{ items: PickerItem[]; total: number }> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  const q: Record<string, unknown> = {
    page: Math.max(1, Number(p.page) || 1),
    size: Math.max(1, Number(p.size) || 60),
  }
  if (String(p.search || '').trim()) q.search = String(p.search).trim()
  if (String(p.brand || '').trim()) q.brand = String(p.brand).trim()
  if (String(p.model || '').trim()) q.model = String(p.model).trim()
  if (String(p.category || '').trim()) q.category = String(p.category).trim()
  if (String(p.mediaType || '').trim()) q.media_type = String(p.mediaType).trim()
  if (String(p.purpose || '').trim()) q.purpose = String(p.purpose).trim()
  const data = await fetchJsonPayload(() => t.server.get('/material/list', q))
  return { items: pickListItems(data), total: pickListTotal(data) }
}

/** 素材字段候选值：GET /material/distinct?field=brand|model|category（原版素材检索
 *  过滤下拉候选口径；失败回退空数组——候选缺失不阻塞弹窗，仍可手输过滤） */
export async function fetchMaterialDistinct(field: 'brand' | 'model' | 'category'): Promise<string[]> {
  const t = getTintin()
  if (!t?.server) return []
  try {
    return pickDistinctValues(await t.server.get('/material/distinct', { field }))
  } catch (_) {
    return []
  }
}

/** 音频库检索：GET /audio/library（keyword + category 过滤，契约已核实） */
export async function fetchAudioLibrary(p: { keyword?: string; category?: string }): Promise<PickerItem[]> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  const q: Record<string, unknown> = { page: 1, size: 60 }
  if (String(p.keyword || '').trim()) q.keyword = String(p.keyword).trim()
  if (String(p.category || '').trim()) q.category = String(p.category).trim()
  return fetchJsonList(() => t.server.get('/audio/library', q))
}

/** 音频分类候选：GET /audio/categories（失败回退空 → 分类下拉仅「全部分类」） */
export async function fetchAudioCategories(): Promise<string[]> {
  const t = getTintin()
  if (!t?.server) return []
  try {
    const d = await t.server.get('/audio/categories')
    const arr = Array.isArray(d) ? d : ((d as any)?.categories ?? (d as any)?.items ?? [])
    return (Array.isArray(arr) ? arr : [])
      .map((x: unknown) =>
        typeof x === 'string' ? x : String((x as Record<string, unknown>)?.category ?? (x as Record<string, unknown>)?.name ?? '')
      )
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

/** 脚本列表：GET /api/storyboard/scripts?topic=&page=1&page_size=100 */
export async function fetchScripts(kw: string): Promise<PickerItem[]> {
  const t = getTintin()
  if (!t?.server) throw new Error(searchErrorText(null))
  return fetchJsonList(() =>
    t.server.get('/api/storyboard/scripts', { topic: String(kw || '').trim(), page: 1, page_size: 100 })
  )
}

/* ── 搜索状态工厂（弹窗组件内消费；状态即 UI 三态数据） ─────── */

export function usePickerSearch(fetcher: (kw: string) => Promise<PickerItem[]>) {
  const kw = ref('')
  const items = ref<PickerItem[]>([])
  const loading = ref(false)
  const error = ref('')
  /** 是否已完成至少一次搜索（区分「未搜索」与「空结果」两种空态） */
  const searched = ref(false)

  async function run() {
    loading.value = true
    error.value = ''
    try {
      items.value = await fetcher(kw.value)
    } catch (e) {
      items.value = []
      error.value = (e as Error)?.message || String(e)
    } finally {
      loading.value = false
      searched.value = true
    }
  }

  /** 弹窗每次打开时重置（原版弹窗每次 exec 都重新加载） */
  function reset() {
    kw.value = ''
    items.value = []
    error.value = ''
    searched.value = false
  }

  return { kw, items, loading, error, searched, run, reset }
}
