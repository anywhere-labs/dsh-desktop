<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ContextBar.vue — 会话输入区·业务上下文条（WP-5b，2026-09-25）
// 挂载于 dsh conversation.input.left slot（输入框工具行左段，与发送按钮同排）（Vue-in-slot，client-entry
// React 薄壳负责挂载）。产品/素材/脚本三入口 + 已选胶囊 + task.json 同步态；
// 选中即防抖写入工作区 task.json（useTaskContext），agent 经自带 read 工具
// 消费——dsh 底层零改动（用户裁决）。
// 样式自含：会话页在 .tintin-media-scope 之外，本组件根节点自带该类使
// 随包令牌（tintin-tokens.css）与全局样式（.luo-tab 等）生效；暗色跟随
// 宿主 html.dark / 系统偏好一次性判定（同 App.vue 口径）。
// 弹窗：产品/素材/脚本复用工作台 WbPick* 组件（TDialog 原地渲染，无 teleport，
// 不会逃出本宿主容器）。
// ═══════════════════════════════════════════════════════════════
import { ref } from 'vue'
import { useHostDark } from '@/composables/hostTheme'
import WbPickProductDialog from '@/components/workbench/WbPickProductDialog.vue'
import WbPickMaterialDialog from '@/components/workbench/WbPickMaterialDialog.vue'
import WbPickScriptDialog from '@/components/workbench/WbPickScriptDialog.vue'
import { productLabel, materialLabel, scriptLabel, materialKeyOf } from '@/composables/contextTaskLogic'
import {
  useTaskContextState,
  addCtxProduct,
  addCtxMaterial,
  addCtxScript,
  addCtxAudio,
  removeProduct,
  removeMaterial,
  removeScript,
  removeAudio,
  clearAll,
} from '@/composables/useTaskContext'
import type { PickerItem } from '@/composables/useWorkbenchPickers'

const { product, materials, scripts, audios, syncState, syncError, savedAt } = useTaskContextState()

// 主题跟随宿主（2026-10-18 修正）：原生信号 body[data-ds-dark-theme]——
// 此前只读 html.dark 在原生下恒浅色，与媒体主视图互相打架。
const isDark = useHostDark()

const showProduct = ref(false)
const showMaterial = ref(false)
const showScript = ref(false)

function onPickProduct(it: PickerItem) { addCtxProduct(it) }
function onPickMaterial(it: PickerItem) { addCtxMaterial(it) }
function onPickAudio(it: PickerItem) { addCtxAudio(it) }
function onPickScript(it: PickerItem) { addCtxScript(it) }

function audioLabel(item: Record<string, unknown>): string {
  return String(item?.filename || item?.title || item?.name || `音频${item?.audio_id ?? ''}`)
}
function audioKey(item: Record<string, unknown>): string {
  return String(item?.audio_id ?? item?.id ?? item?.filename ?? '')
}

function syncLabel(): string {
  if (syncState.value === 'saving') return '同步 task.json…'
  if (syncState.value === 'error') return `同步失败：${syncError.value}`
  if (syncState.value === 'saved') return `已同步 task.json ${savedAt.value}`
  return '选中内容将写入工作区 task.json，智能体「开始」时自动读取'
}
</script>

<template>
  <div class="tintin-media-scope tcb" :class="{ dark: isDark }">
    <!-- 弹窗（TDialog 原地渲染于本宿主内） -->
    <WbPickProductDialog :visible="showProduct" @close="showProduct = false" @pick="onPickProduct" />
    <WbPickMaterialDialog :visible="showMaterial" @close="showMaterial = false" @pick="onPickMaterial" @pick-audio="onPickAudio" />
    <WbPickScriptDialog :visible="showScript" @close="showScript = false" @pick="onPickScript" />

    <div class="tcb-bar">
      <button class="tcb-add" type="button" title="选择产品（写入对话上下文）" @click="showProduct = true">+ 产品</button>
      <button class="tcb-add" type="button" title="选择素材（图片/视频/音频，写入对话上下文）" @click="showMaterial = true">+ 素材</button>
      <button class="tcb-add" type="button" title="选择分镜脚本（写入对话上下文）" @click="showScript = true">+ 脚本</button>
      <button v-if="product || materials.length || scripts.length || audios.length" class="tcb-clear" type="button" @click="clearAll">清空</button>

      <!-- 已选胶囊（源 _rebuild_ctx_bar 口径：产品/素材/脚本/音频） -->
      <span v-if="product" class="tcb-pill">
        <span class="tcb-pill-label">产品：{{ productLabel(product) }}</span>
        <button class="tcb-x" type="button" title="移除产品" @click="removeProduct">×</button>
      </span>
      <span v-for="m in materials" :key="'m' + materialKeyOf(m)" class="tcb-pill">
        <span class="tcb-pill-label">{{ materialLabel(m) }}</span>
        <button class="tcb-x" type="button" title="移除素材" @click="removeMaterial(materialKeyOf(m))">×</button>
      </span>
      <span v-for="s in scripts" :key="'s' + String(s?.id ?? '')" class="tcb-pill">
        <span class="tcb-pill-label">{{ scriptLabel(s) }}</span>
        <button class="tcb-x" type="button" title="移除脚本" @click="removeScript(String(s?.id ?? ''))">×</button>
      </span>
      <span v-for="a in audios" :key="'a' + audioKey(a)" class="tcb-pill">
        <span class="tcb-pill-label">参考音频：{{ audioLabel(a) }}</span>
        <button class="tcb-x" type="button" title="移除音频" @click="removeAudio(audioKey(a))">×</button>
      </span>

      <span class="tcb-status" :class="{ 'tcb-status--err': syncState === 'error', 'tcb-status--ok': syncState === 'saved' }">{{ syncLabel() }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 紧凑条：输入框上方一行（accessory 区域），可换行；不占过多纵向空间 */
.tcb-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 2px;
  font-size: 12px;
}
.tcb-add {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--foreground-muted, #666);
  background: var(--surface-container, rgba(127, 127, 127, 0.08));
  border: 1px solid var(--border, rgba(127, 127, 127, 0.25));
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tcb-add:hover {
  color: var(--primary, #4f6ef2);
  border-color: var(--primary, #4f6ef2);
}
.tcb-clear {
  padding: 3px 8px;
  font-size: 12px;
  color: var(--muted-foreground, #888);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
}
.tcb-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--foreground, #333);
  background: var(--surface-container-high, rgba(79, 110, 242, 0.1));
  border: 1px solid var(--border-subtle, rgba(79, 110, 242, 0.25));
  border-radius: 999px;
  max-width: 240px;
}
.tcb-pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tcb-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 12px;
  line-height: 1;
  color: var(--muted-foreground, #888);
  background: none;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}
.tcb-x:hover {
  color: var(--error, #ef4444);
}
.tcb-status {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted-foreground, #999);
}
.tcb-status--ok {
  color: var(--primary, #4f6ef2);
}
.tcb-status--err {
  color: var(--error, #ef4444);
}
</style>
