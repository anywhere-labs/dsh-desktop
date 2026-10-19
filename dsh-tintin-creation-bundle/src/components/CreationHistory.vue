<!-- CreationHistory.vue — 创作模式·会话历史列表（2026-10-18，自包含子组件）
     职责（用户裁决 2026-10-18：结果本地保存）：历史列表行（时间·来源·摘要，
     点击 emit reopen 由父层重开到结果浮层）、展开/收起、清空两击确认（确认
     态自持，确认后 emit clear）。池状态由父层持有（记录/持久化在 App.vue
     send 链，存储实现在 creationHistoryLogic——服务端端点将来只换那一层）。
     独立域不与宿主视图文件交织（同 CreationReferences 先例）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import {
  type CreationHistoryEntry,
  historySnippet,
  historySourceLabel,
  historyTimeLabel,
} from '../composables/creationHistoryLogic'

defineProps<{
  entries: CreationHistoryEntry[]
}>()

const emit = defineEmits<{
  reopen: [entry: CreationHistoryEntry]
  clear: []
}>()

const open = ref(false)
const confirmClear = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | undefined

function onClear(): void {
  if (!confirmClear.value) {
    confirmClear.value = true
    confirmTimer = setTimeout(() => { confirmClear.value = false }, 3000)
    return
  }
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmClear.value = false
  open.value = false
  emit('clear')
}
</script>

<template>
  <div class="history">
    <div class="history-head">
      <span class="history-title">历史（{{ entries.length }}）</span>
      <span class="history-ops">
        <button type="button" class="mini" @click="open = !open">{{ open ? '收起' : '展开' }}</button>
        <button type="button" class="mini" :class="{ 'is-warn': confirmClear }" @click="onClear">{{ confirmClear ? '再点确认清空' : '清空' }}</button>
      </span>
    </div>
    <div v-show="open" class="history-list">
      <button v-for="h in entries" :key="h.id" type="button" class="history-item" :title="h.resultText" @click="emit('reopen', h)">
        <span class="history-meta">{{ historyTimeLabel(h.ts) }} · {{ historySourceLabel(h) }}</span>
        <span class="history-snippet">{{ historySnippet(h) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.history { margin-top: var(--space-3); }
.history-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.history-title { font-size: 12px; color: var(--muted-foreground); }
.history-ops { display: inline-flex; gap: 6px; }
.history-ops .is-warn { color: #d93025; font-weight: 700; }
.history-list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow: auto; }
.history-item { display: flex; flex-direction: column; gap: 2px; align-items: stretch; text-align: left; border: 1px solid var(--border); background: var(--card); border-radius: 10px; padding: 8px 10px; cursor: pointer; font: inherit; color: var(--foreground); }
.history-item:hover { border-color: var(--primary); }
.history-meta { font-size: 11px; color: var(--muted-foreground); }
.history-snippet { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
