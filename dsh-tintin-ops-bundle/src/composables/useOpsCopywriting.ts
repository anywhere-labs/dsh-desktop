// ═══════════════════════════════════════════════════════════════
// useOpsCopywriting — 产品文案创作域 composable（运营工具 · 产品资料卡内嵌）
// SRC composables/useOpsCopywriting.ts 移植（搬运基线 SRC 9ca9050）：
//   · 产品检索：产品库 GET /search?q=（防抖）→ 下拉选择 → GET /items/{id}
//     回填性能参数/核心卖点（可临时编辑，不回写产品库）
//   · 生成：window.tintin.server.llmChat（/llm/chat/completions，
//     model 空走服务端默认，与工作台/封面制作同口径；
//     2026-10-18 报障修正：llmChat 在 server 命名空间下，顶层无此成员）
//   · 极限词检测：opsCopywritingLogic.checkExtremeWords（词表全移植）
//   · 前往分镜：文案+产品上下文写入 pendingStoryboard（SRC appStore 切片，
//     composables/pendingStoryboard.ts）；分镜脚本创作卡 P2 挂载时消费
// 移植差异：SRC 经 vue-router 跳媒体工具分镜卡——本包无路由，跳转动作在
// OtCopywritingPanel 适配（写入信号 + 状态提示），信号本体与消费时序不变。
// 风格化（知识库条目）：SRC 亦未实装（2026-08-31 知识库批次暂停），不提供选择 UI。
// 分层（IRON-06）：URL 拼装仅在本层；组件零 URL/IPC 调用。
// ═══════════════════════════════════════════════════════════════

import { ref, onUnmounted } from 'vue'
import { getTintin } from './useSettingsConfig'
// 跨包：分镜草案经窗口总线发往媒体包（pendingStoryboard ref 归媒体包）
const setPendingStoryboard = (draft: unknown) => { (window as any).__tintinBus?.emit('tintin:storyboard-pending', draft) }
import {
  buildCopywritingPrompt,
  buildProductSection,
  checkExtremeWords,
  productComboLabel,
  summarizeExtremeWords,
  tagCountOf,
  type ExtremeMatch,
} from './opsCopywritingLogic'

const SEARCH_DEBOUNCE_MS = 300

/** /llm/chat/completions 响应 → 文本（choices[0].message.content，防御解析） */
function pickLlmText(res: unknown): string {
  const r = res as { choices?: Array<{ message?: { content?: unknown } }> } | null
  return String(r?.choices?.[0]?.message?.content ?? '').trim()
}

export function useOpsCopywriting() {
  /* ── 产品检索 / 选择 ── */
  const keyword = ref('')
  const productOptions = ref<{ id: string; label: string }[]>([])
  const productsLoading = ref(false)
  const productsError = ref('')
  const selectedProductId = ref('')

  /* ── 产品已保存资料（可临时编辑） ── */
  const features = ref('')
  const sellingPoints = ref('')
  /** 选中产品原始条目（brand/model/category/goods_no/spec_name...） */
  const currentProduct = ref<Record<string, unknown>>({})
  /**
   * 最近一次检索的全量产品条目缓存（对齐原客户端 ProductLibraryManager.load：
   * /grouped 树节点自带 features/selling_points，选中时本地直取回填；
   * 原 selectProduct 单独赌 GET /items/{id} 响应含同名字段，但 openapi 对该
   * 响应为空 schema 零字段说明，实测回填为空 → 以原客户端口径为准） */
  const productEntries = ref<Record<string, unknown>[]>([])

  /* ── 生成设置 ── */
  const platform = ref<string>('通用')
  const tone = ref<string>('热情种草')
  const structure = ref<string>('黄金3秒开场')
  const tags = ref<string>('不生成')
  const avoidBanned = ref(true)
  const extraPrompt = ref('')

  /* ── 文案 / 状态 ── */
  const copyText = ref('')
  const generating = ref(false)
  const status = ref('')
  const extremeHits = ref<ExtremeMatch[]>([])

  let machineId = ''
  async function ensureMachineId(): Promise<string> {
    if (machineId) return machineId
    const t = getTintin()
    const r = await t?.env?.getMachineId?.()
    machineId = r?.ok ? String(r.machineId || '') : ''
    return machineId
  }

  function base(mid: string): string {
    return `/api/product-library/clients/${encodeURIComponent(mid)}`
  }

  /** {items}|{data}|{results}|裸数组 容错展开（同产品资料域口径） */
  function extractItems(data: unknown): Record<string, unknown>[] {
    if (Array.isArray(data)) return data as Record<string, unknown>[]
    if (data && typeof data === 'object') {
      for (const key of ['items', 'data', 'results']) {
        const v = (data as Record<string, unknown>)[key]
        if (Array.isArray(v)) return v as Record<string, unknown>[]
      }
    }
    return []
  }

  /* ── 产品检索（对齐原 _populate_products：search 或全量） ──── */

  async function loadProducts(): Promise<void> {
    const t = getTintin()
    if (!t?.server) { productsError.value = '预览环境：无 IPC'; return }
    const mid = await ensureMachineId()
    if (!mid) { productsError.value = '机器码获取失败'; return }
    productsLoading.value = true
    productsError.value = ''
    try {
      const kw = keyword.value.trim()
      const data = kw
        ? await t.server.get(`${base(mid)}/search`, { q: kw })
        : await t.server.get(`${base(mid)}/grouped`, {})
      // grouped 树展开为平铺列表（search 已是平铺）
      let items = extractItems(data)
      if (!kw && data && typeof data === 'object' && 'tree' in (data as Record<string, unknown>)) {
        items = []
        const tree = (data as Record<string, unknown>).tree as Record<string, Record<string, Record<string, unknown>[]>>
        for (const cat of Object.keys(tree || {})) {
          for (const brand of Object.keys(tree[cat] || {})) {
            for (const it of tree[cat][brand] || []) items.push(it)
          }
        }
      }
      items.sort((a, b) =>
        (String(a.category ?? '') + String(a.brand ?? '') + String(a.model ?? ''))
          .localeCompare(String(b.category ?? '') + String(b.brand ?? '') + String(b.model ?? '')))
      // 保留全量条目（含 features/selling_points）供选中时本地直取回填
      productEntries.value = items
      productOptions.value = items
        .filter((it) => it.id !== undefined && it.id !== null && String(it.id) !== '')
        .map((it) => ({ id: String(it.id), label: productComboLabel(it) }))
      if (!productOptions.value.length) {
        productsError.value = kw ? '（无匹配产品）' : '（产品资料为空，请先在「产品资料」页同步）'
      }
    } catch (e) {
      productOptions.value = []
      productsError.value = (e as Error)?.message || String(e)
    } finally {
      productsLoading.value = false
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  function onKeywordInput(v: string): void {
    keyword.value = v
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { void loadProducts() }, SEARCH_DEBOUNCE_MS)
  }

  /* ── 选中产品 → 回填资料（对齐 _on_product_selected，可临时编辑） ── */

  async function selectProduct(id: string): Promise<void> {
    selectedProductId.value = id
    currentProduct.value = {}
    features.value = ''
    sellingPoints.value = ''
    if (!id) return
    // 优先本地缓存直取（原客户端 _on_product_selected → self.kb.get 口径）
    const local = productEntries.value.find((it) => String(it.id) === id)
    if (local) {
      currentProduct.value = local
      features.value = String(local.features ?? '')
      sellingPoints.value = String(local.selling_points ?? '')
      status.value = ''
      return
    }
    // 兑底：服务端单条（原客户端 get_item 口径；响应含 {item} 包裹或直接 dict）
    const t = getTintin()
    if (!t?.server) return
    const mid = await ensureMachineId()
    if (!mid) return
    try {
      const data = await t.server.get(`${base(mid)}/items/${encodeURIComponent(id)}`, {})
      const item = (data && typeof data === 'object' && 'item' in data ? data.item : data) as Record<string, unknown> | null
      if (!item) { status.value = `未找到产品（id=${id}）。`; return }
      currentProduct.value = item
      features.value = String(item.features ?? '')
      sellingPoints.value = String(item.selling_points ?? '')
      status.value = ''
    } catch (e) {
      status.value = `读取产品失败：${(e as Error)?.message || e}`
    }
  }

  /* ── 生成文案（对齐 _generate_copywriting 前置校验 + _run_llm） ── */

  async function generate(): Promise<void> {
    if (generating.value) return
    if (!selectedProductId.value) { status.value = '请先选择一个产品。'; return }
    if (!features.value.trim() && !sellingPoints.value.trim()) {
      status.value = '请先在「产品资料」页为该产品填写性能参数或核心卖点。'
      return
    }
    const t = getTintin()
    if (!t?.server?.llmChat) { status.value = '服务端 LLM 不可用，请检查服务端连接。'; return }
    generating.value = true
    status.value = 'AI 正在创作文案…'
    try {
      const productText = buildProductSection(currentProduct.value, features.value.trim(), sellingPoints.value.trim())
      const { systemPrompt, userPrompt } = buildCopywritingPrompt({
        productText,
        platform: platform.value,
        tone: tone.value,
        structure: structure.value,
        tagCount: tagCountOf(tags.value),
        avoidBanned: avoidBanned.value,
        extraPrompt: extraPrompt.value,
      })
      const res = await t.server.llmChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
      if (res && typeof res === 'object' && 'error' in (res as Record<string, unknown>)) {
        throw new Error(String((res as Record<string, unknown>).error || '生成失败'))
      }
      const text = pickLlmText(res)
      if (!text) throw new Error('模型未返回内容')
      copyText.value = text
      extremeHits.value = []
      status.value = '文案已生成，可前往分镜脚本设计。'
    } catch (e) {
      status.value = `生成失败：${(e as Error)?.message || e}`
    } finally {
      generating.value = false
    }
  }

  /* ── 极限词检测（对齐 _check_extreme_words；文本区高亮由展示层处理） ── */

  function checkExtreme(): void {
    if (!copyText.value.trim()) { status.value = '文案内容为空，无需检测。'; return }
    extremeHits.value = checkExtremeWords(copyText.value)
    status.value = extremeHits.value.length
      ? `检测到 ${extremeHits.value.length} 处平台广告极限词：${summarizeExtremeWords(extremeHits.value)}`
      : '恭喜，未检测到任何平台极限词，文案安全！'
  }

  /* ── 复制 / 前往分镜 ── */

  async function copyToClipboard(): Promise<void> {
    if (!copyText.value.trim()) { status.value = '文案为空。'; return }
    try {
      await navigator.clipboard.writeText(copyText.value)
      status.value = '文案已复制到剪贴板。'
    } catch (_) {
      status.value = '复制失败，请手动选择文本复制。'
    }
  }

  /** 携带文案+产品上下文 → 分镜脚本卡片（原 _go_to_storyboard：文案为空拦截）。
   *  移植差异：分镜脚本创作卡为 P2 批次未移植，本版写入 pendingStoryboard
   *  信号并返回 'pending'，由组件提示；卡片移植后改回导航消费。 */
  function goToStoryboard(): boolean {
    if (!copyText.value.trim()) {
      status.value = '请先生成或填写文案，然后再进行分镜脚本设计。'
      return false
    }
    setPendingStoryboard({
      copyText: copyText.value,
      product: {
        brand: String(currentProduct.value.brand ?? ''),
        model: String(currentProduct.value.model ?? ''),
        category: String(currentProduct.value.category ?? ''),
        name: String(currentProduct.value.spec_name ?? ''),
      },
    })
    return true
  }

  onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer)
  })

  return {
    // 产品
    keyword, productOptions, productsLoading, productsError, loadProducts, onKeywordInput,
    selectedProductId, selectProduct,
    // 资料
    features, sellingPoints, currentProduct,
    // 生成设置
    platform, tone, structure, tags, avoidBanned, extraPrompt,
    // 文案 / 动作
    copyText, generating, status, generate, extremeHits, checkExtreme,
    copyToClipboard, goToStoryboard,
  }
}

export type OpsCopywriting = ReturnType<typeof useOpsCopywriting>
