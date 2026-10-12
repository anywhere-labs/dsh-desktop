<script setup lang="ts">
// WbPickProductDialog.vue — 选择产品弹窗（工作台输入区上下文）
// 原版 _ProductPickerDialog（L810-875）+ _pick_product L1778-1784：
// 单选，重复选择直接覆盖当前产品胶囊。
// 2026-09-08 折壳重构：内容抽至 WbPickProductPanel（无弹窗版本，供
// VideoMontage 口播弹窗内嵌复用），本组件只提供 TDialog 壳，对外
// props/emits 与原实现完全一致（Workbench.vue 调用方零改动）。
import TDialog from '@/components/common/TDialog.vue'
import WbPickProductPanel from './WbPickProductPanel.vue'
import type { PickerItem } from '@/composables/useWorkbenchPickers'

defineProps<{ visible: boolean; /** 三栏模式：右列显示选中产品六视图（2026-10-10 仿视频） */ sixViews?: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick', item: PickerItem): void
}>()

/** 选中条目：上报后关闭（单选语义，原版 dlg.exec()==Accepted） */
function onPick(item: PickerItem) {
  emit('pick', item)
  emit('close')
}
</script>

<template>
  <!-- 2026-08-31 用户裁决：弹窗放大到主界面 80%，vw/vh 随窗口缩放 -->
  <TDialog :visible="visible" title="选择产品" width="80vw" :show-footer="false" @close="emit('close')">
    <div class="picker-host">
      <WbPickProductPanel :active="visible" :show-six-views="sixViews" @pick="onPick" />
    </div>
  </TDialog>
</template>

<style scoped>
/* 弹窗高度 ≈ 主界面 80vh（扣除 TDialog 头部/内边距）；面板弹性填满 */
.picker-host {
  height: calc(80vh - 120px);
}
</style>
