<script setup lang="ts">
// WbPickerPanel.vue — 工作台选择器·无弹窗主体（搜索 + 列表 + 预览三态 + tip）
// 从 WbPickerDialog 折出（2026-09-08 用户裁决：口播弹窗内嵌产品选择区，不再二次
// 弹窗），弹窗壳（WbPickerDialog）与内嵌容器（VideoMontage 口播弹窗）共用本面板。
// 搜索编排（fetcher 调用 / 离线与 5xx 文案）在 usePickerSearch
// （composables/useWorkbenchPickers），本组件只绘制三态（加载中/失败/空结果）
// 与结果列表。每次激活（active=true）重置并按空关键字预载列表（原版弹窗每次
// exec 重新加载口径）。预览模式（previewable）：点行切换右侧预览区
// （slot #preview）；clickToPick 同时点行即选（2026-09-09 用户裁决：口播弹窗
// 不需要「选择该产品」按钮，点左侧行直接选中并填充，预览仅同步跟随）。
import { ref, watch } from 'vue'
import { usePickerSearch, type PickerItem } from '@/composables/useWorkbenchPickers'

const props = defineProps<{
  /** 激活即预载（弹窗 visible 或内嵌容器展示时置 true） */
  active: boolean
  placeholder: string
  /** 底部数据来源提示（原版 tip 文案口径） */
  tip: string
  /** 搜索函数（调用方各自注入，组件不感知 URL） */
  fetcher: (kw: string) => Promise<PickerItem[]>
  /** 空结果提示 */
  emptyText: string
  /** 预览模式：点行不 pick，只切换右侧预览区（默认 false 保持点行即选） */
  previewable?: boolean
  /** 预览模式下点行即选（预览+选中同步；点行触发 pick，无确认按钮） */
  clickToPick?: boolean
  /** 激活时恢复上次搜索关键字（2026-09-19 用户裁决：口播弹窗记住上次输入） */
  initialKw?: string
  /** 激活时恢复上次选中/预览的条目（预览区与选中态同步恢复） */
  initialItem?: PickerItem | null
  /** 三栏模式（1:1:0.5，2026-10-10 仿视频选产品六视图）：预览列右侧再加半宽
   *  第三列，内容由 #aside 作用域槽提供（:item=当前预览条目） */
  asideable?: boolean
}>()

const emit = defineEmits<{
  (e: 'pick', item: PickerItem): void
  (e: 'preview', item: PickerItem): void
  (e: 'kw', kw: string): void
}>()

const { kw, items, loading, error, searched, run, reset } = usePickerSearch(props.fetcher)

/** 预览模式当前选中条目（点行切换；搜索/重开后失效清空） */
const sel = ref<PickerItem | null>(null)
const restoredSel = ref<PickerItem | null>(null)

// 激活即预载（immediate 兼容父层 v-if 挂载即 active=true 的用法）
watch(
  () => props.active,
  (v) => {
    if (v) {
      reset()
      if (props.initialKw) kw.value = props.initialKw
      restoredSel.value = props.initialItem ?? null
      sel.value = restoredSel.value
      void run()
    }
  },
  { immediate: true }
)

// 搜索后列表变化，预览条目可能已不在结果内（避免预览残留）
watch(items, () => { if (sel.value && sel.value !== restoredSel.value) sel.value = null })
// 关键字变化上报（父层持久化，重开弹窗恢复）
watch(kw, (v) => { emit('kw', v) })

/** 选中条目：上报（弹窗壳在 pick 后自行关闭；内嵌容器由父层决定行为） */
function onPick(item: PickerItem) {
  emit('pick', item)
}

/** 行点击：预览模式仅切换预览（clickToPick 时同时上报选中）；普通模式即选 */
function onRowClick(item: PickerItem) {
  if (props.previewable) {
    sel.value = item
    emit('preview', item)
    if (props.clickToPick) onPick(item)
  } else {
    onPick(item)
  }
}
</script>

<template>
  <div class="picker">
    <div class="picker-search">
      <input
        v-model="kw"
        class="picker-input"
        :placeholder="placeholder"
        @keydown.enter="run()"
      />
      <button class="picker-btn" :disabled="loading" @click="run()">搜索</button>
    </div>

    <div class="picker-main" :class="{ 'picker-main--third': asideable }">
      <div class="picker-list">
        <div v-if="loading" class="picker-state">加载中…</div>
        <div v-else-if="error" class="picker-state picker-state--error">{{ error }}</div>
        <div v-else-if="!items.length" class="picker-state">
          {{ searched ? emptyText : '输入关键词后回车或点「搜索」' }}
        </div>
        <button
          v-for="(it, i) in items"
          v-else
          :key="String(it.id ?? it.material_id ?? i)"
          class="picker-row"
          :class="{ active: sel === it }"
          :title="previewable ? '查看该条目详情' : '选择该条目'"
          @click="onRowClick(it)"
        >
          <slot name="item" :item="it" />
        </button>
      </div>

      <!-- 预览模式右侧列：纵向堆叠 预览框 + 确认按钮（2026-09-04 用户裁决：
           预览框高度减少一行，按钮在框下方；修复原 footer 与预览框并排拉成竖条） -->
      <div v-if="previewable" class="picker-side">
        <div class="picker-preview custom-scroll">
          <slot name="preview" :item="sel" />
        </div>
        <div v-if="sel && $slots['preview-footer']" class="picker-preview-footer">
          <slot name="preview-footer" :item="sel" :confirm="onPick" />
        </div>
      </div>

      <!-- 三栏模式第三列（asideable）：内容 #aside 槽自取（随预览条目联动） -->
      <div v-if="asideable" class="picker-aside custom-scroll">
        <slot name="aside" :item="sel" />
      </div>
    </div>

    <p class="picker-tip">{{ tip }}</p>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* 高度由父容器决定（弹窗壳定高 / 内嵌容器弹性拉伸），面板本身撑满 */
  height: 100%;
  min-height: 0;
}

.picker-search {
  display: flex;
  gap: var(--space-2);
}

.picker-input {
  flex: 1 1 auto;
  height: 34px;
  padding: 0 var(--space-3);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--foreground);
  font-size: var(--font-size-body);
  outline: none;
  transition: all var(--duration-fast);
}

.picker-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--ring);
}

.picker-btn {
  height: 34px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  background: var(--primary);
  color: var(--primary-foreground);
  font-size: var(--font-size-body);
  transition: filter var(--duration-fast);
}

.picker-btn:hover {
  filter: brightness(1.1);
}

.picker-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.picker-main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  gap: var(--space-3);
}

.picker-list {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 预览模式右侧列：纵向 预览框 + footer（宽度沿用原预览区占比） */
.picker-side {
  flex: 0 0 46%;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 三栏模式（1:1:0.5，2026-10-10 仿视频选产品）：左列表/中预览等宽，
   第三列半宽；覆盖单侧模式的固定 46% 占比 */
.picker-main--third .picker-list { flex: 1 1 0; }
.picker-main--third .picker-side { flex: 1 1 0; }

.picker-aside {
  flex: 0.5 1 0;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
  padding: var(--space-3);
}

/* 预览模式：预览框弹性填满侧列（扣除 footer 一行按钮高度），独立滚动 */
.picker-preview {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
  padding: var(--space-3);
}

/* 预览模式当前条目高亮（点行仅预览，需看见选中的是哪条） */
.picker-row.active {
  border-color: var(--primary);
  background: var(--surface-container-high);
}

.custom-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.custom-scroll::-webkit-scrollbar-thumb { background: var(--surface-container-high); border-radius: 3px; }

/* 预览模式底部操作栏（预览框下方一行；按钮宽度与预览框对齐，
   2026-09-04 用户裁决，同素材弹窗 mtd-btn--full 口径） */
.picker-preview-footer {
  flex: 0 0 auto;
  display: flex;
  padding-top: var(--space-2);
}
.picker-preview-footer :deep(button) {
  flex: 1 1 auto;
  width: 100%;
}

.picker-state {
  padding: var(--space-5) var(--space-3);
  text-align: center;
  font-size: var(--font-size-body);
  color: var(--muted-foreground);
}

.picker-state--error {
  color: var(--destructive, #e5484d);
}

.picker-row {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-container);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: all var(--duration-fast);
}

.picker-row:hover {
  border-color: var(--primary);
  background: var(--surface-container-high);
}

.picker-tip {
  font-size: 12px;
  color: var(--muted-foreground);
}
</style>
