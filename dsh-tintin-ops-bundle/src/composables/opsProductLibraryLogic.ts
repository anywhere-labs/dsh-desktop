// ═══════════════════════════════════════════════════════════════
// opsProductLibraryLogic — 产品资料·纯函数层（无 vue / IPC 依赖）
// 对照原客户端 utils/product_library_manager.py 与 gui/product_library_page.py：
//   · FIELDS / REQUIRED_FIELDS / WAREHOUSE_FIELDS（manager L22-43）
//   · _normalize（manager L211-214）：仅已知字段、缺失补空串、值转字符串
//   · add_item/update_item 必填校验文案（manager L226/L239）
//   · grouped 本地降级（manager L333-344）：品类缺省「未归类」、品牌「未知品牌」
//   · _on_tree_data_ready（page L636-662）：排序 + 叶子标签 model→goods_no→(未命名)
//   · LOCKABLE_FIELDS（page L601-602）+ _apply_field_locks（L604-613）
//   · is_warehouse（page L678）：goods_no 或 spec_no 非空
//   · to_prompt_text（manager L382-391）：非空字段逐行「label：value」
//   · StockSyncWorker 轮询分支（page L70-86）/ Mine 轮询（L130-142/L202-216）
//   · _on_import_excel 行校验（page L897-907）：品类/品牌必填、空行跳过
// UI（OtProductLibrary.vue）只消费这些纯函数 + useOpsProductLibrary 状态。
// ═══════════════════════════════════════════════════════════════

/* ── 字段常量（驱动表单与归一化，对齐原 FIELDS） ─────────────── */

export interface ProductField {
  key: string
  label: string
}

export const PRODUCT_FIELDS: readonly ProductField[] = [
  { key: 'category', label: '品类' },
  { key: 'brand', label: '品牌' },
  { key: 'model', label: '型号/货品名称' },
  { key: 'goods_no', label: '商家编码' },
  { key: 'spec_no', label: '规格编码' },
  { key: 'spec_name', label: '规格名称' },
  { key: 'barcode', label: '条形码' },
  { key: 'stock_num', label: '库存量' },
  { key: 'available_num', label: '可用库存' },
  { key: 'warehouse', label: '仓库' },
  { key: 'notes', label: '备注' },
  { key: 'features', label: '性能参数' },
  { key: 'selling_points', label: '核心卖点' }
] as const

/** 基本资料字段（features/selling_points 属「智能挖掘」区，对齐原 basic_fields 过滤） */
export const BASIC_FIELDS: readonly ProductField[] =
  PRODUCT_FIELDS.filter((f) => f.key !== 'features' && f.key !== 'selling_points')

export const REQUIRED_PRODUCT_FIELDS: readonly string[] = ['brand', 'model'] as const

/** 仓库同步条目的只读字段（对齐原 LOCKABLE_FIELDS） */
export const LOCKABLE_PRODUCT_FIELDS: readonly string[] = [
  'brand', 'goods_no', 'spec_no', 'spec_name',
  'barcode', 'stock_num', 'available_num', 'warehouse'
] as const

export type ProductItem = Record<string, unknown>

/* ── 归一化 / 校验 ───────────────────────────────────────────── */

/** 把任意 dict 规整成只含已知字段的条目（缺失补空串；对齐原 _normalize） */
export function normalizeItem(data: ProductItem | null | undefined): Record<string, string> {
  const src = data || {}
  const out: Record<string, string> = {}
  for (const f of PRODUCT_FIELDS) {
    out[f.key] = String(src[f.key] ?? '').trim()
  }
  return out
}

/** 必填校验（对齐原 add_item/update_item：缺失 → 「必填项不能为空：品牌、型号/货品名称」） */
export function validateItem(data: ProductItem | null | undefined): { ok: boolean; message: string } {
  const item = normalizeItem(data)
  const missing = PRODUCT_FIELDS
    .filter((f) => REQUIRED_PRODUCT_FIELDS.includes(f.key) && !item[f.key])
    .map((f) => f.label)
  if (missing.length) return { ok: false, message: `必填项不能为空：${missing.join('、')}` }
  return { ok: true, message: '' }
}

/* ── 树构建 / 树节点（对齐 grouped 降级 + _on_tree_data_ready） ── */

export interface ProductTreeNode {
  label: string
  /** 叶子节点才有产品 id；品类/品牌节点为 null（点击不进表单） */
  id: string | null
  children: ProductTreeNode[]
}

/** {品类:{品牌:[条目]}} 树（本地构建，对齐原 grouped 本地降级口径） */
export function buildProductTree(items: ProductItem[]): Record<string, Record<string, ProductItem[]>> {
  const tree: Record<string, Record<string, ProductItem[]>> = {}
  for (const it of items || []) {
    const cat = String(it.category ?? '').trim() || '未归类'
    const brand = String(it.brand ?? '').trim() || '未知品牌'
    ;(tree[cat] ??= {})[brand] ??= []
    tree[cat][brand].push(it)
  }
  return tree
}

/** 树 → 有序节点（品类/品牌字典序、叶子按 model 排序；对齐原 L636-662） */
export function treeToNodes(
  tree: Record<string, Record<string, ProductItem[]>>
): ProductTreeNode[] {
  const nodes: ProductTreeNode[] = []
  for (const cat of Object.keys(tree || {}).sort()) {
    const catNode: ProductTreeNode = { label: cat, id: null, children: [] }
    for (const brand of Object.keys(tree[cat]).sort()) {
      const brandNode: ProductTreeNode = { label: brand, id: null, children: [] }
      const leaves = [...tree[cat][brand]].sort((a, b) =>
        String(a.model ?? '').localeCompare(String(b.model ?? ''))
      )
      for (const it of leaves) {
        brandNode.children.push({
          label: String(it.model ?? '') || String(it.goods_no ?? '') || '(未命名)',
          id: String(it.id ?? ''),
          children: []
        })
      }
      catNode.children.push(brandNode)
    }
    nodes.push(catNode)
  }
  return nodes
}

/** 搜索结果条目标签（对齐原 L642：brand+model 或 (未命名)） */
export function searchResultLabel(it: ProductItem): string {
  const label = `${String(it.brand ?? '')} ${String(it.model ?? '')}`.trim()
  return label || '(未命名)'
}

/* ── 仓库条目判定 / 字段锁定（对齐 page L678 + _apply_field_locks） */

export function isWarehouseItem(it: ProductItem | null | undefined): boolean {
  if (!it) return false
  return !!(String(it.goods_no ?? '').trim() || String(it.spec_no ?? '').trim())
}

/** 字段 → 是否只读（warehouse=true 锁 8 字段；手工条目全可编辑） */
export function fieldLockMap(warehouse: boolean): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const f of PRODUCT_FIELDS) map[f.key] = false
  if (warehouse) {
    for (const key of LOCKABLE_PRODUCT_FIELDS) map[key] = true
  }
  return map
}

/* ── 摘要（对齐 to_prompt_text：文案创作/复制用） ─────────────── */

export function productToPromptText(item: ProductItem | null | undefined): string {
  if (!item) return ''
  const lines: string[] = []
  for (const f of PRODUCT_FIELDS) {
    const val = String(item[f.key] ?? '').trim()
    if (val) lines.push(`${f.label}：${val}`)
  }
  return lines.join('\n')
}

/* ── 同步 / 挖掘 轮询状态解析（纯函数，供 composable 轮询消费） ── */

export type PollState = 'running' | 'done' | 'error'

/** 同步状态（对齐原 StockSyncWorker L70-86 分支与文案） */
export function parseSyncStatus(st: Record<string, unknown> | null | undefined):
  { state: PollState; text: string; added?: number; updated?: number } {
  const s = st || {}
  if (s.running) {
    const phase = String(s.phase ?? '').trim() || '同步中...'
    const fetched = Number(s.fetched ?? 0) || 0
    const total = Number(s.total ?? 0) || 0
    return { state: 'running', text: total ? `${phase}（${fetched}/${total}）` : phase }
  }
  if (s.error) return { state: 'error', text: `服务端同步出错: ${String(s.error)}` }
  const added = Number(s.added ?? 0) || 0
  const updated = Number(s.updated ?? 0) || 0
  return { state: 'done', text: `服务端同步完成（新增 ${added}、更新 ${updated}）`, added, updated }
}

/** 挖掘状态（对齐 BulkMineWorker L202-216 / SingleMineWorker L130-142）
 *  done 分支无文案（调用方自行汇总 done/total），故用判别联合而非统一 text */
export type MineStatusResult =
  | { state: 'running'; text: string; done: number; total: number }
  | { state: 'error'; text: string }
  | { state: 'done'; done: number; total: number }

export function parseMineStatus(st: Record<string, unknown> | null | undefined): MineStatusResult {
  const s = st || {}
  if (s.running) {
    const done = Number(s.done ?? 0) || 0
    const total = Number(s.total ?? 0) || 0
    return { state: 'running', text: `服务端挖掘中 ${done}/${total}`, done, total }
  }
  if (s.error) return { state: 'error', text: `服务端挖掘出错: ${String(s.error)}` }
  return {
    state: 'done',
    done: Number(s.done ?? 0) || 0,
    total: Number(s.total ?? 0) || 0
  }
}

/* ── 导入行校验（对齐 _on_import_excel L897-907） ─────────────── */

export interface ImportParseResult {
  valid: Record<string, string>[]
  errors: string[]
}

/** 行对象数组 → {valid, errors}（品类/品牌必填；空行跳过；值裁剪） */
export function parseImportRows(rows: Array<Record<string, unknown>>): ImportParseResult {
  const valid: Record<string, string>[] = []
  const errors: string[] = []
  for (let i = 0; i < (rows || []).length; i++) {
    const row = rows[i] || {}
    const item: Record<string, string> = {}
    for (const f of PRODUCT_FIELDS) item[f.key] = String(row[f.key] ?? '').trim()
    if (!item.category && !item.brand && PRODUCT_FIELDS.every((f) => !item[f.key])) continue // 空行
    if (!item.category || !item.brand) {
      errors.push(`第 ${i + 1} 行：品类和品牌不能为空`)
      continue
    }
    valid.push(item)
  }
  return { valid, errors }
}

/** 导入响应摘要（2026-10-10 服务端 POST /import multipart 自解析，响应无 schema：
 *  message 字符串优先；否则常见计数键中文化平铺，标量键全忽略未知键不崩） */
export function summarizeImportResult(r: unknown): string {
  if (!r || typeof r !== 'object') return '导入完成。'
  const rec = r as Record<string, unknown>
  if (typeof rec.message === 'string' && rec.message.trim()) return rec.message.trim()
  const zh: Record<string, string> = {
    created: '新增', updated: '更新', skipped: '跳过', failed: '失败', total: '总计',
  }
  const parts = Object.entries(rec)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => `${zh[k] ?? k}=${String(v)}`)
  return parts.length ? `导入完成：${parts.join('，')}` : '导入完成。'
}

/** 单行 markdown 剥离（去列表符/加粗/残余标记；firstMarkdownLine 与 markdownListLines 共用） */function stripMarkdownLine(line: string): string {
  return line
    .replace(/^[-*•]+\s*/, '')          // 去列表符（- / * / •）
    .replace(/\*\*([^*]*)\*\*/g, '$1') // 去加粗 **xx** → xx
    .replace(/[*`]/g, '')               // 去残余标记字符
    .trim()
}

/** 通用：多行 markdown 列表文本 → 首行摘要（2026-09-01 产品弹窗两块布局：
 *  服务端 features（性能参数）/ selling_points（核心卖点）均为多行 markdown 列表
 *  （- **标题**：描述），剥列表符/** 加粗/残余标记，超长截断加省略号） */
export function firstMarkdownLine(raw: unknown, maxLen = 48): string {
  const line = String(raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  if (!line) return ''
  const text = stripMarkdownLine(line)
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

/** 多行 markdown 列表 → 干净文本数组（2026-09-01 产品弹窗预览区：左列表点击
 *  仅切换右侧预览，右侧展示选中产品性能参数/核心卖点全文；同 firstMarkdownLine
 *  剥离口径但不截断；空数据/纯空行 → 空数组） */
export function markdownListLines(raw: unknown): string[] {
  return String(raw ?? '')
    .split('\n')
    .map((l) => stripMarkdownLine(l.trim()))
    .filter(Boolean)
}

/** 型号剥离商品编码（2026-09-19 用户报障：产品库 model 尾部带【981-001277】类编码，
 *  生成口播文案弹窗「型号」不应填充——编码对文案生成无意义，念稿还会读出）。
 *  剥离尾部一组或多组全角【…】段（清单列样式：型号【编码】）；名称中段的
 *  圆括号变体（如"(粉色)"）是规格描述，保留不动 */
export function stripProductCodeFromModel(raw: unknown): string {
  return String(raw ?? '').replace(/(?:\s*【[^】]*】)+\s*$/, '').trim()
}

/** 产品资料关联关键词解析（2026-09-19 架构：服务端在产品资料中关联关键词，客户端
 *  据此命中；字段名与 API 契约对齐，仅读取 keywords 字段）。
 *  接受 string[] 或分隔字符串（顿号/逗号/分号/换行），去空去重 */
export function parseProductKeywords(item: Record<string, unknown> | null | undefined): string[] {
  if (!item) return []

  // 严格对齐服务端接口，仅读取 keywords 字段（铁律 6：不猜测、不兜底；
  // 2026-09-19 实测契约 ProductItemOut.keywords: string[]）
  const src = item.keywords ?? null

  const list = Array.isArray(src)
    ? src
    : (src == null ? [] : String(src).split(/[,，、;；\n]/))

  const out: string[] = []
  for (const it of list) {
    const w = String(it ?? '').trim()
    if (!w || out.includes(w)) continue
    out.push(w)
  }

  return out
}

/** 核心卖点摘要（firstMarkdownLine 的卖点语义别名；原直接截断显示已废弃） */
export function firstSellingPoint(raw: unknown, maxLen = 48): string {
  return firstMarkdownLine(raw, maxLen)
}

/* ── 产品六视图（2026-10-09 服务端 8f073bbf：详情 item.six_views 内嵌 + 列表
   six_view_counts + POST items/{id}/views/assemble 生成 + DELETE views/{view}）── */

/** 六视角规范序（missing 清单与占位渲染用） */
export const PRODUCT_SIX_VIEW_ORDER = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const

export interface ProductSixViewEntry {
  view: string
  materialId: string
  url: string
  thumbnail: string
  source: string
  confidence: number
}

/** 视角中文标签（未知视角名原样返回） */
export function productViewLabel(view: string): string {
  const labels: Record<string, string> = {
    front: '正面', back: '背面', left: '左侧', right: '右侧', top: '顶部', bottom: '底部',
  }
  return labels[view] ?? view
}

/** 服务端 six_views 键控对象 → 规范序条目（实弹形态 2026-10-09：
 *  {front:{material_id,url,thumbnail,source,confidence,origin_url,match_mode},…}；
 *  未知视角名按插入序追加在规范视角之后；无 material_id 的脏条目剔除；
 *  url/thumbnail 缺省按 material_id 回退拼装） */
export function normalizeProductSixViews(raw: unknown): ProductSixViewEntry[] {
  if (!raw || typeof raw !== 'object') return []
  const rec = raw as Record<string, unknown>
  const ordered: Array<[string, unknown]> = []
  for (const v of PRODUCT_SIX_VIEW_ORDER) {
    if (v in rec) ordered.push([v, rec[v]])
  }
  for (const [k, v] of Object.entries(rec)) {
    if (!(PRODUCT_SIX_VIEW_ORDER as readonly string[]).includes(k)) ordered.push([k, v])
  }
  const out: ProductSixViewEntry[] = []
  for (const [view, e] of ordered) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    const materialId = String(r.material_id ?? '')
    if (!materialId) continue
    out.push({
      view,
      materialId,
      url: String(r.url || `/material/serve?material_id=${materialId}`),
      thumbnail: String(r.thumbnail || `/material/thumbnail?material_id=${materialId}`),
      source: String(r.source ?? ''),
      confidence: Number(r.confidence ?? 0) || 0,
    })
  }
  return out
}

/** 六视图渲染槽位（规范六视角在前 + 未知视角追加；entry 缺省=占位）
 *  —— 运营「产品资料」六视图卡与选产品弹窗六视图侧栏共用 */
export interface ProductSixViewSlot {
  view: string
  label: string
  entry: ProductSixViewEntry | null
}

export function productSixViewSlots(views: ProductSixViewEntry[]): ProductSixViewSlot[] {
  const map = new Map(views.map((e) => [e.view, e]))
  const slots: ProductSixViewSlot[] = PRODUCT_SIX_VIEW_ORDER.map((v) => ({ view: v, label: productViewLabel(v), entry: map.get(v) ?? null }))
  for (const e of views) {
    if (!(PRODUCT_SIX_VIEW_ORDER as readonly string[]).includes(e.view)) slots.push({ view: e.view, label: productViewLabel(e.view), entry: e })
  }
  return slots
}
