<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// OtReversePromptVideo — 运营工具「视频反推提示词」（2026-10-02 用户裁决启用）
// 走仿视频拆解接口（POST /api/storyboard/scripts/imitate）一个调用返回
// 【拆解脚本 + 反推提示词】——不单独调 /prompt/video；编排复用
// useImitationVideo（上传入素材库→material://→拆解→unified 轮询）。
// 结果 UI（2026-10-06 改造）：整体提示词卡（meta.prompt_en，完成后经
// loadScript 读取，与仿视频第 1 步同源）+ 逐镜合一卡（拆解脚本与反推
// 提示词不再重复两段展示；运镜走服务端枚举标签；每镜/整体一键复制）。
// ═══════════════════════════════════════════════════════════════
import { computed, onMounted, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import { useFilePicker } from '@/composables/useFilePicker'
import { useImitationVideo } from '@/composables/useImitationVideo'
import { enumLabel } from '@/composables/imitationVideoLogic'
import { acceptFileDragOver } from '@/utils/fileUrl'
import { MAX_SOURCE_VIDEO_SEC, probeDurationSec } from '@/utils/videoDuration'

const iv = useImitationVideo()

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'm4v']
type Mode = 'file' | 'material'
const mode = ref<Mode>('file')
const materialId = ref('')
const sourceFile = ref<File | null>(null)
const pickError = ref('')

const picker = useFilePicker({
  dialogTitle: '选择视频',
  filters: [{ name: '视频', extensions: VIDEO_EXTS }],
})
function isVideo(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return VIDEO_EXTS.includes(ext)
}
async function onDrop(e: DragEvent): Promise<void> {
  const f = e.dataTransfer?.files?.[0] || null
  if (f && !isVideo(f.name)) {
    pickError.value = `不支持的视频格式：${f.name}（支持 ${VIDEO_EXTS.join(' / ')}）`
    return
  }
  if (f) {
    // 时长上限校验（2026-10-02 用户裁决：≤60 秒，超限明确提示）
    const sec = await probeDurationSec(f)
    if (sec !== null && sec > MAX_SOURCE_VIDEO_SEC) {
      sourceFile.value = null
      picker.clearFile()
      pickError.value = `视频时长 ${Math.round(sec)} 秒，超过 ${MAX_SOURCE_VIDEO_SEC} 秒上限——请选择 ${MAX_SOURCE_VIDEO_SEC} 秒以内的视频`
      return
    }
    sourceFile.value = f
  }
  pickError.value = ''
  picker.onDrop(e)
}

const canSubmit = computed(() =>
  mode.value === 'file' ? !!sourceFile.value : /^\d+$/.test(materialId.value.trim()),
)

async function submit(): Promise<void> {
  const video = mode.value === 'file' ? sourceFile.value : materialId.value.trim()
  await iv.submitImitate({ video })
}

/** 拆解结果 shots[]：visual 中文 + scene_en/end_scene_en 英文提示词 + 运镜/时长
 *  （随拆解返回——2026-10-02 服务端规范定稿，无独立顶层提示词字段） */
const resultShots = computed<Array<Record<string, unknown>>>(() => {
  const r = iv.part1Result.value || {}
  return Array.isArray(r.shots) ? (r.shots as Array<Record<string, unknown>>) : []
})

/** 时长展示格式化：一位小数、去尾零（浮点噪声修复 2026-10-03） */
function formatSec(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${parseFloat(n.toFixed(2))}s`
}

// ── 整体提示词（meta.prompt_en，随脚本保存；完成后拉脚本记录读取，
//    与仿视频 ImitationVideo.vue overallPromptEn 同源同口径）──
const scriptRecord = ref<Record<string, unknown> | null>(null)
const overallPromptEn = computed(() => {
  const meta = scriptRecord.value?.meta as Record<string, unknown> | undefined
  const v = meta?.prompt_en
  return typeof v === 'string' ? v.trim() : ''
})
watch(() => iv.part1Phase.value, async (ph) => {
  if (ph === 'done' && iv.scriptId.value) {
    scriptRecord.value = await iv.loadScript(iv.scriptId.value)
  }
})

// 运镜枚举标签（未命中/未加载回退原始值——enumLabel 兜底，拉取失败不阻塞本卡）
onMounted(() => { void iv.loadEnums() })

// ── 复制（navigator.clipboard，与素材库同口径；剪贴板不可用静默）──
const copiedKey = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyText(text: string, key: string): Promise<void> {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copiedKey.value = '' }, 1500)
  } catch (_) { /* 非安全上下文等静默 */ }
}
/** 单镜复制内容=首帧+尾帧英文提示词（反推工具的交付物） */
function shotPromptText(s: Record<string, unknown>): string {
  return [s.scene_en, s.end_scene_en]
    .filter((v) => typeof v === 'string' && v.trim())
    .join('\n')
}
/** 一键复制全文=整体提示词（若有）+ 逐镜带镜号分隔（2026-10-06 用户裁决：结果底部整行按钮） */
const allPromptsText = computed(() => {
  const blocks = resultShots.value
    .map((s, i) => {
      const body = shotPromptText(s)
      return body ? `[#${i + 1}]\n${body}` : ''
    })
    .filter(Boolean)
  if (overallPromptEn.value) blocks.unshift(`[整体]\n${overallPromptEn.value}`)
  return blocks.join('\n\n')
})
</script>

<template>
  <div class="rpv">
    <div class="row">
      <label class="rpv-mode" :class="{ on: mode === 'file' }"><input v-model="mode" type="radio" value="file" />本地上传</label>
      <label class="rpv-mode" :class="{ on: mode === 'material' }"><input v-model="mode" type="radio" value="material" />素材库</label>
    </div>

    <div v-if="mode === 'file'" class="rpv-pick">
      <div class="dropzone" :class="{ 'is-active': picker.isDragging.value, 'has-file': !!picker.filePath.value }"
        @click="picker.pickFile"
        @drop.prevent="onDrop"
        @dragover.prevent="acceptFileDragOver($event); picker.onDragOver()"
        @dragleave.prevent="picker.onDragLeave">
        <svg v-if="!picker.filePath.value" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <div class="dropzone__text">
          <template v-if="!picker.filePath.value">
            <span class="dropzone__main">点击选择视频或拖拽到此处</span>
            <span class="dropzone__hint">时长 ≤ {{ MAX_SOURCE_VIDEO_SEC }} 秒；自动上传后拆解，返回脚本与提示词</span>
          </template>
          <template v-else>
            <span class="dropzone__main">{{ picker.fileName.value }}</span>
            <span class="dropzone__hint">点击重新选择</span>
          </template>
        </div>
      </div>
      <div v-if="pickError" class="rpv-err">{{ pickError }}</div>
    </div>
    <div v-else class="seg-field">
      <span class="lbl">素材库 ID</span>
      <input v-model="materialId" class="rpv-input" placeholder="如 812729" />
    </div>

    <div class="row">
      <TButton label="拆解并反推" :loading="iv.part1Phase.value === 'running'" :disabled="!canSubmit" @click="submit" />
      <span v-if="iv.part1Note.value" class="muted">{{ iv.part1Note.value }}</span>
    </div>
    <div v-if="iv.part1Phase.value === 'running'" class="muted">拆解进行中（分割 → 逐镜分析 → 运镜 → 转写 → 反推，分钟级）…</div>
    <div v-if="iv.part1Error.value" class="rpv-err">{{ iv.part1Error.value }}</div>

    <template v-if="iv.part1Phase.value === 'done'">
      <div class="rpv-divider"></div>

      <!-- 整体提示词卡（整片创作方向，随脚本保存） -->
      <div v-if="overallPromptEn" class="rpv-card">
        <div class="rpv-card-head">
          <span class="lbl">整体提示词（整片创作方向 · meta.prompt_en）</span>
          <button class="rpv-copy" @click="copyText(overallPromptEn, 'overall')">{{ copiedKey === 'overall' ? '已复制 ✓' : '复制' }}</button>
        </div>
        <div class="rpv-en rpv-en--block">{{ overallPromptEn }}</div>
      </div>

      <div class="row between">
        <span class="lbl">逐镜（拆解脚本 × 反推提示词）</span>
        <span class="muted">共 {{ resultShots.length }} 镜</span>
      </div>
      <template v-if="resultShots.length">
        <div v-for="(s, i) in resultShots" :key="i" class="rpv-card">
          <div class="rpv-card-head">
            <span class="rpv-no">#{{ i + 1 }}</span>
            <span class="muted">{{ formatSec(s.duration) }} ｜ {{ enumLabel(iv.enums.value?.cameras || [], s.camera) || '—' }}</span>
            <span class="spacer"></span>
            <button class="rpv-copy" @click="copyText(shotPromptText(s), `shot-${i}`)">{{ copiedKey === `shot-${i}` ? '已复制 ✓' : '复制提示词' }}</button>
          </div>
          <div v-if="s.visual" class="rpv-visual">画面：{{ s.visual }}</div>
          <div v-if="s.scene_en" class="rpv-en"><span class="rpv-en-tag">首帧 scene_en</span>{{ s.scene_en }}</div>
          <div v-if="s.end_scene_en" class="rpv-en"><span class="rpv-en-tag">尾帧 end_scene_en</span>{{ s.end_scene_en }}</div>
        </div>
        <!-- 一键复制全部提示词（整行，2026-10-06 用户裁决） -->
        <div class="rpv-copyall">
          <TButton :label="copiedKey === 'all' ? '已复制 ✓' : '一键复制全部提示词'" :disabled="!allPromptsText" @click="copyText(allPromptsText, 'all')" />
        </div>
      </template>
      <div v-else class="muted">拆解结果未含 shots 明细（旧版服务端）</div>
    </template>
  </div>
</template>

<style scoped>
.rpv { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.spacer { flex: 1; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.lbl { font-size: 12px; color: var(--muted-foreground); }
.rpv-mode { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md);
  font-size: 12px; color: var(--muted-foreground); cursor: pointer; }
.rpv-mode.on { color: var(--primary); font-weight: 600; border-color: var(--primary); }
.rpv-pick { display: flex; flex-direction: column; gap: 6px; }
.rpv-err { color: var(--danger, #e74c3c); font-size: 12px; }
.rpv-input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--foreground); font-size: 13px; outline: none; }
.rpv-divider { height: 1px; background: var(--border); margin: 8px 0; }
.rpv-card { padding: 8px 10px; background: var(--surface-container); border: 1px solid var(--border);
  border-radius: var(--radius-md); }
.rpv-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.rpv-no { color: var(--primary); font-weight: 600; font-size: 12px; }
.rpv-copy { margin-left: auto; height: 22px; padding: 0 8px; background: var(--card);
  border: 1px solid var(--border); border-radius: var(--radius-sm, 4px); font-size: 11px;
  color: var(--muted-foreground); cursor: pointer; }
.rpv-card-head .rpv-copy { margin-left: 0; }
.rpv-copy:hover { color: var(--primary); border-color: var(--primary); }
.rpv-visual { font-size: 12px; color: var(--foreground); line-height: 1.5; }
.rpv-en { margin-top: 3px; font-size: 11px; color: var(--muted-foreground); font-family: monospace;
  line-height: 1.5; word-break: break-all; }
.rpv-en--block { margin: 0; padding: 6px 8px; background: var(--card); border-radius: var(--radius-sm, 4px); }
.rpv-en-tag { display: inline-block; margin-right: 6px; padding: 0 5px; background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-radius: 3px; color: var(--primary); font-family: inherit; font-size: 10px; line-height: 16px; }
.rpv-copyall { display: flex; }
.rpv-copyall :deep(.t-button) { flex: 1; }
.dropzone { display: flex; align-items: center; gap: var(--space-3); min-height: 120px; padding: var(--space-6);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-container));
  border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border));
  border-radius: var(--radius-lg); color: var(--muted-foreground); cursor: pointer; }
.dropzone:hover, .dropzone.is-active { border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-container)); }
.dropzone.has-file { border-style: solid; color: var(--foreground); }
.dropzone__text { display: flex; flex-direction: column; gap: 2px; }
.dropzone__main { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--foreground); }
.dropzone__hint { font-size: 12px; color: var(--muted-foreground); }
</style>
