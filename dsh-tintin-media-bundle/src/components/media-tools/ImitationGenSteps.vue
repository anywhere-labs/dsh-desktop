<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ImitationGenSteps.vue — 仿视频第 3 步（分镜头确认：阶段① 高清首尾帧生成与
// 确认全部分镜）与第 4 步（逐镜视频生成 + 可选 A-roll）面板。
// 2026-10-16 用户裁决：九宫格人工确认整体退役——粗稿任务由父级自动确认并
// 自动续跑高清首尾帧，本面板不再有九宫格卡/提示词列表/下载/重新生成入口；
// 原阶段②（首尾帧）升为阶段①。
// 2026-10-06 用户裁决：单镜确认完成即解锁「下一步：视频生成」（手动进入第 4 步）；
// 首尾帧点击=页内灯箱看全图；词表只含当前仿视频脚本（装载后剔除其他脚本 tab）。
// ═══════════════════════════════════════════════════════════════
import { computed, ref, watch } from 'vue'
import { clientInfo } from '@/utils/clientLog'
import TButton from '@/components/common/TButton.vue'
import {
  SCENE_ELEMENT_KEYS,
  canConfirmFrames,
  framesBadgeText,
  isReplaceShot,
  isStageDReady,
  sceneElementOptions,
  shotProgressPercent,
  shotInReplace,
  shotModeBadgeClass,
  shotModeBadgeText,
  type ImitationShot,
  type QualityReport,
  type SceneElementKey,
  type ServerEnums,
} from '@/composables/imitationVideoLogic'

const props = defineProps<{
  mode: 'frames' | 'videos'
  iv: {
    genPhase: { value: string }
    genError: { value: string }
    genStage: { value: string }
    scriptId: { value: string }
    confirmShotFrames: (id: string, name: string) => Promise<boolean>
    genProgress: { value: number }
    genElapsedSec: { value: number }
    genMessage: { value: string }
    enums: { value: ServerEnums | null }
    referenceMode: { value: string }
  }
  shots: ImitationShot[]
  /** 换物档左栏参考=原片（meta.imitate.source_material_id；空=脚本无源片引用） */
  sourceVideoUrl: string
  /** meta.quality_report（批1 M0/D7 frames 后置质量报告；null=无数据不显示） */
  qualityReport: QualityReport | null
  genResultSummary: { done: number; failed: number }
  framesReadyCount: number
  generateShotsCount: number
  doneAll: boolean
  arollStatus: string
  arollConfig: { source: string; imageMaterialId: string; materialId: string }
  arollPreviewUrl: string
  arollBusy: string
  frameConfirming: string
  regenFrame: string
  retrying: string
  retryFidelity: string
  startVideos: string
  /** 六视图就绪（§11-51：videos 阶段服务端消费六视图；未生成禁入第 4 步） */
  sixViewReady: boolean
  frameUrl: (name: unknown, which: 'first' | 'last' | 'draft_first' | 'draft_last') => string
  videoUrlOf: (materialId: unknown) => string
  liveShots: { done: number; total: number } | null
  onConfirmFrame: (index: number) => void
  onPickReplaceFrame: (index: number, which: 'first' | 'last') => void
  onRegenerateFrame: (index: number) => void
  onRetryShot: (index: number) => void
  onBack: () => void
}>()

const emit = defineEmits<{
  (e: 'generate-aroll', config: { source: string; imageMaterialId: string; materialId: string }): void
  (e: 'start-videos'): void
  (e: 'next-pack'): void
  (e: 'update:retryFidelity', v: 'fast' | 'balanced' | 'high'): void
  (e: 'frames-confirmed'): void
  (e: 'toggle-badcase', index: number): void
}>()

function ivRef<T = unknown>(key: string): { value: T } {
  return (props.iv as unknown as Record<string, { value: unknown }>)[key] as { value: T }
}

// on* 前缀的函数 props 在 vue-tsc 模板推断里按「可选监听器」处理（TS2722）——
// 脚本层取快照常量供模板引用，类型收窄为必填函数，运行时零差异
const onConfirmFrame = props.onConfirmFrame
const onPickReplaceFrame = props.onPickReplaceFrame
const onRegenerateFrame = props.onRegenerateFrame
const onRetryShot = props.onRetryShot
const enums = computed<ServerEnums | null>(() => ivRef('enums').value as ServerEnums | null)

// ── 质量徽标（批1 M0/D7 meta.quality_report；评分挂只 warning 不阻塞交付——S6；
//    缺源=N/A 不算 0）+ 坏例标注（shot 根级 extra 随脚本 PUT 持久）──
function fmtScore(v: number | null | undefined): string {
  return v === null || v === undefined ? 'N/A' : String(v)
}
function qualityLine(shot: ImitationShot): string {
  const name = String(shot.gen?.name || '')
  const s = name ? props.qualityReport?.per_shot?.[name] : undefined
  if (!s) return ''
  return `美学 ${fmtScore(s.aesthetic)} ｜ 产品 ${fmtScore(s.product_sim)} ｜ 环境 ${fmtScore(s.env_coverage)} ｜ 视差 ${fmtScore(s.parallax_sim)}`
}
function qualityIssueText(shot: ImitationShot): string {
  const name = String(shot.gen?.name || '')
  return (props.qualityReport?.issues || []).filter((x) => x.shot === name).map((x) => x.detail || x.rule).join('；')
}

/** 阶段 D 放行（全部生成镜帧已确认）——「下一步：视频生成」解锁依据 */
const stageDReady = computed(() => isStageDReady(props.shots))

// ── A-roll 卡（第 4 步·可选：数字人=人物图+口播音频 / 实拍=素材 id；先配置后提任务）──
const arollForm = ref({
  source: props.arollConfig.source || 'digital_human',
  imageMaterialId: props.arollConfig.imageMaterialId || '',
  materialId: props.arollConfig.materialId || '',
})
watch(() => props.arollConfig, (c) => {
  if (!c) return
  if (c.source) arollForm.value.source = c.source
  if (c.imageMaterialId) arollForm.value.imageMaterialId = c.imageMaterialId
  if (c.materialId) arollForm.value.materialId = c.materialId
}, { deep: true })
function submitAroll(): void {
  emit('generate-aroll', { ...arollForm.value })
}

/** 高清首尾帧尚未产生任何帧产物——提示文案依据（非闸门：流程自动流转，2026-10-16 裁决） */
const framesNotStarted = computed(() => !props.shots.some((s) => s.source === 'generate' && (s.gen?.first_frame || s.gen?.frames_status || s.gen?.draft_first)))

const SCENE_ELEMENT_LABELS: Record<string, string> = {
  surface: '台面', environment: '环境', lighting: '光照', style: '风格', composition: '构图',
}

// ── 确认全部分镜（2026-10-05 用户裁决：逐镜确认太繁——循环 PUT 已生成镜帧，一次回读）──
/** 待确认镜数（frames_status=generated 未确认）——按钮可用性依据（已确认数≠待确认数） */
const pendingFramesCount = computed(() => props.shots.filter((s) => canConfirmFrames(s)).length)
const confirmingAll = ref(false)
const confirmAllNote = ref('')
const confirmAllDone = ref(0)
const confirmAllTotal = ref(0)
async function confirmAllFrames(): Promise<void> {
  if (confirmingAll.value) return
  const targets = props.shots.filter((s) => canConfirmFrames(s))
  if (!targets.length) return
  confirmingAll.value = true
  confirmAllDone.value = 0
  confirmAllTotal.value = targets.length
  confirmAllNote.value = `正在确认 ${targets.length} 镜…`
  try {
    const failed: string[] = []
    for (const shot of targets) {
      const name = String(shot.gen?.name || '')
      const ok = !!name && (await props.iv.confirmShotFrames(props.iv.scriptId.value, name))
      if (!ok) failed.push(name)
      confirmAllDone.value++
    }
    confirmAllNote.value = failed.length
      ? `已确认 ${targets.length - failed.length} 镜，失败：${failed.join('、')}——可逐镜重试`
      : `已全部确认（${targets.length} 镜）`
    emit('frames-confirmed')
  } finally {
    confirmingAll.value = false
  }
}

// ── 页内灯箱（2026-10-06 用户裁决：首尾帧点击=看全图，点任意处关闭）──
const lightbox = ref<{ src: string; caption: string } | null>(null)
function openLightbox(name: unknown, which: 'first' | 'last', index: number): void {
  lightbox.value = { src: props.frameUrl(name, which), caption: `#${index + 1} ${String(name || '')} ${which === 'first' ? '首帧' : '尾帧'}` }
  clientInfo('imitation-video', `灯箱打开：${lightbox.value.caption}`)
}

/** 逐镜视频预览地址（生成/实拍统一回填 shot 根级 material_id） */
function shotVideoSrc(shot: ImitationShot): string {
  return props.videoUrlOf(shot.material_id)
}

/** 换物档左栏=原分割镜头（2026-10-12 用户裁决：左参考右产物）；其它档左栏=关键帧首帧 */
const replaceMode = computed(() => props.iv.referenceMode.value === 'video_replace')
/** 原片段地址（gen 源窗 #t= 片段化；无源窗=整段原片） */
function sourceClipSrc(shot: ImitationShot): string {
  if (!props.sourceVideoUrl) return ''
  const s = Number(shot.gen?.source_start), e = Number(shot.gen?.source_end)
  return Number.isFinite(s) && Number.isFinite(e) && e > s ? `${props.sourceVideoUrl}#t=${s},${e}` : props.sourceVideoUrl
}

/** 逐镜完成计数从实时脚本取（2026-10-06 用户裁决复刻：任务 result 运行期恒 0、
 *  结束才一次性回填——运行期计数以此为准，comfygen 流式计数仅作更快的前置叠加） */
const videosDoneCount = computed(() => props.shots.filter((s) => s.source === 'generate' && s.gen?.status === 'done').length)
const videosFailedCount = computed(() => props.shots.filter((s) => s.source === 'generate' && s.gen?.status === 'failed').length)
/** 进度条口径：逐镜完成比优先（镜粒度、且不依赖服务端编排 progress 的上报粒度）；
 *  无逐镜计数回落服务端 %（2026-10-13 起服务端处理期已对齐上报），-1=不定态。
 *  计算下沉 shotProgressPercent 纯函数；props 一律走 props.*（脚本作用域无裸标识符） */
const videosBarPct = computed(() => {
  const live = props.liveShots
  const done = Math.max(live ? live.done : 0, videosDoneCount.value)
  const total = live ? live.total : props.generateShotsCount
  return shotProgressPercent(done, total, ivRef<number>('genProgress').value)
})

/** 总耗时人话格式（2026-10-15 用户裁决：成功时给出共用时长；genElapsedSec 结束时定格在最后轮询 tick） */
function fmtElapsed(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h ? `${h}时${m}分${s}秒` : m ? `${m}分${s}秒` : `${s}秒`
}
</script>

<template>
  <div class="iv-panel">
    <!-- ═══ 第 3 步（mode=frames）═══ -->
    <template v-if="mode === 'frames'">
      <!-- 粗稿准备进度（stage=storyboard；2026-10-16 裁决：粗稿完成后父级自动确认并
           续跑高清首尾帧——不再有九宫格卡与人工确认，此进度条仅为等待期可见性） -->
      <div v-if="ivRef<string>('genStage').value === 'storyboard' && ivRef<string>('genPhase').value === 'running'" class="seg-field">
        <div class="row between">
          <span class="lbl">分镜粗稿准备中（提示词+低清粗稿——完成后自动开始高清首尾帧，无需操作）</span>
          <span v-if="ivRef<number>('genProgress').value >= 0" class="muted">{{ ivRef<number>('genProgress').value }}%</span>
        </div>
        <div class="iv-bar" :class="{ 'is-indeterminate': ivRef<number>('genProgress').value < 0 }">
          <div v-if="ivRef<number>('genProgress').value >= 0" class="iv-bar-fill" :style="{ width: ivRef<number>('genProgress').value + '%' }"></div>
        </div>
        <div v-if="ivRef<string>('genMessage').value" class="muted">{{ ivRef<string>('genMessage').value }}</div>
      </div>

      <!-- 阶段① 高清首尾帧（进入本步自动流转：粗稿自动确认后自动提交生成，逐镜确认/换帧/重生成） -->
      <div v-if="framesNotStarted" class="row">
        <span class="muted">高清首尾帧将自动开始生成（单镜约 3~7 分钟，完成后逐镜确认）</span>
      </div>
      <div class="row between">
        <span class="sb-info">阶段① 已确认 {{ framesReadyCount }} / {{ generateShotsCount }} 镜——全帧确认后解锁视频生成</span>
        <span class="muted">每帧可手动替换 / 单帧重生成</span>
      </div>
        <!-- 高清精稿生成进度就地带在阶段①头部（2026-10-05 用户报障：进度条在页顶隔着两屏看不见） -->
        <div v-if="ivRef<string>('genPhase').value === 'running' && ivRef<string>('genStage').value === 'frames'" class="seg-field">
          <div class="row between">
            <span class="muted">高清首尾帧生成中（已用时 {{ ivRef<number>('genElapsedSec').value }} 秒，单镜约 3~7 分钟）… 已完成 {{ genResultSummary.done }} 镜、失败 {{ genResultSummary.failed }} 镜</span>
            <span v-if="ivRef<number>('genProgress').value >= 0" class="muted">{{ ivRef<number>('genProgress').value }}%</span>
          </div>
          <div class="iv-bar" :class="{ 'is-indeterminate': ivRef<number>('genProgress').value < 0 }">
            <div v-if="ivRef<number>('genProgress').value >= 0" class="iv-bar-fill" :style="{ width: ivRef<number>('genProgress').value + '%' }"></div>
          </div>
          <div v-if="ivRef<string>('genMessage').value" class="muted">{{ ivRef<string>('genMessage').value }}</div>
        </div>
        <div class="iv-grid">
          <div v-for="(shot, i) in shots.filter((s) => s.source === 'generate')" :key="shot.gen?.name || i" class="iv-shot-card">
            <div class="row">
              <span class="seg-no">#{{ i + 1 }}</span>
              <span class="iv-badge" :class="framesBadgeText(shot) === '帧已确认' ? 'iv-badge--ai' : 'iv-badge--mat'">{{ framesBadgeText(shot) }}</span>
              <span class="muted iv-name">{{ shot.gen?.name }}</span>
            </div>
            <div class="iv-shot-cols">
              <div class="shot-info">
                <div class="seg-head">
                  <label class="seg-field head-field"><span class="lbl">镜别</span><input :value="shot.shot_type" disabled class="input w70" /></label>
                  <label class="seg-field head-field"><span class="lbl">时长(秒)</span><input :value="shot.duration" disabled class="input w60" /></label>
                </div>
                <label class="seg-field"><span class="lbl">画面描述</span><textarea :value="shot.visual" rows="2" readonly disabled class="input carry-textarea" /></label>
                <div v-if="shot.orig_audio" class="sb-line iv-orig">原旁白（拆解稿）：{{ shot.orig_audio }}</div>
                <label class="seg-field"><span class="lbl">旁白（新文案，替换原片文字）</span><textarea :value="shot.audio" rows="1" readonly disabled class="input carry-textarea carry-textarea--sm" /></label>
                <div v-if="qualityLine(shot)" class="sb-line qr-line">质量：{{ qualityLine(shot) }}</div>
                <div v-if="qualityIssueText(shot)" class="sb-line qr-issue">⚠ {{ qualityIssueText(shot) }}</div>
                <div v-if="shot.source === 'generate' && shot.gen" class="row">
                  <label class="seg-field head-field"><span class="lbl">运镜</span>
                    <select :value="shot.gen.camera" disabled class="input w110">
                      <option v-for="c in enums?.cameras || []" :key="c.value" :value="c.value">{{ c.label }}</option>
                    </select>
                  </label>
                  <label class="seg-field head-field"><span class="lbl">保真</span>
                    <select :value="shot.gen.fidelity" disabled class="input w110">
                      <option v-for="f in enums?.fidelity || []" :key="f.value" :value="f.value">{{ f.label }}</option>
                    </select>
                  </label>
                  <label v-for="k in SCENE_ELEMENT_KEYS" :key="k" class="seg-field head-field"><span class="lbl">{{ SCENE_ELEMENT_LABELS[k] || k }}</span>
                    <select :value="(shot.gen.scene || {})[k] ?? ''" disabled class="input w110">
                      <option value="">（未设）</option>
                      <option v-for="o in sceneElementOptions(enums, k as SceneElementKey)" :key="o.value" :value="o.value">{{ o.label }}</option>
                    </select>
                  </label>
                </div>
              </div>
              <div class="shot-frames">
                <div class="iv-frames">
                  <figure class="iv-fig">
                    <button v-if="shot.gen?.first_frame" type="button" class="iv-fig-btn" :title="`${shots.indexOf(shot) + 1} ${shot.gen?.name || ''} 首帧（点击查看全图）`" @click="openLightbox(shot.gen?.name, 'first', shots.indexOf(shot))">
                      <img :src="frameUrl(shot.gen.name, 'first')" alt="首帧" loading="lazy" />
                    </button>
                    <span v-else class="iv-fig-empty">首帧待生成</span>
                    <figcaption>首帧</figcaption>
                  </figure>
                  <figure class="iv-fig">
                    <button v-if="shot.gen?.last_frame" type="button" class="iv-fig-btn" :title="`${shots.indexOf(shot) + 1} ${shot.gen?.name || ''} 尾帧（点击查看全图）`" @click="openLightbox(shot.gen?.name, 'last', shots.indexOf(shot))">
                      <img :src="frameUrl(shot.gen.name, 'last')" alt="尾帧" loading="lazy" />
                    </button>
                    <span v-else class="iv-fig-empty">无尾帧（关键帧交付模式）</span>
                    <figcaption>尾帧</figcaption>
                  </figure>
                </div>
                <div class="row iv-frame-actions">
                  <TButton label="确认本镜" size="small" :disabled="!canConfirmFrames(shot)" :loading="frameConfirming === shot.gen?.name" @click="onConfirmFrame(shots.indexOf(shot))" />
                  <TButton label="换首帧" variant="secondary" size="small" @click="onPickReplaceFrame(shots.indexOf(shot), 'first')" />
                  <TButton label="换尾帧" variant="secondary" size="small" @click="onPickReplaceFrame(shots.indexOf(shot), 'last')" />
                  <TButton label="重生成" variant="secondary" size="small" :loading="regenFrame === shot.gen?.name" @click="onRegenerateFrame(shots.indexOf(shot))" />
                  <TButton :label="shot.badcase ? '坏例已标' : '标坏例'" :variant="shot.badcase ? 'danger' : 'ghost'" size="small"
                    :title="'标注不满意镜头（随脚本保存，供服务端沉淀坏例库）'" @click="emit('toggle-badcase', shots.indexOf(shot))" />
                </div>
              </div>
            </div>
          </div>
        </div>

      <!-- 确认全部分镜（2026-10-05 用户裁决）：独立整行，进度条/note 行随其下 -->
      <div class="iv-confirm-all-row">
        <TButton
          label="确认全部分镜"
          :variant="pendingFramesCount ? 'primary' : 'secondary'"
          style="width: 100%"
          :loading="confirmingAll"
          :disabled="pendingFramesCount === 0"
          :title="pendingFramesCount ? `循环确认 ${pendingFramesCount} 镜已生成帧，一次回读` : '没有待确认的镜帧'"
          @click="confirmAllFrames"
        />
      </div>
      <div v-if="confirmingAll || confirmAllNote" class="seg-field">
        <div class="iv-bar">
          <div class="iv-bar-fill" :style="{ width: confirmAllTotal ? (confirmAllDone / confirmAllTotal) * 100 + '%' : '0%' }"></div>
        </div>
        <div class="muted">{{ confirmAllNote }}（{{ confirmAllDone }}/{{ confirmAllTotal }} 镜）</div>
      </div>

      <div class="row">
        <TButton label="← 上一步" variant="primary" @click="onBack" />
        <span v-if="ivRef<string>('genError').value" class="iv-err">{{ ivRef<string>('genError').value }}</span>
        <span v-if="stageDReady && !sixViewReady" class="muted">产品六视图缺「正面/背面」——回第 2 步槽位「上传」补齐</span>
        <span class="spacer"></span>
        <TButton
          label="下一步：视频生成"
          :loading="!!startVideos"
          :disabled="!stageDReady || !sixViewReady || !!startVideos"
          :title="!stageDReady ? '全部分镜帧确认后解锁' : !sixViewReady ? '产品六视图缺「正面/背面」——回第 2 步槽位「上传」补齐' : ''"
          @click="emit('start-videos')"
        />
      </div>
    </template>

    <!-- ═══ 第 4 步（mode=videos）：逐镜视频生成 + 可选 A-roll ═══ -->
    <template v-else>
      <div class="iv-grid">
        <div v-for="(shot, i) in shots" :key="shot.gen?.name || i" class="iv-shot-card">
          <div class="seg-head">
            <span class="seg-no">#{{ i + 1 }}</span>
            <span class="iv-badge" :class="shotModeBadgeClass(shot, props.iv.referenceMode.value)">{{ shotModeBadgeText(shot, props.iv.referenceMode.value) }}</span>
            <span class="muted iv-name">{{ shot.gen?.name || (shot.source === 'material' ? (isReplaceShot(shot) ? '物品替换' : '实拍') : (shotInReplace(shot, props.iv.referenceMode.value) ? '物品替换' : '')) }}</span>
          </div>
          <div class="iv-shot-cols">
            <!-- 整脚本信息=第 3 步同款只读表单（2026-10-06 用户裁决：第四步脚本和第三步一样） -->
            <div class="shot-info">
              <div class="seg-head">
                <label class="seg-field head-field"><span class="lbl">镜别</span><input :value="shot.shot_type" disabled class="input w70" /></label>
                <label class="seg-field head-field"><span class="lbl">时长(秒)</span><input :value="shot.duration" disabled class="input w60" /></label>
              </div>
              <label class="seg-field"><span class="lbl">画面描述</span><textarea :value="shot.visual" rows="2" readonly disabled class="input carry-textarea" /></label>
              <div v-if="shot.orig_audio" class="sb-line iv-orig">原旁白（拆解稿）：{{ shot.orig_audio }}</div>
              <label class="seg-field"><span class="lbl">旁白（新文案，替换原片文字）</span><textarea :value="shot.audio" rows="1" readonly disabled class="input carry-textarea carry-textarea--sm" /></label>
              <div v-if="qualityLine(shot)" class="sb-line qr-line">质量：{{ qualityLine(shot) }}</div>
              <div v-if="qualityIssueText(shot)" class="sb-line qr-issue">⚠ {{ qualityIssueText(shot) }}</div>
              <div v-if="shot.source === 'generate' && shot.gen" class="row">
                <label class="seg-field head-field"><span class="lbl">运镜</span>
                  <select :value="shot.gen.camera" disabled class="input w110">
                    <option v-for="c in enums?.cameras || []" :key="c.value" :value="c.value">{{ c.label }}</option>
                  </select>
                </label>
                <label class="seg-field head-field"><span class="lbl">保真</span>
                  <select :value="shot.gen.fidelity" disabled class="input w110">
                    <option v-for="f in enums?.fidelity || []" :key="f.value" :value="f.value">{{ f.label }}</option>
                  </select>
                </label>
                <label v-for="k in SCENE_ELEMENT_KEYS" :key="k" class="seg-field head-field"><span class="lbl">{{ SCENE_ELEMENT_LABELS[k] || k }}</span>
                  <select :value="(shot.gen.scene || {})[k] ?? ''" disabled class="input w110">
                    <option value="">（未设）</option>
                    <option v-for="o in sceneElementOptions(enums, k as SceneElementKey)" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </label>
              </div>
            </div>
            <div class="shot-frames">
              <div class="iv-ref-row">
                <figure v-if="replaceMode" class="iv-fig iv-fig--ref">
                  <video v-if="sourceClipSrc(shot)" :src="sourceClipSrc(shot)" controls preload="metadata" class="iv-shot-video" />
                  <span v-else class="iv-fig-empty">原片缺失（脚本无源片引用）</span>
                  <figcaption>原片段{{ shot.gen?.source_start !== undefined ? `（${shot.gen?.source_start}s–${shot.gen?.source_end}s）` : '' }}</figcaption>
                </figure>
                <figure v-else-if="shot.gen?.first_frame" class="iv-fig iv-fig--ref">
                  <img :src="frameUrl(shot.gen?.name, 'first')" alt="关键帧首帧" loading="lazy" />
                  <figcaption>关键帧</figcaption>
                </figure>
                <div class="iv-out-col">
                  <video v-if="shotVideoSrc(shot)" :src="shotVideoSrc(shot)" controls preload="metadata" class="iv-shot-video" />
                  <span v-else class="iv-fig-empty iv-shot-empty">{{ shot.source === 'generate' ? (shotInReplace(shot, props.iv.referenceMode.value) ? '换物视频待生成（服务端按拆解源窗裁原片段走换物引擎，产物回填本镜）' : '视频待生成（生成完成后自动播放）') : (isReplaceShot(shot) ? '换物视频待生成…' : '实拍素材未绑定视频') }}</span>
                </div>
              </div>
              <!-- 降档+重新生成（2026-10-06 用户裁决：位于视频下方；done+failed 都可点=只重出该镜视频不动首尾帧） -->
              <div v-if="shot.source === 'generate' && (shot.gen?.status === 'done' || shot.gen?.status === 'failed')" class="row iv-frame-actions">
                <label class="seg-field head-field"><span class="lbl">降档</span>
                  <select :value="retryFidelity" class="input w110" @change="emit('update:retryFidelity', ($event.target as HTMLSelectElement).value as 'fast' | 'balanced' | 'high')">
                    <option v-for="f in enums?.fidelity || []" :key="f.value" :value="f.value">{{ f.label }}</option>
                  </select>
                </label>
                <TButton label="重新生成" size="small" :loading="retrying === shot.gen?.name" @click="onRetryShot(shots.indexOf(shot))" />
                <TButton :label="shot.badcase ? '坏例已标' : '标坏例'" :variant="shot.badcase ? 'danger' : 'ghost'" size="small"
                  :title="'标注不满意镜头（随脚本保存，供服务端沉淀坏例库）'" @click="emit('toggle-badcase', shots.indexOf(shot))" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- A-roll 卡（可选）：2026-10-08 用户裁决——A-roll 生成暂时禁用（卡片保留、
           交互全关；解禁时删掉各 disabled 与徽标即可恢复） -->
      <div class="seg-card aroll-card">
        <div class="seg-head">
          <span class="seg-no">可选</span>
          <span class="sb-info">A-roll 开场（数字人=人物图+口播音频 / 实拍=已入库素材；依赖第 2 步口播音频先行）</span>
          <span class="iv-badge iv-badge--mat" title="2026-10-08 用户裁决：暂时禁用">暂时禁用</span>
          <span class="spacer"></span>
          <span v-if="arollStatus" class="iv-badge iv-badge--ai">{{ arollStatus }}</span>
          <TButton label="生成 A-roll" :loading="arollBusy === 'aroll'" :disabled="true" title="A-roll 生成暂时禁用" @click="submitAroll" />
        </div>
        <div class="row">
          <label class="seg-field head-field"><span class="lbl">方式</span>
            <select v-model="arollForm.source" class="input w110" disabled>
              <option value="digital_human">数字人</option>
              <option value="material">实拍素材</option>
            </select>
          </label>
          <label v-if="arollForm.source === 'digital_human'" class="seg-field head-field"><span class="lbl">人物图素材 ID</span>
            <input v-model="arollForm.imageMaterialId" class="input w110" placeholder="素材库图片 ID" disabled />
          </label>
          <label v-else class="seg-field head-field"><span class="lbl">A-roll 素材 ID</span>
            <input v-model="arollForm.materialId" class="input w110" placeholder="已入库素材 ID" disabled />
          </label>
        </div>
        <div v-if="ivRef<string>('genPhase').value === 'running' && ivRef<string>('genStage').value === 'aroll'" class="seg-field">
          <div class="row between">
            <span class="muted">A-roll 生成中（已用时 {{ ivRef<number>('genElapsedSec').value }} 秒）…</span>
            <span v-if="ivRef<number>('genProgress').value >= 0" class="muted">{{ ivRef<number>('genProgress').value }}%</span>
          </div>
          <div class="iv-bar" :class="{ 'is-indeterminate': ivRef<number>('genProgress').value < 0 }">
            <div v-if="ivRef<number>('genProgress').value >= 0" class="iv-bar-fill" :style="{ width: ivRef<number>('genProgress').value + '%' }"></div>
          </div>
          <div v-if="ivRef<string>('genMessage').value" class="muted">{{ ivRef<string>('genMessage').value }}</div>
        </div>
        <video v-if="arollPreviewUrl" :src="arollPreviewUrl" controls preload="metadata" class="iv-shot-video" />
      </div>

      <!-- 视频生成进度+状态条（2026-10-15 用户裁决：从页顶移到导航行上方——生成小时级，
           页顶隔着整屏看不见；成功时给出总耗时） -->
      <div class="row between">
        <span class="sb-info">逐镜视频生成（以确认首尾帧为硬约束）</span>
        <span v-if="ivRef<string>('genPhase').value === 'running' && ivRef<string>('genStage').value === 'videos'" class="muted">生成中（小时级，取决于镜数与保真档位）…</span>
        <span v-else-if="ivRef<string>('genPhase').value === 'failed'" class="iv-err">失败：{{ ivRef<string>('genError').value }}</span>
        <span v-else-if="ivRef<string>('genPhase').value === 'done'" class="muted">完成（成功 {{ genResultSummary.done }} 镜<template v-if="genResultSummary.failed">、失败 {{ genResultSummary.failed }} 镜</template>）<template v-if="ivRef<number>('genElapsedSec').value > 0"> · 共用时 {{ fmtElapsed(ivRef<number>('genElapsedSec').value) }}</template></span>
      </div>
      <!-- 视频任务进度（stage=videos 就地；comfygen 逐镜流式计数实时） -->
      <div v-if="ivRef<string>('genPhase').value === 'running' && ivRef<string>('genStage').value === 'videos'" class="seg-field">
        <div class="row between">
          <span class="muted">已用时 {{ ivRef<number>('genElapsedSec').value }} 秒… 已完成 {{ Math.max(liveShots ? liveShots.done : 0, videosDoneCount) }} / {{ liveShots ? liveShots.total : generateShotsCount }} 镜、失败 {{ videosFailedCount }} 镜</span>
          <span v-if="videosBarPct >= 0" class="muted">{{ videosBarPct }}%</span>
        </div>
        <div class="iv-bar" :class="{ 'is-indeterminate': videosBarPct < 0 }">
          <div v-if="videosBarPct >= 0" class="iv-bar-fill" :style="{ width: videosBarPct + '%' }"></div>
        </div>
        <div v-if="ivRef<string>('genMessage').value" class="muted">{{ ivRef<string>('genMessage').value }}</div>
      </div>

      <div class="row">
        <TButton label="← 上一步" variant="primary" @click="onBack" />
        <span class="spacer"></span>
        <TButton
          label="下一步：特效包装"
          :disabled="!doneAll"
          :title="doneAll ? '' : '全部镜头就绪（实拍绑定或 AI 生成完成）后解锁'"
          @click="emit('next-pack')"
        />
      </div>
    </template>

    <!-- 页内灯箱（Teleport to body=逃一切祖先层叠/裁剪——2026-10-06 灯箱死案双保险） -->
    <Teleport to="body">
      <div v-if="lightbox" class="iv-lightbox" @click="lightbox = null">
        <img :src="lightbox.src" :alt="lightbox.caption" />
        <div class="iv-lightbox-caption">{{ lightbox.caption }}（点击任意处关闭）</div>
      </div>
    </Teleport>
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
.qr-line { color: var(--muted-foreground); }
.qr-issue { color: var(--warning, #d97706); }
.iv-err { color: var(--danger, #e74c3c); font-size: 12px; }
.iv-orig { color: var(--muted-foreground); font-style: italic; }
.iv-bar { position: relative; height: 6px; overflow: hidden; background: var(--border); border-radius: 999px; }
.iv-bar-fill { height: 100%; background: var(--primary); border-radius: 999px; transition: width 0.6s ease; }
.iv-bar.is-indeterminate::after { content: ''; position: absolute; inset: 0; width: 40%; background: var(--primary); border-radius: 999px; animation: iv-indeterminate 1.2s ease-in-out infinite; }
@keyframes iv-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }
.w70 { width: 90px; } .w60 { width: 64px; } .w110 { width: 130px; }

.seg-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md); }
.seg-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.seg-no { font-weight: 700; color: var(--primary); }
.seg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.seg-field.head-field { flex: 0 0 auto; flex-direction: row; align-items: center; gap: 6px; }
.seg-field .lbl { font-size: 12px; color: var(--muted-foreground); flex: none; }
.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }
.input:focus { border-color: var(--primary); }
.carry-textarea { height: auto; min-height: 72px; padding: 8px 10px; line-height: 1.6; font-family: inherit; resize: vertical; }
.carry-textarea--sm { min-height: 48px; }

.iv-badge { padding: 1px 8px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 600; }
.iv-badge--ai { color: #2ecc71; background: rgba(46, 204, 113, 0.12); }
.iv-badge--mat { color: var(--muted-foreground); background: var(--surface-container); }
.iv-badge--fail { color: #e74c3c; background: rgba(231, 76, 60, 0.12); }

/* 一个镜头一行（2026-10-06 用户裁决）：卡内保持信息左/帧右两栏 */
.iv-grid { display: flex; flex-direction: column; gap: 10px; }
.iv-shot-card { display: flex; flex-direction: column; gap: 8px; padding: 10px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md); }
.iv-shot-cols { display: flex; gap: 10px; align-items: stretch; }
.shot-info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.shot-frames { flex: 0 0 276px; display: flex; flex-direction: column; gap: 6px; }
/* 左参考右产物双栏（2026-10-12 裁决：换物=原片段|换物产物，其它=关键帧|生成镜头） */
.iv-ref-row { display: flex; gap: 6px; align-items: flex-start; }
.iv-fig--ref { width: 135px; flex: 0 0 135px; }
.iv-fig--ref .iv-shot-video { width: 135px; height: 240px; object-fit: cover; }
.iv-out-col { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; }
.iv-ref-row .iv-shot-video { max-width: 135px; }
.iv-name { font-family: monospace; }
/* 首尾帧/分镜视频高度统一 240px（2026-10-06 用户裁决；9:16 → 135×240） */
.iv-frames { display: grid; grid-template-columns: repeat(2, 135px); gap: 6px; }
.iv-fig { display: flex; flex-direction: column; gap: 4px; margin: 0; }
.iv-fig img { width: 135px; height: 240px; object-fit: cover; border-radius: var(--radius-sm);
  background: #101010; display: block; }
.iv-fig-empty { display: flex; align-items: center; justify-content: center; width: 135px; height: 240px;
  background: #101010; color: var(--muted-foreground); font-size: 11px; border-radius: var(--radius-sm); }
.iv-fig figcaption { font-size: 11px; color: var(--muted-foreground); text-align: center; }
.iv-frame-actions { gap: 6px; }
/* 灯箱入口=真实按钮元素包图（2026-10-06 灯箱死案复发：裸 img 原生点击在宿主不触发；
   img 禁用指针事件=事件必达包裹按钮），层级 2000 压过全部弹层 */
.iv-fig-btn { display: block; padding: 0; border: none; background: none; cursor: zoom-in; }
.iv-fig-btn img { pointer-events: none; }
.iv-zoomable { cursor: zoom-in; }

.iv-shot-video { height: 240px; width: auto; max-width: 100%; background: #101010;
  border-radius: var(--radius-sm); display: block; }
.iv-shot-empty { width: 135px; height: 240px; }
.iv-confirm-all-row { width: 100%; }
.aroll-card { border-style: dashed; }

.iv-lightbox { position: fixed; inset: 0; z-index: 2000; background: rgba(0, 0, 0, 0.78);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: zoom-out; }
.iv-lightbox img { max-width: 92vw; max-height: 82vh; border-radius: var(--radius-md); }
.iv-lightbox-caption { color: #fff; font-size: 12px; }
</style>
