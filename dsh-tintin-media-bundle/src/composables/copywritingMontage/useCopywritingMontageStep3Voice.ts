// ══════════════════════════════════════════════════════════
// useCopywritingMontageStep3Voice.ts — 智能混剪 Step3 口播配音/字幕花字/文字模板编排（铁律 10 拆分，2026-09-18）
// 自 useCopywritingMontage.ts 纯搬迁（IRON-02 五项 checklist；蓝图见
// docs/智能混剪拆分迁移映射_2026-09-18.md §五 Step3）。
// 跨步依赖经 ctx 注入：共享运行时（statusText/serverUrl/ensureServerUrl）+
//   Step2 assemblePlans + Step1 previewUrl + 上提 ref（finalBusy/step4Candidates）+
//   S4 函数惰性绑定（collectCandidates/ensureProcessedSrt，运行时才解析）。
// 本步内 offVoiceProgress 槽随 nextVoiceChannel 同步迁入，对外暴露
//   clearVoiceProgressListener（与 setClearBusy 同类机械适配，槽语义不变）。
// ─────────────────────────────────────────────────═
import { ref, computed, watch } from 'vue'
import type { Ref } from 'vue'
import { clientError } from '../../utils/clientLog'
// whisper 响应多形态解析（2026-10-12 与 VoiceClone 同障修复：ct=text/plain 响应到
// 渲染层是 Uint8Array，旧内联解析取不到 text 静默留空文稿）
import { parseTranscriptionResponse, segmentsToPlainText } from '../srtUtils'
import {
  serverStylesToPresets, SUBTITLE_STYLE_PRESETS_FALLBACK, subtitlePresetTileStyle,
  TEXT_KEYWORD_DENSITY_MAX, pickRandomItems, extractFancyWordsFromText,
  buildSubtitleRows, buildTextFxTracks, textFxStyleOf, rewriteTemperature,
  buildRewriteSystemPrompt, cleanRewriteContent, resolveOutMontageDir, pathBasename,
  shotsNarrationText, buildCopywritingStoryboardPrompt,
  type TextFxTrack, type SubtitleStylePreset, type PrecomposePlan, type VoiceRow,
} from '../copywritingMontageLogic'
import { storyboardNameAfterSave } from '../copywritingMontageStep3VoiceLogic'
import { notify, errText, joinPath } from './context'
import { attachVoiceRef, voiceRefFromScriptDetail } from '../copywritingMontageVoiceRefLogic'
import { uploadTabVoiceWav, restoreTabVoiceFromLibrary } from './useCopywritingMontageVoiceSync'
import { readCacheDir } from '../useSettingsConfig'
import {
  parseStoryboardShots,
  buildScriptPayload,
  defaultStoryboardTopic,
  normalizeShot,
  extractScriptItems,
  toScriptOption,
  parseScriptDetail,
  copyFromShots,
  type ScriptSummary,
  type StoryboardShot,
} from '../opsStoryboardLogic'
import { useCopywritingMontageTextFx } from './useCopywritingMontageTextFx'
import type { SplitSceneRow } from '../copywritingMontageStep1SplitLogic'
import {
  encodeClipGroups,
  clipGroupsFromMaterialIds,
  clipGroupsFromScriptShots,
  type ClipBindingSeg,
} from '../copywritingMontageClipBindingLogic'
import { buildAssignPool } from '../copywritingMontageStep2ConcatLogic'
import { underfillAfterVoice } from '../copywritingMontageAssignLogic'

export interface CopywritingMontageStep3Context {
  statusText: Ref<string>
  serverUrl: Ref<string>
  ensureServerUrl: () => Promise<string>
  assemblePlans: Ref<PrecomposePlan[]>
  previewUrl: Ref<string>
  finalBusy: Ref<boolean>
  finalProgress: Ref<number>
  finalDone: Ref<boolean>
  finalVideoList: Ref<Array<{ name: string; path: string }>>
  finalVideoPath: Ref<string>
  step4Candidates: Ref<string[]>
  collectCandidates: (useSource?: boolean) => Promise<string[]>
  ensureProcessedSrt: (text: string, wavPath: string, candidate: string) => Promise<string>
  /** 产品信息（2026-09-19 架构：关键词命中词源=产品资料关联关键词，透传 textfx 子编排） */
  sharedProductInfo: Ref<{ brand: string; product: string; model: string; extra: string; keywords: string[] }>
  /** 文案编写页文案（2026-09-21 用户裁决：扫描建行时无旁车 .txt → 配音文案回退第一步文案） */
  getScriptCopy: () => string
  /** 选择脚本应用时回填旁白（与 getScriptCopy 同一数据源） */
  setScriptCopy: (text: string) => void
  /** 素材池（Step1Split 持有并持久化；2026-09-29 跨机绑定恢复按 serverPath 入池/去重，
   *  推入即被 Step1 的 deep watch 持久化到 localStorage） */
  scenes: Ref<SplitSceneRow[]>
}

export function useCopywritingMontageStep3Voice(ctx: CopywritingMontageStep3Context) {
  const { statusText, serverUrl, ensureServerUrl, assemblePlans, previewUrl,
    finalBusy, finalProgress, finalDone, finalVideoList, finalVideoPath,
    step4Candidates, collectCandidates, ensureProcessedSrt, sharedProductInfo, getScriptCopy, setScriptCopy,
    scenes } = ctx

  // ── Step3 口播配音（对照 step3_voice_view.py 逐控件 + VoiceCloneWorker api 模式 +
  // VideoDubbingWorker；TTS 直连用户可改 apiUrl，初值跟随 server_url + /indextts/tts；
  // 2026-09-05 服务端将删 /voxcpm/*，随声音克隆裁决统一切 IndexTTS）──
  const voiceDirInput = ref('')
  const selectedVoiceFiles = ref<string[]>([])
  const voicesDir = ref('')
  const voiceRows = ref<VoiceRow[]>([])
  // 参考声音（用户裁决 2026-09-03：声音样本从服务端取，与 VoiceClone 页同源 GET /voice/samples；
  // 原版为本地 voice_samples_page 样本库，本端以服务端样本库对齐）
  const refSamples = ref<Array<{ id: string; name: string; url: string; text: string }>>([])
  const selectedRefSample = ref<{ id: string; url: string } | null>(null)
  const refAudioPath = ref('')
  const refAudioLabel = ref('未找到预设声音样本')
  /** 选中样本播放条地址（对齐 VoiceClone samplePreviewUrl：常驻 audio 控件换 src） */
  const refPreviewUrl = ref('')
  const refText = ref('')
  // TTS 参数（L114-175；inference_timesteps/cfg_value 存而不用，原版同口径）
  const ttsApiUrl = ref('')
  const ttsSteps = ref(10)
  const ttsCfg = ref(2.0)
  const ttsSpeedMin = ref(0.9)
  const ttsSpeedMax = ref(1.2)
  // 字幕/花字（L210-265）
  // 2026-09-11 用户裁决：烧制字幕默认勾选（Step4 特效包装开箱即用，未配置也走字幕烧制）
  const addSubtitles = ref(true)
  const subtitleFont = ref('')
  const fontOptions = ref<Array<{ label: string; value: string }>>([{ label: '默认（不指定字体）', value: '' }])
  const fontsLoading = ref(false)
  const fancyEnabled = ref(false)
  const fancyStyle = ref('gold')
  // 字幕样式（2026-09-17 用户裁决：字幕样式统一来自服务端 /subtitle_styles）
  const subtitleStyleKey = ref('')
  const subtitleStylePresets = ref<SubtitleStylePreset[]>(SUBTITLE_STYLE_PRESETS_FALLBACK)
  // 字幕入场动画 key（2026-09-10 用户裁决：字幕可选动画，预览与烧制同用该选择；
  // key 与主进程 VALID_ANIMS 同表：fade/rise/slide/pop/none）
  const subtitleAnimKey = ref('fade')
  // 2026-09-22 用户裁决：字幕字号默认 12 号（2026-09-18 曾定 10，实测仍偏小）；
  // 第四步「字号」下拉覆写，预览同比例缩放
  const subtitleFontSize = ref(12)
  // 花字位置/字幕背景/模板（L224-352；模板首项「自定义 (下方样式)」value=''）
  const fancyPosition = ref('upper_middle')
  // 字幕背景不透明度默认 20%（2026-09-15 用户裁决：背景里的透明默认设计为 20%，原 0.5）
  const subtitleBgOpacity = ref(0.2)
  const fancyTemplateId = ref('')
  const fancyTemplates = ref<FancyTemplateItem[]>([])
  const fancyPreviews = ref<Record<string, string>>({})
  const fancyTemplatesLoading = ref(false)
  // ── 文字模板 textfx（已迁 montage/useCopywritingMontageTextFx.ts，铁律 10 E3b 纯搬迁）──
  const tfx = useCopywritingMontageTextFx({
    voiceRows, assemblePlans, finalBusy, step4Candidates, collectCandidates, sharedProductInfo,
    listAnnotatePlans: () => storyboards.value
      .filter((t) => t.narrative.trim())
      .map((t) => ({
        key: `plan:${t.id}`,
        name: t.name,
        text: t.narrative.trim(),
        timingPath: t.voiceWav ? `${t.voiceWav}.timing.json` : '',
        durationSec: t.voiceDurSec > 0 ? Math.round(t.voiceDurSec) : Math.round(t.shots.reduce((a, sh) => a + (Number(sh.duration) || 0), 0)),
      })),
  })
  const {
    textFxEnabled, lutRestore, lutId, lutList, lutListLoading, loadLuts,
    textTemplateId, textRandomCount, textKeywordDensity, textTemplates, textTemplatesLoading,
    activeTextPool, activeTextCount, textTemplateOptions, catalogTextLanes, loadCatalogLanes,
    textFxPreviewTracks, textFxStyleSamples, srvBase, loadTextTemplates,
    textFxAnnotate, addManualKeyword, removeManualKeyword,
    resolveKeywordHits, currentMatchTemplateIds, refreshTextFxTracks,
    scheduleManualKwRefresh, addManualAnnot, removeManualAnnot, annotsFor,
  } = tfx

  // AI 改写（_show_ai_rewrite_settings：ai_rewrite_temperature 默认 0.5 → 自由度 50%）
  const rewriteTemp = ref(0.5)
  const aiRewriteDlg = ref({ show: false, pct: 50 })
    // TTS 引擎选择与克隆参数（2026-09-09 用户裁决：文案生成设置左边加 TTS 下拉，默认 idexttts，
    //  对齐声音克隆页裁决；duration_factor/emo_text/emo_alpha 契约同 /indextts/tts，克隆时逐条随请求发送）
    // 2026-09-20 用户裁决：默认 QwenTTS（engine=qwen3）
    // 2026-09-28 用户裁决：默认引擎 VoxCPM2（engine=voxcpm）
    const ttsEngine = ref<'indextts' | 'qwen3' | 'voxcpm'>('voxcpm')
    const ttsDurationFactor = ref(1.0)   // 语速 0.5~2.0，默认 1.0（对齐 VoiceClone 页）
    const ttsEmoText = ref('')           // 情感文字（空=用样本默认情感）
    const ttsEmoAlpha = ref(0.5)         // 情感强度 0~1，默认 0.5
    // 句间停顿（2026-09-08 服务端新增，毫秒；0=不插标记，句间停顿由模型按标点自然处理）
    const ttsPauseMs = ref(0)
    // 2026-09-20：补 engine 字段（对齐智能混剪端；设置声音克隆对话框按引擎显示各自参数）
    const cloneParamsDlg = ref({ show: false, factor: 1.0, emo: '', alpha: 0.5, pause: 0, engine: 'voxcpm' })
    // Qwen3-TTS 专属设置（2026-09-20 用户裁决：设置声音克隆对话框按引擎提供各自参数）
    const qwen3Speaker = ref('')
    const qwen3Instruct = ref('')
    const qwen3Voices = ref<Array<{ value: string; label: string }>>([])
    const qwen3VoicesLoading = ref(false)
    async function loadQwen3Voices(): Promise<void> {
      if (qwen3VoicesLoading.value) return
      qwen3VoicesLoading.value = true
      try {
        const res = await window.tintin.server.ttsQwen3Voices()
        const speakers = res && 'speakers' in res && Array.isArray(res.speakers) ? res.speakers : []
        qwen3Voices.value = speakers.map((v) => ({ value: String(v), label: String(v) }))
      } finally { qwen3VoicesLoading.value = false }
    }
  const editDlg = ref({ show: false, index: -1, title: '', content: '', original: '' })
  const voiceBusy = ref(false)
  const rewriteBusy = ref(false)
  // 2026-09-09 用户裁决：配音动作迁 Step4 统一合成（dubBusy/dubbingEnabled/配音弹窗随之移除）

  let offVoiceProgress: (() => void) | null = null

/** 清理口播进度监听（原 useCopywritingMontage 闭包槽复位口径：有则调用并置空） */
function clearVoiceProgressListener(): void {
  offVoiceProgress?.()
  offVoiceProgress = null
}

  // 批量克隆/配音整体进度（0-100）：主进程逐条 emitRow，渲染层按
  //  「已完成条数 + 当条百分比」聚合；动作行下方进度条呈现（2026-09-09 用户裁决）
  const voiceProgress = ref(0)
  let voiceTotal = 0
  let voiceDone = 0
  function nextVoiceChannel(): string {
    const ch = `voice:progress:${(crypto?.randomUUID?.() || `${Date.now()}_${Math.floor(Math.random() * 1e8)}`).replace(/-/g, '')}`
    offVoiceProgress?.(); offVoiceProgress = null
    offVoiceProgress = window.tintin?.server?.onVoiceProgress?.(ch, (d) => {
      if (d.rowIdx !== undefined && d.rowIdx >= 0) {
        const row = voiceRows.value[d.rowIdx]
        if (row) {
          if (d.value !== undefined) row.progress = d.value
          if (d.value !== undefined) row.status = d.value >= 100 ? 'done' : 'generating'
          // 2026-09-11 用户裁决「状态要实时」：完成事件随带 wavPath/时长即回写（此前
          // wavPath 只在整批返回后统一回写 → 已合成行整批期间仍显示未生成/灰字/试听禁用）
          if (d.wavPath) {
            row.wavPath = d.wavPath
            row.dubbedPath = ''
            row.voiceDurSec = d.durSec || 0
            row.status = 'done'
            row.progress = 100
          } else if (d.failed) {
            row.status = 'pending'
            row.progress = 0
          }
        }
        if (d.value !== undefined && voiceTotal > 0) {
          if (d.value >= 100 || d.failed) voiceDone++ // 失败行同样终结，计入完成数（否则总进度到不了 100）
          const frac = d.value < 100 ? d.value / 100 : 0
          voiceProgress.value = Math.min(100, Math.round(((voiceDone + frac) / voiceTotal) * 100))
        }
      }
      // Step4 统一合成：进度接通 + 成片增量上表（2026-09-12 用户反馈：服务端已合成完
      // 列表仍空——此前 final:mix 的 value 无 rowIdx 分支被丢弃致进度条不动，列表只在
      // 整批返回后填充；现 donePath 逐条追加、进度实时回写。条件排除克隆/配音链
      // （带 rowIdx / wavPath），避免 Step4 一键链本地配音段误写合成进度）
      if (finalBusy.value && d.rowIdx === undefined && !d.wavPath) {
        if (d.value !== undefined) finalProgress.value = d.value
        if (d.donePath && !finalVideoList.value.some((it) => it.path === d.donePath)) {
          finalVideoList.value = [...finalVideoList.value, { name: pathBasename(d.donePath), path: d.donePath }]
          if (!finalVideoPath.value) finalVideoPath.value = d.donePath
          finalDone.value = true
        }
      }
      if (d.stage) statusText.value = d.stage
    }) || null
    return ch
  }

  /** TTS 地址初值跟随系统设置（原版 ai_config.vox_api_url 同源等价） */
  async function ensureTtsApiUrl(): Promise<void> {
    if (ttsApiUrl.value) return
    const url = await ensureServerUrl()
    if (url) ttsApiUrl.value = url.replace(/\/$/, '') + '/indextts/tts'
  }

  /** 选择视频（原 _select_voice_dir 本地目录选择：2026-09-08 用户裁决口播配音不需要视频输入功能，删除；
   *  配音对象改为自动取 Step2 已确认合成产物所在目录，见下方 watch） */

  /** 确认产物所在目录（去重保序；2026-09-09 修复：确认合成产物可能分散在多个 outputs 目录——
   *  落盘目录跟随确认时的 splitsJobId，jobId 被重置后（清空缓存/重新分割）产物落到 session 目录，
   *  Step3 只扫第一个目录致「合成 3 个只显示 1 个」实测根因） */
  function confirmedVoiceDirs(paths: string[]): string[] {
    const dirs: string[] = []
    for (const p of paths) {
      const dir = p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')))
      if (dir && !dirs.includes(dir)) dirs.push(dir)
    }
    return dirs
  }

  /** 扫描视频目录（对照 _do_scan_voice_dir；保留已编辑文案 existing_texts 口径）。
   *  keepFiles：本次确认合成产物列表，主进程据此清理首个目录里的旧 montage_concat_* 产物
   *  （对照 _cleanup_stale_montage_outputs L597-634；不传则不清理仅扫描）。
   *  dirs：聚合扫描目录列表（2026-09-09 新增；缺省=[voiceDirInput]），
   *  确认产物分散多目录时逐目录扫描合并，配音对象目录仍取首个（voices/outputs 推导基准不变）。 */
  async function scanVoiceDir(opts?: { keepFiles?: string[]; dirs?: string[] }): Promise<void> {
    const dirs = (opts?.dirs?.length ? opts.dirs : [voiceDirInput.value]).filter((d) => d && d.trim())
    if (!dirs.length) { voiceRows.value = []; return }
    try {
      const prevTexts = new Map(voiceRows.value.map((r) => [r.path, r.text]))
      // 展开为纯数组：ref([]) 的 .value 是响应式 Proxy，ipcRenderer.invoke 结构化克隆
      //   不支持 Proxy，直接传会批「An object could not be cloned」致扫描永远失败
      //   （2026-09-08 实测：Step3 视频列表从未建成的真正根因）
      const allFiles: Array<{ path: string; name: string; originalText: string; wavPath?: string; dubbedPath?: string; durationSec?: number; voiceDurSec?: number }> = []
      let voicesDirFirst = ''
      for (let i = 0; i < dirs.length; i++) {
        const dirPath = dirs[i]
        const res = await window.tintin?.server?.voiceScanDir?.({
          dirPath,
          selectedFiles: [...selectedVoiceFiles.value],
          // keepFiles 清理只作用于首个目录（原版单目录口径）；其余目录仅扫描不清理
          keepFiles: i === 0 && opts?.keepFiles?.length ? [...opts.keepFiles] : undefined,
        })
        if (!res || 'error' in res) throw new Error((res as { error?: string })?.error || '扫描失败')
        if (!voicesDirFirst) voicesDirFirst = res.voicesDir || ''
        allFiles.push(...res.files)
      }
      // 多目录合并去重（同路径防御）
      const seen = new Set<string>()
      const files = allFiles.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)))
      voicesDir.value = voicesDirFirst
      // 2026-09-21 用户裁决：第一步文案带入——行无旁车 .txt（原文空）时，配音文案回退第一步文案
      const tabNarrs = storyboards.value.map((s) => s.narrative.trim())
      voiceRows.value = files.map((f, fi) => ({
        path: f.path,
        name: f.name,
        text: prevTexts.get(f.path) || f.originalText || tabNarrs[fi] || '',
        originalText: f.originalText || tabNarrs[fi] || '',
        status: f.wavPath ? 'done' : 'pending',
        progress: f.wavPath ? 100 : 0,
        wavPath: f.wavPath || '',
        // 配音产物重关联（2026-09-15 报障：重启后 dubbedPath 丢失 → 导出时间轴静默丢口播）
        dubbedPath: f.dubbedPath || '',
        lengthMode: 'video' as const,
        durationSec: f.durationSec || 0,
        // 克隆音频时长（2026-09-10 报障修复：重建行时从扫描结果恢复，不再恒 0 → --:--）
        voiceDurSec: f.voiceDurSec || 0,
      }))
    } catch (e) {
      statusText.value = `扫描失败： ${errText(e)}`
    }
  }

  /** 配音视频自动就绪（2026-09-08 用户裁决：口播配音无视频输入功能）：
   *  Step2 确认合成的产物落盘后自动取其所在目录为配音对象目录并扫描，
   *  保留已编辑文案（existing_texts 口径）；文案行数随确认产物变化重建 */
  watch(
    () => assemblePlans.value.map((p) => (p.confirmed ? p.outputPath || '' : '')).join('|'),
    async (sig) => {
      const paths = sig.split('|').filter(Boolean)
      if (!paths.length) return
      const first = paths[0]
      const dir = first.slice(0, Math.max(first.lastIndexOf('\\'), first.lastIndexOf('/')))
      if (!dir) return
      // 确认产物同落一个 outputs 目录：不能以「目录变化/列表为空」为重扫条件，
      // 否则第 2~N 条确认完成后不会进列表（旧守卫 bug）；签名变化即重扫，
      // 已编辑文案由 scanVoiceDir 的 prevTexts 按路径保留。
      // 2026-09-09：产物可能分散多目录（jobId 重置后落 session），聚合扫描全部目录
      voiceDirInput.value = dir
      // 分镜驱动批量（2026-09-21 用户裁决）：确认产物落旁白 sidecar（plan.copy=分镜脚本旁白），
      // 确保扫描行文案按分镜对应；写完再扫描
      const plans = assemblePlans.value
      for (const p of plans) {
        if (p.confirmed && p.outputPath && p.copy) {
          try {
            await window.tintin?.liveclip?.writeTextFile?.({
              path: p.outputPath.replace(/.[^.]+$/, '') + '.txt',
              content: p.copy,
            })
          } catch (_) { /* sidecar 失败不阻断，行文案回退激活旁白 */ }
        }
      }
      await scanVoiceDir({ dirs: confirmedVoiceDirs(paths) })
    },
  )

  /** 进入 Step3 自动带视频（对照 _on_enter_step_3 L636-656 一比一）：
   *  取已确认合成产物所在目录 → 清理旧产物 → 回填目录并扫描。
   *  无确认产物时不动现有列表（保留原版回退语义的空态）。
   *  字幕字体列表来自服务端，进 Step3 预拉一次（对照同函数 L667-669：
   *  if not _fonts_loaded → _refresh_server_fonts；失败可用「刷新字体」重拉） */
  let fontsPreloaded = false
  let subtitleStylesPreloaded = false
  async function enterStepVoice(): Promise<void> {
    if (!fontsPreloaded) {
      fontsPreloaded = true
      void refreshFonts()
    }
    if (!subtitleStylesPreloaded) {
      subtitleStylesPreloaded = true
      void refreshSubtitleStyles()
    }
    const confirmed = assemblePlans.value
      .filter((p) => p.confirmed && p.outputPath)
      .map((p) => p.outputPath as string)
    if (!confirmed.length) return
    const first = confirmed[0]
    const dir = first.slice(0, Math.max(first.lastIndexOf('\\'), first.lastIndexOf('/')))
    if (!dir) return
    voiceDirInput.value = dir
    // 2026-09-09 修复：确认产物可能分散多目录（jobId 重置后落 session），聚合扫描全部目录
    await scanVoiceDir({ keepFiles: confirmed, dirs: confirmedVoiceDirs(confirmed) })
  }

  /** 拉取服务端声音样本库（GET /voice/samples，与 VoiceClone 页 loadCatalog 同源） */
  async function loadRefSamples(): Promise<void> {
    try {
      const raw = await window.tintin?.server?.ttsVoicesSamples?.()
      const list = Array.isArray(raw) ? raw : (extractArrayLike(raw))
      refSamples.value = list.map((s: any) => ({
        id: String(s.id ?? ''),
        name: String(s.name ?? `样本${s.id ?? ''}`),
        url: String(s.audio_url || ''),   // 契约 /voice/samples 音频字段为 audio_url；url 属猜测兜底，删除
        text: String(s.text || ''),
      }))
    } catch (_) { refSamples.value = [] /* 服务端离线时呈无样本态 */ }
  }

  /** {items|data|samples|...} 包裹响应解包（对齐 useVoiceCloneStudio extractArray 口径） */
  function extractArrayLike(res: unknown): any[] {
    if (Array.isArray(res)) return res
    if (res && typeof res === 'object') {
      const obj = res as Record<string, unknown>
      for (const key of ['items', 'data', 'samples', 'voices', 'list', 'results']) {
        if (Array.isArray(obj[key])) return obj[key] as any[]
      }
    }
    return []
  }

  /** 下拉选择：服务端样本（sample:{id}）；选中即换播放条 src（对齐 VoiceClone selectSample → loadSamplePreview） */
  function selectRefAudio(value: string): void {
    if (value.startsWith('sample:')) {
      const s = refSamples.value.find((x) => x.id === value.slice(7))
      if (!s) return
      selectedRefSample.value = { id: s.id, url: s.url }
      refAudioPath.value = ''
      refAudioLabel.value = s.name
      // 对齐 VoiceClone 页 selectSample：自动填充样本参考文字
      if (s.text) refText.value = s.text
      // 播放条地址：服务端相对路径拼绝对 URL（直连服务端，媒体栈自行加载，无 base64/blob 中间环节）
      if (!s.url) { refPreviewUrl.value = ''; return }
      refPreviewUrl.value = /^https?:/i.test(s.url)
        ? s.url
        : serverUrl.value.replace(/\/$/, '') + (s.url.startsWith('/') ? s.url : '/' + s.url)
      if (!serverUrl.value) void ensureServerUrl().then(() => {
        const cur = selectedRefSample.value
        if (cur?.url && !/^https?:/i.test(cur.url)) {
          refPreviewUrl.value = serverUrl.value.replace(/\/$/, '') + (cur.url.startsWith('/') ? cur.url : '/' + cur.url)
        }
      })
    } else {
      selectedRefSample.value = null
      refAudioLabel.value = refSamples.value.length ? '请选择声音样本' : '未找到预设声音样本'
    }
  }

  /** 底部上传新样本（对齐 VoiceClone onUploadNewSample：音频+名称+文字 → 服务端
   *  POST /voice/samples → 刷新下拉并自动选中；2026-09-08 用户裁决与声音克隆页同口径，
   *  不再是行内「选择本地文件」仅本地路径的旧交互） */
  const nsFilePath = ref('')
  const nsName = ref('')
  const nsText = ref('')
  const nsError = ref('')
  const nsSuccess = ref('')
  const nsBusy = ref(false)
  const nsTranscribing = ref(false)

  function pickNewSampleFile(): void {
    void (async () => {
      try {
        const p = await window.tintin?.dialog?.openFile?.({
          title: '选择音频文件上传为样本',
          filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg'] }, { name: 'All Files', extensions: ['*'] }],
        })
        if (!p) return
        nsFilePath.value = p
        const base = pathBasename(p).replace(/\.[^.]+$/, '')
        if (base && !nsName.value) nsName.value = base
      } catch (_) { /* 取消 */ }
    })()
  }

  /** 上传样本时 ASR 识别音频文字（VoiceClone transcribeForNewSample 同款） */
  function transcribeNewSample(): void {
    void (async () => {
      if (!nsFilePath.value) return
      nsTranscribing.value = true
      nsError.value = ''
      try {
        const res = await window.tintin.server.asrTranscribe({
          audio: { path: nsFilePath.value } as unknown as Blob,
          language: 'zh',
          format: 'txt',
        } as any)
        if (!res || (res as any).error) throw new Error((res as any)?.error || '识别失败')
        const segments = parseTranscriptionResponse(res)
        const text = segmentsToPlainText(segments)
        if (!text) throw new Error('未从音频中识别到文字（音频可能为空或无语音）')
        nsText.value = text
      } catch (err) {
        nsError.value = `文字识别失败：${errText(err)}`
      } finally {
        nsTranscribing.value = false
      }
    })()
  }

  function uploadNewSampleRef(): void {
    void (async () => {
      nsError.value = ''
      nsSuccess.value = ''
      if (!nsFilePath.value) { nsError.value = '请先选择音频文件'; return }
      if (!nsName.value.trim()) { nsError.value = '请输入样本名称'; return }
      nsBusy.value = true
      try {
        const res = await window.tintin.server.ttsUploadSample({
          file: { path: nsFilePath.value } as unknown as Blob,
          name: nsName.value.trim(),
          text: nsText.value.trim() || '',
        } as any)
        if (!res || (res as any).error) throw new Error((res as any)?.error || '上传失败')
        const newId = String((res as any)?.id || '')
        await loadRefSamples()
        if (newId) selectRefAudio(`sample:${newId}`)
        nsSuccess.value = `样本「${nsName.value}」上传成功，已自动选中`
        nsFilePath.value = ''
        nsName.value = ''
        nsText.value = ''
      } catch (err) {
        nsError.value = errText(err)
      } finally {
        nsBusy.value = false
      }
    })()
  }

  /** 文案生成设置弹窗（对照 _show_ai_rewrite_settings：slider 初值 = 当前温度换算） */
  function openRewriteSettings(): void {
    aiRewriteDlg.value = { show: true, pct: Math.round((1.0 - rewriteTemp.value) * 100) }
  }
  function closeRewriteSettings(): void { aiRewriteDlg.value.show = false }
  function saveRewriteSettings(): void {
    rewriteTemp.value = rewriteTemperature(aiRewriteDlg.value.pct)
    aiRewriteDlg.value.show = false
  }

  /** 设置声音克隆弹窗（对齐声音克隆页 IndexTTS 参数：语速/情感/情感强度；保存后克隆时生效。
   *  句间停顿：2026-09-08 服务端新增 ((pause=毫秒)) 标记口径） */
  function openCloneParams(): void {
    cloneParamsDlg.value = { show: true, factor: ttsDurationFactor.value, emo: ttsEmoText.value, alpha: ttsEmoAlpha.value, pause: ttsPauseMs.value, engine: ttsEngine.value }
    // QwenTTS 时预载预置音色列表（2026-09-20 用户裁决）
    if (ttsEngine.value === 'qwen3' && !qwen3Voices.value.length) void loadQwen3Voices()
  }
  function closeCloneParams(): void { cloneParamsDlg.value.show = false }
  function saveCloneParams(): void {
    ttsDurationFactor.value = cloneParamsDlg.value.factor
    ttsEmoText.value = cloneParamsDlg.value.emo
    ttsEmoAlpha.value = cloneParamsDlg.value.alpha
    ttsPauseMs.value = cloneParamsDlg.value.pause
    cloneParamsDlg.value.show = false
  }

  /** 一键AI修改全部文案（对照 _batch_ai_rewrite_scripts + BatchAITextRewriteWorker；
   *  V3 LLM 凭证由服务端持有（用户裁决 2026-08-28）→ 不再检查本地 llm_model 配置） */
  async function batchAiRewrite(): Promise<void> {
    if (rewriteBusy.value) return
    const tasks = voiceRows.value
      .map((r, i) => ({ i, text: r.originalText || r.text.trim() }))
      .filter((t) => t.text)
    if (!tasks.length) { notify('无可改写内容', '当前列表中没有可改写的视频或文案。'); return }
    rewriteBusy.value = true
    statusText.value = '正在调用AI批量修改文案...'
    let failed = 0
    try {
      const system = buildRewriteSystemPrompt(rewriteTemp.value)
      for (let k = 0; k < tasks.length; k++) {
        const t = tasks[k]
        statusText.value = `正在调用AI批量修改文案... (${k + 1}/${tasks.length})`
        try {
          const res = await window.tintin?.server?.llmChat?.({
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: t.text },
            ],
            temperature: rewriteTemp.value,
          })
          const content = String((res as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? '')
          if (content) voiceRows.value[t.i].text = cleanRewriteContent(content)
        } catch (_) { failed++ }
      }
      statusText.value = '完成： 一键AI修改全部文案完成！'
      notify('成功', '批量AI文案修改润色完成！')
    } finally {
      rewriteBusy.value = false
    }
  }

  /** voice:cloneBatch 公共载荷（runCloneBatch / cloneScriptCopy 共用） */
  function clonePayload() {
    return {
      refAudioPath: refAudioPath.value,
      // 2026-09-20 用户裁决：传 sample_id 走样本库渠道——服务端用库内样本并自动补
      // ref_text，主进程不再重复下载样本音频转 b64（省带宽；0=未选样本 → Base 音色）
      sampleId: Number(selectedRefSample.value?.id || 0),
      refAudioUrl: selectedRefSample.value?.url || '',
      apiUrl: ttsApiUrl.value,
      speedMin: ttsSpeedMin.value,
      speedMax: ttsSpeedMax.value,
      // 克隆参数（「设置声音克隆」弹窗配置；主进程展开进 /indextts/tts 载荷）
      ttsParams: {
        durationFactor: ttsDurationFactor.value,
        emoText: ttsEmoText.value,
        emoAlpha: ttsEmoAlpha.value,
        pauseMs: ttsPauseMs.value,
        // Qwen3-TTS 专属（2026-09-20 用户裁决）：预置音色/指令文本随批次下发
        speaker: qwen3Speaker.value,
        instruct: qwen3Instruct.value,
      },
      // 2026-09-20（服务端 TTS 统一入口）：engine=qwen3 → Qwen3-TTS；
      // refText=参考音频文稿（qwen3 克隆必填 ref_text 的文稿源）
      engine: ttsEngine.value,
      refText: refText.value,
    }
  }

  /** 单条/批量克隆人声（对照 _start_synthesize_voice + VoiceCloneWorker.run） */
  async function runCloneBatch(rowIdxs: number[]): Promise<{ ok: number; failures: Array<{ rowIdx: number; msg: string }> }> {
    const tasks = rowIdxs
      .filter((i) => voiceRows.value[i]?.text.trim())
      .map((i) => ({
        rowIdx: i,
        text: voiceRows.value[i].text.trim(),
        videoPath: voiceRows.value[i].path,
        outWavPath: joinPath(voicesDir.value, `voice_${i + 1}.wav`),
      }))
    voiceBusy.value = true
    voiceTotal = tasks.length; voiceDone = 0; voiceProgress.value = 0
    const channel = nextVoiceChannel()
    try {
      const res = await window.tintin?.server?.voiceCloneBatch?.({
        tasks,
        ...clonePayload(),
        progressChannel: channel,
      })
      if (!res) throw new Error('主进程不可达')
      if ('error' in res) throw new Error(res.error)
      // 回写已生成 wav（generated_voice_paths 口径）+ 状态
      for (const t of tasks) {
        const wav = res.results[t.videoPath]
        if (wav && voiceRows.value[t.rowIdx]) {
          voiceRows.value[t.rowIdx].wavPath = wav
          // 重新克隆 = 旧配音失效（Step4 一键链检测到缺 dubbedPath 会自动重配）
          voiceRows.value[t.rowIdx].dubbedPath = ''
          voiceRows.value[t.rowIdx].status = 'done'
          voiceRows.value[t.rowIdx].progress = 100
          // 克隆音频时长（voice_audio_durations 口径，行内绿字）
          voiceRows.value[t.rowIdx].voiceDurSec = res.durations?.[t.videoPath] || 0
        } else if (voiceRows.value[t.rowIdx]) {
          voiceRows.value[t.rowIdx].status = 'pending'
          voiceRows.value[t.rowIdx].progress = 0
        }
      }
      // 2026-09-18 用户裁决：字幕重切段后处理在声音克隆完成后立即执行——逐条成功
      //   克隆生成 SRT 资产（LLM 重切段 + timing 映射）落 srt/，供本地剪映导出与
      //   服务端合成 subtitle_srt 上传消费；best-effort，失败不阻断克隆结果
      for (const t of tasks) {
        const wav = res.results[t.videoPath]
        if (wav) await ensureProcessedSrt(t.text, wav, t.videoPath)
      }
      return { ok: Object.keys(res.results).length, failures: res.failures }
    } finally {
      voiceBusy.value = false
      offVoiceProgress?.(); offVoiceProgress = null
    }
  }

  // ── 多分镜脚本（2026-09-21 用户裁决：分镜脚本支持多个，tab 切换，每个分镜脚本对应
  //  一个视频；二/三步对全部分镜批量处理；分镜数据内存化不持久化；tab 上限 10）──
  interface StoryboardTab {
    id: string
    name: string
    /** 来源脚本库 id（''=AI 生成/手动；选择脚本时同 id 的 tab 已存在则直接切换） */
    scriptId: string
    /** 服务端脚本库选题（首次同步/保存时生成；同 topic 覆盖更新） */
    topic: string
    /** 该脚本的旁白（第一步文案框绑定激活 tab 的旁白） */
    narrative: string
    shots: StoryboardShot[]
    /** 每镜绑定的分割素材 idx 有序组（2026-09-22 用户裁决：一镜多片·按时长装填——
     *  外层=镜、内层=该镜按序使用的片段；空数组=未绑定） */
    clipGroups: number[][]
    /** 分镜生成/应用时的旁白快照（过期判定：narrative 改过即过期） */
    sourceNarrative: string
    /** 整体克隆产物（2026-09-21 用户裁决：每分镜脚本一条整段声音；二/三步批量处理） */
    voiceWav: string
    voiceDurSec: number
    /** 克隆产物在服务端音频库的 id（2026-09-30 用户裁决 B：wav 上传
     *  POST /audio/library/upload category=口播→归一「配音」池；''=未上传——脚本
     *  同步不携带口播引用，换机应用脚本后无口播可恢复，重新批量克隆即可重建） */
    voiceAudioId: string
    /** 每脚本视频设置（2026-09-23 用户裁决：输出画幅/转场动画/输出帧率按 tab 绑定——
     *  切 tab 即切设置，导出按各 tab 自身 transition 消费；时长限制=跟随本 tab 声音时长派生值） */
    layout: string
    transition: string
    fps: number | 'source'
    /** 产品快照（2026-09-23 用户裁决：品牌/产品/型号 摘要，创建时自 sharedProductInfo
     *  快照、选择脚本时自服务端 detail.product 带回；选择弹窗等处展示脚本基本信息） */
    productBrief: string
  }
  const COPY_STORYBOARD_MAX = 10
  const storyboards = ref<StoryboardTab[]>([])
  const activeStoryboardId = ref('')

  // ── 会话持久化（2026-09-22 用户裁决 A5：装填结果/克隆声音/音效包装产物落
  //  localStorage，重启恢复——分镜内容仍以服务端脚本库为权威（选择脚本整组刷新），
  //  本缓存只恢复本地态：绑定组/声音/音效路径，避免重跑智能匹配与音效包装。
  //  声音/音效为 cacheDir 下的稳定本地路径，重启后仍有效；缓存被清则路径失效，
  //  重按批量克隆/音效包装即可重建）──
  const STORYBOARDS_LS_KEY = 'copywriting-montage.storyboards'
  const STORYBOARDS_LS_ACTIVE = 'copywriting-montage.storyboards.active'
  function reviveTab(raw: unknown): StoryboardTab | null {
    if (!raw || typeof raw !== 'object') return null
    const t = raw as Record<string, unknown>
    const shots = Array.isArray(t.shots) ? (t.shots as StoryboardShot[]) : []
    if (!shots.length || !String(t.id || '')) return null
    const rawGroups = Array.isArray(t.clipGroups) ? (t.clipGroups as unknown[]) : []
    const clipGroups = rawGroups
      .map((g) => (Array.isArray(g) ? (g as unknown[]).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0) : []))
      .slice(0, shots.length)
    while (clipGroups.length < shots.length) clipGroups.push([])
    return {
      id: String(t.id),
      name: String(t.name || '').slice(0, 20) || '未命名分镜',
      scriptId: String(t.scriptId || ''),
      topic: String(t.topic || ''),
      narrative: String(t.narrative || ''),
      shots,
      clipGroups,
      sourceNarrative: String(t.sourceNarrative || t.narrative || ''),
      voiceWav: String(t.voiceWav || ''),
      voiceDurSec: Number(t.voiceDurSec) || 0,
      voiceAudioId: String(t.voiceAudioId || ''),
      // 每脚本视频设置（恢复失败/旧缓存缺字段回退全局默认）
      layout: String(t.layout || 'vertical'),
      transition: String(t.transition || 'random'),
      fps: t.fps === 'source' || Number(t.fps) > 0 ? (t.fps === 'source' ? 'source' : Number(t.fps)) : 'source',
      productBrief: String(t.productBrief || ''),
    }
  }
  function restoreStoryboards(): void {
    try {
      const raw = localStorage.getItem(STORYBOARDS_LS_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const seen = new Set<string>()
      const tabs = parsed.slice(0, COPY_STORYBOARD_MAX)
        .map(reviveTab)
        .filter((t): t is StoryboardTab => !!t)
        // 2026-09-22 用户裁决：脚本身份统一——同服务端脚本 id 的重复 tab 只保留一个
        //（修复历史缓存里「同内容双 tab」），后续新写入不再产生重复
        .filter((t) => {
          if (t.scriptId && seen.has(t.scriptId)) return false
          if (t.scriptId) seen.add(t.scriptId)
          return true
        })
      if (!tabs.length) return
      storyboards.value = tabs
      const act = localStorage.getItem(STORYBOARDS_LS_ACTIVE)
      activeStoryboardId.value = act && tabs.some((t) => t.id === act) ? act : tabs[0].id
    } catch (_) { /* 缓存损坏忽略，走空态 */ }
  }
  restoreStoryboards()
  // 分镜（旁白/声音/时长）变化 → 标注面板与预览轨重刷
  watch(storyboards, () => { scheduleManualKwRefresh() }, { deep: true })
  watch(storyboards, () => {
    try {
      localStorage.setItem(STORYBOARDS_LS_KEY, JSON.stringify(storyboards.value))
      localStorage.setItem(STORYBOARDS_LS_ACTIVE, activeStoryboardId.value)
    } catch (_) { /* 存储满/不可写静默 */ }
  }, { deep: true })
  watch(activeStoryboardId, (v) => {
    try { localStorage.setItem(STORYBOARDS_LS_ACTIVE, v) } catch (_) {}
  })

  const activeStoryboard = computed(() =>
    storyboards.value.find((s) => s.id === activeStoryboardId.value) || null)
  function nextStoryboardName(): string {
    let max = 0
    for (const s of storyboards.value) {
      const m = /^脚本(\d+)$/.exec(s.name)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return `脚本${max + 1}`
  }
  /** 产品快照摘要（品牌/产品(品类)/型号 非空拼接；detail.product 与 sharedProductInfo 两形态通用） */
  function productBriefOf(p: { brand?: string; product?: string; category?: string; model?: string }): string {
    return [p.brand, p.product || p.category, p.model].map((x) => String(x || '').trim()).filter(Boolean).join(' / ')
  }
  /** 新增分镜 tab（AI 生成分镜/选择脚本/手动新建都走这里）；超上限返回 null */
  function addStoryboardTab(init: { name?: string; scriptId?: string; topic?: string; narrative: string; shots: StoryboardShot[]; productBrief?: string }): StoryboardTab | null {
    if (storyboards.value.length >= COPY_STORYBOARD_MAX) return null
    const tab: StoryboardTab = {
      id: `sb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      name: (init.name || '').trim() || nextStoryboardName(),
      scriptId: init.scriptId || '',
      topic: init.topic || '',
      narrative: init.narrative,
      shots: init.shots,
      clipGroups: init.shots.map(() => []),
      sourceNarrative: init.narrative,
      voiceWav: '',
      voiceDurSec: 0,
      voiceAudioId: '',
      layout: 'vertical',
      transition: 'random',
      fps: 'source',
      productBrief: (init.productBrief || '').trim(),
    }
    storyboards.value.push(tab)
    activeStoryboardId.value = tab.id
    return tab
  }
  function removeStoryboardTab(id: string): void {
    const i = storyboards.value.findIndex((s) => s.id === id)
    if (i < 0) return
    storyboards.value.splice(i, 1)
    if (activeStoryboardId.value === id) {
      activeStoryboardId.value = storyboards.value[Math.min(i, storyboards.value.length - 1)]?.id || ''
    }
  }
  function renameStoryboardTab(id: string, name: string): void {
    const tab = storyboards.value.find((s) => s.id === id)
    if (tab && name.trim()) tab.name = name.trim().slice(0, 20)
  }
  function setActiveStoryboard(id: string): void {
    if (storyboards.value.some((s) => s.id === id)) activeStoryboardId.value = id
  }
  /** 当前激活分镜的旁白（第一步文案框绑定此处；无分镜 tab → 全局草稿 manualCopy） */
  const activeNarrative = computed<string>({
    get: () => {
      const tab = activeStoryboard.value
      return tab ? tab.narrative : getScriptCopy()
    },
    set: (v) => {
      const tab = activeStoryboard.value
      if (tab) tab.narrative = v
      else setScriptCopy(v)
    },
  })
  /** 当前激活分镜的镜头（兼容口径：读写都落在激活 tab 上；无 tab → 空） */
  const copyShots = computed<StoryboardShot[]>({
    get: () => activeStoryboard.value?.shots || [],
    set: (v) => { const tab = activeStoryboard.value; if (tab) tab.shots = v },
  })
  const copyShotsStale = computed(() => {
    const tab = activeStoryboard.value
    return !!tab && tab.sourceNarrative.trim() !== tab.narrative.trim()
  })
  /** 每镜绑定的分割素材组（2026-09-22 用户裁决：一镜多片）。第三步「智能匹配/选择素材/
   *  解绑」写这里；确认预合成按组装填出方案 */
  const shotClipGroup = computed<number[][]>({
    get: () => activeStoryboard.value?.clipGroups || [],
    set: (v) => { const tab = activeStoryboard.value; if (tab) tab.clipGroups = v },
  })
  /** 单镜追加绑定（追加式选材；同片去重） */
  function bindShotMaterial(shotIdx: number, sceneIdx: number): void {
    if (shotIdx < 0 || shotIdx >= copyShots.value.length) return
    const arr = shotClipGroup.value.map((g) => g.slice())
    while (arr.length < copyShots.value.length) arr.push([])
    const g = arr[shotIdx] || []
    if (!g.includes(sceneIdx)) g.push(sceneIdx)
    arr[shotIdx] = g
    shotClipGroup.value = arr
  }
  /** 移除单镜组内指定位置的片段 */
  function removeShotClipAt(shotIdx: number, pos: number): void {
    if (shotIdx < 0 || shotIdx >= copyShots.value.length) return
    const arr = shotClipGroup.value.map((g) => g.slice())
    while (arr.length < copyShots.value.length) arr.push([])
    const g = arr[shotIdx] || []
    if (pos >= 0 && pos < g.length) g.splice(pos, 1)
    arr[shotIdx] = g
    shotClipGroup.value = arr
  }
  /** 清空单镜整组绑定 */
  function unbindShotMaterial(shotIdx: number): void {
    if (shotIdx < 0 || shotIdx >= copyShots.value.length) return
    const arr = shotClipGroup.value.map((g) => g.slice())
    while (arr.length < copyShots.value.length) arr.push([])
    arr[shotIdx] = []
    shotClipGroup.value = arr
  }
  /** 克隆合成全文 = 当前激活分镜的旁白（无分镜 tab → 全局草稿） */
  function copyShotsText(): string {
    return activeNarrative.value.trim()
  }

  /** 每步完成后同步分镜到服务端脚本库（2026-09-21 用户裁决：分镜数据以服务端为持久化层，
   *  每步完成即同步；同 topic 覆盖更新，best-effort——失败仅提示不阻断流程）。
   *  2026-09-23 用户裁决：防重入改「尾随合并」——同步进行中收到的新请求不再静默丢弃，
   *  当前轮结束后补跑一轮（智能匹配→生成剪辑方案接连触发时，最新绑定状态保证落库） */
  const scriptSyncing = ref(false)
  let scriptSyncQueued = false
  // ── 绑定随脚本跨机同步（2026-09-29 A′：clip_groups 附加字段——服务端存储原样
  //    透传已实测；历史实现只写单素材弱引用，换机/重新应用脚本后绑定全空）──
  /** 保存载荷附加每镜绑定组：clipGroups 下标 → 素材池 serverPath 实体标识数组 */
  function attachClipGroups(payload: Record<string, unknown>, tab: StoryboardTab): void {
    const shots = payload.shots as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(shots)) return
    const groups = encodeClipGroups(tab.clipGroups, scenes.value)
    shots.forEach((s, i) => { if (groups[i]?.length) s.clip_groups = groups[i] })
  }

  /** 应用脚本后异步恢复绑定：按 ref（'material://<id>' 或服务端分割片路径）入池——
   *  同 serverPath 行复用下标不重复入池；新行 downloadState=pending 懒下载；
   *  推入即被 Step1 的 deep watch 持久化。分镜绑定失效场景不变（重新智能匹配可重建）。 */
  async function restoreTabClipGroups(tab: StoryboardTab, groups: ClipBindingSeg[][]): Promise<void> {
    if (!groups.length) return
    await ensureServerUrl()
    const base = serverUrl.value.replace(/\/$/, '')
    // 响应式代理修复（2026-09-30 实测：恢复 23 段入池成功、toast 已弹，但 12 张分镜
    // 卡仍全部「未绑定素材」、storyboards 持久化 clipGroupsNonEmpty=0）——
    // addStoryboardTab 返回的是原始对象，直接改写其 clipGroups 不触发任何依赖更新
    // （界面 computed 缓存不刷新、A5 深度持久化 watch 不触发）。经 storyboards
    // 数组重新解析出代理对象再写。
    const live = storyboards.value.find((t) => t.id === tab.id) ?? tab
    let nextIdx = scenes.value.reduce((m, s) => Math.max(m, s.idx), 0)
    const byServerPath = new Map(scenes.value.map((s) => [s.serverPath, s.idx]))
    let restored = 0
    groups.forEach((segs, i) => {
      if (!segs || !segs.length) return
      const idxs: number[] = []
      for (const seg of segs) {
        const ref = String(seg.ref || '').trim()
        if (!ref) continue
        let idx = byServerPath.get(ref)
        if (idx === undefined) {
          nextIdx++
          const isMat = ref.startsWith('material://')
          const mid = isMat ? ref.slice('material://'.length) : ''
          const name = isMat ? `素材库 ${mid}` : (ref.split('/').pop() || ref)
          scenes.value.push({
            idx: nextIdx,
            name,
            sourceName: name,
            startSec: 0,
            endSec: seg.duration,
            duration: seg.duration,
            description: '',
            analysis: '',
            clipUrl: isMat
              ? `/material/serve?material_id=${encodeURIComponent(mid)}`
              : base + (ref.startsWith('/') ? ref : '/' + ref),
            serverPath: ref,
            downloadState: 'pending',
            checked: false,
            ...(seg.mediaType === 'image' ? { mediaType: 'image' as const } : {}),
          })
          byServerPath.set(ref, nextIdx)
          idx = nextIdx
        }
        idxs.push(idx)
      }
      if (idxs.length) { live.clipGroups[i] = idxs; restored += idxs.length }
    })
    if (restored) {
      notify('素材绑定已恢复', `脚本携带的绑定组已按服务端标识入池重建（${restored} 段）；若片段已不在服务端，重新智能匹配即可重建。`)
    }
  }

  async function syncStoryboardsToServer(): Promise<void> {
    if (!storyboards.value.length) return
    if (scriptSyncing.value) { scriptSyncQueued = true; return }
    scriptSyncing.value = true
    try {
      do {
        scriptSyncQueued = false
        const info = sharedProductInfo.value
        for (const tab of storyboards.value) {
          if (!tab.shots.length) continue
          if (!tab.topic) tab.topic = defaultStoryboardTopic()
          const payload = buildScriptPayload({
            topic: tab.topic,
            ratio: 'vertical',
            shots: tab.shots,
            product: { brand: info.brand || '', model: info.model || '', category: info.product || '', name: '' },
          })
          attachClipGroups(payload, tab)
          attachVoiceRef(payload, tab)
          // 与 saveStoryboard 同接口同忙场景（分割/合成排队时实测 68s 才返回）：2026-09-21
          // 用户裁决同步一并放宽 120s（30s 默认超时被掐即弹「分镜同步失败」）
          const res = await window.tintin.server.post('/api/storyboard/scripts', payload, undefined, 120000)
          if (res && typeof res === 'object' && 'error' in res) throw new Error(String(res.error || '同步失败'))
          // 2026-09-22 用户裁决：脚本身份统一——tab 回学服务端脚本 id（原不回学，
          // 「选择脚本」再次选到同一份即成重复 tab）
          const sid = (res as { id?: unknown } | null)?.id
          if (sid && !tab.scriptId) tab.scriptId = String(sid)
        }
      } while (scriptSyncQueued)
    } catch (e) {
      clientError('copywriting-montage', '分镜同步失败', errText(e))
      notify('分镜同步失败', errText(e))
    } finally {
      scriptSyncing.value = false
    }
  }
  // 2026-09-29 用户裁决：绑定随脚本同步的触发=三个里程碑动作——①第二步批量克隆
  // 完成（cloneAllTabVoices 内已有）②第三步生成剪辑方案成功（onConfirmCompose 内
  // 已有，0923 裁决）③第四步导出剪映草稿（Step4Panel 导出完成后调用，见该文件）。
  // 手动「保存脚本」不作为触发要求；不做成全局 watch（避免任何绑定抖动都触发全量
  // 脚本回传）。attachClipGroups 仍挂在本文件两个 POST 点，途经即携带。
  /** 进入模块时按 scriptId 回学服务端选题名（2026-09-23 用户裁决：本地持久化只恢复
   *  界面状态，同步是单向推——本地默认名「脚本N」会长期挂 Name；此处一次性拉脚本库
   *  列表，按 id 回填 tab.topic 与 tab.name（display_name 优先），best-effort 静默。 */
  const tabNamesSynced = new Set<string>()
  async function refreshTabNamesFromServer(): Promise<void> {
    const withId = storyboards.value.filter((t) => t.scriptId && !tabNamesSynced.has(t.scriptId))
    if (!withId.length) return
    for (const t of withId) tabNamesSynced.add(t.scriptId)
    try {
      const data = (await window.tintin.server.get('/api/storyboard/scripts', { page: 1, page_size: 100 })) as unknown
      if (!data || typeof data !== 'object' || 'error' in data) return
      const items = extractScriptItems(data)
      const byId = new Map<string, Record<string, unknown>>()
      for (const it of items) {
        const id = String((it as Record<string, unknown>).id ?? '').trim()
        if (id) byId.set(id, it as Record<string, unknown>)
      }
      for (const t of withId) {
        const hit = byId.get(String(t.scriptId))
        if (!hit) continue
        const topic = String(hit.topic ?? '').trim()
        const dn = String(hit.display_name ?? '').trim()
        if (topic) t.topic = topic
        if (dn) t.name = dn.slice(0, 20)
        else if (topic && /^脚本\d+$/.test(t.name)) t.name = topic.slice(0, 20)
      }
    } catch (_) { /* best-effort：失败保持本地名 */ }
  }
  /** ✨ AI 生成分镜：llm:chat → 现有分镜解析器（剥```/JSON/normalize）→ 整组替换镜头卡。
   *  解析失败（fallback 单镜回退标记）保留现有卡并报错，不吞用户已编辑内容 */
  const storyboardBusy = ref(false)
  async function genStoryboard(): Promise<void> {
    // 2026-09-21 用户裁决：口播文案与分镜脚本绑定——生成分镜取激活旁白
    // （activeNarrative：有 tab=激活 tab.narrative，无 tab=全局草稿），不再读全局草稿
    const copy = activeNarrative.value.trim()
    if (!copy) { notify('文案为空', '请先在「文案编写」页生成或填写视频文案。'); return }
    if (storyboardBusy.value) return
    storyboardBusy.value = true
    try {
      statusText.value = '正在根据旁白生成分镜脚本...'
      const { systemPrompt, userPrompt } = buildCopywritingStoryboardPrompt(copy)
      const res = await window.tintin.server.llmChat({
        model: '',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
      if (res && 'error' in res) throw new Error(String(res.error) || '服务端返回空错误')
      const content = String(res?.choices?.[0]?.message?.content ?? '')
      const parsed = parseStoryboardShots(content)
      if (parsed.fallback || !parsed.shots.length) throw new Error('分镜解析失败（模型未返回 JSON 数组），请重试')
      const tab = addStoryboardTab({ narrative: copy, shots: parsed.shots, productBrief: productBriefOf(sharedProductInfo.value) })
      if (!tab) {
        notify('分镜数量已达上限', `最多支持 ${COPY_STORYBOARD_MAX} 个分镜脚本，请先删除部分分镜。`)
        return
      }
      const total = parsed.shots.reduce((s, x) => s + (Number(x.duration) || 0), 0)
      statusText.value = `完成： 分镜「${tab.name}」已生成（${parsed.shots.length} 镜 / 约 ${Math.round(total)} 秒）`
      void syncStoryboardsToServer()
    } catch (e) {
      statusText.value = `失败： ${errText(e)}`
      notify('生成分镜失败', errText(e))
    } finally {
      storyboardBusy.value = false
    }
  }
  /** 保存分镜脚本（2026-09-21 用户裁决：与分镜脚本页一致——POST /api/storyboard/scripts
   *  入同一脚本库，工作台「选择脚本」刷新后可选；同 topic 覆盖更新。
   *  topic=分镜脚本_YYYYMMDD_HHMM 同款默认命名；ratio 固定竖屏（文案混剪输出口径）；
   *  product 随 sharedProductInfo（品牌/型号/品类）带回） */
  const scriptSaving = ref(false)
  async function saveStoryboard(): Promise<void> {
    if (scriptSaving.value) return
    if (!copyShots.value.length) {
      notify('当前没有分镜内容', '请先生成分镜脚本。')
      return
    }
    const tab = activeStoryboard.value
    if (!tab) {
      notify('当前没有分镜内容', '请先生成分镜脚本。')
      return
    }
    scriptSaving.value = true
    try {
      if (!tab.topic) tab.topic = defaultStoryboardTopic()
      const info = sharedProductInfo.value
      const payload = buildScriptPayload({
        topic: tab.topic,
        ratio: 'vertical',
        shots: copyShots.value,
        product: { brand: info.brand || '', model: info.model || '', category: info.product || '', name: '' },
      })
      attachClipGroups(payload, tab)
      attachVoiceRef(payload, tab)
      // 2026-09-21 用户报障「保存失败 Request timeout」：保存 POST 走通用通道默认 30s 超时，
      //   服务端正忙（如跑语音合成排队）时会被掐——保存放宽到 120s（仅本调用，通道向后兼容）
      const res = await window.tintin.server.post('/api/storyboard/scripts', payload, undefined, 120000)
      if (res === null || res === undefined) throw new Error('无法连接服务端。')
      if (typeof res === 'object' && 'error' in res) throw new Error(String(res.error || '保存失败'))
      // 2026-09-22 用户裁决：脚本身份统一——tab 回学服务端脚本 id（同 sync 口径）
      const sid = (res as { id?: unknown }).id
      if (sid && tab && !tab.scriptId) tab.scriptId = String(sid)
      // 2026-09-25 用户裁决：保存成功后 tab 名回学选题——仍是默认「脚本N」才回学，
      // 用户双击重命名过的名字保留（storyboardNameAfterSave）
      if (tab) tab.name = storyboardNameAfterSave(tab.name, tab.topic)
      const total = Math.round(Number(payload.total_duration) || 0)
      statusText.value = `完成： 分镜脚本已保存（${payload.shot_count} 镜 · ${total}s · 选题：${payload.topic}）`
      notify('保存成功', `分镜脚本已保存到脚本库（${payload.shot_count} 镜 · ${total}s · 选题：${payload.topic}），工作台「选择脚本」刷新后可选。`)
    } catch (e) {
      const msg = errText(e)
      statusText.value = `失败： ${msg}`
      if (/Request timeout/i.test(msg)) {
        notify('保存超时', '服务端 120 秒未响应，可能正忙（如正在合成语音等长任务），请稍后重试。')
      } else {
        notify('保存失败', msg)
      }
    } finally {
      scriptSaving.value = false
    }
  }
  /** 选择脚本（2026-09-21 用户裁决：与分镜脚本页一致——脚本库选脚本，分镜与旁白整组回填。
   *  详情口径同「继续创作」：文案=镜头旁白拼接） */
  const scriptPickDlg = ref({ show: false, loading: false, error: '', options: [] as ScriptSummary[], selectedId: '' })
  function openScriptPick(): void {
    scriptPickDlg.value = { show: true, loading: scriptPickDlg.value.loading, error: '', options: scriptPickDlg.value.options, selectedId: '' }
    void refreshScriptOptions()
  }
  async function refreshScriptOptions(): Promise<void> {
    scriptPickDlg.value.loading = true
    scriptPickDlg.value.error = ''
    try {
      const data = (await window.tintin.server.get('/api/storyboard/scripts', { page: 1, page_size: 100 })) as unknown
      if (data === null || data === undefined) throw new Error('无法连接服务端。')
      if (typeof data === 'object' && 'error' in data) throw new Error(String((data as { error: unknown }).error || '加载失败'))
      scriptPickDlg.value.options = extractScriptItems(data)
        .map(toScriptOption)
        .filter((s): s is ScriptSummary => s !== null)
    } catch (e) {
      scriptPickDlg.value.options = []
      scriptPickDlg.value.error = errText(e)
    } finally {
      scriptPickDlg.value.loading = false
    }
  }
  /** 弹窗内点选脚本：拉取详情供右侧基本信息展示（选题/镜数/总时长/逐镜列表）；
   *  2026-09-23 增 product 保留（应用脚本时写 tab.productBrief 展示脚本基本信息） */
  const pickDetail = ref<{
    loading: boolean
    error: string
    detail: { topic: string; ratio: string; product: { brand: string; model: string; category: string; name: string }; shots: StoryboardShot[]; clipGroups: ClipBindingSeg[][]; voiceAudioId: string; voiceDurSec: number } | null
  }>({ loading: false, detail: null, error: '' })
  async function selectScriptOption(id: string): Promise<void> {
    if (!id) return
    scriptPickDlg.value.selectedId = id
    pickDetail.value = { loading: true, detail: null, error: '' }
    try {
      const data = (await window.tintin.server.get(`/api/storyboard/scripts/${encodeURIComponent(id)}`, {})) as unknown
      if (data === null || data === undefined) throw new Error('无法连接服务端。')
      if (typeof data === 'object' && 'error' in data) throw new Error(String((data as { error: unknown }).error || '加载失败'))
      const script = parseScriptDetail(data)
      if (!script) throw new Error('脚本响应为空或格式不符。')
      pickDetail.value = {
        loading: false,
        detail: {
          topic: script.topic,
          ratio: script.ratio,
          product: {
            brand: String(script.product.brand || ''),
            model: String(script.product.model || ''),
            category: String(script.product.category || ''),
            name: String(script.product.name || ''),
          },
          shots: script.shots.map((s, i) => normalizeShot(s, i + 1)),
          // 2026-09-29 跨机绑定恢复：从原始 shots 提取 clip_groups（normalizeShot 白名单不带它）
          clipGroups: clipGroupsFromScriptShots((data as { shots?: unknown }).shots),
          // 2026-09-30 跨机口播恢复：根字段 voice_audio_id/voice_dur_sec（兼容 script 包裹）
          voiceAudioId: voiceRefFromScriptDetail(data).audioId,
          voiceDurSec: voiceRefFromScriptDetail(data).durSec,
        },
        error: '',
      }
    } catch (e) {
      pickDetail.value = { loading: false, detail: null, error: errText(e) }
    }
  }
  /** 应用选中的脚本：分镜与旁白整组回填为新分镜 tab（同脚本已开 → 直接切换） */
  /** 应用选中的脚本：分镜与旁白整组回填为新分镜 tab（同脚本已开 → 直接切换）。
   *  重建路径返回绑定恢复的 Promise（2026-10-06 仿视频交付步需等入池完成再生成方案；
   *  其余分支/既有火忘调用不受影响）。silent=程序化装载静默（2026-10-06 用户报障：
   *  仿视频装载是"以服务端为准重建"，弹「已切换分镜/已应用脚本」全是噪声） */
  function applySelectedScript(opts?: { silent?: boolean }): Promise<void> | void {
    const quiet = !!opts?.silent
    const id = scriptPickDlg.value.selectedId
    const detail = pickDetail.value.detail
    if (!id || !detail || !detail.shots.length) {
      if (!quiet) notify('未选择脚本', '请先在左侧列表选择一个脚本。')
      return
    }
    const existing = storyboards.value.find((s) => s.scriptId === id)
    if (existing) {
      activeStoryboardId.value = existing.id
      scriptPickDlg.value.show = false
      if (!quiet) notify('已切换分镜', `脚本已在分镜列表中，已切换到「${existing.name}」。`)
      return
    }
    const tab = addStoryboardTab({ name: detail.topic || '', scriptId: id, topic: detail.topic || '', narrative: shotsNarrationText(detail.shots), shots: detail.shots, productBrief: productBriefOf(detail.product) })
    if (!tab) {
      if (!quiet) notify('分镜数量已达上限', `最多支持 ${COPY_STORYBOARD_MAX} 个分镜脚本，请先删除部分分镜。`)
      return
    }
    // 2026-09-29 跨机绑定恢复：脚本带 clip_groups → 按服务端标识入池重建 clipGroups
    // 2026-10-06 仿视频桥接：clip_groups 缺失镜用根级 material_id 兜底（仿视频生成链
    // 回填 material_id 不写 clip_groups——缺失时恢复链全空=特效包装整页「未绑定素材」）
    // （异步不阻塞 tab 创建；素材已不在服务端时该段预合成会点名，重新智能匹配可重建）
    const restored = restoreTabClipGroups(tab, clipGroupsFromMaterialIds(detail.shots, detail.clipGroups))
    // 2026-09-30 跨机口播恢复：脚本带 voice_audio_id → 从音频库下载回填 tab.voiceWav
    void restoreTabVoiceFromLibrary(tab, detail.voiceAudioId, detail.voiceDurSec, {
      ensureServerUrl,
      getServerUrl: () => serverUrl.value,
      findTab: (id) => storyboards.value.find((t) => t.id === id),
    })
    scriptPickDlg.value.show = false
    statusText.value = `完成： 已应用脚本「${detail.topic || id}」（${detail.shots.length} 镜）`
    if (!quiet) notify('已应用脚本', `分镜与旁白已回填（${detail.shots.length} 镜），可在分镜卡上继续调整。`)
    return restored
  }
  /** 批量克隆全部分镜的旁白（2026-09-21 用户裁决：二/三步批量处理——每个分镜脚本
   *  一条整段声音；进度按 tab 聚合；单 tab 失败不阻断其余。产物落在各 tab.voiceWav） */
  async function cloneAllTabVoices(): Promise<void> {
    const tabs = storyboards.value.filter((s) => s.narrative.trim())
    if (!tabs.length) {
      notify('没有可克隆的旁白', '请先在分镜脚本中生成或填写旁白。')
      return
    }
    if (!refAudioPath.value && !selectedRefSample.value?.url) {
      notify('未选择声音样本', '请先选择或上传声音样本 (wav/mp3/m4a)！')
      return
    }
    await ensureTtsApiUrl()
    // 落盘：本地缓存 copy-montage/voice/（无视频目录可用；主进程 mkdirSync recursive 建目录）
    const cacheDir = await readCacheDir()
    if (!cacheDir) {
      notify('路径无效', '本地缓存目录不可用，请重启应用后重试。')
      return
    }
    const now = new Date()
    const p2 = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
    const tasks = tabs.map((tab, i) => {
      const outWavPath = joinPath(cacheDir, 'copy-montage', 'voice', `${tab.name}_voice_${stamp}_${i + 1}.wav`)
      return { rowIdx: i, text: tab.narrative.trim(), videoPath: outWavPath, outWavPath, tabId: tab.id }
    })
    // 2026-09-28 [object Object] 事故防回归：输出路径必须是绝对路径——旧热部署
    // host 的 env:cacheDir 曾返回对象（String 化成 '[object Object]' 当目录用），
    // 相对坏路径会让主进程把文件写进 launch-root 并在剪映里全部缺媒体
    for (const t of tasks) {
      if (!/^[A-Za-z]:[\\/]/.test(t.outWavPath)) {
        notify('路径异常', '缓存目录解析异常（' + t.outWavPath.slice(0, 60) + '）。请重启应用后重试；反复出现请检查通用设置·本地缓存目录。')
        return
      }
    }
    voiceBusy.value = true
    voiceTotal = tasks.length; voiceDone = 0; voiceProgress.value = 0
    const channel = nextVoiceChannel()
    try {
      const res = await window.tintin?.server?.voiceCloneBatch?.({ tasks, ...clonePayload(), progressChannel: channel })
      if (!res) throw new Error('主进程不可达')
      if ('error' in res) throw new Error(res.error)
      let ok = 0
      const fails: string[] = []
      for (const tk of tasks) {
        const wav = res.results[tk.videoPath]
        const tab = storyboards.value.find((s) => s.id === tk.tabId)
        if (wav && tab) {
          tab.voiceWav = wav
          tab.voiceDurSec = Number(res.durations[tk.videoPath] || 0)
          ok++
        } else {
          const f = res.failures.find((x) => x.rowIdx === tk.rowIdx)
          fails.push(`${tab ? tab.name : tk.outWavPath}：${f ? f.msg : '克隆失败'}`)
        }
      }
      if (ok) {
        statusText.value = `完成： ${ok}/${tabs.length} 个分镜声音已生成`
        notify('批量克隆完成', ok === tabs.length ? `${ok} 个分镜声音全部生成。` : `${ok}/${tabs.length} 个成功：${fails.join('；')}`)
        // 2026-09-30 用户裁决 B：克隆产物上传音频库（category=口播→归一「配音」池，
        // 编排实现在 useCopywritingMontageVoiceSync.ts），id 记 tab.voiceAudioId 随下方
        // 里程碑脚本同步跨机携带；单 tab 失败仅打点不阻断。必须先于
        // syncStoryboardsToServer 完成才能同轮携带。
        for (const tk of tasks) {
          const tab = storyboards.value.find((s) => s.id === tk.tabId)
          if (tab?.voiceWav) await uploadTabVoiceWav(tab)
        }
        // 2026-09-30 用户裁决 A：克隆后欠装检测提示——镜标将按旁白时长等比放大，
        // 「先匹配后克隆」的旧绑定组可能全长不足新目标。提示用户方案生成时会自动
        // 补片（裁决 B）；需要语义最优分配时可重新智能匹配。
        try {
          const pool = buildAssignPool(scenes.value)
          const cloned = storyboards.value.filter((t) => t.voiceWav && tasks.some((tk) => tk.tabId === t.id))
          let shortShots = 0
          let deficit = 0
          for (const t of cloned) {
            if (!t.clipGroups.length || t.clipGroups.length !== t.shots.length) continue
            const u = underfillAfterVoice(t.shots, t.clipGroups, pool, Number(t.voiceDurSec) || 0)
            shortShots += u.shotsShort
            deficit += u.deficitSec
          }
          if (shortShots > 0) {
            notify('镜标已按旁白放大', `旁白时长长于镜标设计：${shortShots} 个镜头的已绑定素材将不够填满（合计约差 ${deficit.toFixed(1)} 秒）。\n生成剪辑方案时会自动从素材池补片填满；如需按画面语义重新分配，可重新「智能匹配到分镜脚本」。`)
          }
        } catch { /* 检测失败不影响克隆完成提示 */ }
        // 2026-09-22 用户裁决：声音克隆完成后自动触发服务端同步——让脚本库及时
        // 感知声音状态（120s 超时、best-effort 不阻断）
        void syncStoryboardsToServer()
      } else {
        notify('批量克隆失败', fails.join('\n') || '未知原因')
      }
    } catch (e) {
      clientError('copywriting-montage', '批量克隆分镜声音失败', errText(e))
      notify('批量克隆失败', errText(e))
    } finally {
      voiceBusy.value = false
      offVoiceProgress?.(); offVoiceProgress = null
    }
  }

  /** 开始批量克隆人声合成（对照 _start_synthesize_voice 弹窗逐字） */
  async function startSynthesizeVoice(): Promise<void> {
    if (voiceBusy.value) return
    await ensureTtsApiUrl()
    if (!refAudioPath.value && !selectedRefSample.value?.url) {
      notify('未选择声音样本', '请先选择或上传声音样本 (wav/mp3/m4a)！')
      return
    }
    if (!voiceDirInput.value) {
      // 2026-09-21 用户裁决：文案混剪=先文案→再声音→再按文案剪辑——无视频时对
      // 第一步文案做纯声音克隆（自由时长），不再以「路径无效」阻断
      await cloneAllTabVoices()
      return
    }
    const idxs = voiceRows.value.map((_, i) => i).filter((i) => voiceRows.value[i].text.trim())
    if (!idxs.length) {
      notify('文案为空', '没有检测到任何有配音文案的视频。请在表格的“配音文案”栏输入内容。')
      return
    }
    const { ok, failures } = await runCloneBatch(idxs)
    statusText.value = '完成： 克隆人声音频生成完成！'
    if (failures.length) {
      statusText.value = `注意： 合成完成：成功 ${ok} 个，失败 ${failures.length} 个（已跳过）`
      const detail = failures.slice(0, 8).map((f) => `· 第 ${f.rowIdx + 1} 个：${f.msg}`).join('\n')
      const more = failures.length <= 8 ? '' : `\n…… 等共 ${failures.length} 个失败`
      notify(
        '部分合成失败',
        `批量人声克隆完成：成功 ${ok} 个，失败 ${failures.length} 个（已跳过，可单独重试）。\n\n${detail}${more}\n\n提示：失败多为服务端 TTS 异常（如 Qwen3 CUDA 崩溃/显存不足）或文案过长——重启服务端 TTS 服务后重试，或将引擎切换为 IndexTTS；也可缩短该条文案。`,
      )
    } else {
      notify('合成成功', `批量人声克隆合成完毕，共生成 ${ok} 个音频文件。`)
    }
  }

  /** Step4 一键链·配音阶段（原 startDubVideos 内核；2026-09-09 用户裁决：配音动作自
   *  Step3 迁入 Step4 统一合成时自动执行——纯化配音不烧特效（特效在 final:mix 阶段），
   *  完成回写 dubbedPath，不再弹配音完成弹窗；失败抛错由 startFinalMix 统一上报） */
  async function runDubBatch(): Promise<void> {
    if (!voiceDirInput.value) throw new Error('视频输入目录无效，请先回到第②步确认合成产物')
    const dubbedDir = joinPath(resolveOutMontageDir(voiceDirInput.value), 'dubbed')
    const tasks = voiceRows.value
      .filter((r) => r.wavPath && r.path)
      .map((r) => ({
        videoPath: r.path,
        voiceWavPath: r.wavPath,
        outVideoPath: joinPath(dubbedDir, `dubbed_${r.name}`),
        text: r.text.trim(),
      }))
    if (!tasks.length) return
    voiceTotal = tasks.length; voiceDone = 0; voiceProgress.value = 0
    const channel = nextVoiceChannel()
    try {
      // 纯化配音：字幕/花字特效已在 final:mix 统一烧制，此处不传任何特效配置
      const res = await window.tintin?.server?.voiceDubVideos?.({
        tasks,
        lengthModes: Object.fromEntries(voiceRows.value.map((r) => [r.path, r.lengthMode])),
        progressChannel: channel,
      })
      if (!res) throw new Error('主进程不可达')
      if ('error' in res) throw new Error(res.error)
      // 回写配音后视频（dubbed_video_paths 口径）
      for (const [vid, dubbed] of Object.entries(res.results)) {
        const row = voiceRows.value.find((r) => r.path === vid)
        if (row) row.dubbedPath = dubbed
      }
    } finally {
      offVoiceProgress?.(); offVoiceProgress = null
    }
  }

  /** 选定字体族名（对照 _selected_subtitle_font：itemData 空 → 未指定） */
  function selectedFontFamily(): string {
    const opt = fontOptions.value.find((o) => o.value === subtitleFont.value)
    return opt ? opt.value : ''
  }

  // ---- 字体自渲染设施（2026-09-09 裁决：字幕三行改造，下拉/预览按各自字体渲染，图2）----
  // fontId → 服务端族名（CSS font-family 回退链用）；FontFace 注册为 'stfont_<id>'
  //  独立族名，避免与本地同名字体冲突；fontFacesVersion 驱动样式重算。
  const serverFontFamilies = new Map<string, string>()
  const fontFaceLoaded = new Set<string>()
  const fontFacePending = new Set<string>()
  const fontFacesVersion = ref(0)

  /**
   * 预载服务端字体文件并注册 FontFace（GET /config/fonts/{id}/file）。
   * 2026-09-24 修复：不再走 voice:fontFile 桥通道——字体是二进制大对象，
   * 桥的 sendJson 会把字节 JSON.stringify 成数字数组文本（几十 MB 字体 →
   * 数百 MB 字符串，超 V8 上限抛 Invalid string length，渲染层解析该响应
   * 连带冻结主线程：症状=字幕字体下拉首次渲染时整个页面无响应，用户报障
   * 「选择分镜脚本点击没反应」正是弹窗渲染触发字体预载所致）。改渲染层
   * 直连服务端音频/字体 URL（样本试听 2026-09-07 同款裁决：媒体栈自加载，
   * 无 base64/JSON 中间环节），FontFace 接受 url 引用，按 fid 派生去重。
   */
  async function ensureServerFontFace(fid: string): Promise<void> {
    if (!fid || fontFaceLoaded.has(fid) || fontFacePending.has(fid)) return
    fontFacePending.add(fid)
    try {
      const base = await ensureServerUrl()
      if (!base) return
      const url = `${String(base).replace(/\/$/, '')}/config/fonts/${encodeURIComponent(fid)}/file`
      const ff = new FontFace(`stfont_${fid}`, `url(${JSON.stringify(url)})`)
      await ff.load()
      document.fonts.add(ff)
      fontFaceLoaded.add(fid)
      fontFacesVersion.value++
    } catch (_) {
      // 字体文件拉取失败：保留族名回退链，不阻断 UI
    } finally {
      fontFacePending.delete(fid)
    }
  }

  /** 字体选项的 CSS font-family（stfont_ 注册族 → 服务端族名 → sans-serif） */
  function fontOptionCssFamily(fid: string): string {
    if (!fid) return ''
    const family = (serverFontFamilies.get(fid) || '').replace(/'/g, '')
    return `'stfont_${fid}'${family ? `, '${family}'` : ''}, sans-serif`
  }

  /** TSelect optionStyle：字体下拉/触发器按所选字体自渲染；顺带惰性预载字体文件 */
  function fontOptionStyle(opt: { label: string; value: string | number }): Record<string, string> | undefined {
    const fid = String(opt.value || '')
    if (!fid) return undefined
    void fontFacesVersion.value
    void ensureServerFontFace(fid)
    return { fontFamily: fontOptionCssFamily(fid) }
  }

  /** 字幕效果预览（行3）：选中预设的 CSS 近似（描边 paintOrder）+ 选中字体 + 背景框 */
  const selectedSubtitlePreset = computed<SubtitleStylePreset>(
    () => subtitleStylePresets.value.find((p) => p.key === subtitleStyleKey.value) || subtitleStylePresets.value[0]
  )
  const subtitlePreviewStyle = computed<Record<string, string>>(() => {
    void fontFacesVersion.value
    const st = subtitlePresetTileStyle(selectedSubtitlePreset.value)
    // 2026-09-18：预览字号随「字号」设置同比例缩放（10 号→18px=原观感基准）
    st.fontSize = `${Math.round(subtitleFontSize.value * 1.8)}px`
    st.fontWeight = '700'
    st.lineHeight = '1.5'
    st.textAlign = 'center'
    if (subtitleFont.value) st.fontFamily = fontOptionCssFamily(subtitleFont.value)
    if (addSubtitles.value && subtitleBgOpacity.value > 0) {
      st.background = `rgba(0,0,0,${subtitleBgOpacity.value})`
    }
    return st
  })

  /** 刷新字体（对照 _refresh_server_fonts：失败降级空列表不阻断） */
  async function refreshFonts(): Promise<void> {
    if (fontsLoading.value) return
    fontsLoading.value = true
    try {
      const res = await window.tintin?.server?.voiceFonts?.()
      const fonts = res && !('error' in res) ? res.fonts || [] : []
      // 对照 _populate_font_combo：首项「默认（不指定字体）」；同族多字重追加文件名区分
      const items: Array<{ label: string; value: string }> = [{ label: '默认（不指定字体）', value: '' }]
      const seen = new Set<string>()
      for (const f of fonts) {
        const fid = String(f.id || '').trim()
        const family = String(f.family || f.filename || '').trim()
        if (!fid || !family) continue
        serverFontFamilies.set(fid, family)
        const label = seen.has(family) && f.filename ? `${family}（${f.filename}）` : family
        seen.add(family)
        items.push({ label, value: fid })
      }
      fontOptions.value = items
      // 后台按序预载字体文件（自渲染下拉需要；FontFace 注册一次后 document.fonts 缓存复用）
      void items.slice(1).reduce(
        (p, it) => p.then(() => ensureServerFontFace(it.value)),
        Promise.resolve()
      )
      if (!subtitleFont.value) subtitleFont.value = ''
      statusText.value = items.length > 1
        ? `已从服务端加载 ${items.length - 1} 个字体`
        : '服务端未返回字体，字幕将使用默认字体'
    } catch (_) {
      statusText.value = '拉取服务端字体失败，字幕将使用默认字体'
    } finally {
      fontsLoading.value = false
    }
  }

  /** 刷新字幕样式（2026-09-17 用户裁决：字幕样式统一来自服务端 /subtitle_styles）。
   *  失败降级兆底预设（SUBTITLE_STYLE_PRESETS_FALLBACK），不阻断 UI。 */
  async function refreshSubtitleStyles(): Promise<void> {
    try {
      const res = await window.tintin?.server?.voiceSubtitleStyles?.()
      const styles = res && !('error' in res) ? res.styles || [] : []
      if (styles.length) {
        subtitleStylePresets.value = serverStylesToPresets(styles)
        // 默认选中第一个（或保持当前选中，若仍在列表中）
        if (!subtitleStyleKey.value || !subtitleStylePresets.value.some((p) => p.key === subtitleStyleKey.value)) {
          subtitleStyleKey.value = subtitleStylePresets.value[0]?.key || ''
        }
      }
    } catch (_) {
      // 降级兆底预设，不阻断
    }
  }

  /** 花字模板列表 + 预览图（对照 _start_fancy_preview_loader / _update_fancy_template_preview）。
   *  2026-09-09 对齐核实：服务端 GET /fancy/templates 返回的剪映系模板与本地同格式
   *  （style 即 ffmpeg drawtext 样式串），可直接进本地配音烧制链；来源标记仅用于
   *  UI 后缀展示。预览图：服务端模板与本地同一 ffmpeg drawtext 预览口径。
   *  服务端离线/失败回退本地 resources/fancy/templates。 */
  async function loadFancyTemplates(): Promise<void> {
    if (fancyTemplatesLoading.value) return
    fancyTemplatesLoading.value = true
    try {
      // 服务端模板库（宽容解析：items 包裹/数组直收；离线 null）
      const sr = await window.tintin?.server?.fancyServerTemplates?.()
      const serverItems: FancyTemplateItem[] = sr && !('error' in sr) && Array.isArray(sr.templates)
        ? sr.templates.map((t) => ({
            ...t,
            // 防御：服务端模板 style 必为 drawtext 样式串，缺省置空（不可进烧制链时预览/烧制自动降级）
            style: String((t as Record<string, unknown>).style ?? ''),
            origin: 'server' as const,
            anim: '',
            hasSound: !!(t as Record<string, unknown>).sound,
          }))
        : []
      // 本地模板（服务端不可用时的回退集）
      const res = await window.tintin?.server?.fancyListTemplates?.()
      const localItems: FancyTemplateItem[] = res && !('error' in res)
        ? res.templates.map((t) => ({ ...t, origin: 'local' as const }))
        : []
      fancyTemplates.value = [...serverItems, ...localItems]
      fancyPreviews.value = res && !('error' in res) ? { ...res.previews } : {}
      // 本地+服务端缺失预览图后台补齐（同一 drawtext 预览口径；服务端模板传 dict 生成）
      const r2 = await window.tintin?.server?.fancyEnsurePreviews?.(
        serverItems.length ? { templates: serverItems.map((t) => ({ ...t })) } : undefined,
      )
      if (r2 && !('error' in r2) && r2.generated > 0) {
        fancyPreviews.value = { ...fancyPreviews.value, ...r2.previews }
      }
      if (serverItems.length) {
        statusText.value = `已从服务端加载 ${serverItems.length} 个花字模板`
      }
    } catch (_) { /* 模板加载失败不阻断页面 */ } finally {
      fancyTemplatesLoading.value = false
    }
  }

  /** 选定模板 dict（模板优先：样式/动画/音效以模板为准；未选/未勾选返回 null=自定义样式） */
  const selectedFancyTemplate = computed(() => {
    if (!fancyEnabled.value || !fancyTemplateId.value) return null
    return fancyTemplates.value.find((t) => t.template_id === fancyTemplateId.value) || null
  })

  /** 双击文案 → 弹窗编辑（对照 _on_edit_double_clicked → TextEditDialog） */
  function openEditDlg(index: number): void {
    const row = voiceRows.value[index]
    if (!row) return
    editDlg.value = {
      show: true,
      index,
      title: `编辑第 ${index + 1} 行配音文案`,
      content: row.text,
      original: row.originalText,
    }
  }
  function saveEditDlg(): void {
    const i = editDlg.value.index
    if (i >= 0 && voiceRows.value[i]) voiceRows.value[i].text = editDlg.value.content
    editDlg.value.show = false
  }

  /** 导出克隆声音（对照 _on_btn_export_clicked：保存对话框 + copy2 + 成功提示） */
  async function exportVoice(index: number): Promise<void> {
    const row = voiceRows.value[index]
    if (!row?.wavPath) return
    try {
      const savePath = await window.tintin?.dialog?.saveFile?.({
        title: '导出克隆声音',
        defaultPath: pathBasename(row.wavPath),
        filters: [{ name: 'Audio Files', extensions: ['wav'] }, { name: 'All Files', extensions: ['*'] }],
      })
      if (!savePath) return
      const r = await window.tintin?.server?.voiceExportAudio?.({ srcPath: row.wavPath, savePath })
      if (r && 'error' in r) throw new Error(r.error)
      notify('导出成功', `人声音频成功导出至：\n${savePath}`)
    } catch (e) {
      clientError('video-montage', '导出人声音频失败', e)
      notify('导出失败', errText(e))
    }
  }

  /** 行播放视频：配音后优先（对照 _on_play_row_video L6725-6733）→ 内置播放器 */
  function playRowVideo(index: number): void {
    const row = voiceRows.value[index]
    if (!row) return
    const target = (row.dubbedPath && row.dubbedPath.endsWith('.mp4')) ? row.dubbedPath : row.path
    if (target) previewUrl.value = target
  }

  /** 播放配音后的视频（对照 btn_play_dubbed：仅已生成时可用）→ 内置播放器 */
  function playDubbedVideo(index: number): void {
    const row = voiceRows.value[index]
    if (row?.dubbedPath) previewUrl.value = row.dubbedPath
  }

  /** 时长模式切换（对照 btn_length_mode toggle：video↔audio + tooltip 两态） */
  function toggleLengthMode(index: number): void {
    const row = voiceRows.value[index]
    if (row) row.lengthMode = row.lengthMode === 'video' ? 'audio' : 'video'
  }

  function lengthModeTip(row: VoiceRow): string {
    return row.lengthMode === 'video'
      ? '以视频长度为准（点击切换为以音频长度为准）'
      : '以音频长度为准，视频不够用最后一帧补足（点击切回）'
  }

  /** 仅重新生成该声音（对照 _on_btn_regen_clicked：空文案弹窗 + 单条合成） */
  async function regenVoice(index: number): Promise<void> {
    const row = voiceRows.value[index]
    if (!row) return
    if (!row.text.trim()) {
      notify('配音文案为空', '该行文案为空，无法生成克隆人声。')
      return
    }
    await ensureTtsApiUrl()
    await runCloneBatch([index])
  }

  return {
    voiceDirInput, selectedVoiceFiles, voicesDir, voiceRows,
    // Qwen3-TTS 专属（2026-09-20 用户裁决）
    qwen3Speaker, qwen3Instruct, qwen3Voices, qwen3VoicesLoading, loadQwen3Voices,
    refSamples, selectedRefSample, refAudioPath, refAudioLabel, refPreviewUrl, refText,
    ttsApiUrl, ttsSteps, ttsCfg, ttsSpeedMin, ttsSpeedMax,
    addSubtitles, subtitleFont, fontOptions, fontsLoading,
    fancyEnabled, fancyStyle, subtitleStyleKey, subtitleStylePresets, subtitleAnimKey,
    subtitleFontSize, fancyPosition, subtitleBgOpacity, fancyTemplateId, fancyTemplates,
    fancyPreviews, fancyTemplatesLoading, textFxEnabled, lutRestore, lutId, lutList,
    lutListLoading, textTemplateId, textRandomCount, textKeywordDensity, textTemplates,
    textTemplatesLoading, activeTextPool, activeTextCount, textTemplateOptions,
    textFxPreviewTracks, textFxStyleSamples, srvBase, rewriteTemp, aiRewriteDlg,
    textFxAnnotate, addManualKeyword, removeManualKeyword, addManualAnnot, removeManualAnnot, annotsFor,
    ttsEngine, ttsDurationFactor, ttsEmoText, ttsEmoAlpha, ttsPauseMs, cloneParamsDlg,
    editDlg, voiceBusy, rewriteBusy, voiceProgress,
    loadLuts, loadCatalogLanes, resolveKeywordHits,
    currentMatchTemplateIds, refreshTextFxTracks, loadTextTemplates, ensureTtsApiUrl,
    copyShots, copyShotsStale, shotClipGroup, bindShotMaterial, removeShotClipAt, unbindShotMaterial,
    storyboards, activeStoryboardId, activeStoryboard, setActiveStoryboard, renameStoryboardTab, removeStoryboardTab, activeNarrative, COPY_STORYBOARD_MAX,
    scriptSyncing, syncStoryboardsToServer,
    refreshTabNamesFromServer,
    genStoryboard, storyboardBusy, scriptSaving, saveStoryboard,
    scriptPickDlg, openScriptPick, refreshScriptOptions, pickDetail, selectScriptOption, applySelectedScript,
    nextVoiceChannel, clearVoiceProgressListener, scanVoiceDir, enterStepVoice,
    loadRefSamples, selectRefAudio, pickNewSampleFile, transcribeNewSample,
    nsFilePath, nsName, nsText, nsError, nsSuccess, nsBusy, nsTranscribing,
    uploadNewSampleRef, batchAiRewrite, startSynthesizeVoice, runDubBatch, runCloneBatch,
    selectedFontFamily, ensureServerFontFace, fontOptionStyle, selectedSubtitlePreset,
    subtitlePreviewStyle, refreshFonts, refreshSubtitleStyles, loadFancyTemplates,
    selectedFancyTemplate, openEditDlg, saveEditDlg, exportVoice, playRowVideo,
    playDubbedVideo, toggleLengthMode, lengthModeTip, regenVoice,
    openRewriteSettings, closeRewriteSettings, saveRewriteSettings,
    openCloneParams, closeCloneParams, saveCloneParams,
  }
}

/** 花字模板项（fancyListTemplates 返回字段；PR#4 对照 utils/fancy_templates.py） */
export type FancyTemplateItem = Record<string, unknown> & {
  template_id: string
  name: string
  style: string
  anim: string
  hasSound: boolean
  /** 模板来源（2026-09-09 服务端对接）：server=GET /fancy/templates 模板库；local=本地 resources/fancy */
  origin?: 'server' | 'local'
  /** 服务端模板描述（textfx 模板无本地预览图，UI 显描述文字） */
  description?: string
  category?: string
}

// TSelect 选项最小结构已随 Step2（TRANSITIONS）迁 montage/useCopywritingMontageStep2Concat.ts
