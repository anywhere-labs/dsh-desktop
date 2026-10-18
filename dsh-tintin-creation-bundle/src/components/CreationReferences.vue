<!-- CreationReferences.vue — 创作模式·上传引用池（2026-10-17，自包含子组件）
     职责（用户裁决 2026-10-17）：①引用池缩略图行（48×64 块：图片/视频经宿主
     /tintin/media 代理真实预览，× 移除，小 ＋ 续传）；②「可能@的内容」菜单
     （＋创建主体 + 上传引用 + 产品库——方案 4 混合双源，选中 emit pick-ref/
     pick-product 由父层内联补全提及并落芯片/引用）。产品搜索状态在父层
     （subjectHits 单一状态，工具栏 @ 菜单共用）；文件对话框
     （window.tintin.dialog.openFiles，多选）在本组件内自持——
     独立域不与宿主视图文件交织；池状态由父层持有（发送组包需要）。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  REFERENCE_DIALOG_FILTERS,
  type CreationReference,
  extOf,
  filterReferences,
  isImageRef,
  isVideoRef,
  mergeReferencePaths,
  referenceUrl,
} from '../composables/creationReferenceLogic'

const props = defineProps<{
  references: CreationReference[]
  menuOpen: boolean
  /** 输入框 @ 后的过滤词（父层从输入文本解析；''=未过滤，null=未触发） */
  query?: string | null
  /** 产品库命中（父层搜索 subjectHits 单一状态分组下发；2026-10-17 方案 4：
   *  @ 菜单=上传引用+产品库混合，选中产品 emit pick-product 由父层落芯片） */
  products?: Array<{ id: string; name: string }>
  productsLoading?: boolean
  productsError?: string
}>()

const emit = defineEmits<{
  add: [paths: string[]]
  remove: [path: string]
  'pick-ref': [name: string]
  'pick-product': [product: { id: string; name: string }]
  'create-subject': [name: string]
}>()

const atCreating = ref(false)
const atName = ref('')

const candidates = computed(() => filterReferences(props.references, props.query ?? ''))

async function pickReferences(): Promise<void> {
  if (!window.tintin?.dialog?.openFiles) return
  const paths = await window.tintin.dialog.openFiles({
    multi: true,
    filters: REFERENCE_DIALOG_FILTERS.map((f) => ({ name: f.name, extensions: [...f.extensions] })),
  })
  if (!paths?.length) return
  emit('add', mergeReferencePaths([], paths).map((r) => r.path))
}
function confirmCreateSubject(): void {
  const name = atName.value.trim()
  if (!name) return
  emit('create-subject', name)
  atName.value = ''
  atCreating.value = false
}
</script>

<template>
  <!-- 引用池缩略图行（即梦同款 48×64 块：预览 + ×移除 + 小 ＋ 续传）；
       池空时仅显示 ＋ 入口块（即梦真身同位） -->
  <div class="refs-row">
    <div v-for="r in references" :key="r.path" class="ref-thumb" :title="r.name">
      <img v-if="isImageRef(r.path)" :src="referenceUrl(r.path)" alt="" loading="lazy">
      <video v-else-if="isVideoRef(r.path)" :src="referenceUrl(r.path)" muted preload="metadata" />
      <span v-else class="ref-ext">{{ extOf(r.name) || '文件' }}</span>
      <button type="button" class="ref-x" :title="`移除 ${r.name}`" @click="emit('remove', r.path)">×</button>
    </div>
    <button type="button" class="ref-add" title="继续上传参考" @click="pickReferences">＋</button>
  </div>

  <!-- 输入 @ 菜单（可能@的内容：＋创建主体 + 上传引用 + 产品库；方案 4 混合双源） -->
  <div v-if="menuOpen" class="menu">
    <div class="menu-title">可能@的内容</div>
    <div class="menu-list">
      <template v-if="!atCreating">
        <button type="button" class="menu-item" @click="atCreating = true; atName = ''">
          <span class="menu-emoji">＋</span>
          <span class="menu-name">创建主体</span>
        </button>
        <div class="menu-group-title">上传参考</div>
        <button v-for="r in candidates" :key="r.path" type="button" class="menu-item" @click="emit('pick-ref', r.name)">
          <img v-if="isImageRef(r.path)" class="menu-thumb" :src="referenceUrl(r.path)" alt="">
          <span v-else class="menu-emoji">🖼️</span>
          <span class="menu-name">@{{ r.name }}</span>
        </button>
        <div v-if="candidates.length === 0" class="menu-empty">还没有上传参考——点左侧「＋」上传后即可 @</div>
        <div class="menu-group-title">产品库</div>
        <button v-for="p in products" :key="p.id" type="button" class="menu-item" @click="emit('pick-product', p)">
          <span class="menu-emoji">📦</span>
          <span class="menu-name">@{{ p.name }}</span>
        </button>
        <div v-if="productsLoading" class="menu-empty">产品搜索中…</div>
        <div v-else-if="productsError" class="menu-empty">{{ productsError }}</div>
      </template>
      <template v-else>
        <div class="at-create">
          <input v-model="atName" class="menu-search" placeholder="输入主体名称…" @keydown.enter.prevent="confirmCreateSubject">
          <button type="button" class="menu-close is-ok" @click="confirmCreateSubject">✓</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.refs-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
/* 菜单浮层：scoped 样式不跨组件，定位需在本组件内自持（锚定 .composer）。
     方向=向下（top；2026-10-16 弹窗向下裁决——朝上会被视口顶裁掉，1017 @
     菜单混合产品库后列表更高，本组件漏同款裁决 1017 用户报障已补） */
.menu { position: absolute; left: 16px; right: 16px; top: calc(100% + 8px); z-index: 30; background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-3); overflow: hidden; }
.menu-list { max-height: 300px; overflow: auto; }
.ref-thumb { position: relative; width: 48px; height: 64px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: var(--surface); }
.ref-thumb img, .ref-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.ref-thumb .ref-ext { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; }
.ref-thumb .ref-x { position: absolute; top: 1px; right: 1px; width: 14px; height: 14px; border: none; border-radius: 999px; background: rgba(0,0,0,0.55); color: #fff; font-size: 10px; line-height: 1; cursor: pointer; padding: 0; }
.ref-add { width: 48px; height: 64px; border-radius: 8px; border: 1px dashed var(--border); background: transparent; color: var(--muted-foreground); font-size: 16px; cursor: pointer; }
.ref-add:hover { border-color: var(--primary); color: var(--primary); }
.menu-title { padding: 10px 14px 4px; font-size: 12px; color: var(--muted-foreground); }
.menu-group-title { padding: 8px 14px 2px; font-size: 11px; font-weight: 600; color: var(--muted-foreground); }
.menu-list { padding: 6px 0; }
.menu-item { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: transparent; color: var(--foreground); font: inherit; font-size: 14px; text-align: left; padding: 9px 14px; cursor: pointer; }
.menu-item:hover { background: var(--surface); }
.menu-emoji { width: 22px; text-align: center; }
.menu-thumb { width: 22px; height: 22px; object-fit: cover; border-radius: 4px; display: block; }
.menu-name { font-weight: 600; }
.menu-empty { padding: 14px; text-align: center; color: var(--muted-foreground); font-size: 13px; }
.at-create { display: flex; align-items: center; gap: 8px; padding: 4px 14px; }
.menu-search { flex: 1 1 auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--foreground); font: inherit; font-size: 13px; padding: 6px 10px; outline: none; }
.at-create .menu-close { border: none; background: transparent; color: var(--primary); font-size: 15px; font-weight: 700; cursor: pointer; }
</style>
