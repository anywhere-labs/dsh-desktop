<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// MaterialImagePickerDialog.vue — 选择产品图弹窗（六视图槽位绑定专用，单图）
// 2026-10-10 用户裁决：仿视频第 2 步/换物品的视图上传恢复原「选择产品图」形态——
// 弹窗双 tab=素材库选择（purpose=product 产品图口径）+ 本地上传；库选=既有素材
// 直接选用，本地上传=新图（绑定走 views/{view}/upload，入库归一在服务端）。
// 数据面复用 fetchMaterialGrid（useWorkbenchPickers）/materialGridKey
// （materialLibraryLogic）；缩略图=GET /material/thumbnail?material_id=。
// ═══════════════════════════════════════════════════════════════
import { computed, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import {
  fetchMaterialGrid,
} from '@/composables/useWorkbenchPickers'
import {
  materialGridKey,
} from '@/composables/materialLibraryLogic'
import { buildMediaThumbUrl } from '@/composables/workbenchChatContext'

const props = defineProps<{
  open: boolean
  /** 绑定目标视角中文标签（标题/确认按钮语境） */
  viewLabel?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** 库选=materialId（素材键）；本地上传=file（原始 File，绑定端点入库归一） */
  (e: 'pick', payload: { materialId?: string; file?: File; name: string }): void
}>()

/** 服务端地址（同 MaterialLibrary 口径：env serverPing 单一来源；预览环境为空串） */
const serverUrl = ref('')
async function resolveServerUrl(): Promise<void> {
  if (serverUrl.value) return
  try {
    const ping = await (window as unknown as { tintin?: { env?: { serverPing?: () => Promise<{ url?: unknown }> } } }).tintin?.env?.serverPing?.()
    serverUrl.value = String(ping?.url || '')
  } catch { serverUrl.value = '' }
}

// ── 双 tab（2026-10-06 原裁决沿用：素材库选择 / 本地上传）──
const tab = ref<'library' | 'local'>('library')

type GridItem = Record<string, unknown>
const PAGE_SIZE = 24
const page = ref(1)
const total = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const loading = ref(false)
const error = ref('')
const kw = ref('')
const items = ref<GridItem[]>([])
const thumbFailed = ref<Record<string, boolean>>({})

/** 单选（2026-10-10：一个视图绑一张图；点卡片即选中，再点取消） */
const selectedKey = ref('')

async function run(p = 1): Promise<void> {
  page.value = Math.max(1, p)
  loading.value = true
  error.value = ''
  thumbFailed.value = {}
  try {
    const r = await fetchMaterialGrid({
      search: kw.value,
      mediaType: 'image',
      page: page.value,
      size: PAGE_SIZE,
      purpose: 'product',
    })
    items.value = r.items as GridItem[]
    total.value = r.total
  } catch (e) {
    items.value = []
    total.value = 0
    error.value = (e as Error)?.message || String(e)
  } finally {
    loading.value = false
  }
}

function keyOf(it: GridItem): string {
  return materialGridKey(it) || ''
}
function thumbUrl(it: GridItem): string {
  const k = keyOf(it)
  return k ? buildMediaThumbUrl(serverUrl.value, k) : ''
}
function isSelected(it: GridItem): boolean {
  return !!selectedKey.value && selectedKey.value === keyOf(it)
}
function toggleSelect(it: GridItem): void {
  const k = keyOf(it)
  if (!k) return
  selectedKey.value = selectedKey.value === k ? '' : k
}
function clearSelection(): void {
  selectedKey.value = ''
}
function prevPage(): void { void run(page.value - 1) }
function nextPage(): void { void run(page.value + 1) }

// ── 本地上传 tab（拖入/点选；确认时原始 File 交父级走视图绑定端点——
//    入库归一由绑定端点完成，旧 imitate/upload 仅收视频的死路不复用）──
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
interface LocalItem { file: File; name: string; preview: string }
const localItem = ref<LocalItem | null>(null)
const localBusy = ref(false)
const localError = ref('')
const localDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function addLocalFiles(files: FileList | File[] | null): void {
  if (!files?.length) return
  localError.value = ''
  for (const f of Array.from(files)) {
    const ext = f.name.split('.').pop()?.toLowerCase() || ''
    if (!IMAGE_EXTS.includes(ext)) {
      localError.value = `不支持的图片格式：${f.name}（支持 ${IMAGE_EXTS.join('/')}）`
      continue
    }
    if (localItem.value) URL.revokeObjectURL(localItem.value.preview)
    localItem.value = { file: f, name: f.name, preview: URL.createObjectURL(f) }
    break // 单选：取第一张
  }
}
function onLocalDrop(e: DragEvent): void {
  localDragging.value = false
  addLocalFiles(e.dataTransfer?.files ?? null)
}
function clearLocal(): void {
  if (localItem.value) URL.revokeObjectURL(localItem.value.preview)
  localItem.value = null
  localError.value = ''
}

watch(() => props.open, (open) => {
  if (!open) {
    clearLocal()
    tab.value = 'library'
    return
  }
  selectedKey.value = ''
  void resolveServerUrl().then(() => run(1))
})

function confirmSelection(): void {
  if (localItem.value && tab.value === 'local') {
    const it = localItem.value
    emit('pick', { file: it.file, name: it.name })
    return
  }
  const k = selectedKey.value
  if (!k) return
  emit('pick', { materialId: k, name: k })
}
</script>

<template>
  <teleport to="body"><div class="tintin-media-scope tintin-modal-layer">
    <div v-if="open" class="modal-mask" @click.self="emit('close')">
      <div class="modal">
        <span class="modal-title">选择产品图（绑定到「{{ props.viewLabel || '该视图' }}」，单张）</span>
        <div class="row picker-tabs">
          <button class="picker-tab" :class="{ 'is-on': tab === 'library' }" @click="tab = 'library'">产品库选择</button>
          <button class="picker-tab" :class="{ 'is-on': tab === 'local' }" @click="tab = 'local'">本地上传</button>
        </div>

        <!-- 产品库选择 tab -->
        <template v-if="tab === 'library'">
          <div class="row picker-toolbar">
            <input v-model="kw" class="input grow" placeholder="按关键词搜索产品图" @keyup.enter="run(1)" />
            <TButton label="搜索" @click="run(1)" />
          </div>
          <span v-if="error" class="picker-error">{{ error }}</span>
          <div v-else class="picker-grid">
            <div
              v-for="(it, i) in items"
              :key="keyOf(it) || i"
              class="picker-card"
              :class="{ 'is-selected': isSelected(it) }"
              @click="toggleSelect(it)"
            >
              <div class="picker-thumb-wrap">
                <img
                  v-if="!thumbFailed[keyOf(it)]"
                  :src="thumbUrl(it)"
                  class="picker-thumb"
                  loading="lazy"
                  @error="thumbFailed[keyOf(it)] = true"
                />
                <div v-else class="picker-thumb picker-thumb--fail">缩略图加载失败</div>
              </div>
              <span class="picker-name">{{ String(it?.filename || keyOf(it)) }}</span>
              <span class="picker-check" :class="{ 'is-on': isSelected(it) }"></span>
            </div>
            <div v-if="!items.length && !loading" class="muted">无图片素材</div>
            <div v-if="loading" class="muted">加载中…</div>
          </div>
          <div class="row between">
            <span class="muted">第 {{ page }}/{{ totalPages }} 页</span>
            <div class="row">
              <TButton label="上一页" :disabled="page <= 1 || loading" @click="prevPage" />
              <TButton label="下一页" :disabled="page >= totalPages || loading" @click="nextPage" />
              <TButton label="取消选择" plain @click="clearSelection" />
            </div>
          </div>
        </template>

        <!-- 本地上传 tab（拖入/点选；确认时原始 File 交父级走视图绑定端点） -->
        <template v-else>
          <div
            class="local-dropzone"
            :class="{ 'is-active': localDragging }"
            @click="fileInput?.click()"
            @dragover.prevent="localDragging = true"
            @dragleave.prevent="localDragging = false"
            @drop.prevent="onLocalDrop"
          >
            <span class="local-dropzone__main">拖入图片到此处，或点击选择</span>
            <span class="local-dropzone__hint">支持 PNG / JPG / JPEG / WEBP / GIF / BMP，单张</span>
          </div>
          <input ref="fileInput" type="file" :accept="IMAGE_EXTS.map((e) => '.' + e).join(',')" class="local-input" @change="addLocalFiles(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" />
          <span v-if="localError" class="picker-error">{{ localError }}</span>
          <div v-if="localItem" class="picker-grid picker-grid--single">
            <div class="picker-card is-selected">
              <div class="picker-thumb-wrap">
                <img :src="localItem.preview" class="picker-thumb" :alt="localItem.name" />
              </div>
              <span class="picker-name">{{ localItem.name }}</span>
              <span class="picker-check is-on"></span>
              <button class="local-remove" title="移除" @click="clearLocal()">×</button>
            </div>
          </div>
          <div v-else class="muted">尚未选择本地图片。</div>
        </template>

        <div class="modal-actions">
          <TButton label="取消" plain @click="emit('close')" />
          <TButton
            :label="`使用该图（${props.viewLabel || '绑定视图'}）`"
            :disabled="tab === 'library' ? !selectedKey : !localItem"
            @click="confirmSelection"
          />
        </div>
      </div>
    </div>
  </div></teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed; inset: 0; z-index: 1002; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.7);
}

.modal {
  display: flex; flex-direction: column; gap: 12px; width: 760px; max-width: 90vw; max-height: 80vh;
  padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg);
}

.modal-title { font-size: 15px; font-weight: 600; }

.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }

.row.between { justify-content: space-between; }

.grow { flex: 1 1 auto; }

.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }

.input:focus { border-color: var(--primary); }

.muted { color: var(--muted-foreground); font-size: 12px; }

.picker-error { color: var(--danger, #e74c3c); font-size: 12px; }

.picker-tabs { gap: 8px; }
.picker-tab {
  height: 30px; padding: 0 14px; font-size: 13px; cursor: pointer;
  background: var(--card); color: var(--muted-foreground);
  border: 1px solid var(--border); border-radius: var(--radius-md);
}
.picker-tab.is-on { color: var(--primary); border-color: var(--primary); font-weight: 600; background: color-mix(in srgb, var(--primary) 8%, var(--card)); }

.local-dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  min-height: 120px; padding: 16px; cursor: pointer; text-align: center;
  background: color-mix(in srgb, var(--primary) 6%, var(--card));
  border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border)); border-radius: var(--radius-lg);
  color: var(--muted-foreground);
  transition: border-color var(--duration-fast, 0.15s), background var(--duration-fast, 0.15s);
}
.local-dropzone:hover, .local-dropzone.is-active { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, var(--card)); }
.local-dropzone__main { font-size: 13px; font-weight: 600; color: var(--foreground); }
.local-dropzone__hint { font-size: 12px; }
.local-input { display: none; }
.local-remove {
  position: absolute; top: 4px; left: 6px; width: 18px; height: 18px; padding: 0; line-height: 1;
  font-size: 12px; border: none; border-radius: 50%; cursor: pointer;
  background: rgba(0,0,0,.55); color: #fff;
}

.picker-grid {
  display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px;
  min-height: 0; overflow-y: auto; max-height: 52vh; padding: 2px;
}
.picker-grid--single { grid-template-columns: repeat(1, minmax(0, 1fr)); max-height: none; }
.picker-grid--single .picker-card { max-width: 260px; }

.picker-card {
  position: relative; display: flex; flex-direction: column; gap: 4px; padding: 6px; min-width: 0;
  background: color-mix(in srgb, var(--primary) 4%, var(--card));
  border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer;
  transition: border-color var(--duration-fast, 0.15s), background var(--duration-fast, 0.15s);
}

.picker-card:hover { border-color: var(--primary); }

.picker-card.is-selected {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--card));
}

.picker-thumb-wrap { width: 100%; aspect-ratio: 1 / 1; overflow: hidden; border-radius: var(--radius-sm, 4px); background: var(--border); display: flex; align-items: center; justify-content: center; }
.picker-thumb { width: 100%; height: 100%; object-fit: cover; }
.picker-thumb--fail { font-size: 12px; color: var(--muted-foreground); }

.picker-name {
  min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--foreground);
}

.picker-check {
  position: absolute; top: 10px; right: 10px; width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid var(--border); background: var(--card);
}

.picker-check.is-on { border-color: var(--primary); background: var(--primary); }
</style>
