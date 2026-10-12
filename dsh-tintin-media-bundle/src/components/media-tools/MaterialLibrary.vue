<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// MaterialLibrary.vue — 素材库（媒体工具·音频组卡位）
// 2026-09-29 用户裁决：原「音频生成」卡升级为「素材库」，三 tab：
//   · 视频 / 图片：服务端素材库检索浏览，整体形态对齐会话「选择素材」弹窗
//     （WbPickMaterialDialog 图视域：关键字/品牌/型号/分类过滤 + 缩略图卡片
//     网格 + 右侧预览 + 多选跨页保留 + 分页）。选择语义在独立页落地为
//     「下载到本地」（弹窗的「选择该素材」=入会话池，本页无会话可加入；
//     与音频页行内下载、成片任务页「下载所选」同族动作）。
//   · 音频：原「音频生成」界面与功能原样内嵌（AudioGen 组件不动，v-show
//     保持组件状态，切换 tab 不丢列表/筛选）。
// 数据获取复用 useWorkbenchPickers（组件零 URL 拼装，IRON-06）；条目字段
// 容错/分页/下载文件名等纯逻辑下沉 materialLibraryLogic（铁律 8）。
// ═══════════════════════════════════════════════════════════════
import { computed, onMounted, ref, watch } from 'vue'
import AudioGen from './AudioGen.vue'
import {
  fetchMaterialGrid,
  fetchMaterialDistinct,
  type PickerItem,
} from '@/composables/useWorkbenchPickers'
import {
  buildMediaServeUrl,
  buildMediaThumbUrl,
} from '@/composables/workbenchChatContext'
import { mediaTypeLabel } from '@/composables/contextTaskLogic'
import { clientError } from '@/utils/clientLog'
import {
  materialGridKey,
  usageCountOf,
  materialMainText,
  materialSubText,
  materialMetaId,
  materialMetaHash,
  previewKindOf,
  totalPagesOf,
  pagerVisible,
  downloadFileNameOf,
  joinDownloadPath,
} from '@/composables/materialLibraryLogic'

const TAG = 'material-library'

const tab = ref<'video' | 'image' | 'audio'>('video')
/** 视频/图片 tab 对应 media_type（audio tab 不走图视域） */
const mType = computed<'image' | 'video'>(() => (tab.value === 'video' ? 'video' : 'image'))

/* ── 服务端地址（缩略图/预览/下载 URL 拼接；经 env:serverPing 取回） ── */
const serverUrl = ref('')
async function ensureServerUrl(): Promise<string> {
  if (serverUrl.value) return serverUrl.value
  try {
    const ping = await (window as any).tintin?.env?.serverPing?.()
    serverUrl.value = String(ping?.url || '')
  } catch (_) {
    serverUrl.value = '' // 预览环境无 env 桥 → 空串
  }
  return serverUrl.value
}

/** 右下角系统通知（无壳环境静默，同 useAudioGen 口径） */
function notify(title: string, body: string): void {
  try { window.tintin?.shell?.showNotification?.(title, body) } catch (_) { /* 静默 */ }
}

/* ── 图视域：过滤条件（品牌/型号/分类候选来自 /material/distinct，失败静默） ── */
const kw = ref('')
const brand = ref('')
const model = ref('')
const category = ref('')
const brandOpts = ref<string[]>([])
const modelOpts = ref<string[]>([])
const categoryOpts = ref<string[]>([])
/** 图片 tab 出图口径（2026-10-10 用户裁决）：product=服务端产品图模式（purpose=product：
 *  底型白名单 white/solid/transparent+强制 media_type=image+形态闸 0.4~2.6+白底优先），
 *  默认；all=全库图片（不带 purpose，行为不变）。仅图片 tab 生效 */
const imgPurpose = ref<'product' | 'all'>('product')
async function loadDistinctOpts(): Promise<void> {
  const [b, m, c] = await Promise.all([
    fetchMaterialDistinct('brand'),
    fetchMaterialDistinct('model'),
    fetchMaterialDistinct('category'),
  ])
  brandOpts.value = b
  modelOpts.value = m
  categoryOpts.value = c
}

/* ── 列表 + 分页（/material/list page/size；total 缺失(-1) → 单页不分页） ── */
const PAGE_SIZE = 60
const items = ref<PickerItem[]>([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const total = ref(0)
const totalPages = computed(() => totalPagesOf(total.value, PAGE_SIZE))
const hasPager = computed(() => pagerVisible(total.value, PAGE_SIZE))
function prevPage(): void {
  if (page.value > 1 && !loading.value) void run(page.value - 1)
}
function nextPage(): void {
  if (page.value < totalPages.value && !loading.value) void run(page.value + 1)
}

async function run(p = page.value): Promise<void> {
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
      purpose: mType.value === 'image' && imgPurpose.value === 'product' ? 'product' : '',
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
function runFromFirst(): void {
  void run(1)
}

/** 视频/图片 tab 切换 → 按新 media_type 重查第一页（选择集跨 tab 保留） */
watch(tab, (t) => {
  if (t !== 'audio') void run(1)
})

/** 出图口径切换（全部/产品图）→ 回第一页重查 */
watch(imgPurpose, () => {
  if (tab.value === 'image') void runFromFirst()
})

/* ── 多选（卡片右上角勾选 + 底部全选/取消全选；跨页/跨 tab 保留） ── */
const selectedMap = ref(new Map<string, PickerItem>())
const selectedCount = computed(() => selectedMap.value.size)
function toggleSelect(it: PickerItem): void {
  const k = materialGridKey(it)
  if (!k) return
  if (selectedMap.value.has(k)) selectedMap.value.delete(k)
  else selectedMap.value.set(k, it)
}
function isSelected(it: PickerItem): boolean {
  return selectedMap.value.has(materialGridKey(it))
}
function selectPageAll(): void {
  for (const it of items.value) {
    const k = materialGridKey(it)
    if (k) selectedMap.value.set(k, it)
  }
}
function clearSelection(): void {
  selectedMap.value.clear()
}

/* ── 卡片/预览展示字段（容错下沉 materialLibraryLogic） ── */
function keyOf(it: PickerItem): string {
  return materialGridKey(it)
}
function usageOf(it: PickerItem): number {
  return usageCountOf(it)
}
function mainText(it: PickerItem): string {
  return materialMainText(it)
}
function subText(it: PickerItem): string {
  return materialSubText(it)
}
function thumbUrl(it: PickerItem): string {
  const mid = keyOf(it)
  return mid ? buildMediaThumbUrl(serverUrl.value, mid) : ''
}

/** 缩略图加载失败 → 显示文字块（空库/服务端未生成缩略图时兜底） */
const thumbFailed = ref<Record<number, boolean>>({})
function onThumbError(i: number): void {
  thumbFailed.value[i] = true
}

/* ── 预览区（点卡片加载；下载动作见下） ── */
const preview = ref<PickerItem | null>(null)
const previewKind = computed<'video' | 'image'>(() => previewKindOf(preview.value))
const previewUrl = computed(() =>
  preview.value ? buildMediaServeUrl(serverUrl.value, keyOf(preview.value)) : ''
)
function showPreview(it: PickerItem): void {
  preview.value = it
}
/** 点击复制（剪贴板不可用静默，如非安全上下文） */
async function copyMetaText(t: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(t)
  } catch (_) { /* 忽略 */ }
}

/* ── 下载（选择语义在本页的落地；通道复用 dialog:saveFile/openDir +
      server:downloadResult，与 useAudioGen.downloadRow 同口径） ── */
const dlBusy = ref(false)
const dlNote = ref('')

/** 单条下载落盘；返回 '' 成功，否则失败原因（downloadResult 契约：离线 null，
 *  失败 {error}，成功返回落盘路径——对象形态类型声明未覆盖，运行时防御） */
async function downloadOne(it: PickerItem, savePath: string): Promise<string> {
  const url = buildMediaServeUrl(serverUrl.value, keyOf(it))
  if (!url) return '素材 ID 缺失'
  const res = await window.tintin.server.downloadResult(url, savePath)
  if (res === null) return '服务端不可达'
  if (res && typeof res === 'object' && 'error' in (res as Record<string, unknown>)) {
    return String((res as Record<string, unknown>).error || '下载失败')
  }
  return ''
}

/** 下载当前预览素材（saveFile 选保存路径，按类型给扩展名过滤器） */
async function downloadPreview(): Promise<void> {
  const it = preview.value
  if (!it || dlBusy.value) return
  const isImage = previewKind.value === 'image'
  try {
    const savePath = await window.tintin?.dialog?.saveFile?.({
      title: '下载素材',
      defaultPath: downloadFileNameOf(it),
      filters: [isImage
        ? { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
        : { name: '视频文件', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }],
    })
    if (!savePath) return // 用户取消
    dlBusy.value = true
    dlNote.value = ''
    await ensureServerUrl()
    const err = await downloadOne(it, savePath)
    if (err) {
      clientError(TAG, `下载失败 ${mainText(it)}`, new Error(err))
      notify('失败', `下载失败：${mainText(it)}（${err}）`)
      dlNote.value = `下载失败：${err}`
    } else {
      notify('成功', `已下载：${savePath}`)
      dlNote.value = `已下载：${savePath}`
    }
  } catch (e) {
    clientError(TAG, '下载失败', e)
    notify('失败', `下载失败：${(e as Error)?.message || e}`)
    dlNote.value = `下载失败：${(e as Error)?.message || e}`
  } finally {
    dlBusy.value = false
  }
}

/** 批量下载所选（openDir 选目标目录一次，逐条落盘；文件名取条目 filename 容错） */
async function downloadSelected(): Promise<void> {
  if (dlBusy.value || !selectedCount.value) return
  const picked = [...selectedMap.value.values()]
  try {
    const dir = await window.tintin?.dialog?.openDir?.({ title: '选择下载目录' })
    if (!dir) return // 用户取消
    dlBusy.value = true
    dlNote.value = ''
    await ensureServerUrl()
    let ok = 0
    const failed: string[] = []
    for (const it of picked) {
      try {
        const err = await downloadOne(it, joinDownloadPath(dir, downloadFileNameOf(it)))
        if (err) failed.push(`${mainText(it)}（${err}）`)
        else ok += 1
      } catch (e) {
        failed.push(`${mainText(it)}（${(e as Error)?.message || e}）`)
      }
    }
    if (failed.length) {
      clientError(TAG, `批量下载 ${failed.length}/${picked.length} 失败`, new Error(failed.join('; ')))
      notify('部分失败', `已下载 ${ok}/${picked.length}，失败：${failed.slice(0, 3).join('、')}${failed.length > 3 ? ' 等' : ''}`)
      dlNote.value = `已下载 ${ok}/${picked.length}，失败 ${failed.length} 个`
    } else {
      notify('成功', `已下载 ${ok} 个素材到 ${dir}`)
      dlNote.value = `已下载 ${ok}/${picked.length} 到 ${dir}`
    }
  } finally {
    dlBusy.value = false
  }
}

/** 预览区主按钮：有勾选 → 批量下载；仅预览 → 单个下载 */
const actionLabel = computed(() =>
  selectedCount.value ? `下载所选（${selectedCount.value}）` : '下载该素材'
)
const actionDisabled = computed(() => dlBusy.value || (!selectedCount.value && !preview.value))
function runAction(): void {
  if (selectedCount.value) void downloadSelected()
  else void downloadPreview()
}

/* ── 挂载：取服务端地址 → 首页列表 + 候选值（页面级只载一次，非弹窗每次重开语义） ── */
onMounted(() => {
  void ensureServerUrl().then(() => run(1))
  void loadDistinctOpts()
})
</script>

<template>
  <section class="mlib">
    <!-- 三 tab 占满一行平分（形态对齐「选择素材」弹窗的 luo-tab 分段） -->
    <div class="mlib-tabs">
      <button class="luo-tab" :class="{ active: tab === 'video' }" type="button" @click="tab = 'video'">视频</button>
      <button class="luo-tab" :class="{ active: tab === 'image' }" type="button" @click="tab = 'image'">图片</button>
      <button class="luo-tab" :class="{ active: tab === 'audio' }" type="button" @click="tab = 'audio'">音频</button>
    </div>

    <!-- ─── 视频/图片（同域不同 media_type） ─── -->
    <div v-show="tab !== 'audio'" class="mlib-av">
      <div class="mlib-filter">
        <input v-model="kw" class="mlib-input" placeholder="搜索文件名/关键字…" @keydown.enter="runFromFirst()" />
        <!-- 出图口径（仅图片 tab；2026-10-10 用户裁决：默认产品图=服务端 purpose=product 模式） -->
        <select
          v-if="tab === 'image'"
          v-model="imgPurpose"
          class="mlib-input mlib-input--sm"
          title="产品图=服务端产品图模式（白底/纯色/透明底+形态闸过滤+白底优先）；全部=全库图片"
          @change="runFromFirst()"
        >
          <option value="product">产品图</option>
          <option value="all">全部</option>
        </select>
        <input v-model="brand" class="mlib-input mlib-input--sm" list="mlib-brand-opts" placeholder="品牌过滤…" @keydown.enter="runFromFirst()" />
        <input v-model="model" class="mlib-input mlib-input--sm" list="mlib-model-opts" placeholder="型号过滤…" @keydown.enter="runFromFirst()" />
        <input v-model="category" class="mlib-input mlib-input--sm" list="mlib-category-opts" placeholder="分类过滤…" @keydown.enter="runFromFirst()" />
        <datalist id="mlib-brand-opts"><option v-for="o in brandOpts" :key="o" :value="o" /></datalist>
        <datalist id="mlib-model-opts"><option v-for="o in modelOpts" :key="o" :value="o" /></datalist>
        <datalist id="mlib-category-opts"><option v-for="o in categoryOpts" :key="o" :value="o" /></datalist>
        <button class="mlib-btn" :disabled="loading" @click="runFromFirst()">搜索</button>
      </div>

      <div class="mlib-body">
        <div class="mlib-grid-wrap">
          <div v-if="loading" class="mlib-state">加载中…</div>
          <div v-else-if="error" class="mlib-state mlib-state--error">{{ error }}</div>
          <div v-else-if="!items.length" class="mlib-state">未找到匹配的素材，换个条件试试。</div>
          <div v-else class="mlib-grid">
            <button
              v-for="(it, i) in items"
              :key="keyOf(it) || i"
              class="mlib-card"
              :class="{ active: preview === it, checked: isSelected(it) }"
              type="button"
              :title="`${mediaTypeLabel(String(it?.media_type || ''))}·点击预览`"
              @click="showPreview(it)"
            >
              <img
                v-if="thumbUrl(it) && !thumbFailed[i]"
                class="mlib-thumb"
                :src="thumbUrl(it)"
                loading="lazy"
                alt=""
                @error="onThumbError(i)"
              />
              <span v-else class="mlib-thumb mlib-thumb--ph">{{ mediaTypeLabel(String(it?.media_type || '')) }}</span>
              <!-- 右上角勾选（@click.stop 不触发预览；跨页保留选择） -->
              <span
                class="mlib-check"
                :class="{ on: isSelected(it) }"
                role="checkbox"
                :aria-checked="isSelected(it)"
                title="选择（下载用）"
                @click.stop="toggleSelect(it)"
              >
                <svg v-if="isSelected(it)" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span class="mlib-card-main">{{ mainText(it) }}</span>
              <span v-if="subText(it)" class="mlib-card-sub" :title="subText(it)">{{ subText(it) }}</span>
              <!-- 使用次数徽标（原素材=源热度：自身+分割片段聚合；分割片段=自身；缺失/0 不显示） -->
              <span v-if="usageOf(it) > 0" class="mlib-usage" title="该素材被草稿/成片引用的次数">已用 {{ usageOf(it) }}</span>
            </button>
          </div>
        </div>

        <div class="mlib-preview">
          <div class="mlib-preview-box">
            <video v-if="preview && previewKind === 'video' && previewUrl" :src="previewUrl" controls autoplay muted class="mlib-preview-media" />
            <img v-else-if="preview && previewKind === 'image' && previewUrl" :src="previewUrl" class="mlib-preview-media" alt="素材预览" />
            <div v-else class="mlib-state">点击左侧卡片预览（视频/图片）</div>
          </div>
          <div v-if="preview" class="mlib-preview-info">
            <span class="mlib-preview-name">{{ mainText(preview) }}</span>
            <span v-if="subText(preview)" class="mlib-preview-sub">{{ subText(preview) }}</span>
            <!-- 素材 ID / 文件 Hash（点击复制，同「选择素材」弹窗口径） -->
            <span
              v-if="materialMetaId(preview)"
              class="mlib-preview-meta"
              title="素材 ID（点击复制）"
              @click="copyMetaText(materialMetaId(preview))"
            >ID：{{ materialMetaId(preview) }}</span>
            <span
              v-if="materialMetaHash(preview)"
              class="mlib-preview-meta mlib-preview-meta--hash"
              title="文件 Hash（点击复制）"
              @click="copyMetaText(materialMetaHash(preview))"
            >Hash：{{ materialMetaHash(preview) }}</span>
          </div>
          <button class="mlib-btn mlib-btn--full" :disabled="actionDisabled" :title="selectedCount ? '下载勾选的全部素材' : '下载当前预览素材'" @click="runAction()">
            {{ actionLabel }}
          </button>
          <div v-if="dlNote" class="mlib-dl-note" :title="dlNote">{{ dlNote }}</div>
        </div>
      </div>

      <!-- 底部：全选/取消全选 + 已选计数 + 分页器（同「选择素材」弹窗口径） -->
      <div class="mlib-pager">
        <div class="mlib-pager-side">
          <button class="mlib-btn mlib-btn--ghost" :disabled="!items.length" @click="selectPageAll()">全选本页</button>
          <button class="mlib-btn mlib-btn--ghost" :disabled="!selectedCount" @click="clearSelection()">取消全选</button>
          <span class="mlib-pager-info">已选 {{ selectedCount }} 项（跨页保留）</span>
        </div>
        <div v-if="hasPager" class="mlib-pager-side">
          <span class="mlib-pager-info">共 {{ total }} 条 · 第 {{ page }}/{{ totalPages }} 页</span>
          <button class="mlib-btn mlib-btn--ghost" :disabled="page <= 1 || loading" @click="prevPage()">上一页</button>
          <button class="mlib-btn mlib-btn--ghost" :disabled="page >= totalPages || loading" @click="nextPage()">下一页</button>
        </div>
      </div>
    </div>

    <!-- ─── 音频：原「音频生成」界面与功能原样内嵌（v-show 保持组件状态） ─── -->
    <div v-show="tab === 'audio'" class="mlib-au">
      <AudioGen />
    </div>

    <p class="mlib-tip">视频/图片素材来自服务端素材库（下载到本机）；音频页即原音频生成（音频库 + AI 生成 BGM/音效）。素材为空时请先在服务端确认是否已入库。</p>
  </section>
</template>

<style scoped>
/* 图视域样式对照「选择素材」弹窗（WbPickMaterialDialog .mtd-*）压缩为页面形态：
   弹窗 80vw/80vh 固定高，本页随视图区（100vh 预算）自适应；其余卡片/预览/
   勾选/分页样式同源。类名前缀 mlib- 与弹窗 mtd- 区分，两处不共享样式。 */
.mlib {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.mlib-tabs {
  display: flex;
  gap: var(--space-1);
  /* 容器底色对齐工作台顶栏 .tab-bar（surface-container 圆角胶囊），同弹窗口径 */
  background: var(--color-surface-container);
  border-radius: var(--radius-md);
  padding: var(--space-1);
}
.mlib-tabs .luo-tab {
  flex: 1 1 0;
  justify-content: center;
}

.mlib-filter {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}
.mlib-input {
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
.mlib-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring); }
.mlib-input--sm { flex: 0 1 140px; }
.mlib-btn {
  height: 32px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  background: var(--primary);
  color: var(--primary-foreground);
  font-size: var(--font-size-body);
  transition: filter var(--duration-fast);
}
.mlib-btn:hover { filter: brightness(1.1); }
.mlib-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mlib-btn--full { width: 100%; flex: 0 0 auto; }
.mlib-btn--ghost {
  background: var(--surface-container);
  color: var(--foreground);
  border: 1px solid var(--border);
  font-size: 12px;
}
.mlib-btn--ghost:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); filter: none; }

.mlib-av { display: flex; flex-direction: column; gap: var(--space-3); }
/* 页面形态高度预算：视图区 100vh −（返回条+tabs+过滤+分页+tip+留白 ≈ 300px）；
   min-height 保小窗口下网格/预览仍可用（超出部分由容器滚动） */
.mlib-body { display: flex; gap: var(--space-3); height: calc(100vh - 300px); min-height: 420px; }

.mlib-grid-wrap { flex: 1 1 auto; min-width: 0; overflow-y: auto; }
.mlib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2);
}
.mlib-card {
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
.mlib-card:hover { border-color: var(--primary); }
.mlib-card.active { border-color: var(--primary); box-shadow: 0 0 0 2px var(--ring); }
.mlib-card.checked { border-color: var(--primary); background: var(--surface-container-high); }

/* 卡片右上角勾选框（多选；跨页保留） */
.mlib-check {
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
.mlib-check:hover { border-color: var(--primary); }
.mlib-check.on {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}

/* 左上角使用次数徽标（服务端 usage_count/usage_count_total） */
.mlib-usage {
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
.mlib-thumb {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--surface-container-high);
}
.mlib-thumb--ph {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--muted-foreground);
}
.mlib-card-main {
  font-size: 12px;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mlib-card-sub {
  font-size: 11px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlib-preview {
  flex: 0 0 300px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mlib-preview-box {
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
.mlib-preview-media { max-width: 100%; max-height: 100%; }
.mlib-preview-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mlib-preview-name {
  font-size: 12px;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mlib-preview-sub { font-size: 11px; color: var(--muted-foreground); }

/* 预览元信息（ID/Hash）：可点击复制（同弹窗口径） */
.mlib-preview-meta {
  align-self: flex-start;
  padding: 1px 6px;
  font-size: 11px;
  color: var(--muted-foreground);
  background: var(--surface-container);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.mlib-preview-meta:hover { color: var(--primary); border-color: var(--primary); }
.mlib-preview-meta--hash {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 下载结果一行（单条/批量的落盘路径或失败原因；过长省略，title 悬浮全文） */
.mlib-dl-note {
  font-size: 11px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlib-pager {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.mlib-pager-side { display: flex; align-items: center; gap: var(--space-2); }
.mlib-pager-info { font-size: 12px; color: var(--muted-foreground); }

.mlib-state {
  padding: var(--space-6) var(--space-3);
  text-align: center;
  font-size: var(--font-size-body);
  color: var(--muted-foreground);
}
.mlib-state--error { color: var(--destructive, #e5484d); }

/* 音频域：AudioGen 自带布局（左右 6:4），容器只做占位 */
.mlib-au { display: flex; flex-direction: column; }

.mlib-tip { font-size: 12px; color: var(--muted-foreground); }

/* 响应式：窄屏预览列退化为堆叠 */
@media (max-width: 980px) {
  .mlib-body { height: auto; }
  .mlib-preview { flex: 1 1 auto; }
}
</style>
