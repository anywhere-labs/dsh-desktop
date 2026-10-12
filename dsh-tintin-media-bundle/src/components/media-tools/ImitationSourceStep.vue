<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ImitationSourceStep — 仿爆款视频向导第 1 步「视频拆解」（2026-10-03 自
// ImitationVideo.vue 拆出：铁律 4 千行红线，逐符号纯搬迁零行为改动）。
// 自持状态：来源三态/画幅/保真/拖拽选择/60s 校验/上传进度 + 拆解脚本与
// 反推提示词（整体卡+逐镜）展示。提交走 iv.submitImitate；完成后的脚本
// 回读由父级 watch(iv.part1Phase) 承担（本组件只发起到展示）。
// ═══════════════════════════════════════════════════════════════
import { computed, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import { useFilePicker } from '@/composables/useFilePicker'
import type { useImitationVideo } from '@/composables/useImitationVideo'
import { clientError } from '@/utils/clientLog'
import { acceptFileDragOver } from '@/utils/fileUrl'
import { MAX_SOURCE_VIDEO_SEC, probeDurationSec } from '@/utils/videoDuration'
import { setPendingMediaTool } from '@/composables/pendingMediaTool'
import {
  enumLabel,
  shotsTotalDuration,
  type ImitationShot,
} from '@/composables/imitationVideoLogic'

const props = defineProps<{
  iv: ReturnType<typeof useImitationVideo>
  shots: ImitationShot[]
  /** 整体提示词（meta.prompt_en，父级从脚本记录读取） */
  overallPromptEn: string
}>()

const emit = defineEmits<{
  /** 拆解完成，请求进入第 2 步（父级切步） */
  (e: 'next'): void
}>()

type SourceMode = 'file' | 'material' | 'url'
const sourceMode = ref<SourceMode>('file')
const sourceMaterial = ref('')
const sourceUrl = ref('')
const ratio = ref('9:16')
const fidelity = ref('off')  // 2026-10-09 用户裁决：默认不启用 FlashVSR（fidelity=off）
/** 本地文件上传进度（0..1；<0 未在上传） */
const uploadRatio = ref(-1)

// 本地视频走工程统一拖入控件（useFilePicker：点击选择/拖拽 + 120px 统一 dropzone，
// 2026-09-07 全程序统一裁决）。上传通道需要真 File：拖入从 dataTransfer 直取；
// 对话框只给路径 → 经宿主 /tintin/media 代理（unlock 已由选择器触发）取回内容成 File。
const VIDEO_PICK_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'm4v']
const sourceFile = ref<File | null>(null)
const fileResolving = ref(false)
const pickError = ref('')
const videoPicker = useFilePicker({
  dialogTitle: '选择原视频',
  filters: [{ name: '视频', extensions: VIDEO_PICK_EXTS }],
})

function isVideoName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return VIDEO_PICK_EXTS.includes(ext)
}

/** 原片时长上限（2026-10-02 用户裁决：上传视频 ≤60 秒，超限明确提示拦截） */
const MAX_SOURCE_SEC = MAX_SOURCE_VIDEO_SEC

/** 拆解耗时文案（2026-10-10 用户裁决：完成后稍明显展示全过程用时） */
const p1DurText = computed(() => {
  const sec = Math.max(0, Math.round(props.iv.part1ElapsedSec.value))
  return sec >= 60 ? `${Math.floor(sec / 60)} 分 ${sec % 60} 秒` : `${sec} 秒`
})

/** 时长校验：超限清空选择并给明确提示；返回是否通过 */
async function enforceDurationLimit(file: File): Promise<boolean> {
  const sec = await probeDurationSec(file)
  if (sec !== null && sec > MAX_SOURCE_SEC) {
    sourceFile.value = null
    videoPicker.clearFile()
    pickError.value = `视频时长 ${Math.round(sec)} 秒，超过 ${MAX_SOURCE_SEC} 秒上限——请选择 ${MAX_SOURCE_SEC} 秒以内的原片（拆解链面向短视频）`
    clientError('imitation-video', pickError.value, { name: file.name, sec })
    return false
  }
  return true
}

/**
 * 拖入：同步段内完成格式校验 + File 直取 + 选择器回显（Drop 事件的 dataTransfer
 * 在处理器让出控制权后被清空——任何 await 之后再读就是空，2026-10-02 实机回归：
 * async 化时长校验后回显消失，即此因）；时长探测异步后置，超限撤下并明确提示。
 */
function onVideoDrop(e: DragEvent): void {
  const f = e.dataTransfer?.files?.[0] || null
  if (f && !isVideoName(f.name)) {
    pickError.value = `不支持的视频格式：${f.name}（支持 ${VIDEO_PICK_EXTS.join(' / ')}）`
    return
  }
  if (f) sourceFile.value = f
  pickError.value = ''
  videoPicker.onDrop(e)
  if (f) {
    void enforceDurationLimit(f)
  }
}

/** 对话框路径 → File（宿主 /tintin/media 同源代理流式取回；失败显式报错不静默） */
async function resolveFileFromPath(path: string): Promise<void> {
  if (!isVideoName(path)) {
    sourceFile.value = null
    pickError.value = `不支持的视频格式：${path}`
    return
  }
  fileResolving.value = true
  try {
    const res = await fetch(`/tintin/media?path=${encodeURIComponent(path)}`)
    if (!res.ok) {
      // 403 带宿主响应体（Path outside allowed media roots / Request rejected）——定位不靠裸状态码
      let detail = ''
      try { detail = (await res.text()).slice(0, 200) } catch { /* 响应体缺失保持裸状态码 */ }
      throw new Error(`HTTP ${res.status}${detail ? `：${detail}` : ''}`)
    }
    const blob = await res.blob()
    const name = path.split(/[\\/]/).pop() || 'source.mp4'
    const file = new File([blob], name, { type: blob.type || 'video/mp4' })
    if (!(await enforceDurationLimit(file))) return
    sourceFile.value = file
    pickError.value = ''
  } catch (err) {
    sourceFile.value = null
    pickError.value = `读取所选文件失败：${(err as Error).message}`
    clientError('imitation-video', pickError.value, err)
  } finally {
    fileResolving.value = false
  }
}

// 路径变化：拖入已直取同名 File 则跳过；对话框新路径则代理解析
watch(videoPicker.filePath, (p) => {
  if (!p) {
    sourceFile.value = null
    return
  }
  const base = p.split(/[\\/]/).pop()
  if (sourceFile.value && sourceFile.value.name === base) return
  void resolveFileFromPath(p)
})

const part1VideoInput = computed<unknown>(() => {
  if (sourceMode.value === 'file') return sourceFile.value
  if (sourceMode.value === 'material') return sourceMaterial.value.trim()
  return sourceUrl.value.trim()
})

const canSubmitPart1 = computed(() => {
  if (sourceMode.value === 'file') return !!sourceFile.value && !fileResolving.value
  if (sourceMode.value === 'material') return /^\d+$/.test(sourceMaterial.value.trim())
  return /^https?:\/\//i.test(sourceUrl.value.trim())
})

/** 时长展示格式化：一位小数、去尾零（浮点噪声修复 2026-10-03） */
function formatSec(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${parseFloat(n.toFixed(2))}s`
}

/** 反推提示词（随拆解返回，2026-10-02 服务端规范定稿）：result.shots[]=逐镜反推提示词
 *  （visual 中文 + scene_en/end_scene_en 英文提示词 + 运镜/时长）——无独立顶层字段 */
const rpShots = computed<Array<Record<string, unknown>>>(() => {
  const r = props.iv.part1Result.value || {}
  return Array.isArray(r.shots) ? (r.shots as Array<Record<string, unknown>>) : []
})
</script>

<template>
  <div class="iv-panel">
    <div class="row">
      <label class="iv-mode" :class="{ on: sourceMode === 'file' }"><input v-model="sourceMode" type="radio" value="file" />本地上传</label>
      <label class="iv-mode" :class="{ on: sourceMode === 'material' }"><input v-model="sourceMode" type="radio" value="material" />素材库</label>
      <label class="iv-mode" :class="{ on: sourceMode === 'url' }"><input v-model="sourceMode" type="radio" value="url" />链接</label>
      <!-- 2026-10-09 用户裁决：行尾直达「视频去水印字幕」工具（原视频含字幕时先去字再拆解） -->
      <button type="button" class="iv-goto-vsr" title="打开「视频去水印字幕」工具" @click="setPendingMediaTool('subtitle-removal')">
        视频去字幕
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
      </button>
    </div>

    <div v-if="sourceMode === 'file'" class="iv-filepick">
      <div class="dropzone" :class="{ 'is-active': videoPicker.isDragging.value, 'has-file': !!videoPicker.filePath.value }"
        @click="videoPicker.pickFile"
        @drop.prevent="onVideoDrop"
        @dragover.prevent="acceptFileDragOver($event); videoPicker.onDragOver()"
        @dragleave.prevent="videoPicker.onDragLeave">
        <svg v-if="!videoPicker.filePath.value" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <div class="dropzone__text">
          <template v-if="!videoPicker.filePath.value">
            <span class="dropzone__main">点击选择原视频或拖拽到此处</span>
            <span class="dropzone__hint">支持 MP4 / MOV / MKV / AVI / WEBM / FLV / M4V，时长 ≤ {{ MAX_SOURCE_SEC }} 秒；自动上传入素材库后进入拆解</span>
          </template>
          <template v-else>
            <span class="dropzone__main">{{ videoPicker.fileName.value }}</span>
            <span class="dropzone__hint">{{ fileResolving ? '正在读取文件…' : sourceFile ? `${(sourceFile.size / 1024 / 1024).toFixed(1)} MB · 点击重新选择` : '正在读取文件…' }}</span>
          </template>
        </div>
      </div>
      <div v-if="pickError" class="iv-err">{{ pickError }}</div>
    </div>
    <div v-else-if="sourceMode === 'material'" class="seg-field">
      <span class="lbl">素材库 ID（视频需已在服务端素材库）</span>
      <input v-model="sourceMaterial" class="input" placeholder="如 123" />
    </div>
    <div v-else class="seg-field">
      <span class="lbl">视频链接（服务端下载）</span>
      <input v-model="sourceUrl" class="input" placeholder="https://..." />
    </div>

    <!-- 设置行（2026-10-03 用户裁决：提交拆解移本行右对齐） -->
    <div class="row">
      <label class="seg-field head-field"><span class="lbl">画幅</span>
        <select v-model="ratio" class="input w-ratio" title="生成目标画幅（枚举来自服务端 /comfygen/enums）">
          <option v-for="r in iv.enums.value?.ratios || []" :key="r.ratio" :value="r.ratio">
            {{ r.ratio }}（{{ r.width }}×{{ r.height }}）
          </option>
        </select>
      </label>
      <label class="seg-field head-field"><span class="lbl">保真档位</span>
        <select v-model="fidelity" class="input w-fidelity">
          <option v-for="f in iv.enums.value?.fidelity || []" :key="f.value" :value="f.value">{{ f.label }}</option>
        </select>
      </label>
      <label class="seg-field head-field"><span class="lbl">参考模式</span>
        <select v-model="iv.referenceMode.value" class="input w-fidelity"
          title="画面级还原=原片帧参考（构图/姿态以场景帧为准）；风格级相似=文字+产品图（现行为）">
          <option v-for="r in iv.enums.value?.referenceModes || []" :key="r.value" :value="r.value">{{ r.label }}</option>
        </select>
      </label>
      <span class="spacer"></span>
      <TButton label="提交拆解" :loading="iv.part1Phase.value === 'running'" :disabled="!canSubmitPart1" @click="iv.submitImitate({
        video: part1VideoInput,
        options: { ratio, fidelity },
        onUploadProgress: (r) => { uploadRatio = r },
      })" />
      <span v-if="iv.part1Note.value" class="muted">{{ iv.part1Note.value }}</span>
    </div>

    <div class="seg-field">
      <span class="lbl">A-roll 口播人像（可选，第 3 步配置）</span>
      <span class="muted">数字人 / 实拍上传在「3. 分镜头确认」中配置（数字人人物图上传通道待服务端契约，当前可先走实拍）</span>
    </div>
    <div v-if="uploadRatio >= 0 && uploadRatio < 1 && iv.part1Phase.value !== 'running'" class="muted">本地上传中 {{ Math.round(uploadRatio * 100) }}%</div>
    <div v-if="iv.part1Phase.value === 'running'" class="iv-progress">
      <div class="row between">
        <span class="muted">分析进行中（已用时 {{ iv.part1ElapsedSec.value }} 秒）：拆镜头 → 运镜测量 → 转写文案 → 生成仿拍脚本…</span>
        <span v-if="iv.part1Progress.value >= 0" class="muted">{{ iv.part1Progress.value }}%</span>
      </div>
      <!-- 进度条（2026-10-03 用户裁决：拆解中必须有进度条）：服务端报百分比走定态，
           未报进度走不定态滑动动画；last_message=服务端阶段文案 -->
      <div class="iv-bar" :class="{ 'is-indeterminate': iv.part1Progress.value < 0 }">
        <div v-if="iv.part1Progress.value >= 0" class="iv-bar-fill" :style="{ width: iv.part1Progress.value + '%' }"></div>
      </div>
      <div v-if="iv.part1Message.value" class="muted">{{ iv.part1Message.value }}</div>
    </div>
    <div v-if="iv.part1Error.value" class="iv-err">{{ iv.part1Error.value }}</div>
    <div v-if="iv.enumsError.value" class="iv-err">枚举加载失败：{{ iv.enumsError.value }}（刷新重试：{{ ' ' }}<a class="iv-link" @click="iv.loadEnums">重试</a>）</div>

    <template v-if="iv.part1Phase.value === 'done' && shots.length">
      <div class="p1-dur">拆解完成，耗时 {{ p1DurText }}</div>
      <div class="iv-divider"></div>
      <div class="row between">
        <span class="lbl">拆解脚本（原片脚本·只读）——编辑与文案替换在第 2 步「生成脚本」</span>
        <span class="sb-info">共 {{ shots.length }} 镜 ｜ 总时长 {{ shotsTotalDuration(shots) }} 秒</span>
      </div>
      <div v-for="(shot, i) in shots" :key="i" class="seg-card">
        <div class="seg-head">
          <span class="seg-no">#{{ i + 1 }}</span>
          <span class="sb-info">{{ shot.shot_type || '未定镜别' }} ｜ {{ formatSec(shot.duration) }} ｜ {{ enumLabel(iv.enums.value?.cameras || [], shot.gen?.camera) }}</span>
        </div>
        <div v-if="shot.visual" class="sb-line">画面：{{ shot.visual }}</div>
        <div v-if="shot.orig_audio || shot.audio" class="sb-line iv-orig">原旁白：{{ shot.orig_audio || shot.audio }}</div>
      </div>

      <!-- 反推提示词（逐镜，随拆解 shots[] 返回——2026-10-02 服务端规范定稿：
           result.shots[]=name/visual/scene 四要素/scene_en/end_scene_en/camera/duration；
           整体方向卡=meta.prompt_en（服务端映射层生成，随脚本保存，2026-10-03 实证） -->
      <div class="seg-field">
        <span class="lbl">反推提示词（逐镜，随拆解返回）</span>
        <div v-if="overallPromptEn" class="seg-card iv-gen">
          <div class="row between"><span class="lbl">整体提示词（整片创作方向，随脚本保存）</span><span class="sb-info">meta.prompt_en</span></div>
          <div class="sb-line">{{ overallPromptEn }}</div>
        </div>
        <template v-if="rpShots.length">
          <div v-for="(s, i) in rpShots" :key="i" class="seg-card">
            <div class="seg-head">
              <span class="seg-no">#{{ i + 1 }}</span>
              <span class="sb-info">{{ formatSec(s.duration) }} ｜ {{ enumLabel(iv.enums.value?.cameras || [], s.camera) }}</span>
            </div>
            <div class="sb-line">{{ s.visual }}</div>
            <div v-if="s.scene_en" class="sb-line iv-orig">scene_en: {{ s.scene_en }}</div>
            <div v-if="s.end_scene_en" class="sb-line iv-orig">end_scene_en: {{ s.end_scene_en }}</div>
          </div>
        </template>
        <span v-else class="muted">拆解结果未含 shots 明细（旧版服务端）——升级后自动展示逐镜提示词</span>
      </div>

      <div class="row">
        <span class="muted">拆解完成——下一步替换文案文字并配新口播</span>
        <span class="spacer"></span>
        <TButton label="下一步：生成脚本" @click="emit('next')" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.iv-panel { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.spacer { flex: 1; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.sb-info { font-size: 12px; color: var(--muted-foreground); }
.sb-line { font-size: 12px; color: var(--foreground); line-height: 1.5; }
.iv-err { color: var(--danger, #e74c3c); font-size: 12px; }
.iv-link { color: var(--primary); cursor: pointer; text-decoration: underline; }
.iv-filepick { display: flex; flex-direction: column; gap: 6px; }
.iv-divider { height: 1px; background: var(--border); margin: 8px 0; }
.iv-orig { color: var(--muted-foreground); font-style: italic; }
.w90 { width: 110px; } .w110 { width: 130px; }
/* 画幅/保真下拉加宽（2026-10-03 用户裁决：完整显示「16:9（1280×704）」「均衡（约4.5分/镜）」） */
.w-ratio { width: 168px; }
.w-fidelity { width: 178px; }

.iv-mode {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md);
  font-size: 12px; color: var(--muted-foreground); cursor: pointer;
}
.iv-mode.on { color: var(--primary); font-weight: 600; border-color: var(--primary); }

/* 行尾直达按钮（2026-10-09）：同 .iv-mode 芯片形态，主色描边区分动作属性 */
.iv-goto-vsr {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-container));
  border: 1px solid color-mix(in srgb, var(--primary) 45%, var(--border)); border-radius: var(--radius-md);
  font-size: 12px; color: var(--primary); cursor: pointer;
  transition: background var(--duration-fast) var(--easing-default);
}
.iv-goto-vsr:hover { background: color-mix(in srgb, var(--primary) 16%, var(--surface-container)); }

.seg-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md); }
.seg-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.seg-no { font-weight: 700; color: var(--primary); }
.seg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.seg-field.head-field { flex: 0 0 auto; flex-direction: row; align-items: center; gap: 6px; }
.seg-field .lbl, .lbl { font-size: 12px; color: var(--muted-foreground); flex: none; }
.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }
.input:focus { border-color: var(--primary); }
.iv-gen { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;
  background: color-mix(in srgb, var(--primary) 4%, var(--card)); border: 1px dashed var(--border); border-radius: var(--radius-md); }

.dropzone {
  display: flex; align-items: center; gap: var(--space-3); min-height: 120px; padding: var(--space-6);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-container));
  border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border));
  border-radius: var(--radius-lg); color: var(--muted-foreground); cursor: pointer;
  transition: border-color var(--duration-fast) var(--easing-default),
    background var(--duration-fast) var(--easing-default);
}
.dropzone:hover, .dropzone.is-active { border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-container)); }
.dropzone.has-file { border-style: solid; color: var(--foreground); }
.dropzone__text { display: flex; flex-direction: column; gap: 2px; }
.dropzone__main { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--foreground); }
.dropzone__hint { font-size: 12px; color: var(--muted-foreground); }

/* 拆解进度条（2026-10-03：定态=服务端 progress 百分比；不定态=滑动动画） */
.iv-progress { display: flex; flex-direction: column; gap: 6px; }
.iv-bar {
  position: relative; height: 6px; overflow: hidden;
  background: var(--border); border-radius: 999px;
}
.iv-bar-fill { height: 100%; background: var(--primary); border-radius: 999px; transition: width 0.6s ease; }
.iv-bar.is-indeterminate::after {
  content: ''; position: absolute; inset: 0; width: 40%;
  background: var(--primary); border-radius: 999px;
  animation: iv-indeterminate 1.2s ease-in-out infinite;
}
@keyframes iv-indeterminate {
  0% { left: -40%; }
  100% { left: 100%; }
}

.p1-dur { font-size: 13px; font-weight: 600; color: var(--primary); }
</style>
