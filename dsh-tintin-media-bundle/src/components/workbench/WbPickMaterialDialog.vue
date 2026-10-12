<script setup lang="ts">
// WbPickMaterialDialog.vue — 选择素材弹窗（三 tab：图片 / 视频 / 音频）
// 2026-09-25 自源项目同目录组件一比一移植（WP-5b 上下文条随迁件；唯一差异：mediaTypeLabel 导入随本仓模块归属改自 contextTaskLogic）。
// 2026-08-31 用户需求（参考原版素材检索 vector_search/page.py 口径）；
// 2026-09-01 用户裁决：图片与视频拆独立 tab（tab 即 media_type 过滤，
// 取消原「全部|视频|图片」类型分段）：
//   · 图片/视频 tab：顶部 关键字/品牌/型号 过滤；
//     卡片网格（缩略图 /material/thumbnail，卡片含品牌/型号/分类行）+
//     右侧预览（/material/serve 流式，视频 video / 图片 img；不移植原版反推面板）；
//     点卡片预览，卡片右上角勾选多选（跨页保留），底部 全选本页/取消全选 +
//     分页器（/material/list page/size，2026-09-01 用户需求）。
//   · 音频 tab：关键字 + 分类下拉（GET /audio/categories）过滤；列表行点击
//     → 底部播放条（<audio> 原生控件，GET /audio/library/{audio_id}/file）。
// 选中语义：图视逐项 emit('pick')（容器 addCtxMaterial 入素材池，按
// material_id 去重）；音频 emit('pick-audio')（容器 addCtxAudio：infoOnly
// 信息胶囊不入池）。数据获取在 useWorkbenchPickers（组件零 URL 拼装，IRON-06）。
import { computed, ref, watch } from 'vue'
import TDialog from '@/components/common/TDialog.vue'
import {
  fetchMaterialGrid,
  fetchMaterialDistinct,
  fetchAudioLibrary,
  fetchAudioCategories,
  type PickerItem
} from '@/composables/useWorkbenchPickers'
import {
  buildMediaServeUrl,
  buildMediaThumbUrl,
  buildAudioFileUrl,
} from '@/composables/workbenchChatContext'
// mediaTypeLabel 随 /agent/* 退役清理迁至 contextTaskLogic（WP-5b 复活时归位）
import { mediaTypeLabel } from '@/composables/contextTaskLogic'

const props = defineProps<{
  visible: boolean
  /** 2026-10-10 换物品选择（仿视频第 3 步复用本弹窗）：锁定图片 tab 隐藏视频/音频 */
  imageOnly?: boolean
  /** 透传 /material/list purpose（'product'=产品图口径：白底优先+强 image） */
  purpose?: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  /** 图视条目选中（容器 addCtxMaterial，入会话素材池） */
  (e: 'pick', item: PickerItem): void
  /** 音频条目选中（容器 addCtxAudio，信息胶囊不入池） */
  (e: 'pick-audio', item: PickerItem): void
}>()

const tab = ref<'image' | 'video' | 'audio'>('image')

/* ── 服务端地址（预览/缩略图/播放条 URL 拼接；经 env:serverPing 取回） ── */
const serverUrl = ref('')
async function ensureServerUrl(): Promise<void> {
  if (serverUrl.value) return
  try {
    const ping = await (window as any).tintin?.env?.serverPing?.()
    serverUrl.value = String(ping?.url || '')
  } catch (_) {
    serverUrl.value = ''
  }
}

/* ── 图视域（关键字/品牌/型号/分类过滤 + 卡片网格 + 预览；tab 即 media_type） ── */
const kw = ref('')
const brand = ref('')
const model = ref('')
const category = ref('')
/** 品牌/型号/分类候选（GET /material/distinct，2026-09-01 用户指正：候选来自服务端） */
const brandOpts = ref<string[]>([])
const modelOpts = ref<string[]>([])
const categoryOpts = ref<string[]>([])
async function loadDistinctOpts(): Promise<void> {
  const [b, m, c] = await Promise.all([
    fetchMaterialDistinct('brand'),
    fetchMaterialDistinct('model'),
    fetchMaterialDistinct('category')
  ])
  brandOpts.value = b
  modelOpts.value = m
  categoryOpts.value = c
}
/** 图片/视频 tab 对应 media_type（audio tab 不走图视域） */
const mType = computed<'image' | 'video'>(() => (tab.value === 'video' ? 'video' : 'image'))
const items = ref<PickerItem[]>([])
const loading = ref(false)
const error = ref('')

/* ── 分页（/material/list page/size；total 缺失(-1) → 单页不分页） ── */
const PAGE_SIZE = 60
const page = ref(1)
const total = ref(0)
const totalPages = computed(() => (total.value < 0 ? 1 : Math.max(1, Math.ceil(total.value / PAGE_SIZE))))
const hasPager = computed(() => total.value > PAGE_SIZE)
function prevPage() {
  if (page.value > 1 && !loading.value) void run(page.value - 1)
}
function nextPage() {
  if (page.value < totalPages.value && !loading.value) void run(page.value + 1)
}

/* ── 多选（2026-09-01 用户需求：卡片右上角勾选 + 底部全选/取消全选；跨页保留） ── */
const selectedMap = ref(new Map<string, PickerItem>())
const selectedCount = computed(() => selectedMap.value.size)
function toggleSelect(it: PickerItem) {
  const k = midOf(it)
  if (!k) return
  if (selectedMap.value.has(k)) selectedMap.value.delete(k)
  else selectedMap.value.set(k, it)
}
function isSelected(it: PickerItem): boolean {
  return selectedMap.value.has(midOf(it))
}
function selectPageAll() {
  for (const it of items.value) {
    const k = midOf(it)
    if (k) selectedMap.value.set(k, it)
  }
}
function clearSelection() {
  selectedMap.value.clear()
}

async function run(p = page.value) {
  page.value = Math.max(1, p)
  loading.value = true
  error.value = ''
  thumbFailed.value = {} // 换页/换条件后缩略图失败标记重建（按索引存）
  try {
    const r = await fetchMaterialGrid({
      search: kw.value,
      brand: brand.value,
      model: model.value,
      category: category.value,
      mediaType: mType.value,
      page: page.value,
      size: PAGE_SIZE,
      purpose: props.purpose || '',
    })
    items.value = r.items
    total.value = r.total
  } catch (e) {
    items.value = []
    total.value = 0
    error.value = (e as Error)?.message || String(e)
  } finally {
    loading.value = false
  }
}

/** 过滤条件变化 → 回第一页（搜索按钮/回车共用） */
function runFromFirst() {
  void run(1)
}

/** 图片/视频 tab 切换 → 按新 media_type 重查第一页（选择集跨 tab 保留） */
watch(tab, (t) => {
  if (t !== 'audio') void run(1)
})

function midOf(it: PickerItem): string {
  return String(it?.material_id ?? it?.id ?? '').trim()
}
/** 使用次数显示值：原素材读 usage_count_total（源热度=自身+分割片段聚合），
 *  分割片段回落 usage_count（自身）；均缺失/为 0 → 0（徽标不显示） */
function usageOf(it: PickerItem): number {
  const total = Number(it?.usage_count_total)
  if (Number.isFinite(total) && total > 0) return total
  return Number(it?.usage_count) || 0
}
function mainText(it: PickerItem): string {
  return String(it?.filename || it?.name || midOf(it) || '未命名素材')
}
function subText(it: PickerItem): string {
  // 素材条目无 category 字段（实测），分类语义回退 share_name（如「鼠标键盘」）
  const seg = [
    String(it?.brand || ''),
    String(it?.model || ''),
    String(it?.category || it?.share_name || '')
  ]
    .filter(Boolean)
    .join(' / ')
  return seg
}
function thumbUrl(it: PickerItem): string {
  const mid = midOf(it)
  return mid ? buildMediaThumbUrl(serverUrl.value, mid) : ''
}

/** 缩略图加载失败 → 显示文字块（空库/服务端未生成缩略图时兜底） */
const thumbFailed = ref<Record<number, boolean>>({})
function onThumbError(i: number) {
  thumbFailed.value[i] = true
}

/* 预览区（点卡片加载，不选中；确认按钮才入上下文） */
const preview = ref<PickerItem | null>(null)
const previewKind = computed<'video' | 'image'>(() =>
  String(preview.value?.media_type || '').toLowerCase() === 'image' ? 'image' : 'video'
)
const previewUrl = computed(() =>
  preview.value ? buildMediaServeUrl(serverUrl.value, midOf(preview.value)) : ''
)
function showPreview(it: PickerItem) {
  preview.value = it
}

/** 素材 ID / 文件 Hash（2026-09-01 用户需求：预览信息区展示；
 *  /material/list 条目实测字段 id + file_hash） */
function metaId(it: PickerItem): string {
  return String(it?.id ?? it?.material_id ?? '').trim()
}
function metaHash(it: PickerItem): string {
  return String(it?.file_hash ?? '').trim()
}
/** 点击复制（剪贴板不可用静默，如非安全上下文） */
async function copyMetaText(t: string) {
  try {
    await navigator.clipboard.writeText(t)
  } catch (_) { /* 忽略 */ }
}
function confirmPick() {
  const picked = [...selectedMap.value.values()]
  if (!picked.length) {
    if (!preview.value) return // 无勾选且无预览 → 按钮本身已禁用，此处兑底
    emit('pick', preview.value) // 兼容旧单选口径：未勾选时按当前预览选中
  } else {
    for (const it of picked) emit('pick', it) // 逐项入池，容器 addCtxMaterial 按 material_id 去重
  }
  emit('close')
}

/* ── 音频域（关键字 + 分类过滤 + 列表 + 底部播放条） ── */
const aKw = ref('')
const aCat = ref('')
const cats = ref<string[]>([])
const aItems = ref<PickerItem[]>([])
const aLoading = ref(false)
const aError = ref('')

async function runAudio() {
  aLoading.value = true
  aError.value = ''
  try {
    aItems.value = await fetchAudioLibrary({ keyword: aKw.value, category: aCat.value })
  } catch (e) {
    aItems.value = []
    aError.value = (e as Error)?.message || String(e)
  } finally {
    aLoading.value = false
  }
}

function audioName(it: PickerItem): string {
  return String(it?.filename || it?.title || it?.name || `音频${it?.audio_id ?? ''}`)
}
function audioSub(it: PickerItem): string {
  const seg = [String(it?.category || ''), String(it?.genre || '')].filter(Boolean).join(' / ')
  const dur = Number(it?.duration || it?.duration_sec || 0)
  return dur > 0 ? `${seg}${seg ? ' · ' : ''}${Math.round(dur)}秒` : seg
}

/** 底部播放条当前音频（点列表行切换；<audio> 原生控件播放/进度） */
const currentAudio = ref<PickerItem | null>(null)
const audioUrl = computed(() =>
  currentAudio.value ? buildAudioFileUrl(serverUrl.value, String(currentAudio.value.audio_id ?? currentAudio.value.id ?? '')) : ''
)
function playAudio(it: PickerItem) {
  currentAudio.value = it
}
function confirmAudio() {
  if (!currentAudio.value) return
  emit('pick-audio', currentAudio.value)
  emit('close')
}

/* ── 打开即预载两域（弹窗每次打开重新加载，原弹窗口径） ── */
watch(
  () => props.visible,
  async (v) => {
    if (!v) {
      preview.value = null
      currentAudio.value = null
      thumbFailed.value = {}
      return
    }
    preview.value = null
    currentAudio.value = null
    thumbFailed.value = {}
    selectedMap.value.clear() // 弹窗每次打开重建选择集与分页（原弹窗重新加载口径）
    page.value = 1
    total.value = 0
    void ensureServerUrl()
    void run()
    void loadDistinctOpts() // 品牌/型号/分类候选（服务端 distinct，失败静默不阻塞）
    void runAudio()
    if (!cats.value.length) cats.value = await fetchAudioCategories()
  },
  { immediate: true }
)
</script>

<template>
  <!-- 2026-08-31 用户裁决：弹窗 80% 主界面，vw/vh 随窗口缩放 -->
  <TDialog :visible="visible" title="选择素材" width="80vw" :show-footer="false" @close="emit('close')">
    <div class="mtd">
      <!-- 2026-09-04 用户裁决：三 tab 改用全局 luo-tab 分段切换样式（同工作台顶栏） -->
      <div class="mtd-tabs">
        <button class="luo-tab" :class="{ active: tab === 'image' }" type="button" @click="tab = 'image'">图片</button>
        <button v-if="!props.imageOnly" class="luo-tab" :class="{ active: tab === 'video' }" type="button" @click="tab = 'video'">视频</button>
        <button v-if="!props.imageOnly" class="luo-tab" :class="{ active: tab === 'audio' }" type="button" @click="tab = 'audio'">音频</button>
      </div>

      <!-- ─── Tab1/Tab2 图片/视频（同域不同 media_type） ─── -->
      <div v-show="tab !== 'audio'" class="mtd-av">
        <div class="mtd-filter">
          <input v-model="kw" class="mtd-input" placeholder="搜索文件名/关键字…" @keydown.enter="runFromFirst()" />
          <input v-model="brand" class="mtd-input mtd-input--sm" list="mtd-brand-opts" placeholder="品牌过滤…" @keydown.enter="runFromFirst()" />
          <input v-model="model" class="mtd-input mtd-input--sm" list="mtd-model-opts" placeholder="型号过滤…" @keydown.enter="runFromFirst()" />
          <input v-model="category" class="mtd-input mtd-input--sm" list="mtd-category-opts" placeholder="分类过滤…" @keydown.enter="runFromFirst()" />
          <datalist id="mtd-brand-opts"><option v-for="o in brandOpts" :key="o" :value="o" /></datalist>
          <datalist id="mtd-model-opts"><option v-for="o in modelOpts" :key="o" :value="o" /></datalist>
          <datalist id="mtd-category-opts"><option v-for="o in categoryOpts" :key="o" :value="o" /></datalist>
          <button class="mtd-btn" :disabled="loading" @click="runFromFirst()">搜索</button>
        </div>

        <div class="mtd-av-body">
          <div class="mtd-grid-wrap">
            <div v-if="loading" class="mtd-state">加载中…</div>
            <div v-else-if="error" class="mtd-state mtd-state--error">{{ error }}</div>
            <div v-else-if="!items.length" class="mtd-state">未找到匹配的素材，换个条件试试。</div>
            <div v-else class="mtd-grid">
              <button
                v-for="(it, i) in items"
                :key="midOf(it) || i"
                class="mtd-card"
                :class="{ active: preview === it, checked: isSelected(it) }"
                type="button"
                :title="`${mediaTypeLabel(String(it?.media_type || ''))}·点击预览`"
                @click="showPreview(it)"
              >
                <img
                  v-if="thumbUrl(it) && !thumbFailed[i]"
                  class="mtd-thumb"
                  :src="thumbUrl(it)"
                  loading="lazy"
                  alt=""
                  @error="onThumbError(i)"
                />
                <span v-else class="mtd-thumb mtd-thumb--ph">{{ mediaTypeLabel(String(it?.media_type || '')) }}</span>
                <!-- 右上角勾选（@click.stop 不触发预览；跨页保留选择） -->
                <span
                  class="mtd-check"
                  :class="{ on: isSelected(it) }"
                  role="checkbox"
                  :aria-checked="isSelected(it)"
                  title="选择"
                  @click.stop="toggleSelect(it)"
                >
                  <svg v-if="isSelected(it)" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span class="mtd-card-main">{{ mainText(it) }}</span>
                <span v-if="subText(it)" class="mtd-card-sub" :title="subText(it)">{{ subText(it) }}</span>
                <!-- 使用次数徽标（2026-09-27 服务端 usage_count/usage_count_total 字段；
                     原素材=源热度（自身+分割片段聚合），分割片段=自身；缺失/0 不显示） -->
                <span v-if="usageOf(it) > 0" class="mtd-usage" title="该素材被草稿/成片引用的次数">已用 {{ usageOf(it) }}</span>
              </button>
            </div>
          </div>

          <div class="mtd-preview">
            <div class="mtd-preview-box">
              <video v-if="preview && previewKind === 'video' && previewUrl" :src="previewUrl" controls autoplay muted class="mtd-preview-media" />
              <img v-else-if="preview && previewKind === 'image' && previewUrl" :src="previewUrl" class="mtd-preview-media" alt="素材预览" />
              <div v-else class="mtd-state">点击左侧卡片预览（视频/图片）</div>
            </div>
            <div v-if="preview" class="mtd-preview-info">
              <span class="mtd-preview-name">{{ mainText(preview) }}</span>
              <span v-if="subText(preview)" class="mtd-preview-sub">{{ subText(preview) }}</span>
              <!-- 素材 ID / 文件 Hash（点击复制，2026-09-01 用户需求） -->
              <span
                v-if="metaId(preview)"
                class="mtd-preview-meta"
                title="素材 ID（点击复制）"
                @click="copyMetaText(metaId(preview))"
              >ID：{{ metaId(preview) }}</span>
              <span
                v-if="metaHash(preview)"
                class="mtd-preview-meta mtd-preview-meta--hash"
                title="文件 Hash（点击复制）"
                @click="copyMetaText(metaHash(preview))"
              >Hash：{{ metaHash(preview) }}</span>
            </div>
            <button class="mtd-btn mtd-btn--full" :disabled="!selectedCount && !preview" @click="confirmPick()">
              {{ selectedCount ? `添加所选素材（${selectedCount}）` : '选择该素材' }}
            </button>
          </div>
        </div>

        <!-- 底部：全选/取消全选 + 已选计数 + 分页器（2026-09-01 用户需求） -->
        <div class="mtd-pager">
          <div class="mtd-pager-side">
            <button class="mtd-btn mtd-btn--ghost" :disabled="!items.length" @click="selectPageAll()">全选本页</button>
            <button class="mtd-btn mtd-btn--ghost" :disabled="!selectedCount" @click="clearSelection()">取消全选</button>
            <span class="mtd-pager-info">已选 {{ selectedCount }} 项（跨页保留）</span>
          </div>
          <div v-if="hasPager" class="mtd-pager-side">
            <span class="mtd-pager-info">共 {{ total }} 条 · 第 {{ page }}/{{ totalPages }} 页</span>
            <button class="mtd-btn mtd-btn--ghost" :disabled="page <= 1 || loading" @click="prevPage()">上一页</button>
            <button class="mtd-btn mtd-btn--ghost" :disabled="page >= totalPages || loading" @click="nextPage()">下一页</button>
          </div>
        </div>
      </div>

      <!-- ─── Tab3 音频 ─── -->
      <div v-show="tab === 'audio'" class="mtd-au">
        <div class="mtd-filter">
          <input v-model="aKw" class="mtd-input" placeholder="搜索音频名称/关键字…" @keydown.enter="runAudio()" />
          <select v-model="aCat" class="mtd-input mtd-input--sm" @change="runAudio()">
            <option value="">全部分类</option>
            <option v-for="c in cats" :key="c" :value="c">{{ c }}</option>
          </select>
          <button class="mtd-btn" :disabled="aLoading" @click="runAudio()">搜索</button>
        </div>

        <div class="mtd-au-list">
          <div v-if="aLoading" class="mtd-state">加载中…</div>
          <div v-else-if="aError" class="mtd-state mtd-state--error">{{ aError }}</div>
          <div v-else-if="!aItems.length" class="mtd-state">未找到匹配的音频，换个条件试试。</div>
          <button
            v-for="(it, i) in aItems"
            v-else
            :key="String(it?.audio_id ?? it?.id ?? i)"
            class="mtd-au-row"
            :class="{ active: currentAudio === it }"
            type="button"
            :title="audioName(it)"
            @click="playAudio(it)"
          >
            <span class="mtd-au-main">{{ audioName(it) }}</span>
            <span v-if="audioSub(it)" class="mtd-au-sub">{{ audioSub(it) }}</span>
          </button>
        </div>

        <!-- 底部播放条（<audio> 原生控件：播放/暂停/进度/音量） -->
        <div class="mtd-player">
          <span class="mtd-player-name">{{ currentAudio ? audioName(currentAudio) : '点击列表中的音频试听' }}</span>
          <audio v-if="currentAudio && audioUrl" :src="audioUrl" controls class="mtd-player-audio" />
          <button class="mtd-btn mtd-btn--right" :disabled="!currentAudio" @click="confirmAudio()">选择该音频</button>
        </div>
      </div>

      <p class="mtd-tip">图视素材来自服务端素材库，音频来自音频库；为空时可先在「素材检索」页确认是否已入库。</p>
    </div>
  </TDialog>
</template>

<style scoped>
.mtd {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: calc(80vh - 140px);
}

.mtd-tabs {
  display: flex;
  /* 2026-09-04 用户裁决：三 tab 占满一行并平分（图片/视频/音频各 1/3，文字居中） */
  gap: var(--space-1);
  /* 容器底色对齐工作台顶栏 .tab-bar（surface-container 圆角胶囊） */
  background: var(--color-surface-container);
  border-radius: var(--radius-md);
  padding: var(--space-1);
}
.mtd-tabs .luo-tab {
  flex: 1 1 0;
  justify-content: center;
}
/* tab 按钮复用全局 .luo-tab 分段切换样式（styles/global.css L428：
   无底色胶囊 + hover 浅底 + active 主色容器/加粗，同工作台顶栏） */

.mtd-filter {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}
.mtd-input {
  flex: 1 1 160px;
  height: 32px;
  padding: 0 var(--space-3);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--foreground);
  font-size: var(--font-size-body);
  outline: none;
}
.mtd-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
.mtd-input--sm { flex: 0 1 140px; }
.mtd-btn {
  height: 32px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  background: var(--primary);
  color: var(--primary-foreground);
  font-size: var(--font-size-body);
  transition: filter var(--duration-fast);
}
.mtd-btn:hover { filter: brightness(1.1); }
.mtd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mtd-btn--full { width: 100%; }
.mtd-btn--ghost {
  background: var(--surface-container);
  color: var(--foreground);
  border: 1px solid var(--border);
  font-size: 12px;
}
.mtd-btn--ghost:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); filter: none; }

.mtd-av { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.mtd-av-body { flex: 1 1 auto; min-height: 0; display: flex; gap: var(--space-3); }

/* 底部分页条：全选/取消全选 + 已选计数 + 上一页/下一页（2026-09-01） */
.mtd-pager {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.mtd-pager-side { display: flex; align-items: center; gap: var(--space-2); }
.mtd-pager-info { font-size: 12px; color: var(--muted-foreground); }
.mtd-grid-wrap { flex: 1 1 auto; min-width: 0; overflow-y: auto; }
.mtd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2);
}
.mtd-card {
  position: relative; /* 右上角勾选锚点 */
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
  text-align: left;
  transition: all var(--duration-fast);
}
.mtd-card:hover { border-color: var(--primary); }
.mtd-card.active { border-color: var(--primary); box-shadow: 0 0 0 2px var(--ring); }
.mtd-card.checked { border-color: var(--primary); background: var(--surface-container-high); }

/* 卡片右上角勾选框（多选；2026-09-01） */
.mtd-check {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.92);
  color: transparent;
  transition: all var(--duration-fast);
}
.mtd-check:hover { border-color: var(--primary); }
.mtd-check.on {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}

/* 左上角使用次数徽标（2026-09-27 服务端 usage_count/usage_count_total） */
.mtd-usage {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  padding: 1px 6px;
  font-size: 10px;
  line-height: 1.5;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  pointer-events: none;
}
.mtd-check:hover { border-color: var(--primary); }
.mtd-check.on {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.mtd-thumb {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--surface-container-high);
}
.mtd-thumb--ph {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--muted-foreground);
}
.mtd-card-main {
  font-size: 12px;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mtd-card-sub {
  font-size: 11px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mtd-preview {
  flex: 0 0 300px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mtd-preview-box {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
  overflow: hidden;
}
.mtd-preview-media { max-width: 100%; max-height: 100%; }
.mtd-preview-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mtd-preview-name {
  font-size: 12px;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mtd-preview-sub { font-size: 11px; color: var(--muted-foreground); }

/* 预览元信息（ID/Hash）：可点击复制（2026-09-01） */
.mtd-preview-meta {
  align-self: flex-start;
  padding: 1px 6px;
  font-size: 11px;
  color: var(--muted-foreground);
  background: var(--surface-container);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.mtd-preview-meta:hover { color: var(--primary); border-color: var(--primary); }
.mtd-preview-meta--hash {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mtd-au { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.mtd-au-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mtd-au-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
  text-align: left;
  transition: all var(--duration-fast);
}
.mtd-au-row:hover { border-color: var(--primary); }
.mtd-au-row.active { border-color: var(--primary); box-shadow: 0 0 0 2px var(--ring); }
.mtd-au-main {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mtd-au-sub { flex: 0 0 auto; font-size: 11px; color: var(--muted-foreground); }

/* 播放条内确认按钮推到最右（2026-09-04 用户裁决：默认进入即右对齐） */
.mtd-player .mtd-btn--right { margin-left: auto; }

.mtd-player {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
}
.mtd-player-name {
  flex: 0 1 220px;
  min-width: 0;
  font-size: 12px;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mtd-player-audio { flex: 1 1 auto; height: 32px; }

.mtd-state {
  padding: var(--space-6) var(--space-3);
  text-align: center;
  font-size: var(--font-size-body);
  color: var(--muted-foreground);
}
.mtd-state--error { color: var(--destructive, #e5484d); }

.mtd-tip { font-size: 12px; color: var(--muted-foreground); }
</style>
