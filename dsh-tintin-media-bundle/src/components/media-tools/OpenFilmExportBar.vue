<!-- 方案二「导出到视频剪辑项目」共用 UI（2026-10-21 用户裁决）：CopywritingStep4Panel 与
     ImitationFxPackPanel 同款，抽成公共件让两个面板留在行数基线内（铁律 4）。 -->
<template>
  <div>
    <div class="vd4-scheme-line">方案二，导出到视频剪辑项目（可在视频剪辑里继续精剪）</div>
    <TButton label="导出到视频剪辑项目" class="vd4-run" :loading="busy" :disabled="disabled"
      title="把剪辑方案时间线转译为视频剪辑（OpenFilm）项目：视频段/口播/BGM 各轨独立，导出后可在视频剪辑里继续精剪"
      @click="$emit('export')" />
    <div v-if="busy" class="pbar" style="margin-top:8px"><div class="pbar-inner" :style="{ width: '60%' }"></div></div>
    <div v-if="busy && stage" class="muted" style="margin-top:4px;font-size:12px">{{ stage }}</div>
    <div v-if="project" class="export-done-bar">
      <span class="export-done-icon">✓</span>
      <span class="export-done-text">已导出到视频剪辑项目</span>
      <div class="export-done-actions">
        <TButton label="打开视频剪辑" size="small" @click="$emit('open')" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import TButton from '@/components/common/TButton.vue'

defineProps<{ busy: boolean; stage: string; project: string; disabled?: boolean }>()
defineEmits<{ (e: 'export'): void; (e: 'open'): void }>()
</script>
