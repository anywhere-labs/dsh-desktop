<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// ImitationReviewStep.vue — 仿视频第 3 步「分镜头确认」（2026-10-06 用户裁决：
// 分镜脚本审阅独立成步；九宫格/首尾帧/分镜视频/A-roll 全部在第 4 步 视频生成）。
// 只读过目拆解稿（镜别/画面/旁白/运镜），生成动作全部在第 4 步。
// ═════════════════════════════════════════════════════════════
import TButton from '@/components/common/TButton.vue'
import type { ImitationShot } from '@/composables/imitationVideoLogic'

const props = defineProps<{
  shots: ImitationShot[]
  totalDuration: number
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'next'): void
}>()
</script>

<template>
  <div class="iv-panel">
    <div class="row between">
      <span class="sb-info">分镜脚本（拆解稿）——共 {{ shots.length }} 镜 ｜ 总时长 {{ totalDuration }} 秒</span>
      <span class="muted">确认无误后进入视频生成（首尾帧 → 分镜视频 → 可选 A-roll）</span>
    </div>
    <div v-for="(shot, i) in shots" :key="i" class="seg-card">
      <div class="seg-head">
        <span class="seg-no">#{{ i + 1 }}</span>
        <span class="iv-badge" :class="shot.source === 'generate' ? 'iv-badge--ai' : 'iv-badge--mat'">{{ shot.source === 'generate' ? 'AI 生成' : '实拍' }}</span>
        <span class="muted iv-name">{{ shot.gen?.name }}</span>
        <span class="spacer"></span>
        <span class="muted">{{ shot.shot_type || '未定镜别' }} ｜ {{ shot.duration }}s</span>
      </div>
      <div class="sb-line">画面：{{ shot.visual || '（无）' }}</div>
      <div v-if="shot.orig_audio || shot.audio" class="sb-line iv-orig">旁白：{{ shot.audio || shot.orig_audio }}</div>
      <div v-if="shot.gen?.camera" class="sb-line">运镜：{{ shot.gen.camera }}</div>
    </div>
    <div class="row">
      <TButton label="← 上一步" variant="primary" @click="emit('back')" />
      <span class="spacer"></span>
      <TButton label="下一步：视频生成" @click="emit('next')" />
    </div>
  </div>
</template>

<style scoped>
.iv-panel { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.spacer { flex: 1; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.sb-info { font-size: 13px; color: var(--foreground); }
.sb-line { font-size: 12px; color: var(--muted-foreground); line-height: 1.5; word-break: break-word; }
.iv-orig { font-style: italic; }
.seg-card { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.seg-head { display: flex; align-items: center; gap: 8px; }
.seg-no { font-size: 13px; font-weight: 600; color: var(--primary); }
.iv-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.iv-badge--ai { background: color-mix(in srgb, var(--primary) 18%, transparent); color: var(--primary); }
.iv-badge--mat { background: color-mix(in srgb, var(--muted-foreground) 18%, transparent); color: var(--muted-foreground); }
.iv-name { font-size: 12px; }
</style>
