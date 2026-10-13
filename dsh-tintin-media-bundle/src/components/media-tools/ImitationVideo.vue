<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// ImitationVideo.vue — 仿爆款视频向导（PRD-M-5 · V3.5 客户端 UI）
// 步骤结构=六步（2026-10-02/03 用户裁决定稿）：
//   1 视频拆解 → 2 生成脚本(HumanGate①) → 3 分镜头确认(HumanGate②)
//   → 4 视频生成 → 5 包装特效(HumanGate③) → 6 交付
// 第 1 步自持拆解交互，拆为 ImitationSourceStep 子组件（铁律 4 千行红线拆分，
// 逐符号纯搬迁）；本壳保留步序/脚本数据/第 2-6 步。
// 整体方案与文案混剪对应（§5.3 原则）：同卡片/步骤条/镜头卡视觉形态与交互惯例；
// 审核页不复用 CopywritingStoryboard（深耦合文案线 inject shell），按同形态自持数据。
// 编排=useImitationVideo（runner）；纯逻辑=imitationVideoLogic（可单测）。
// 待服务端契约项（显式占位不发明）：A-roll 数字人人物图上传通道、细化批注
// 映射层端点、草稿链直提（storyboard_montage 走文案线现有入口）。
// ═══════════════════════════════════════════════════════════════
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import VdStepBar from '@/components/media-tools/VdStepBar.vue'
import ImitationSourceStep from '@/components/media-tools/ImitationSourceStep.vue'
import WbPickProductDialog from '@/components/workbench/WbPickProductDialog.vue'
import VoiceoverPickerDialog from '@/components/media-tools/VoiceoverPickerDialog.vue'
import VoiceCloneParamsDialog from '@/components/media-tools/VoiceCloneParamsDialog.vue'
import ImitationGenSteps from '@/components/media-tools/ImitationGenSteps.vue'
import MaterialImagePickerDialog from '@/components/media-tools/MaterialImagePickerDialog.vue'
import WbPickMaterialDialog from '@/components/workbench/WbPickMaterialDialog.vue'
import ImitationMontageStep from './ImitationMontageStep.vue'
import ImitationFxStep from './ImitationFxStep.vue'
import { useImitationTts } from '@/composables/useImitationTts'
import { toFileUrl } from '@/utils/fileUrl'
import { readCacheDir } from '@/composables/useSettingsConfig'
import { joinPath } from '@/composables/copywritingMontage/context'
import { fmtDur } from '@/composables/copywritingMontageStep3VoiceLogic'
import TSelect from '@/components/common/TSelect.vue'
import { createMontageSharedRuntime } from '@/composables/copywritingMontage/context'
import { useImitationVideo } from '@/composables/useImitationVideo'
import { useImitationMontage } from '@/composables/useImitationMontage'
import type { PickerItem } from '@/composables/useWorkbenchPickers'
import { buildMediaServeUrl, buildMediaThumbUrl } from '@/composables/workbenchChatContext'
import { productSixViewSlots, productViewLabel } from '@/composables/opsProductLibraryLogic'
import { clientError } from '@/utils/clientLog'
import { API_PATHS } from '@/types/server-api'
import { voiceoverCandidatesFromResponse } from '@/composables/copywritingMontageStep2ConcatLogic'
import type { VoiceoverCandidate } from '@/composables/copywritingMontageStep2ConcatLogic'
import {
  SCENE_ELEMENT_KEYS,
  canConfirmFrames,
  buildScriptPutPayload,
  enumLabel,
  framesBadgeText,
  arollPreviewUrlFrom,
  disableShotReplaceItem,
  enableShotReplaceItem,
  isReplaceShot,
  isStageDReady,
  preserveProductSelectionOnReload,
  productChipLabel,
  shotInReplace,
  shotModeBadgeClass,
  shotModeBadgeText,
  sceneElementOptions,
  shotsTotalDuration,
  storyboardGridUrlFrom,
  type GenerateStage,
  type ImitationShot,
  type QualityReport,
  type SceneElementKey,
} from '@/composables/imitationVideoLogic'

const STEPS = ['1. 视频拆解', '2. 生成脚本', '3. 分镜头确认', '4. 视频生成', '5. 包装特效', '6. 交付']

/** 场景要素键 → 中文标签（展示层专用；数据面键名/枚举值仍按契约英文） */
const SCENE_ELEMENT_LABELS: Record<string, string> = {
  surface: '台面',
  environment: '环境',
  lighting: '光照',
  style: '风格',
  composition: '构图',
}

const iv = useImitationVideo()
const { ivPlatformOptions, ivPlatform } = iv
const { ensureServerUrl, toAbsolute } = createMontageSharedRuntime()

const step = ref(1)
const record = ref<Record<string, unknown> | null>(null)
/** shots 仅接受数组（2026-10-11：服务端曾把 shots 写成键控对象致整页白屏，入口强制数组化） */
const shots = computed<ImitationShot[]>(() => (Array.isArray(record.value?.shots) ? (record.value.shots as ImitationShot[]) : []))
const scriptId = computed(() => iv.scriptId.value || String(record.value?.id || ''))

async function reloadScript(): Promise<void> {
  if (!scriptId.value) return
  const data = await iv.loadScript(scriptId.value)
  if (data) {
    if (data && typeof data === 'object' && !Array.isArray((data as Record<string, unknown>).shots)) {
      ;(data as Record<string, unknown>).shots = [] // 服务端异常写入（键控对象）防御：强制数组化
    }
    // 产品选择内存优先（2026-10-12 裁决：未落库期间回读不冲 chip 与六视图绑定）
    preserveProductSelectionOnReload(record.value, data as Record<string, unknown>, productSelectionDirty.value)
    record.value = data
    void iv.loadStoryboardPack(scriptId.value)
    seedOrigAudio()
    seedOrigVoiceover()
    // 六视图槽位回填（2026-10-11：productSixViews 仅点选产品时拉取，重开页面=全空
    // 且闸门恒拦——product_id 随 meta 持久化，加载后按它自动回填）
    const pid = String(imitateMeta.value.product_id ?? '')
    if (productPicked() && pid) void populateFromProductSixViews(pid)
  }
}

/** 每镜固化原片旁白参考（orig_audio 随脚本透传）：原片切片留档对照，shot.audio=新文案 */
function seedOrigAudio(): void {
  for (const s of shots.value) {
    if (s.orig_audio === undefined || s.orig_audio === '') s.orig_audio = String(s.audio ?? '')
  }
}

/** 拆解文案固化（orig_voiceover）：首载拷入原片口播转写（两套文案分离裁决） */
const origVoiceoverText = computed(() => {
  const imitate = (record.value?.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown> | undefined
  return String(imitate?.orig_voiceover ?? '')
})
/** 会话级采纳标记（record 内标记会被 adoptCopy 回读覆盖——2026-10-11 误归档事故根因） */
const copyAdoptedSession = ref(false)
/** 转写一致性校验（剥标点空白）：仅 voiceover=各镜 orig 拼接才可归档——内容层杜绝误归档 */
function matchesShotTranscription(voiceover: string, list: ImitationShot[]): boolean {
  const norm = (s: string): string => String(s || '').replace(/[^\p{L}\p{N}]/gu, '')
  const v = norm(voiceover)
  if (!v) return false
  const concat = list.map((x) => norm(String(x.orig_audio ?? ''))).join('')
  if (!concat) return false
  return v.includes(concat) || concat.includes(v)
}
function seedOrigVoiceover(): void {
  if (!record.value) return
  if (copyAdoptedSession.value) return // 本会话已采纳：固化彻底停用
  const imitate = { ...(((record.value.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown>) ?? {}) }
  if (imitate.orig_seeded === true || imitate.copy_adopted === true) return
  const vo = String(imitate.voiceover ?? '')
  const origExisting = String(imitate.orig_voiceover ?? '')
  // 归档仅限可证明的拆解转写（无转写视频=不归档不清空，脚本文案原样保留）
  const archive = !origExisting && !!vo && matchesShotTranscription(vo, shots.value)
  imitate.orig_seeded = true
  writeImitateMeta({ orig_voiceover: archive ? vo : origExisting, voiceover: archive ? '' : vo, orig_seeded: true })
}

onMounted(() => {
  void iv.loadEnums()
  void ensureServerUrl()
  void ivTts.loadVoiceSamples()
  void iv.loadIvPlatforms()
})

// ── 产品选择（WbPickProductDialog 单选；写 products 随 PUT 保存，§5.1-2）──
const productPickVisible = ref(false)
/** 产品 chip 只认用户主动选择（自动提取的 products=探测参考不得冒充），持久化 product_selected */
function productPicked(): boolean {
  const imitate = (record.value?.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown> | undefined
  return imitate?.product_selected === true
}
function productLabel(): string { return productChipLabel(record.value?.products, productPicked()) }
function onProductPick(item: PickerItem): void {
  if (!record.value) return
  record.value.products = [{
    brand: String(item.brand || ''),
    model: String(item.model || ''),
    category: String(item.category || ''),
    name: String(item.name || item.model || ''),
  }]
  writeImitateMeta({ product_selected: true, product_id: String(item.id ?? '') })
  productSelectionDirty.value = true
  // 选品即保存（2026-10-11 报障）；失败只亮红字+补发按钮（2026-10-12 裁决：接口失败不冲六视图）
  void populateFromProductSixViews(String(item.id ?? '')).then(() => saveScript()).then((ok) => { if (!ok) productImgNote.value = PRODUCT_SAVE_FAIL_NOTE })
}
function clearScriptProduct(): void {
  if (!record.value) return
  record.value.products = []
  writeImitateMeta({ product_selected: false })
  productSelectionDirty.value = true // 未落库期间回读不得把服务端残留绑定带回（清品即保存随下一次保存落库）
  void iv.refreshProductSixViews('') // 清产品=清空六视图槽位与直传 meta
  clearProductImages()
}

// ── 产品图（选完产品即带出六视图；product_images=生成任务直传，服务端产品锚定 ≤6 张）──
const { serverUrl: ivServerUrl } = createMontageSharedRuntime()
/** 六视图带出状态（无视图/读取失败提示；选择产品时刷新） */
const productImgNote = ref('')
const PRODUCT_SAVE_FAIL_NOTE = '产品选择暂存失败——等待重试或点「重试补发」，无需重新选品'
/** 选品/清品尚未落库标记：回读保留依据；saveScript 成功即解除（2026-10-12 裁决） */
const productSelectionDirty = ref(false)
/** 保存失败态=红字即按钮（派生，成功清红字自动熄） */
const productSavePending = computed(() => productImgNote.value === PRODUCT_SAVE_FAIL_NOTE)
/** meta.imitate 局部写入（product_images/product_selected 等选择态统一收口） */
function writeImitateMeta(patch: Record<string, unknown>): void {
  if (!record.value) return
  const meta = { ...((record.value.meta as Record<string, unknown>) ?? {}) }
  meta.imitate = { ...((meta.imitate as Record<string, unknown>) ?? {}), ...patch }
  record.value.meta = meta
}

const imitateMeta = computed<Record<string, unknown>>(() => {
  const meta = record.value?.meta as Record<string, unknown> | undefined
  return ((meta?.imitate as Record<string, unknown>) ?? {})
})
const productImages = computed<string[]>(() => { const a = imitateMeta.value.product_images; return Array.isArray(a) ? a.map(String).filter(Boolean) : [] })
/** 换物左栏参考=原片（meta.imitate.source_material_id；片段化由子组件按 gen 源窗 #t= 截取） */
const sourceClipVideoUrl = computed(() => { const mid = imitateMeta.value.source_material_id; return mid ? buildMediaServeUrl(ivServerUrl.value, mid) : '' })
const productImageIds = computed<string[]>(() => { const a = imitateMeta.value.product_image_ids; return Array.isArray(a) ? a.map(String).filter(Boolean) : [] })
/** 产品六视图→产品图（槽位化=产品资料同款；顶部视图必填；直传 meta 随脚本保存） */
async function populateFromProductSixViews(itemId: string): Promise<void> {
  if (!itemId) return
  try {
    const views = await iv.refreshProductSixViews(itemId)
    if (!views.length) {
      clearProductImages()
      productImgNote.value = '该产品暂无六视图——在下方槽位「上传」补图（至少顶部视图）后即可继续'
      return
    }
    writeImitateMeta({
      product_images: views.map((e) => buildMediaServeUrl(ivServerUrl.value, e.materialId)),
      product_image_ids: views.map((e) => e.materialId),
      product_image_names: views.map((e) => productViewLabel(e.view)),
    })
    productImgNote.value = ''
  } catch (e) {
    productImgNote.value = `产品六视图读取失败：${(e as Error)?.message || e}`
  }
}
function clearProductImages(): void {
  writeImitateMeta({ product_images: [], product_image_names: [], product_image_ids: [] })
  productImgNote.value = ''
}
/** 六视图槽位上传/删除（上传弹「选择产品图」双 tab；绑定走 views 端点纯替换+回读刷新） */
const productSixSlots = computed(() => productSixViewSlots(iv.productSixViews.value))
const productSixFilledCount = computed(() => productSixSlots.value.filter((s) => s.entry).length)
const sixPendingView = ref('')
const sixBinding = ref(false)
/** 槽位写忙=绑定端点上传中 或 库选图取字节中 */
const sixBusy = computed(() => iv.productSixBusy.value || sixBinding.value)
const sixPickOpen = ref(false)
function onSixUpload(view: string): void {
  sixPendingView.value = view
  sixPickOpen.value = true
}
/** 库选图→绑定：渲染层取 /material/serve 字节组 File 走绑定端点（纯替换） */
async function onPickerPick(payload: { materialId?: string; file?: File; name: string }): Promise<void> {
  sixPickOpen.value = false
  const view = sixPendingView.value
  const itemId = iv.currentProductId.value
  if (!view || !itemId) return
  sixBinding.value = true
  productImgNote.value = ''
  try {
    let file = payload.file
    if (!file && payload.materialId) {
      const r = await fetch(buildMediaServeUrl(ivServerUrl.value, payload.materialId))
      if (!r.ok) throw new Error(`读取产品图失败（HTTP ${r.status}）`)
      file = new File([await r.blob()], payload.name || `${view}.png`, { type: r.headers.get('content-type') || 'image/png' })
    }
    if (!file) throw new Error('未取得图片数据')
    if (!(await iv.uploadProductSixView(itemId, view, file))) throw new Error('上传失败')
    await populateFromProductSixViews(itemId)
  } catch (e) {
    productImgNote.value = `选用产品图失败：${(e as Error)?.message || e}——可改用弹窗「本地上传」重试`
  } finally {
    sixBinding.value = false
  }
}
function onDeleteProductView(view: string, label: string): void {
  const itemId = iv.currentProductId.value
  if (!itemId) return
  if (window.confirm(`确定删除「${label}」视图吗？顶部视图是下一步的必备视图。`)) {
    void iv.deleteProductSixView(itemId, view).then((ok) => { if (ok) void populateFromProductSixViews(itemId) })
  }
}
// ── A-roll 阶段③（数字人=人物图+口播音频/实拍=素材 id；aroll 块先 PUT 配置再提任务）──
const arollBusy = ref('')
const arollConfig = computed(() => { const a = (record.value?.aroll as Record<string, unknown> | undefined) || {}; return { source: String(a.source || ''), imageMaterialId: String(a.image_material_id || ''), materialId: String(a.material_id || '') } })
/** A-roll 产物预览（material_id 回填后 /material/serve 流式）；九宫图总览（v4.7 meta 引用） */
const arollPreviewUrl = computed(() => toAbsolute(arollPreviewUrlFrom(arollConfig.value.materialId))); const storyboardGridUrl = computed(() => { const u = storyboardGridUrlFrom(record.value?.meta, scriptId.value); return u ? toAbsolute(`${u}?v=${Number(record.value?.version) || 0}`) : '' })
async function generateAroll(config: { source: string; imageMaterialId: string; materialId: string }): Promise<void> {
  if (arollBusy.value || !record.value) return
  const bad = !record.value.voice_audio_id ? '请先在第 2 步「生成口播配音」并绑定口播音频（A-roll 依赖口播音频先行）。'
    : config.source === 'digital_human' && !config.imageMaterialId.trim() ? '数字人方式需要先填「人物图素材 ID」（素材库图片）。'
    : config.source === 'material' && !config.materialId.trim() ? '实拍方式需要填「A-roll 素材 ID」（已入库素材）。' : ''
  if (bad) { notify('无法生成 A-roll', bad); return }
  arollBusy.value = 'aroll'
  try {
    const a = (record.value.aroll as Record<string, unknown>) ?? {}
    record.value.aroll = { ...a, source: config.source, image_material_id: Number(config.imageMaterialId) || 0, material_id: Number(config.materialId) || 0 }
    if (!(await saveScript())) return
    const ok = await iv.submitGenerate({
      scriptId: scriptId.value, stage: 'aroll',
      arollMaterialId: config.source === 'material' ? Number(config.materialId) || undefined : undefined,
      arollImage: config.source === 'digital_human' && config.imageMaterialId.trim() ? `material://${config.imageMaterialId.trim()}` : undefined,
    }, shots.value)
    if (ok) notify('A-roll 已提交', '素材生成任务已提交（stage=aroll），完成后可重新生成或继续后续阶段。')
  } catch (e) {
    clientError('imitation-video', 'A-roll 生成提交失败', e)
    notify('提交失败', (e as Error).message)
  } finally {
    arollBusy.value = ''
  }
}

/** 时长展示格式化：一位小数、去尾零（浮点噪声修复 2026-10-03） */

/** 整体提示词（meta.prompt_en，服务端映射层自动生成：从逐镜 scene 枚举统计主导
 *  风格组装整片创作方向；随脚本保存，只读展示为"整体方向卡"——2026-10-03 实证） */
const overallPromptEn = computed(() => {
  const meta = record.value?.meta as Record<string, unknown> | undefined
  const v = meta?.prompt_en
  return typeof v === 'string' ? v.trim() : ''
})

// ── 口播文案（脚本主稿）：Part 1 拆解稿在 meta.imitate.voiceover；「重新生成文案」
//    走 /copywriting/voiceover（product_desc 必填=选中产品，duration_s=镜头轨总长）；
//    随脚本保存（ScriptIn.meta 透传）──
const voiceoverText = computed({
  get: () => String(((record.value?.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown> | undefined)?.voiceover ?? ''),
  set: (v: string) => {
    if (!record.value) return
    const meta = { ...((record.value.meta as Record<string, unknown>) ?? {}) }
    meta.imitate = { ...((meta.imitate as Record<string, unknown>) ?? {}), voiceover: v }
    record.value.meta = meta
  },
})

const regenBusy = ref(false)
const regenError = ref('')
const regenWarn = ref('')
/** 逐镜脚本卡显示门（2026-10-12 用户裁决：第 2 步进入时未生成新文案前不显示——
 *  恢复的脚本自带拆解 shots，直接铺开会盖住选品/文案主流程；「重新生成仿写文案」
 *  采纳成功后才显示，此后会话内保持显示） */
const shotsRevealed = ref(false)
/** 口播语速基准（字/秒，服务端统一口径=6） */
const VOICEOVER_CPS = 6

/** 脚本文案字数/口播时长（2026-10-06 用户裁决：标签行右侧显示；随编辑实时，语速基准同上） */
const voiceoverChars = computed(() => voiceoverText.value.replace(/\s/g, '').length)
const voiceoverEstSec = computed(() => Math.round(voiceoverChars.value / VOICEOVER_CPS))

// ── 十稿挑选（2026-10-03 用户裁决：仿写文案对齐文案混剪——返回约 10 种写法，
//    默认选中第一种，点卡片切换、确定后写入脚本文案框；单稿形态免弹窗直采）──
const voiceoverCandidates = ref<VoiceoverCandidate[]>([])
const voiceoverFailedFormulas = ref<string[]>([])
const voiceoverDlgOpen = ref(false)
const voiceoverSelectedIdx = ref(0)
function closeVoiceoverDlg(): void { voiceoverDlgOpen.value = false }
function confirmVoiceoverCandidate(): void {
  const c = voiceoverCandidates.value[voiceoverSelectedIdx.value]
  if (c) adoptVoiceoverText(c.text)
}

async function adoptVoiceoverText(text: string): Promise<void> {
  copyAdoptedSession.value = true
  voiceoverDlgOpen.value = false
  voiceoverText.value = text
  regenError.value = ''
  writeImitateMeta({ copy_adopted: true }) // 采纳标记：固化不得再把主稿归档进拆解文案
  // 旧口播配音随旧文案作废（2026-10-08 用户裁决：重新仿写后原配音不可用）——
  // 清结果行+解绑 voice_audio_id（A-roll 依赖口播音频，须按新文案重出后再绑定）
  const hadAudio = !!ttsAudioUrl.value || !!record.value?.voice_audio_id
  if (hadAudio && record.value) {
    ttsAudioUrl.value = ''
    ttsSampleLabel.value = ''
    ttsDurSec.value = 0
    ttsBindNote.value = ''
    record.value.voice_audio_id = 0
    record.value.voice_dur_sec = 0
  }
  const dur = shotsTotalDuration(shots.value)
  const targetChars = Math.round(dur * VOICEOVER_CPS)
  const chars = text.replace(/\s/g, '').length
  if (targetChars > 0 && Math.abs(chars - targetChars) / targetChars > 0.3) {
    regenWarn.value = `生成了 ${chars} 字，按 ${Math.round(dur)} 秒口播应约 ${targetChars} 字——偏差偏大，建议重试或直接编辑`
    clientError('imitation-video', regenWarn.value, { chars, targetChars, dur })
  }
  // 采纳=adopt-copy 单接口（主稿落库在服务端内完成），不再前置 saveScript（PUT 写路径
  // 曾间歇挂起致链路首步即断）；旧配音解绑改采纳后 best-effort 落库
  const adopted = await adoptCopy(text)
  if (hadAudio) {
    const prev = distributeNote.value ? distributeNote.value + '；' : ''
    distributeNote.value = prev + '旧口播配音已随旧文案失效解绑——请重新「生成口播配音」（旧音频仍留在音频库）'
  }
  if (!adopted) return
  shotsRevealed.value = true // 新文案已采纳——第 2 步逐镜脚本卡自此显示（进入门）
  // 服务端 adopt-copy 曾丢 meta.imitate（产品/主稿）：采纳后补一次全量保存自愈
  if (!(await saveScript())) {
    distributeError.value = '文案已采纳，但补存脚本失败——产品选择/脚本文案可能未持久化，建议稍后重新采纳或手动保存'
  }
  if (hadAudio) {
    const prev = distributeNote.value ? distributeNote.value + '；' : ''
    distributeNote.value = prev + '旧口播配音已随旧文案失效解绑——请重新「生成口播配音」（旧音频仍留在音频库）'
  }
}

/** 保存修改文案（2026-10-12 用户裁决）：手编脚本文案后重新采纳分发——复用
 *  adoptVoiceoverText 的完整采纳链（adopt-copy 单接口：服务端按新主稿重铺逐镜
 *  旁白/重写画面描述+解绑旧配音+落库），与「重新生成仿写文案」的采纳同一条
 *  服务端处理，无新增服务端改动；完成后逐镜脚本卡回填新分配结果。 */
const savingCopyBusy = ref(false)
async function saveEditedVoiceover(): Promise<void> {
  if (savingCopyBusy.value || distributeBusy.value) return
  const text = voiceoverText.value.trim()
  if (!text) {
    regenError.value = '脚本文案为空——请先填写内容再保存'
    return
  }
  savingCopyBusy.value = true
  regenError.value = ''
  try {
    await adoptVoiceoverText(text)
  } catch (e) {
    regenError.value = `保存失败：${(e as Error).message}`
    clientError('imitation-video', regenError.value, e)
  } finally {
    savingCopyBusy.value = false
  }
}

async function regenerateVoiceover(): Promise<void> {
  const p = (record.value?.products as Array<Record<string, unknown>> | undefined)?.[0]
  if (!p) {
    regenError.value = '请先「选择产品」——文案按产品信息重写（product_desc 必填）'
    return
  }
  regenBusy.value = true
  regenError.value = ''
  regenWarn.value = ''
  try {
    const productDesc = [p.brand, p.model || p.name, p.category].filter(Boolean).map(String).join(' / ')
    const dur = shotsTotalDuration(shots.value)
    const targetChars = Math.round(dur * VOICEOVER_CPS)
    const resp = (await window.tintin.server.post(API_PATHS.copywriting.voiceover, {
      ...(scriptId.value ? { script_id: scriptId.value } : {}), // 服务端 1012：带上即按脚本 reference_mode=video_replace 自动挂 video-copy-imitation skill
      product_desc: productDesc,
      duration_s: dur,
      platform: ivPlatform.value,
      hint: `电商口播，节奏贴近原片，句子完整不拆行；全文约 ${targetChars} 字（对应 ${Math.round(dur)} 秒口播），口语化带货风格`,
    })) as Record<string, unknown> | null
    // 十稿全量（formula 缺省=约 10 种写法）/单稿双形态归一；空响应按实得键名报错
    const parsed = voiceoverCandidatesFromResponse(resp)
    if (!parsed.candidates.length) {
      const keys = resp ? Object.keys(resp).join(',') : 'null'
      regenError.value = `文案生成响应无可用文稿（实得字段：${keys}）`
      clientError('imitation-video', regenError.value, { resp })
      return
    }
    if (parsed.single || parsed.candidates.length === 1) {
      adoptVoiceoverText(parsed.candidates[0]!.text)
      return
    }
    voiceoverCandidates.value = parsed.candidates
    voiceoverFailedFormulas.value = parsed.failedFormulas
    voiceoverSelectedIdx.value = 0
    voiceoverDlgOpen.value = true
  } catch (e) {
    regenError.value = `文案生成失败：${(e as Error).message}`
    clientError('imitation-video', regenError.value, e)
  } finally {
    regenBusy.value = false
  }
}

// ── 口播配音（2026-10-03 用户裁决：功能点与文案混剪 Step3 一样实现——参考声音
//    下拉/试听/设置声音克隆（参数随请求）/上传新样本/TTS resp json+600s 超时，
//    状态与调用收口 useImitationTts）──
const ivTts = useImitationTts({ getTargetDuration: () => shotsTotalDuration(shots.value), getScriptId: () => scriptId.value, saveScript, reloadScript })
const {
  TTS_ENGINE_OPTIONS, TTS_EMO_OPTIONS,
  ttsEngineSel, voiceSamples, voiceSamplesError, selectedSampleKey, sampleOptions, samplePreviewUrl,
  loadVoiceSamples,
  ttsFactor, ttsEmoText, ttsEmoAlpha, qwen3Speaker, qwen3Instruct, qwen3Voices, qwen3VoicesLoading,
  cloneParamsDlg, openCloneParams, closeCloneParams, saveCloneParams,
  distributeNote, distributeBusy, distributeError, adoptCopy, rewriteBusy,
} = ivTts

const ttsBusy = ref(false)
const ttsError = ref('')
const ttsAudioUrl = ref('')
const ttsBindNote = ref('')

const ttsSampleLabel = ref('')   // 结果行名称=所选参考声音（对齐文案混剪结果行"名称+播放条+时长"）
const ttsDurSec = ref(0)         // 播放器 loadedmetadata 采集的实际时长
const ttsDurText = computed(() => (ttsDurSec.value > 0 ? fmtDur(ttsDurSec.value) : '--:--'))
function onTtsMeta(e: Event): void {
  const d = (e.target as HTMLAudioElement).duration
  ttsDurSec.value = Number.isFinite(d) ? d : 0
}
async function generateVoiceAudio(): Promise<void> {
  const text = voiceoverText.value.trim()
  if (!text) {
    ttsError.value = '口播文案为空：先拆解或「重新生成文案」'
    return
  }
  // 2026-10-06 用户裁决：未选样本直接提示、不发请求（Base 未选样本选项已退役；
  // voxcpm 无参考音频服务端必 400）
  if (!selectedSampleKey.value) {
    ttsError.value = '没有可用的参考声音样本——请先在「参考声音」下拉选择样本（样本在声音克隆页上传维护）'
    return
  }
  ttsBusy.value = true
  ttsError.value = ''
  try {
    // 2026-10-06 用户裁决（推翻 1003「单条 TTS+URL 试听」旧口径）：与文案混剪声音克隆
    // 完全同通道（voiceCloneBatch）——主进程克隆+服务端 whisperx 对齐，产物=wav +
    // <wav>.timing.json + <wav>.aligned.srt（字幕单一来源=服务端，fx 导出链恰在此查
    // sidecar）。outWavPath=口播库恢复同款稳定路径 voice_script_<scriptId>.wav：
    // fx 面板装载后 sidecar 必在 wav 旁边，字幕轨不再缺失。
    const cacheDir = await readCacheDir()
    if (!cacheDir) throw new Error('本地缓存目录不可用，请重启应用后重试')
    const stableId = (scriptId.value || 'tmp').replace(/[^\w.-]/g, '_')
    const outWavPath = joinPath(cacheDir, 'copy-montage', 'voice', `voice_script_${stableId}.wav`)
    const key = 'iv_voice_1'
    const res = await window.tintin.server.voiceCloneBatch({
      tasks: [{ rowIdx: 0, text, videoPath: key, outWavPath }],
      refAudioPath: '',
      apiUrl: toAbsolute(API_PATHS.tts),
      speedMin: 0.9,
      speedMax: 1.2,
      sampleId: Number(selectedSampleKey.value) || 0,
      refAudioUrl: voiceSamples.value.find((s) => String(s.id) === selectedSampleKey.value)?.url || '',
      engine: ttsEngineSel.value,
      ttsParams: {
        durationFactor: ttsFactor.value,
        emoText: ttsEmoText.value,
        emoAlpha: ttsEmoAlpha.value,
        speaker: qwen3Speaker.value,
        instruct: qwen3Instruct.value,
      },
    })
    if (!res) throw new Error('主进程不可达')
    if ('error' in res) throw new Error(res.error)
    const wav = res.results[key]
    if (!wav) throw new Error('克隆完成但响应缺 wav 路径')
    // 试听=本地 wav 直播（fileUrl）；时长用克隆产物实测
    ttsAudioUrl.value = toFileUrl(wav)
    ttsSampleLabel.value = sampleOptions.value.find((o) => o.value === selectedSampleKey.value)?.label || '口播配音'
    ttsDurSec.value = Number(res.durations[key]) || 0
    // 入库绑定（不变：上传音频库→脚本带 voice_audio_id，草稿链按 id 恢复口播）
    try {
      const up = (await window.tintin.server.audioLibraryUpload({ filePath: wav, category: '口播' })) as Record<string, unknown> | null
      const audioId = Number(up?.id)
      if (Number.isInteger(audioId) && audioId > 0 && record.value) {
        record.value.voice_audio_id = audioId
        record.value.voice_dur_sec = ttsDurSec.value || shotsTotalDuration(shots.value)
        await saveScript()
        ttsBindNote.value = `配音已入库（audio_id=${audioId}）并绑定脚本口播轨`
      } else {
        const keys = up ? Object.keys(up).join(',') : 'null'
        ttsBindNote.value = `配音已生成（可试听）；入库响应缺 id（实得字段：${keys}），绑定待重试`
        clientError('imitation-video', `音频入库响应缺 id（实得字段：${keys}）`, { up })
      }
    } catch (bindErr) {
      // 入库失败不阻断试听——文案仍可继续；绑定可重试（如实提示，不静默）
      ttsBindNote.value = `配音已生成（可试听）；入库绑定失败：${(bindErr as Error).message}——可重新生成重试`
      clientError('imitation-video', ttsBindNote.value, bindErr)
    }
  } catch (e) {
    ttsError.value = `配音生成失败：${(e as Error).message}`
    clientError('imitation-video', ttsError.value, e)
  } finally {
    ttsBusy.value = false
  }
}

function goBack(): void {
  step.value = Math.max(1, step.value - 1)
}

/** 重新走一遍：清选择与脚本态，停留在第 1 步 */
function resetFlow(): void {
  montage.stopPolling()
  montage.montagePhase.value = ''
  montage.montageTaskId.value = ''
  montage.montageError.value = ''
  montage.exportNote.value = ''
  record.value = null
  iv.part1Phase.value = ''
  iv.part1Note.value = ''
  iv.part1Error.value = ''
  iv.genPhase.value = ''
  iv.genError.value = ''
  iv.genResult.value = {}
  step.value = 1 // 第 1 步子组件随 v-if 重建，源选择自动清空
}

// ── 第 2 步：审核脚本（HumanGate①：逐镜编辑 + AI 生成区块 + 来源切换）──
/* ── 换物品（§11-62 video_replace 档：缺省六视图；档内路由归服务端，按钮隐藏） ── */
const replaceMode = computed(() => iv.referenceMode.value === 'video_replace')
function inReplace(shot: ImitationShot): boolean {
  return shotInReplace(shot, iv.referenceMode.value)
}
/** 镜头替换物 ref ids：显式块 > video_replace 档缺省=第 2 步产品六视图（≤9） */
function replaceRefIds(shot: ImitationShot): number[] {
  if (shot.replace_item?.ref_ids.length) return shot.replace_item.ref_ids
  return replaceMode.value ? productImageIds.value.map(Number).slice(0, 9) : []
}
function onToggleReplace(i: number): void {
  const cur = shots.value[i]
  if (!cur) return
  shots.value[i] = isReplaceShot(cur)
    ? disableShotReplaceItem(cur, shots.value)
    : enableShotReplaceItem(cur, productImageIds.value.map(Number))
}

/* ── 替换物选择（WbPickMaterialDialog 复用；模式驱动镜首次改选即落地显式块） ── */
const replacePickVisible = ref(false)
const replacePickIndex = ref(-1)
function openReplacePicker(i: number): void {
  replacePickIndex.value = i
  replacePickVisible.value = true
}
function onReplacePick(item: PickerItem): void {
  const cur = shots.value[replacePickIndex.value]
  if (!cur) return
  if (!cur.replace_item) {
    if (!inReplace(cur)) return
    shots.value[replacePickIndex.value] = enableShotReplaceItem(cur, productImageIds.value.map(Number))
  }
  const block = shots.value[replacePickIndex.value]?.replace_item
  const mid = Number((item as Record<string, unknown>).material_id ?? (item as Record<string, unknown>).id)
  if (!block || !Number.isFinite(mid) || mid <= 0) return
  if (!block.ref_ids.includes(mid) && block.ref_ids.length < 9) block.ref_ids.push(mid) // refs 槽位上限 9（video_edit 契约）
}
function replaceThumbUrl(mid: number): string {
  return buildMediaThumbUrl(ivServerUrl.value, mid)
}

const timelineWarn = computed(() => iv.timelineWarning(shots.value, record.value?.voice_dur_sec))

/** PUT 整体替换（§8）：字段组包在纯逻辑层（buildScriptPutPayload），shots 原样回传 */
function buildScriptPayload(): Record<string, unknown> {
  return buildScriptPutPayload(record.value || {}, shots.value)
}

const saving = ref(false)
async function saveScript(): Promise<boolean> {
  saving.value = true
  const ok = await iv.saveScript(scriptId.value, buildScriptPayload())
  saving.value = false
  if (ok) { productSelectionDirty.value = false; if (productImgNote.value === PRODUCT_SAVE_FAIL_NOTE) productImgNote.value = '' } // 落库成功=服务端重新权威（2026-10-12 裁决）
  return ok
}

const enteringPrep = ref(false)
/** 禁入第 3 步除非配音/采纳链完成（方案 A）且顶部视图在（2026-10-10 裁决） */
const enterPrepBlocked = computed(() => !iv.productViewsReady.value || !!ttsBusy.value || !!distributeBusy.value)
const enterPrepError = ref('')
watch(enterPrepBlocked, (blocked) => { if (!blocked) enterPrepError.value = '' })
const enterPrepTitle = computed(() => {
  if (ttsBusy.value) return '口播配音生成中——等配音完成（完成后自动入库绑定）再进入下一步'
  if (distributeBusy.value) return '正在按新文案铺旁白/重写画面——等完成后再进入下一步'
  if (!productPicked()) return '请先「选择产品」——六视图槽位随产品带出，直传生成任务'
  if (!iv.productViewsReady.value) return '六视图至少要有「顶部」视图——缺的槽位点「上传」补齐'
  return ''
})
async function enterPrep(): Promise<void> {
  // 已有进行中的生成任务 → 直接回对应步显示进度/状态（不重复提交；轮询在组合函数层持续）
  if (iv.genPhase.value === 'running' && iv.genTaskId.value) { step.value = iv.genStage.value === 'videos' ? 4 : 3; return }
  // 九宫粗稿已生成/已确认 → 不重复提交，直接进第 3 步显示/确认
  const genShots = shots.value.filter((s) => s.source === 'generate')
  if (genShots.length > 0 && genShots.every((s) => s.gen?.draft_status === 'generated' || s.gen?.draft_status === 'confirmed')) { step.value = 3; return }
  if (!(await saveScript())) {
    enterPrepError.value = '脚本保存失败——无法进入下一步；请检查服务端连接后重试（主稿与各镜未变）'
    return
  }
  // 视频换物直通（2026-10-12 裁决：输入=原片段+六视图，免九宫格，直进视频生成并自动提交）
  if (iv.referenceMode.value === 'video_replace') {
    await startVideoGeneration()
    if (iv.genPhase.value !== 'running') enterPrepError.value = iv.genError.value || '视频生成任务提交失败'
    return
  }
  enterPrepError.value = ''
  enteringPrep.value = true
  // v4.3 闸门①：提交九宫分镜粗稿（storyboard 低清档），整体确认后才放行高清精稿
  const ok = await iv.submitGenerate({ scriptId: scriptId.value, stage: 'storyboard', productImages: productImages.value }, shots.value)
  enteringPrep.value = false
  if (ok) step.value = 3
}

// ── 生成任务通用：完成/失败后刷新脚本（帧引用/状态徽标落库后回读）；
//    不自动跳步——步进一律由用户点「下一步」（2026-10-02 用户裁决）──
watch(() => iv.genPhase.value, async (ph, old) => {
  if (old === 'running' && (ph === 'done' || ph === 'failed')) {
    await reloadScript()
  }
})

// Part1（视频拆解）完成回读（2026-10-03 修复：轮询置 done 拿到 scriptId 后无人回读
// 脚本，record/shots 恒空 → UI 无运行提示也无结果，用户只见"过一会没返回"）；
// 全手动步进裁决不变——回读后停留第 1 步展示拆解脚本，由用户点「下一步」。
watch(() => iv.part1Phase.value, async (ph) => {
  if (ph === 'done' && iv.scriptId.value) await reloadScript()
})

const genResultSummary = computed(() => {
  const r = iv.genResult.value || {}
  const done = Array.isArray(r.shots_done) ? (r.shots_done as unknown[]).length : 0
  const failed = Array.isArray(r.shots_failed) ? (r.shots_failed as unknown[]).length : 0
  return { done, failed }
})

// ── 第 4 步：分镜图确认（HumanGate②·九宫格视图）──
// 帧地址带脚本 version 击穿 webview 缓存（2026-10-07 服务端重生成换种子=同 URL 不同图常态）
function frameUrl(name: unknown, which: 'first' | 'last' | 'draft_first' | 'draft_last'): string {
  return toAbsolute(`/api/storyboard/scripts/${scriptId.value}/shots/${encodeURIComponent(String(name))}/frames/${which}?v=${Number(record.value?.version) || 0}`)
}
const frameConfirming = ref('')
async function confirmFrame(i: number): Promise<void> {
  const s = shots.value[i]
  const name = s?.gen?.name
  if (!name) return
  frameConfirming.value = String(name)
  if (await iv.confirmShotFrames(scriptId.value, String(name))) await reloadScript()
  frameConfirming.value = ''
}
/** 换帧目标（共享一个隐藏 input）：{idx, which} */
const replaceTarget = ref<{ idx: number; which: 'first' | 'last' } | null>(null)
const frameInput = ref<HTMLInputElement | null>(null)
function pickReplaceFrame(i: number, which: 'first' | 'last'): void {
  replaceTarget.value = { idx: i, which }
  frameInput.value?.click()
}
async function onReplaceFrame(e: Event): Promise<void> {
  const f = (e.target as HTMLInputElement).files?.[0] || null
  const t = replaceTarget.value
  replaceTarget.value = null
  ;(e.target as HTMLInputElement).value = ''
  if (!f || !t) return
  const name = shots.value[t.idx]?.gen?.name
  if (!name) return
  const files = t.which === 'first' ? { first: f } : { last: f }
  if (await iv.replaceShotFrames(scriptId.value, String(name), files)) await reloadScript()
}
/** 单帧重生成（§5.1 only_shots 通道；细化批注映射层端点待契约，暂不提供批注输入） */
const regenFrame = ref('')
async function regenerateFrame(i: number): Promise<void> {
  const name = shots.value[i]?.gen?.name
  if (!name) return
  regenFrame.value = String(name)
  // 单帧重生成：提交后留在本页（分镜头确认），生成状态行可见
  await iv.submitGenerate({ scriptId: scriptId.value, stage: 'frames', onlyShots: [String(name)], productImages: productImages.value }, shots.value)
  regenFrame.value = ''
}

const framesReadyCount = computed(() => shots.value.filter((s) => s.source === 'generate' && s.gen?.frames_status === 'confirmed').length)
const generateShotsCount = computed(() => shots.value.filter((s) => s.source === 'generate').length)

// ── 质量徽标数据源 + 坏例标注（批1 M0/D7：meta.quality_report 随 reloadScript 刷新；
//    badcase 写 shot 根级 extra（extra=allow 透传往返）随 PUT 持久，服务端消费待契约）──
const qualityReport = computed(() => ((record.value?.meta as Record<string, unknown> | undefined)?.quality_report ?? null) as QualityReport | null)
async function toggleBadcase(i: number): Promise<void> {
  const cur = shots.value[i]
  if (!cur) return
  shots.value[i] = { ...cur, badcase: !cur.badcase }
  await saveScript()
}

/** 六视图就绪=顶部视图在——第 3→4 步闸门（直传 product_images 亦源自六视图） */
const sixViewReady = computed(() => iv.productViewsReady.value)

/** 第 4 步阶段①「重新生成九宫格图」：重提 storyboard 任务（全部镜头重生成，带产品图） */
async function regenStoryboard(): Promise<void> {
  if (iv.genPhase.value === 'running' && iv.genTaskId.value) return
  if (!(await saveScript())) return
  await iv.submitGenerate({ scriptId: scriptId.value, stage: 'storyboard', productImages: productImages.value }, shots.value)
}
function shotVideoUrl(materialId: unknown): string { const mid = Number(materialId); return Number.isInteger(mid) && mid > 0 ? toAbsolute(`/material/serve?material_id=${mid}`) : '' }
const montageStepProps = computed(() => ({ step: step.value, scriptId: scriptId.value, phase: montage.montagePhase.value, progress: montage.montageProgress.value, elapsedSec: montage.montageElapsedSec.value, message: montage.montageMessage.value, error: montage.montageError.value, exporting: montage.exporting.value, exportStage: montage.exportStage.value, exportNote: montage.exportNote.value, transition: cfgTransition.value, bgmName: cfgBgmName.value, result: montage.montageResult.value }))
const startVideos = ref('')
/** 轻提示（横幅式 toast 缺位——用与文案混剪一致的临时提示条替代；显式不静默） */
const notifyMsg = ref('')
function notify(title: string, detail: string): void {
  notifyMsg.value = `${title}：${detail}`
  window.setTimeout(() => { if (notifyMsg.value === `${title}：${detail}`) notifyMsg.value = '' }, 6000)
}
// 第 5 步特效配置（转场/BGM——写入脚本随草稿链消费）
const cfgTransition = ref('random')
const cfgBgmName = ref('')
watch(() => [step.value, record.value?.transition, record.value?.bgm_type] as const, ([st, tr, bgm]) => {
  if (st !== 5) return
  if (typeof tr === 'string' && tr) cfgTransition.value = tr
  cfgBgmName.value = typeof bgm === 'string' ? bgm : ''
})
function onMontageConfig(patch: { transition?: string; bgmName?: string }): void {
  if (!record.value) return
  if (patch.transition !== undefined) record.value.transition = patch.transition
  if (patch.bgmName !== undefined) record.value.bgm_type = patch.bgmName
  void saveScript()
}
async function startMontage(): Promise<void> {
  if (!record.value) return
  record.value.transition = cfgTransition.value
  record.value.bgm_type = cfgBgmName.value
  if (!(await saveScript())) return
  await montage.trigger(scriptId.value, shots.value)
}
async function downloadMontageVideo(): Promise<void> {
  const path = String(montage.montageResult.value?.video_path || '')
  if (!path) return
  const savePath = await window.tintin?.dialog?.saveFile?.({ title: '下载成片', defaultPath: 'imitation_final.mp4', filters: [{ name: '视频文件', extensions: ['mp4'] }] })
  if (!savePath) return
  montage.exporting.value = true
  montage.exportStage.value = '下载中...'
  try {
    const res = (await window.tintin.server.downloadResult(path, savePath)) as { error?: string } | null
    montage.exportNote.value = res && res.error ? `下载失败：${res.error}` : `已下载：${savePath}`
  } catch (e) {
    montage.exportNote.value = `下载失败：${(e as Error).message}`
  } finally {
    montage.exporting.value = false
  }
}
// 第 5/6 步：特效包装草稿链 + 导出（2026-10-06 用户裁决：特效包装实体化、导出拆第 6 步）
const montage = useImitationMontage()
// videos 运行期每 10s 回读——逐镜完成徽标/计数实时（2026-10-06 裁决）
let liveReloadTimer: ReturnType<typeof setInterval> | undefined
let cgTimer: ReturnType<typeof setInterval> | undefined
/** comfygen 逐镜流式计数（/comfygen/jobs 滚动窗口——最新 script 模式 job 的 shots_done/total） */
const cgShots = ref<{ done: number; total: number } | null>(null)
async function pollComfygenShots(): Promise<void> {
  try {
    const jobs = (await window.tintin.server.get('/comfygen/jobs')) as Array<Record<string, unknown>> | null
    const ids = iv.genJobIds.value
    const scriptJobs = (jobs || [])
      .filter((j) => j.shots_total !== undefined && (ids.length ? ids.includes(String(j.job_id)) : j.mode === 'script'))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    if (!scriptJobs.length) { cgShots.value = null; return }
    let done = 0
    let total = 0
    for (const j of scriptJobs) {
      done += Number(j.shots_done) || 0
      total += Number(j.shots_total) || 0
    }
    cgShots.value = { done, total }
  } catch { cgShots.value = null }
}
watch(() => [iv.genPhase.value, iv.genStage.value] as const, ([ph, st]) => {
  // storyboard 也挂轮询（2026-10-12 用户裁决「生成一个显示一个」：粗稿逐镜独立生成，
  // 每 10s 回读=完成一镜亮一格；完成瞬间回读撞 500 也在下一轮自愈）
  if (ph === 'running' && (st === 'videos' || st === 'storyboard')) {
    liveReloadTimer ??= setInterval(() => { void reloadScript(); void pollComfygenShots() }, 10000)
    void pollComfygenShots()
    cgTimer ??= setInterval(() => { void pollComfygenShots() }, 4000)
  } else {
    if (liveReloadTimer) { clearInterval(liveReloadTimer); liveReloadTimer = undefined }
    if (cgTimer) { clearInterval(cgTimer); cgTimer = undefined }
  }
}, { immediate: true })
onBeforeUnmount(() => {
  if (liveReloadTimer) clearInterval(liveReloadTimer)
  if (cgTimer) clearInterval(cgTimer)
})
async function startVideoGeneration(): Promise<void> {
  if (iv.genPhase.value === 'running' && iv.genTaskId.value) { step.value = 4; return }
  // 全部镜头已就绪（实拍绑定或 AI 生成完成）→ 不重提任务直接展示（2026-10-06 用户报障：
  // 完成后返回再进入=整脚本重跑一遍 GPU 小时级任务；原守卫只拦运行中、不拦已完成）
  if (shots.value.length > 0 && doneCount.value === shots.value.length) { step.value = 4; return }
  startVideos.value = '1'
  if (await iv.submitGenerate({ scriptId: scriptId.value, stage: 'videos', productImages: productImages.value }, shots.value)) step.value = 4
  startVideos.value = ''
}

// ── 第 5 步：逐镜视频生成（徽标/失败重跑/降档）──
const retryFidelity = ref<'fast' | 'balanced' | 'high'>('fast')
const retrying = ref('')
async function retryShot(i: number): Promise<void> {
  const name = shots.value[i]?.gen?.name
  if (!name) return
  retrying.value = String(name)
  if (await iv.submitGenerate(
    { scriptId: scriptId.value, stage: 'videos', onlyShots: [String(name)], fidelityOverride: retryFidelity.value, productImages: productImages.value },
    shots.value,
  )) step.value = 4
  retrying.value = ''
}

// ── 第 6/7 步：触发草稿链（HumanGate③ 两段式）与交付 ──
// §5.3：素材就绪后手动触发，交互与文案线产片一致——脚本已存服务端脚本库，
// 在「文案混剪」工具选择该脚本继续 特效包装→草稿/成片（复用既有产片 UI）。
// 直提 storyboard_montage 任务为后续接线项（走既有任务提交入口，不另发明端点）。
const doneCount = computed(() => shots.value.filter((s) => s.source !== 'generate' || s.gen?.status === 'done').length)

// ── 闸门① 九宫分镜粗稿（v4.3：draft_status confirmed 后解锁逐镜视频）──
const draftConfirmed = computed(() => { const g = shots.value.filter((s) => s.source === 'generate'); return g.length > 0 && g.every((s) => s.gen?.draft_status === 'confirmed') })
const draftsReady = computed(() => { const g = shots.value.filter((s) => s.source === 'generate'); return g.length > 0 && g.every((s) => s.gen?.draft_status === 'generated' || s.gen?.draft_status === 'confirmed') })
const canConfirmDraft = computed(() => draftsReady.value && !draftConfirmed.value)
/** 素材生成阶段任务统一提交（storyboard→步3/frames→步3/videos→步4；进行中不重复提交） */
async function submitStage(stage: 'storyboard' | 'frames' | 'videos'): Promise<void> {
  if (iv.genPhase.value === 'running' && iv.genTaskId.value) { step.value = stage === 'videos' ? 4 : 3; return }
  startVideos.value = '1'
  try {
    await iv.submitGenerate({ scriptId: scriptId.value, stage, productImages: productImages.value }, shots.value)
  } finally {
    // 忙标志必须复位（恒 '1' 曾把下一步永久禁用——2026-10-06 报障）
    startVideos.value = ''
  }
}
async function confirmDraftAndSubmitVideos(): Promise<void> {
  if (!(await iv.confirmDraft(scriptId.value))) { notify('确认失败', '九宫粗稿确认请求未成功，请重试'); return }
  await reloadScript()
  await startFramesSubmission()
}
async function startFramesSubmission(): Promise<void> { await submitStage('frames') }
async function startVideosSubmission(): Promise<void> { await submitStage('videos') }

// 九宫已确认且精稿未生成 → 自动续跑高清精稿（重入/刷新恢复；已完成不重触发）
watch(() => [draftConfirmed.value, framesReadyCount.value, iv.genPhase.value, iv.genTaskId.value] as const,
  ([confirmed, ready, phase, taskId]) => {
    if (confirmed && ready === 0 && phase !== 'running' && !taskId) void startFramesSubmission()
  })
</script>

<template>
  <div class="iv-page">
    <VdStepBar :step="step - 1" :steps="STEPS" />
    <!-- 换帧共享隐藏 input（第 3 步「换首帧/换尾帧」经 pickReplaceFrame 触发） -->
    <input ref="frameInput" type="file" accept="image/png" class="iv-hide" @change="onReplaceFrame" />

    <!-- ═══ 第 1 步：视频拆解（自持子组件，铁律 4 拆分；完成回读由父级 watch 承担）═══ -->
    <ImitationSourceStep v-if="step === 1" :iv="iv" :shots="shots" :overall-prompt-en="overallPromptEn" @next="step = 2" />

    <!-- ═══ 第 2 步：生成脚本（原片脚本为模板：替换文字=新产品文案 + 新文案口播配音；HumanGate①；单脚本全步共用）═══ -->
    <div v-else-if="step === 2 && record && shots.length" class="iv-panel">
      <div class="row between">
        <span class="sb-info">原片脚本（模板）：共 {{ shots.length }} 镜 ｜ 总时长 {{ shotsTotalDuration(shots) }} 秒 ｜ 脚本 {{ scriptId }}</span>
        <span class="muted">本步生成新视频脚本：替换文案文字 + 新文案口播配音；AI/实拍逐镜定稿</span>
      </div>
      <div v-if="timelineWarn" class="iv-warn">{{ timelineWarn }}</div>

      <!-- 两套文案（2026-10-02 用户裁决）：上=拆解文案（原片口播转写，只读、不绑定脚本）；
           下=脚本文案（重新生成后绑定脚本，配音/逐镜以此为准） -->
      <div class="seg-field">
        <span class="lbl">拆解文案（原片口播转写——只读参考，不绑定脚本）</span>
        <textarea :value="origVoiceoverText" readonly rows="3" class="input carry-textarea iv-orig" placeholder="（原片无口播或拆解未含转写）"></textarea>
      </div>
      <div class="seg-field">
        <div class="row">
          <span class="lbl">脚本文案（重新生成后绑定脚本，可编辑——配音与逐镜替换以此为准）</span>
          <!-- 字数/口播时长（2026-10-06 用户裁决：确认仿写方案后在标签行右侧显示；随编辑实时） -->
          <span v-if="voiceoverText.trim()" class="muted">共 {{ voiceoverChars }} 字 ｜ 约 {{ voiceoverEstSec }} 秒</span>
        </div>
        <textarea v-model="voiceoverText" rows="4" class="input carry-textarea" placeholder="选择产品 →「重新生成文案」按新产品重写（生成后才与脚本绑定），也可直接编辑"></textarea>
      </div>
      <!-- 保存修改文案（2026-10-12 用户裁决）：手编后重新采纳分发——服务端按新主稿重铺逐镜旁白/重写画面描述 -->
      <div class="row">
        <span class="spacer"></span>
        <TButton
          label="保存修改文案"
          :loading="savingCopyBusy || !!distributeBusy"
          :disabled="!voiceoverText.trim() || !!distributeBusy"
          title="按修改后的文案重新采纳分发：服务端重铺逐镜旁白并重写画面描述（会覆盖逐镜里手动改过的旁白）"
          @click="saveEditedVoiceover"
        />
      </div>
      <div class="row">
        <TButton label="选择产品" @click="productPickVisible = true" />
        <span v-if="productLabel()" class="product-chip" title="当前产品（文案按此重写，产品图随脚本供生成）">当前产品：{{ productLabel() }}</span>
        <button v-if="productLabel()" class="product-clear" title="清除已选产品" @click="clearScriptProduct">×</button>
        <!-- 平台下拉（2026-10-03 用户裁决：仿写文案对齐文案混剪——字典 GET /copywriting/platforms，
             platform 直传服务端，平台口播风格指引由服务端织入；十稿挑选弹窗确认后写入上方脚本文案框） -->
        <label class="lbl">平台</label>
        <select v-model="ivPlatform" class="input w110" title="投放平台（平台口播风格指引由服务端织入生成）">
          <option v-for="p in ivPlatformOptions" :key="p.name" :value="p.name">{{ p.name }}</option>
          <option v-if="!ivPlatformOptions.length" value="抖音">抖音</option>
        </select>
        <span class="spacer"></span>
        <TButton
          label="重新生成仿写文案"
          :loading="regenBusy"
          :disabled="!productLabel()"
          :title="productLabel() ? '' : '请先「选择产品」——服务端按产品信息生成 10 种文案写法'"
          @click="regenerateVoiceover"
        />
      </div>
      <div v-if="regenError" class="iv-err">{{ regenError }}</div>
      <div class="opl-six">
        <template v-for="s in productSixSlots" :key="s.view">
          <div v-if="s.entry" class="six-cell">
            <img :src="buildMediaServeUrl(ivServerUrl, s.entry.materialId)" :alt="s.label" class="six-img" loading="lazy" />
            <span class="six-label">{{ s.label }}<i v-if="s.entry.source" class="six-src">{{ s.entry.source }}</i></span>
            <button class="six-up" :disabled="sixBusy" title="上传替换该视图（仅替换此张，其余五张不动）" @click="onSixUpload(s.view)">替换</button>
            <button class="six-del" :disabled="sixBusy" title="删除该视图（顶部视图为下一步必备）" @click="onDeleteProductView(s.view, s.label)">×</button>
          </div>
          <div v-else class="six-cell six-cell--empty">
            <span class="six-miss">缺</span>
            <button class="six-up six-up--empty" :disabled="sixBusy" title="上传该视图（仅补此张，其余五张不动）" @click="onSixUpload(s.view)">{{ sixBusy && sixPendingView === s.view ? '上传中…' : '上传' }}</button>
            <span class="six-label">{{ s.label }}</span>
          </div>
        </template>
      </div>
      <span class="muted">{{ productSixFilledCount }}/6 · 六视图随「产品资料」保存并直传生成任务；顶部视图必填</span>
      <span v-if="productImgNote" class="iv-err">{{ productImgNote }}</span>
      <TButton v-if="productSavePending" label="重试补发产品选择" variant="secondary" size="small" :loading="saving" title="产品选择尚未落库（保存接口失败）——服务端恢复后就地补存，已选产品与六视图不受影响" @click="saveScript" />
      <!-- 参考声音（同文案混剪 Step3：TSelect+常驻播放条，源 GET /voice/samples） -->
      <div class="row ref-row">
        <span class="lbl">参考声音:</span>
        <TSelect :model-value="selectedSampleKey" :options="sampleOptions" @update:model-value="selectedSampleKey = String($event)" />
        <audio v-if="samplePreviewUrl" :src="toAbsolute(samplePreviewUrl)" controls preload="auto" class="iv-audio" title="样本试听" />
        <span v-if="voiceSamplesError" class="muted">{{ voiceSamplesError }}</span>
      </div>
      <div class="row">
        <span class="lbl">配音引擎:</span>
        <TSelect v-model="ttsEngineSel" :options="TTS_ENGINE_OPTIONS" class="tts-engine-select" title="TTS 引擎（客户端默认 VoxCPM2）" />
        <TButton label="设置声音克隆" variant="secondary" @click="openCloneParams()" />
        <span class="spacer"></span>
        <TButton label="生成口播配音" :loading="ttsBusy" :disabled="!voiceoverText.trim()" @click="generateVoiceAudio" />
      </div>
      <div class="row">
        <template v-if="ttsAudioUrl">
          <span class="lbl">口播配音:</span>
          <span class="iv-voice-name" :title="ttsSampleLabel">{{ ttsSampleLabel }}</span>
          <audio :src="ttsAudioUrl" controls preload="auto" class="iv-audio" :title="`口播配音（${ttsSampleLabel}，${ttsDurText}）`" @loadedmetadata="onTtsMeta" />
          <span class="iv-dur" :class="{ none: ttsDurSec <= 0 }">{{ ttsDurText }}</span>
        </template>
        <span v-if="regenWarn" class="iv-warn">{{ regenWarn }}</span>
        <span v-if="ttsError" class="iv-err">{{ ttsError }}</span>
        <span v-if="ttsBindNote" class="muted">{{ ttsBindNote }}</span>
        <span v-if="distributeError" class="iv-err">{{ distributeError }}</span>
        <span v-if="distributeNote" class="muted">{{ distributeNote }}</span>
        <span v-if="distributeBusy" class="muted">正在按新文案分配逐镜旁白…</span>
      </div>

      <div class="muted">时长保存后由服务端按帧对齐量化（≤0.7s 偏移，设计行为，非 bug）</div>
      <div v-if="!shotsRevealed && shots.length" class="muted">逐镜脚本将在「重新生成仿写文案」采纳新文案后显示（当前为拆解稿原文，旁白未按新产品重写）</div>
      <div v-for="(shot, i) in (shotsRevealed ? shots : [])" :key="i" class="seg-card">
        <div class="seg-head">
          <span class="seg-no">#{{ i + 1 }}</span>
          <label class="seg-field head-field"><span class="lbl">镜别</span><input v-model="shot.shot_type" class="input w70" placeholder="特写/中景" /></label>
          <label class="seg-field head-field"><span class="lbl">时长(秒)</span><input v-model.number="shot.duration" type="number" min="3" max="15" class="input w60" title="保存后服务端按帧对齐量化，时长可能微调 ≤0.7s（设计行为）" /></label>
          <span class="iv-badge" :class="shotModeBadgeClass(shot, iv.referenceMode.value)">{{ shotModeBadgeText(shot, iv.referenceMode.value) }}</span>
          <span class="spacer"></span>
          <TButton v-if="!replaceMode" :label="isReplaceShot(shot) ? '切换为 AI' : '切换为换物品'" variant="secondary" size="small"
            :title="isReplaceShot(shot) ? '剥除换物品块并恢复 AI 生成参数（gen 参数原样保留）' : '换物品模式：默认带出第 2 步产品六视图作替换物，底部可改选；生成时走服务端换物引擎'"
            @click="onToggleReplace(i)" />
        </div>
        <label class="seg-field"><span class="lbl">画面描述</span><textarea v-model="shot.visual" rows="2" class="input carry-textarea" /></label>
        <div v-if="shot.orig_audio" class="sb-line iv-orig">原旁白（拆解稿）：{{ shot.orig_audio }}</div>
        <label class="seg-field"><span class="lbl">旁白（新文案，替换原片文字——可编辑）</span><textarea v-model="shot.audio" rows="1" class="input carry-textarea carry-textarea--sm" placeholder="新视频该镜的口播文案（从上方新文案粘贴或手写替换）"></textarea></label>

        <div v-if="inReplace(shot)" class="iv-replace">
          <div class="row iv-rep-row">
            <span class="iv-rep-orig">原物品：第 #{{ i + 1 }} 镜原片物品（换物保持原场景/动作/旁白，仅替换该物品外观）</span>
          </div>
          <div class="row iv-rep-row">
            <span class="lbl">替换为</span>
            <span class="iv-rep-refs">
              <img v-for="rid in replaceRefIds(shot)" :key="rid" :src="replaceThumbUrl(rid)" class="iv-rep-thumb" loading="lazy" />
              <span v-if="!replaceRefIds(shot).length" class="muted">未选替换物品（请点右侧选择）</span>
            </span>
            <TButton label="选择替换物品" variant="secondary" size="small" @click="openReplacePicker(i)" />
            <span class="muted">默认=第 2 步产品六视图；最多 9 张，排列顺序即参考图顺序</span>
          </div>
        </div>

        <!-- AI 生成区块（§5.3 差异项：来源标记 / 生成参数 / 逐镜状态） -->
        <div v-if="shot.source === 'generate' && shot.gen" class="iv-gen">
          <div class="row">
            <label class="seg-field head-field"><span class="lbl">运镜</span>
              <select v-model="shot.gen.camera" class="input w110">
                <option v-for="c in iv.enums.value?.cameras || []" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>
            </label>
            <label class="seg-field head-field"><span class="lbl">保真</span>
              <select v-model="shot.gen.fidelity" class="input w110">
                <option v-for="f in iv.enums.value?.fidelity || []" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
            </label>
            <label v-for="k in SCENE_ELEMENT_KEYS" :key="k" class="seg-field head-field"><span class="lbl">{{ SCENE_ELEMENT_LABELS[k] || k }}</span>
              <select :value="(shot.gen.scene || {})[k] ?? ''" class="input w110" @change="(shot.gen.scene = { ...(shot.gen.scene || {}), [k]: ($event.target as HTMLSelectElement).value })">
                <option value="">（未设）</option>
                <option v-for="o in sceneElementOptions(iv.enums.value!, k as SceneElementKey)" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div class="row">
        <TButton label="← 上一步" variant="primary" @click="goBack" />
        <span class="spacer"></span>
        <TButton
          label="下一步：分镜头确认"
          :loading="enteringPrep"
          :disabled="enterPrepBlocked"
          :title="enterPrepTitle"
          @click="enterPrep"
        />
      </div>
      <div v-if="enterPrepBlocked && enterPrepTitle" class="iv-err">无法进入下一步：{{ enterPrepTitle }}</div>
      <div v-if="enterPrepError" class="iv-err">{{ enterPrepError }}</div>
      <div v-if="iv.genError.value" class="iv-err">{{ iv.genError.value }}</div>
      <WbPickProductDialog :visible="productPickVisible" six-views @close="productPickVisible = false" @pick="onProductPick" />
      <!-- 六视图槽位·选择产品图（2026-10-10 恢复原形态：产品库选择+本地上传，单图绑定） -->
      <MaterialImagePickerDialog :open="sixPickOpen" :view-label="productSixSlots.find((s) => s.view === sixPendingView)?.label"
        @close="sixPickOpen = false" @pick="onPickerPick" />
      <WbPickMaterialDialog :visible="replacePickVisible" image-only purpose="product"
        @close="replacePickVisible = false" @pick="onReplacePick" />

      <!-- 设置声音克隆弹窗（对齐文案混剪 Step3 同名功能：参数随每次 TTS 请求发送） -->
      <VoiceCloneParamsDialog
        :open="cloneParamsDlg.show"
        :engine="ttsEngineSel"
        :initial="{ factor: ttsFactor, emo: ttsEmoText, alpha: ttsEmoAlpha, speaker: qwen3Speaker, instruct: qwen3Instruct }"
        :voices="qwen3Voices"
        :voices-loading="qwen3VoicesLoading"
        @save="saveCloneParams"
        @close="closeCloneParams"
      />

      <!-- 十稿挑选弹窗（共享组件；默认选中第一种，点卡片切换，确定写入脚本文案框） -->
      <VoiceoverPickerDialog
        :open="voiceoverDlgOpen"
        :candidates="voiceoverCandidates"
        :failed-formulas="voiceoverFailedFormulas"
        :selected-idx="voiceoverSelectedIdx"
        @update:selected-idx="voiceoverSelectedIdx = $event"
        @confirm="confirmVoiceoverCandidate"
        @close="closeVoiceoverDlg" />
    </div>

    <!-- ═══ 第 3 步：分镜头确认（阶段① 九宫格确认 + 阶段② 首尾帧+确认全部分镜——2026-10-06 用户裁决）═══ -->
    <ImitationGenSteps
      v-else-if="step === 3"
      mode="frames"
      :iv="iv"
      :shots="shots"
      :grid-url="storyboardGridUrl"
      :quality-report="qualityReport"
      :six-view-ready="sixViewReady"
      @toggle-badcase="toggleBadcase"
      :pack="iv.storyboardPack.value"
      :gen-result-summary="genResultSummary"
      :frames-ready-count="framesReadyCount"
      :generate-shots-count="generateShotsCount"
      :done-all="doneCount === shots.length"
      :aroll-status="String((record?.aroll as Record<string, unknown>)?.status || '')"
      :aroll-config="arollConfig"
      :aroll-preview-url="arollPreviewUrl"
      :aroll-busy="arollBusy"
      :draft-confirmed="draftConfirmed"
      :drafts-ready="draftsReady"
      :can-confirm-draft="canConfirmDraft"
      @confirm-draft="confirmDraftAndSubmitVideos"
      @refresh-grid="reloadScript"
      @frames-confirmed="reloadScript"
      @regen-storyboard="regenStoryboard"
      :frame-confirming="frameConfirming"
      :regen-frame="regenFrame"
      :retrying="retrying"
      :retry-fidelity="retryFidelity"
      :start-videos="startVideos"
      :frame-url="frameUrl"
      :video-url-of="shotVideoUrl"
      :live-shots="cgShots"
      :on-confirm-frame="confirmFrame"
      :on-pick-replace-frame="pickReplaceFrame"
      :on-regenerate-frame="regenerateFrame"
      :on-retry-shot="retryShot"
      @start-videos="startVideoGeneration"
      :on-back="goBack"
      @update:retry-fidelity="retryFidelity = $event"
    />

    <!-- ═══ 第 4 步：逐镜视频生成（整脚本信息在左、首尾帧在右）═══ -->
    <ImitationGenSteps
      v-else-if="step === 4"
      mode="videos"
      :iv="iv"
      :shots="shots"
      :source-video-url="sourceClipVideoUrl"
      :grid-url="storyboardGridUrl"
      :quality-report="qualityReport"
      :six-view-ready="sixViewReady"
      @toggle-badcase="toggleBadcase"
      :pack="iv.storyboardPack.value"
      :gen-result-summary="genResultSummary"
      :frames-ready-count="framesReadyCount"
      :generate-shots-count="generateShotsCount"
      :done-all="doneCount === shots.length"
      :aroll-status="String((record?.aroll as Record<string, unknown>)?.status || '')"
      :aroll-config="arollConfig"
      :aroll-preview-url="arollPreviewUrl"
      :aroll-busy="arollBusy"
      :draft-confirmed="draftConfirmed"
      :drafts-ready="draftsReady"
      :can-confirm-draft="canConfirmDraft"
      @confirm-draft="confirmDraftAndSubmitVideos"
      @refresh-grid="reloadScript"
      @frames-confirmed="reloadScript"
      @generate-aroll="generateAroll"
      @regen-storyboard="regenStoryboard"
      :frame-confirming="frameConfirming"
      :regen-frame="regenFrame"
      :retrying="retrying"
      :retry-fidelity="retryFidelity"
      :start-videos="startVideos"
      @start-videos="startVideoGeneration"
      :frame-url="frameUrl"
      :video-url-of="shotVideoUrl"
      :live-shots="cgShots"
      :on-confirm-frame="confirmFrame"
      :on-pick-replace-frame="pickReplaceFrame"
      :on-regenerate-frame="regenerateFrame"
      :on-retry-shot="retryShot"
      :on-back="goBack"
      @update:retry-fidelity="retryFidelity = $event"
      @next-pack="step = 5"
    />


    <!-- ═══ 第 5/6 步：特效包装（草稿链）与交付（草稿包导入剪映）═══ -->
    <ImitationFxStep
      v-else-if="step === 5"
      section="fx"
      :script-id="scriptId"
      @back="goBack"
      @next="step = 6"
    />

    <!-- ═══ 第 6 步：交付（特效包装导出 + 成片预览/下载）═══ -->
    <ImitationFxStep
      v-else-if="step === 6"
      section="export"
      :script-id="scriptId"
      :gen-task-id="iv.videosTaskId.value"
      @back="goBack"
    />
    <ImitationMontageStep
      v-else-if="step === 6"
      :step="step"
      :script-id="scriptId"
      :phase="montage.montagePhase.value"
      :progress="montage.montageProgress.value"
      :elapsed-sec="montage.montageElapsedSec.value"
      :message="montage.montageMessage.value"
      :error="montage.montageError.value"
      :exporting="montage.exporting.value"
      :export-stage="montage.exportStage.value"
      :export-note="montage.exportNote.value"
      :transition="cfgTransition"
      :bgm-name="cfgBgmName"
      :result="montage.montageResult.value"
      @trigger="startMontage"
      @import="montage.importDraftPackage()"
      @back="goBack"
      @next="step = 6"
      @restart="resetFlow"
      @config-change="onMontageConfig"
      @download="downloadMontageVideo"
      @regen-storyboard="regenStoryboard"
    />
  </div>
</template>

<style scoped>
.iv-page { display: flex; flex-direction: column; gap: 12px; }
.iv-panel { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.spacer { flex: 1; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.sb-info { font-size: 12px; color: var(--muted-foreground); }
.sb-line { font-size: 12px; color: var(--foreground); line-height: 1.5; }
.iv-err { color: var(--danger, #e74c3c); font-size: 12px; }
.iv-warn { color: var(--warning, #f1c40f); font-size: 12px; font-weight: 600; }
.iv-link { color: var(--primary); cursor: pointer; text-decoration: underline; }
.iv-hide { display: none; }
.iv-filepick { display: flex; flex-direction: column; gap: 6px; }
.iv-divider { height: 1px; background: var(--border); margin: 8px 0; }
.iv-orig { color: var(--muted-foreground); font-style: italic; }
.iv-bar { position: relative; height: 6px; overflow: hidden; background: var(--border); border-radius: 999px; }
.iv-bar-fill { height: 100%; background: var(--primary); border-radius: 999px; transition: width 0.6s ease; }
.iv-bar.is-indeterminate::after { content: ''; position: absolute; inset: 0; width: 40%; background: var(--primary); border-radius: 999px; animation: iv-indeterminate 1.2s ease-in-out infinite; }
@keyframes iv-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }
.iv-audio { height: 32px; width: 320px; flex: 0 1 auto; }
.ref-row :deep(.t-select) { flex: 1 1 0; width: auto; min-width: 0; }
.iv-voice-name { font-size: 13px; color: var(--foreground); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iv-dur { font-size: 12px; color: var(--muted-foreground); }
.iv-dur.none { color: var(--border); }
.tts-engine-select { width: 220px; flex: none; }
.product-chip {
  display: inline-flex; align-items: center; padding: 1px 8px; font-size: 12px;
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-container));
  border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--foreground);
}
.product-clear {
  width: 18px; height: 18px; padding: 0; line-height: 1; font-size: 12px; flex: none;
  background: transparent; color: var(--muted-foreground); border: none; border-radius: 50%; cursor: pointer;
}
.product-clear:hover { color: var(--danger, #e74c3c); }
/* 产品六视图槽位（2026-10-10 槽位化裁决：产品资料同款六格） */
.opl-six { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.six-cell { position: relative; aspect-ratio: 1 / 1; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; background: var(--surface-container); }
.six-img { width: 100%; height: 100%; object-fit: contain; display: block; }
.six-cell--empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-style: dashed; }
.six-miss { font-size: 15px; color: var(--muted-foreground); opacity: 0.6; }
.six-label { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 6px; font-size: 11px; color: #fff; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; gap: 4px; }
.six-src { font-style: normal; font-size: 10px; opacity: 0.8; }
.six-up { position: absolute; top: 2px; left: 2px; height: 18px; padding: 0 6px; border: none; border-radius: 9px; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 10px; cursor: pointer; }
.six-up:hover { background: var(--primary); }
.six-up:disabled { opacity: 0.6; cursor: wait; }
.six-cell--empty .six-up { position: static; height: 20px; padding: 0 10px; font-size: 11px; border-radius: 10px; }
.six-del { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; line-height: 16px; border: none; border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 12px; cursor: pointer; padding: 0; }
.six-del:hover { background: var(--error, #EF4444); }

/* ── 工程统一拖入控件（2026-09-07 用户裁决：全程序拖拽上传区高度统一 min-height 120px；
     样式与 ImageMatting 等工具卡同构）── */
.dropzone {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 120px;
  padding: var(--space-6);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-container));
  border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border));
  border-radius: var(--radius-lg);
  color: var(--muted-foreground);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--easing-default),
    background var(--duration-fast) var(--easing-default);
}
.dropzone:hover,
.dropzone.is-active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-container));
}
.dropzone.has-file {
  border-style: solid;
  color: var(--foreground);
}
.dropzone__text { display: flex; flex-direction: column; gap: 2px; }
.dropzone__main { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--foreground); }
.dropzone__hint { font-size: 12px; color: var(--muted-foreground); }
.w70 { width: 90px; } .w60 { width: 64px; } .w110 { width: 130px; } .w140 { width: 160px; }

.iv-mode {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md);
  font-size: 12px; color: var(--muted-foreground); cursor: pointer;
}
.iv-mode.on { color: var(--primary); font-weight: 600; border-color: var(--primary); }

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
.iv-replace { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: color-mix(in srgb, var(--primary) 4%, var(--card)); border: 1px dashed var(--border); border-radius: var(--radius-md); }
.iv-rep-row { align-items: center; gap: 8px; flex-wrap: wrap; }
.iv-rep-orig { font-size: 12px; color: var(--muted-foreground); }
.iv-rep-refs { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.iv-rep-thumb { width: 34px; height: 34px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-container); }
.iv-gen { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;
  background: color-mix(in srgb, var(--primary) 4%, var(--card)); border: 1px dashed var(--border); border-radius: var(--radius-md); }

.iv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.iv-frame-card { display: flex; flex-direction: column; gap: 8px; padding: 10px;
  background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md); }
.iv-name { font-family: monospace; }
.iv-frames { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.iv-fig { display: flex; flex-direction: column; gap: 4px; margin: 0; }
.iv-fig img { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: var(--radius-sm);
  background: #101010; display: block; }
.iv-fig-empty { display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 9 / 16;
  background: #101010; color: var(--muted-foreground); font-size: 11px; border-radius: var(--radius-sm); }
.iv-fig figcaption { font-size: 11px; color: var(--muted-foreground); text-align: center; }
.iv-frame-actions { gap: 6px; }
</style>
