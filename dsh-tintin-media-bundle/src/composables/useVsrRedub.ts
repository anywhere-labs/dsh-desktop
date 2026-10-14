// ═══════════════════════════════════════════════════════════════
// useVsrRedub — 视频去水印字幕·第 2 步「字幕配音」编排（2026-10-13 用户裁决：
//   去除字幕后的视频重新配新字幕并导出剪映草稿）。
// 音频方案：保留原音频（默认，字幕=whisper 转写分段）/ 生成新配音（TTS 整段
//   替换原声，voiceClips 轨）。字幕样式与文案混剪 Step4 同源：/subtitle_styles
//   预设色板 + /config/fonts + 入场动画/字号/背景不透明度（serverStyle 直传导出器）。
// 导出：jianyingExport 单视频（keep）/ multi 单段+静音+voiceClips（redub）——
//   与文案混剪特效包装同一导出管线（lib/jianying/jianying-exporter.js）。
// ═══════════════════════════════════════════════════════════════
import { computed, ref } from 'vue'
import {
  parseTranscriptionResponse,
  segmentsToPlainText,
  segmentsToSrt,
  type SrtSegment,
} from './srtUtils'
import {
  serverStylesToPresets,
  SUBTITLE_STYLE_PRESETS_FALLBACK,
  type SubtitleStylePreset,
} from './copywritingMontageStep4FxBgmLogic'

export interface VsrRedubOptions {
  /** 第 1 步产物（去字幕后视频）的本地绝对路径（自动落盘结果） */
  getResultPath: () => string
  /** 原视频文件名（推导 SRT/草稿命名） */
  getFileName: () => string
  /** 原视频时长（秒，redub 音轨长度用） */
  getDurationSec: () => number
}

/** utf8 文本 → base64（tts:saveAudio 落盘 SRT 用；分块避免栈溢出） */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/** 通用防御解析：{items}|{fonts}|{data}|裸数组 → 数组 */
function extractArray(res: unknown): unknown[] {
  if (Array.isArray(res)) return res
  if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>
    for (const key of ['items', 'fonts', 'data', 'list', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[]
    }
  }
  return []
}

/** 入场动画选项（key 与主进程 VALID_ANIMS 同表，对照文案混剪 Step4） */
export const VSR_SUB_ANIM_OPTIONS = [
  { label: '淡入', value: 'fade' },
  { label: '上浮', value: 'rise' },
  { label: '滑入', value: 'slide' },
  { label: '弹入', value: 'pop' },
  { label: '无动画', value: 'none' },
]
/** 字号选项（值=剪映草稿 texts styles[].size，对照文案混剪 Step4） */
export const VSR_FONT_SIZE_OPTIONS = [6, 8, 10, 12, 15, 20, 25, 30].map((v) => ({ label: String(v), value: v }))

export function useVsrRedub(options: VsrRedubOptions) {
  // ── 音频方案 ──
  const plan = ref<'keep' | 'redub'>('keep')
  const planOptions = [
    { label: '保留原音频（原声配新字幕）', value: 'keep' },
    { label: '生成新配音（TTS 替换原声）', value: 'redub' },
  ]

  // ── 语音转写（字幕文本+时间轴来源）──
  const transcribing = ref(false)
  const transcribeError = ref('')
  const transcribed = ref(false)
  const segments = ref<SrtSegment[]>([])
  const srtPath = ref('')
  const segmentLines = computed(() =>
    segments.value.map((s, i) => `#${i + 1}  [${Number(s.start).toFixed(2)}s – ${Number(s.end).toFixed(2)}s]  ${s.text}`))

  /** 转写去字幕后的视频 → 分段（字幕轨）+ 全文（配音文案初稿）→ SRT 落盘 */
  async function transcribe(): Promise<void> {
    const videoPath = options.getResultPath()
    if (!videoPath) {
      transcribeError.value = '还没有第 1 步的去字幕视频——请先完成移除并等待自动保存'
      return
    }
    transcribing.value = true
    transcribeError.value = ''
    try {
      const res = await window.tintin.server.asrTranscribe({
        audio: { path: videoPath } as unknown as Blob,
        fmt: 'json',
      } as never)
      if (!res || (res as { error?: string }).error) {
        throw new Error((res as { error?: string })?.error || '识别失败（服务端离线或音频无法解码）')
      }
      const segs = parseTranscriptionResponse(res)
      if (!segs.length) throw new Error('未从视频音轨中识别到语音（原片可能无口播）')
      segments.value = segs
      redubText.value = segmentsToPlainText(segs)
      // SRT 落盘（剪映导出器读文件路径）：缓存目录 /vsr_srt/<原名>.srt
      const base = (options.getFileName() || 'video').replace(/\.[^.]+$/, '')
      const cache = await window.tintin.env.cacheDir()
      const dir = cache && !cache.error ? `${String(cache.dir || '').replace(/[/\\]+$/, '')}/vsr_srt` : 'vsr_srt'
      const saved = await window.tintin.server.ttsSaveAudio({
        base64: utf8ToBase64(segmentsToSrt(segs)),
        savePath: `${dir}/${base}.srt`,
      })
      if (saved && typeof saved === 'object' && (saved as { error?: string }).error) {
        throw new Error((saved as { error?: string }).error)
      }
      srtPath.value = typeof saved === 'string' ? saved : ''
      transcribed.value = true
    } catch (err) {
      transcribeError.value = err instanceof Error ? err.message : String(err)
    } finally {
      transcribing.value = false
    }
  }

  // ── 字幕样式（与文案混剪 Step4 同源：/subtitle_styles + /config/fonts）──
  const stylePresets = ref<SubtitleStylePreset[]>(SUBTITLE_STYLE_PRESETS_FALLBACK)
  const styleKey = ref(SUBTITLE_STYLE_PRESETS_FALLBACK[0]?.key || '')
  const selectedPreset = computed(() =>
    stylePresets.value.find((p) => p.key === styleKey.value) || stylePresets.value[0] || null)
  const fonts = ref<Array<{ id: string; name: string }>>([])
  const fontId = ref('')
  const bgOpacity = ref(30)
  const animKey = ref('fade')
  const fontSize = ref(12)

  async function loadStyleAssets(): Promise<void> {
    try {
      const res = await window.tintin?.server?.voiceSubtitleStyles?.()
      const styles = res && !('error' in res) ? res.styles || [] : []
      if (styles.length) {
        stylePresets.value = serverStylesToPresets(styles)
        if (!stylePresets.value.some((p) => p.key === styleKey.value)) {
          styleKey.value = stylePresets.value[0]?.key || ''
        }
      }
    } catch { /* 降级本地预设 */ }
    try {
      const res = await window.tintin?.server?.get('/config/fonts')
      const list = extractArray(res)
      fonts.value = list
        .map((f) => f as { id?: unknown; name?: unknown })
        .filter((f) => f.id !== undefined)
        .map((f) => ({ id: String(f.id), name: String(f.name ?? f.id) }))
    } catch { /* 字体列表失败不阻断（导出不依赖） */ }
  }

  /** 导出用字幕样式：选中预设的 serverStyle 直传（文案混剪同口径）+ 字体选择合入 */
  const exportSubtitleStyle = computed<Record<string, unknown> | null>(() => {
    const st = selectedPreset.value?.serverStyle
    if (!st) return fontId.value ? { font: fontId.value } : null
    return fontId.value ? { ...st, font: fontId.value } : st
  })

  // ── 重新配音（TTS 整段替换原声；样本/引擎与声音克隆页同源）──
  const dubbing = ref(false)
  const dubError = ref('')
  const dubAudioPath = ref('')
  const redubText = ref('')
  const dubSamples = ref<Array<{ value: string; label: string }>>([])
  const dubSampleId = ref('')
  const dubEngine = ref('voxcpm')

  async function loadDubSamples(): Promise<void> {
    try {
      const res = await window.tintin.server.ttsVoicesSamples()
      const list = extractArray(res)
      dubSamples.value = list.map((v) => {
        const o = v as { id?: unknown; name?: unknown }
        return { value: String(o.id ?? ''), label: String(o.name ?? o.id ?? '') }
      }).filter((s) => s.value)
      if (dubSamples.value.length && !dubSamples.value.some((s) => s.value === dubSampleId.value)) {
        dubSampleId.value = dubSamples.value[0]!.value
      }
    } catch { dubSamples.value = [] }
  }

  /** 生成新配音：TTS 整段（voxcpm，ref_text=转写全文）→ 下载落盘（缓存目录） */
  async function generateDub(): Promise<void> {
    const text = redubText.value.trim()
    if (!text) { dubError.value = '配音文案为空——请先转写或手动填写'; return }
    if (!dubSampleId.value) { dubError.value = '请先选择声音样本'; return }
    dubbing.value = true
    dubError.value = ''
    try {
      const res = await window.tintin.server.ttsGenerate({
        text,
        sample_id: Number(dubSampleId.value),
        engine: dubEngine.value,
        ref_text: segmentsToPlainText(segments.value) || text,
        resp: 'json',
      } as never)
      if (!res || (res as { error?: string }).error) throw new Error((res as { error?: string })?.error || '服务端离线')
      let audioUrl = String((res as { audio_url?: string }).audio_url || '')
      if (audioUrl && !/^https?:\/\//i.test(audioUrl)) {
        const ping = await window.tintin.env.serverPing()
        const base = String(ping?.url || '').replace(/\/$/, '')
        audioUrl = base + (audioUrl.startsWith('/') ? audioUrl : '/' + audioUrl)
      }
      if (!/^https?:\/\//i.test(audioUrl)) throw new Error('服务端未返回音频地址')
      const cache = await window.tintin.env.cacheDir()
      const dir = cache && !cache.error ? `${String(cache.dir || '').replace(/[/\\]+$/, '')}/vsr_dub` : 'vsr_dub'
      const base = (options.getFileName() || 'video').replace(/\.[^.]+$/, '')
      const saved = await window.tintin.server.downloadResult(audioUrl, `${dir}/${base}_配音.wav`)
      if (!saved) throw new Error('配音音频下载失败')
      dubAudioPath.value = String(saved)
    } catch (err) {
      dubError.value = err instanceof Error ? err.message : String(err)
    } finally {
      dubbing.value = false
    }
  }

  // ── 导出剪映草稿 ──
  const exporting = ref(false)
  const exportMessage = ref('')
  const exportOk = ref<boolean | null>(null)

  async function exportDraft(): Promise<void> {
    const videoPath = options.getResultPath()
    if (!videoPath) { exportMessage.value = '还没有去字幕视频'; exportOk.value = false; return }
    if (plan.value === 'keep' && !srtPath.value) { exportMessage.value = '请先「识别原片语音」生成字幕'; exportOk.value = false; return }
    if (plan.value === 'redub' && !dubAudioPath.value) { exportMessage.value = '请先生成新配音'; exportOk.value = false; return }
    exporting.value = true
    exportMessage.value = ''
    exportOk.value = null
    try {
      const base = (options.getFileName() || 'video').replace(/\.[^.]+$/, '')
      const subtitleStyle = exportSubtitleStyle.value
      const common = {
        subtitleStyle,
        subtitleBoxOpacity: bgOpacity.value,
        subtitleFontSize: fontSize.value,
        subAnim: animKey.value,
      }
      const payload = plan.value === 'keep'
        ? { mode: 'single' as const, videoPath, srtPath: srtPath.value, draftName: `${base}_新字幕`, ...common }
        : {
            mode: 'multi' as const,
            videoPaths: [videoPath],
            muteVideoAudio: [true],
            voiceClips: [[{ path: dubAudioPath.value, startUs: 0, durUs: Math.max(1, Math.round(options.getDurationSec() * 1e6)) }]],
            srtPaths: [srtPath.value],
            draftName: `${base}_新字幕配音`,
            ...common,
          }
      const res = await window.tintin.server.jianyingExport(payload as never)
      if (!res || res.success === false) {
        throw new Error((res as { message?: string })?.message || '导出失败（详见宿主日志）')
      }
      exportOk.value = true
      exportMessage.value = res.message || '已导出剪映草稿——打开剪映「草稿」即可查看'
    } catch (err) {
      exportOk.value = false
      exportMessage.value = err instanceof Error ? err.message : String(err)
    } finally {
      exporting.value = false
    }
  }

  /** 进入第 2 步时拉取一次样式/字体/样本资产（重复进入不重复拉） */
  let assetsLoaded = false
  async function loadAssetsOnce(): Promise<void> {
    if (assetsLoaded) return
    assetsLoaded = true
    await Promise.all([loadStyleAssets(), loadDubSamples()])
  }

  return {
    plan, planOptions,
    transcribing, transcribeError, transcribed, segments, segmentLines, srtPath, transcribe,
    stylePresets, styleKey, selectedPreset, fonts, fontId, bgOpacity, animKey, fontSize,
    VSR_SUB_ANIM_OPTIONS, VSR_FONT_SIZE_OPTIONS,
    dubbing, dubError, dubAudioPath, redubText, dubSamples, dubSampleId, dubEngine, generateDub,
    exporting, exportMessage, exportOk, exportDraft,
    loadAssetsOnce,
  }
}
