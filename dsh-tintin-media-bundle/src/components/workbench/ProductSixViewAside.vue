<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ProductSixViewAside.vue — 产品六视图侧栏（选产品弹窗第三列，2026-10-10）
// 数据：GET /api/product-library/items/{id} 详情内嵌 item.six_views
// （2026-10-09 服务端 8f073bbf：{view:{material_id,url,thumbnail,source,…}}，
// url/thumbnail 为相对路径，拼 env serverPing 地址）；纯展示——生成/删除入口
// 在「产品资料」页六视图卡。
// ═══════════════════════════════════════════════════════════════
import { computed, ref, watch } from 'vue'
import {
  productSixViewSlots,
  normalizeProductSixViews,
  productViewLabel,
} from '@/composables/opsProductLibraryLogic'
import { clientError } from '@/utils/clientLog'
import type { PickerItem } from '@/composables/useWorkbenchPickers'

const props = defineProps<{ item: PickerItem | null }>()

const serverUrl = ref('')
void (window as unknown as { tintin?: { env?: { serverPing?: () => Promise<{ url?: unknown }> } } })
  .tintin?.env?.serverPing?.().then((p) => { serverUrl.value = String(p?.url || '') }).catch(() => { serverUrl.value = '' })

const loading = ref(false)
const error = ref('')
const views = ref<ReturnType<typeof normalizeProductSixViews>>([])
const missing = ref<string[]>([])

/** 预览条目变化（点行切换）→ 拉详情刷新六视图 */
watch(() => props.item?.id, (id) => {
  views.value = []
  missing.value = []
  error.value = ''
  if (id) void load(String(id))
}, { immediate: true })

async function load(itemId: string): Promise<void> {
  const t = (window as unknown as { tintin?: { server?: Record<string, (...a: unknown[]) => Promise<unknown>> } }).tintin?.server
  if (!t) { error.value = '宿主桥不可用'; return }
  loading.value = true
  try {
    const data = (await t.get(`/api/product-library/items/${encodeURIComponent(itemId)}`, {})) as Record<string, unknown> | null
    const item = (data?.item ?? null) as Record<string, unknown> | null
    views.value = normalizeProductSixViews(item?.six_views)
    missing.value = Array.isArray(data?.six_views_missing) ? (data as Record<string, unknown>).six_views_missing as string[] : []
  } catch (e) {
    error.value = (e as Error)?.message || String(e)
    clientError('product-six-view-aside', `产品六视图读取失败 ${itemId}`, e)
  } finally {
    loading.value = false
  }
}

const slots = computed(() => productSixViewSlots(views.value))
function imgUrl(u: string): string {
  if (!u) return ''
  return /^https?:\/\//.test(u) ? u : `${serverUrl.value}${u}`
}
</script>

<template>
  <div class="psv">
    <div class="psv-title">六视图<span class="psv-count">{{ views.length }}/6</span></div>
    <div v-if="!item" class="psv-none">点击左侧产品查看六视图</div>
    <div v-else-if="loading" class="psv-none">加载中…</div>
    <div v-else-if="error" class="psv-none psv-err">{{ error }}</div>
    <div v-else-if="!views.length" class="psv-none">暂无六视图<br />（可在「产品资料」页生成）</div>
    <template v-else>
      <div class="psv-grid">
        <template v-for="s in slots" :key="s.view">
          <div v-if="s.entry" class="psv-cell">
            <img :src="imgUrl(s.entry.thumbnail || s.entry.url)" :alt="s.view" class="psv-img" loading="lazy" />
            <span class="psv-label">{{ s.label }}</span>
          </div>
          <div v-else class="psv-cell psv-cell--empty">
            <span class="psv-miss">缺</span>
            <span class="psv-label psv-label--dark">{{ s.label }}</span>
          </div>
        </template>
      </div>
      <div v-if="missing.length" class="psv-hint">缺 {{ missing.length }} 视（{{ missing.map((m) => productViewLabel(m)).join(' / ') }}）</div>
    </template>
  </div>
</template>

<style scoped>
.psv { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; }
.psv-title { font-size: 13px; font-weight: var(--font-weight-semibold); color: var(--foreground); display: flex; align-items: center; gap: 6px; }
.psv-count { font-size: 11px; font-weight: 500; color: var(--muted-foreground); background: var(--surface-container-high); border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; }
.psv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.psv-cell { position: relative; aspect-ratio: 1 / 1; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; background: var(--surface-container-high); }
.psv-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.psv-cell--empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-style: dashed; }
.psv-miss { font-size: 14px; color: var(--muted-foreground); opacity: 0.6; }
.psv-label { position: absolute; left: 0; right: 0; bottom: 0; padding: 1px 5px; font-size: 10px; color: #fff; background: rgba(0, 0, 0, 0.45); }
.psv-label--dark { position: static; background: transparent; color: var(--muted-foreground); }
.psv-none { font-size: 12px; color: var(--muted-foreground); text-align: center; padding: var(--space-4) 0; line-height: 1.6; }
.psv-err { color: var(--destructive, #e5484d); word-break: break-all; }
.psv-hint { font-size: 11px; color: var(--muted-foreground); }
</style>
