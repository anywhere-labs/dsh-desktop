<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// LiveClip.vue — 直播智能切片（M9 全量补齐，2026-09-03）
// 严格照原客户端 live_clip/page.py 的 2 步向导流程（L128 步骤文本逐字一致）：
//   1. 视频分析与热点发现 → 2. 切片与封面生成
// 接线真实 IPC：ffmpeg(extractAudioCached/cut+reencode/extractFrames/embedCover/probe)
//   + server.asrTranscribe(/whisper/transcribe) + server.llmChat(/llm/chat/completions)
//   + liveclip(writeImageFile/writeTextFile/writeTempText)。
// M9 补齐（对照原 live_clip/{page,workers,utils}.py，逐条注明行号）：
//   · 音频缓存：extractAudioCached（page.py L542-568 meta 校验 + AudioExtractWorker
//     L61-63 wav 同参数）→「强制重新提取音频」真实生效
//   · 音频预览：<audio>（原版 AudioPlayerWidget）
//   · 停止按钮：软停止（ipc invoke 单调用不可中断，当前步骤完成后终止链路；
//     切片循环逐段检查；原版 _stop_analysis 杀进程，此为架构差异下的等价折衷）
//   · LLM 分析真接线：buildLlmChunks（4000 字符/5 行重叠）+ prompt 逐字 +
//     parseLlmPlanResponse（extract_json_block 等价）+ mergeLlmPlan；失败块跳过
//   · 评分过滤下拉（原版 L264-272 默认 ≥9.0，过滤同步勾选 L725-739）+ 全选/取消
//   · 导出字幕：buildSrtFromSegments（原版 _RemoteWorker L484-492 格式）
//   · 切片：reencode 两段式精确 seek + 重编码（原版 VideoClipWorker L288-317），
//     「加字幕」勾选 → clipSegmentsForRange 裁剪 + 临时 SRT + subtitles 滤镜
//   · 封面：ffmpeg 抽帧(base64) → 渲染层 canvas 复刻原版 PIL generate_cover_image
//     （utils.py L99-139：模糊背景+前景居中+底部标题条+蓝线+阴影白字）横竖两版
//   · 最终导出：embedCover 原版语义（封面 2s 片头 concat + 音频延迟，utils.py
//     L142-171），输出 final/done_NNN_title.mp4
// 归属口径（IRON-11）：ASR 走服务端（原版 transcribe_remote 同口径）；切片为
// 本地 ffmpeg（原版 VideoClipWorker 同口径，服务端无切片接口）。
// 与原版的已知差异（有意）：输出目录默认切片目录可选（原版固定 outputs/live_clips）；
// 封面编辑对话框（CoverEditDialog）简化为「重新生成封面」（改标题后重画）。
// ═══════════════════════════════════════════════════════════════
import { ref, computed, watch, type Ref } from 'vue'
import TButton from '@/components/common/TButton.vue'
import TSelect, { type SelectOption } from '@/components/common/TSelect.vue'
import { acceptFileDragOver } from '@/utils/fileUrl'
import {
  buildClipPlan, buildPlanFromText, mergeLlmPlan,
  buildLlmChunks, buildLlmPrompt, parseLlmPlanResponse,
  buildSrtFromSegments, clipSegmentsForRange,
  clipFileName, SCORE_FILTER_OPTIONS, SCORE_FILTER_DEFAULT, scoreClass,
} from '@/composables/liveClipLogic'
import type { ClipPlanItem, LlmPlanItem } from '@/composables/liveClipLogic'
import { parseTranscriptionResponse } from '@/composables/srtUtils'
import type { SrtSegment } from '@/composables/srtUtils'
import { filePathOf } from '@/utils/fileUrl'

const STEPS = ['1. 视频分析与热点发现', '2. 切片与封面生成']
const step = ref(0)
const tintin = () => (window as any).tintin

/* ── Step 0 视频分析与热点发现 ───────────────────────── */
interface Hotspot extends ClipPlanItem { checked: boolean }
const videoPath = ref('')
const videoName = ref('')
const isDragging = ref(false)
// 2026-09-18 用户裁决：删除内置算法，只保留服务端 LLM 分析
const MODE_OPTIONS: SelectOption[] = [
  { label: 'AI 大模型 (服务端代理)', value: 'llm' },
]
const analysisMode = ref<'llm'>('llm') as Ref<'llm'>
const transcribeLang = ref('zh')
const forceReextract = ref(false)
const analyzing = ref(false)
const analysisMsg = ref('')
const transcript = ref('')
const transcriptSegs = ref<SrtSegment[]>([])
const hotspots = ref<Hotspot[]>([])
const clipDir = ref('')
// 音频预览（原版 AudioPlayerWidget）：提取成功后设 file:// 地址；dev http 页面
// file:// 可能被 CORS 拦截 → @error 降级隐藏（生产 file:// 页面正常）
const audioPath = ref('')
const audioUrl = ref('')
const audioAvailable = ref(false)
// 停止（软停止标志，见文件头差异说明）
const stopRequested = ref(false)

function pickVideo() {
  tintin()?.dialog?.openFile?.({ title: '选择直播录像', filters: [{ name: '视频', extensions: ['mp4','mov','avi','mkv','flv','ts','webm','m4v'] }] }).then((r: any) => {
    if (r) setVideo(r)
  })
}
function onDrop(e: DragEvent) {
  e.preventDefault(); isDragging.value = false
  // Electron 43 移除 File.path：统一经共享 filePathOf 桥解析（2026-10-20 对账修复）
  const f = e.dataTransfer?.files?.[0]
  const p = f ? filePathOf(f) : ''
  if (p) setVideo(p)
}
function setVideo(p: string) {
  videoPath.value = p; videoName.value = String(p).split(/[\\/]/).pop() || ''
  hotspots.value = []; transcript.value = ''; transcriptSegs.value = []; clips.value = []
  audioPath.value = ''; audioUrl.value = ''; audioAvailable.value = false
}

function pickClipDir() {
  tintin()?.dialog?.openDir?.({ title: '选择切片输出目录' }).then((r: any) => {
    const d = Array.isArray(r?.filePaths) ? r.filePaths[0] : (r?.filePaths ?? r?.path)
    if (d) clipDir.value = String(d)
  })
}

/** 音频预览地址（原版 _set_video_path L460-467：提取成功即可预览） */
function setAudio(p: string) {
  audioPath.value = p
  audioUrl.value = 'file:///' + String(p).replace(/\\/g, '/').replace(/^\//, '')
  audioAvailable.value = true
}
function onAudioError() {
  audioAvailable.value = false
}

/** LLM 分析进度（原版 stage「正在使用大模型分析第 x/y 段字幕」L197） */
const llmStage = ref('')

/** 请求停止（原版 _stop_analysis L603-617；差异见文件头） */
function stopAnalysis() {
  stopRequested.value = true
  analysisMsg.value = '已请求停止：当前步骤完成后终止'
}

/**
 * Step0 开始提取并分析（对齐原版 _start_analysis_pipeline L469 链路）：
 * 带缓存音频提取 → 服务端 ASR 转写（/whisper/transcribe）→ 内置算法 / LLM 热点分析。
 */
async function startAnalysis() {
  if (!videoPath.value) return
  analyzing.value = true
  stopRequested.value = false
  analysisMsg.value = '正在提取音频（缓存校验中）...'
  llmStage.value = ''
  const t = tintin()
  try {
    // 1. 带缓存音频提取（原版 L542-568：meta 校验 → 复用或重提；forceReextract 真实生效）
    let audio = ''
    try {
      const r = await t?.ffmpeg?.extractAudioCached?.(videoPath.value, forceReextract.value)
      if (!r || r.error) throw new Error(r?.error || 'ffmpeg:extractAudioCached 不可用')
      audio = r.path
      analysisMsg.value = r.cached ? '使用已提取的音频缓存，正在转写...' : '音频提取完成，正在转写...'
    } catch (e) {
      analysisMsg.value = '音频提取失败：' + (e instanceof Error ? e.message : String(e))
      return
    }
    setAudio(audio)
    if (stopRequested.value) return

    // 2. 服务端 ASR 转写（multipart 上传音频；language 语义对齐原版 transcribe_lang L494-495）
    let segs: SrtSegment[] = []
    let text = ''
    try {
      const res = await t?.server?.asrTranscribe?.({
        audio: { path: audio },
        language: transcribeLang.value === 'auto' ? undefined : transcribeLang.value,
        task: 'transcribe',
      })
      // 防御解析（对齐 asr_client：segments / result.segments / text / 裸文本多形态）
      segs = parseTranscriptionResponse(res ?? null)
      text = segs.map((s) => s.text).join('')
    } catch (e) {
      analysisMsg.value = '转写不可用（服务端未就绪）：' + (e instanceof Error ? e.message : String(e))
      return
    }
    if (stopRequested.value) return
    transcriptSegs.value = segs
    transcript.value = text

    // 3. 热点策略（LLM 模式）：分块 → 逐块 llmChat（temperature=0.3）→ JSON 解析 → 合并；失败块跳过（原版 L230-231 同口径）。
    const chunks = buildLlmChunks(segs)
    if (!chunks.length) { hotspots.value = wrapPlan([]); applyFilterSync(); return }
    const llmItems: LlmPlanItem[] = []
    let okChunks = 0
    for (let i = 0; i < chunks.length; i++) {
      if (stopRequested.value) return
      llmStage.value = `正在使用大模型分析第 ${i + 1}/${chunks.length} 段字幕...`
      analysisMsg.value = llmStage.value
      try {
        const res = await t?.server?.llmChat?.({
          messages: [{ role: 'user', content: buildLlmPrompt(chunks[i]) }],
          temperature: 0.3,
        })
        const content = res?.choices?.[0]?.message?.content
        if (!content) throw new Error(res?.error || 'LLM 响应为空')
        llmItems.push(...parseLlmPlanResponse(content))
        okChunks += 1
      } catch (_) { /* 失败块跳过（原版 L230-231） */ }
    }
    if (!okChunks) {
      hotspots.value = []
      analysisMsg.value = 'LLM 分析失败（服务端 /llm/chat/completions 不可达），未发现热点'
      return
    }
    hotspots.value = wrapPlan(mergeLlmPlan(llmItems))
    analysisMsg.value = `LLM 分析完成，发现 ${hotspots.value.length} 个热点片段`
  } finally {
    analyzing.value = false
    llmStage.value = ''
  }
}

/** 纯函数输出 → 勾选态挂载副本（默认全选，随后按评分过滤同步，对齐原版 L673-675） */
function wrapPlan(items: ClipPlanItem[]): Hotspot[] {
  return items.map((h) => ({ ...h, checked: true }))
}

/* ── 评分过滤 / 全选（原版 _filter_hotspots L725-739 / _select_all L713-723）── */
const scoreFilter = ref<number>(SCORE_FILTER_DEFAULT)
const visiblePlan = computed(() => hotspots.value.filter((h) => h.score >= scoreFilter.value))
const selectedCount = computed(() => visiblePlan.value.filter((h) => h.checked).length)
/** 过滤切换 → 同步勾选（原版语义：隐藏行取消勾选、显示行勾选） */
watch(scoreFilter, applyFilterSync)
function applyFilterSync() {
  for (const h of hotspots.value) h.checked = h.score >= scoreFilter.value
}
function selectAllVisible() { for (const h of visiblePlan.value) h.checked = true }
function deselectAllVisible() { for (const h of visiblePlan.value) h.checked = false }

/* ── 导出字幕（原版 _export_subtitles L808-828）── */
const canExportSub = computed(() => transcriptSegs.value.length > 0)
async function exportSubtitles() {
  if (!canExportSub.value) return
  const vname = videoName.value.replace(/\.[^.]+$/, '') || 'transcript'
  const r = await tintin()?.dialog?.saveFile?.({
    title: '保存字幕文件',
    defaultPath: `${vname}.srt`,
    filters: [{ name: 'SRT 字幕', extensions: ['srt'] }],
  })
  const path = Array.isArray(r?.filePaths) ? r.filePaths[0] : (r?.filePath ?? r)
  if (!path) return
  const res = await tintin()?.liveclip?.writeTextFile?.({ path, content: buildSrtFromSegments(transcriptSegs.value) })
  analysisMsg.value = res?.ok ? `字幕已导出：${res.path}` : ('导出失败：' + (res?.error || '未知错误'))
}

/* ── Step 1: 切片与封面生成 ─────────────────────────── */
type ClipState = 'pending' | 'running' | 'done' | 'failed'
interface Clip {
  id: string; path: string; title: string; start: number; end: number
  state: ClipState; err: string
  coverPath: string; coverVerticalPath: string; coverUrl: string
  burnSubtitles: boolean
}
const clips = ref<Clip[]>([])
const clipBusy = ref(false)
const clipMsg = ref('')
const exporting = ref(false)
const exportMsg = ref('')
const coverStage = ref('')

/** 切片输出基目录（原版固定 outputs/live_clips/{vname}；本端默认视频目录 + 可选） */
function outputBaseDir(): string {
  return clipDir.value || videoPath.value.replace(/[\\/][^\\/]+$/, '')
}
function joinPath(dir: string, name: string): string {
  return dir.replace(/[\\/]+$/, '') + '\\' + name
}

/**
 * 批量切片（原版 _start_clip_pipeline L830 + VideoClipWorker L262-377 同口径）：
 * 逐段重编码（两段式精确 seek）；勾选「加字幕」→ 裁剪切片段字幕落临时 SRT，
 * 交 subtitles 滤镜烧录。全部完成后自动生成封面（原版 _on_clip_done L869-882）。
 */
async function startClipping() {
  const sel = visiblePlan.value.filter((h) => h.checked)
  if (!sel.length) return
  clipBusy.value = true; clipMsg.value = ''; exportMsg.value = ''
  stopRequested.value = false
  clips.value = sel.map((h, i) => ({
    id: `clip_${i}`,
    path: '',
    title: h.title,
    start: h.start,
    end: h.end,
    state: 'pending' as ClipState,
    err: '',
    coverPath: '', coverVerticalPath: '', coverUrl: '',
    burnSubtitles: false,
  }))
  const outDir = outputBaseDir()
  try {
    for (let i = 0; i < clips.value.length; i++) {
      const c = clips.value[i]
      c.state = 'running'
      if (stopRequested.value) { c.state = 'pending'; clipMsg.value = '已停止'; break }
      clipMsg.value = `正在剪辑第 ${i + 1}/${clips.value.length} 个片段: ${c.title}...`
      const out = joinPath(outDir, clipFileName(i, c.title))
      // 烧字幕：裁剪切片段字幕 → 临时 SRT（原版 slice_srt L49-93 + L297-303 同角色）
      let srtPath: string | undefined
      if (c.burnSubtitles && transcriptSegs.value.length) {
        try {
          const segContent = buildSrtFromSegments(clipSegmentsForRange(transcriptSegs.value, c.start, c.end))
          if (segContent) {
            const tr = await tintin()?.liveclip?.writeTempText?.({ basename: `liveclip_sub_${Date.now()}_${i}.srt`, content: segContent })
            if (tr?.path) srtPath = tr.path
          }
        } catch (_) { /* 临时字幕失败 → 不烧录继续切片 */ }
      }
      try {
        const res = await tintin()?.ffmpeg?.cut?.(videoPath.value, out, c.start, c.end, { reencode: true, srtPath })
        if (res === undefined) throw new Error('ffmpeg:cut 不可用（预览环境）')
        c.path = out
        c.state = 'done'
      } catch (e) {
        c.state = 'failed'
        c.err = e instanceof Error ? e.message : String(e)
      }
    }
    const done = clips.value.filter((c) => c.state === 'done')
    const fail = clips.value.filter((c) => c.state === 'failed').length
    clipMsg.value = stopRequested.value && !done.length
      ? '已停止'
      : `切片完成：成功 ${done.length}${fail ? ` / 失败 ${fail}` : ''}`
    // 切片完成自动生成封面（原版 _on_clip_done → CoverGeneratorWorker）
    if (done.length) await generateCovers(done)
  } finally {
    clipBusy.value = false
  }
}

/** 加载 base64 图片 */
function loadImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('封面帧解码失败'))
    img.src = `data:image/jpeg;base64,${base64}`
  })
}

/**
 * canvas 复刻原版 PIL generate_cover_image（utils.py L99-139）：
 * 帧拉伸模糊为背景 + 前景等比居中 + 底部黑色半透明标题条 + 蓝色顶线 +
 * 阴影白字标题；横版 1280×720（bar 130/字 56）、竖版 720×1280（bar 180/字 52）。
 */
async function drawCoverCanvas(frameBase64: string, title: string, W: number, H: number): Promise<string> {
  const img = await loadImage(frameBase64)
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  // 背景：拉伸到 W×H + 高斯模糊（原版 resize + GaussianBlur(20)）
  ctx.filter = 'blur(20px)'
  ctx.drawImage(img, 0, 0, W, H)
  ctx.filter = 'none'
  // 前景：等比缩放居中（原版 resize_and_pad_with_blur L31-46）
  const ratio = Math.min(W / img.width, H / img.height)
  const fw = img.width * ratio, fh = img.height * ratio
  ctx.drawImage(img, (W - fw) / 2, (H - fh) / 2, fw, fh)
  // 底部标题条（原版 L104-116：竖版 bar 180 / 横版 bar 130，蓝线 4px）
  const barH = W < H ? 180 : 130
  const fontSize = W < H ? 52 : 56
  ctx.fillStyle = 'rgba(0, 0, 0, 0.71)'
  ctx.fillRect(0, H - barH, W, barH)
  ctx.fillStyle = 'rgb(59, 130, 246)'
  ctx.fillRect(0, H - barH, W, 4)
  // 标题（原版 L119-137：雅黑粗体，阴影 +2/+2 黑 alpha≈0.39，白字居中）
  ctx.font = `bold ${fontSize}px "Microsoft YaHei", "SimHei", sans-serif`
  ctx.textBaseline = 'middle'
  const text = String(title || '')
  const tw = ctx.measureText(text).width
  const tx = Math.max(8, (W - tw) / 2)
  const ty = H - barH + barH / 2
  ctx.fillStyle = 'rgba(0, 0, 0, 0.39)'
  ctx.fillText(text, tx + 2, ty + 2)
  ctx.fillStyle = 'rgb(255, 255, 255)'
  ctx.fillText(text, tx, ty)
  return canvas.toDataURL('image/jpeg', 0.95)
}

/**
 * 封面生成（原版 CoverGeneratorWorker L380-424）：抽 1s 帧 → 横竖两版封面
 * 落盘 covers/ 目录（渲染层 canvas 合成 + liveclip:writeImageFile 落盘）。
 */
async function generateCovers(list: Clip[]): Promise<void> {
  const t = tintin()
  const coversDir = joinPath(outputBaseDir(), 'covers')
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    coverStage.value = `正在生成第 ${i + 1}/${list.length} 个片段的封面: ${c.title.slice(0, 20)}...`
    clipMsg.value = coverStage.value
    try {
      const fr = await t?.ffmpeg?.extractFrames?.({ videoPath: c.path, times: [1.0], tag: 'liveclip-cover', width: 1280, quality: 2 })
      const b64 = fr?.frames?.[0]?.base64
      if (!b64) throw new Error(fr?.error || '抽帧失败')
      const idxS = String(list.indexOf(c) + 1).padStart(3, '0')
      const horizontal = await drawCoverCanvas(b64, c.title, 1280, 720)
      const vertical = await drawCoverCanvas(b64, c.title, 720, 1280)
      const coverPath = joinPath(coversDir, `cover_${idxS}.jpg`)
      const coverVerticalPath = joinPath(coversDir, `cover_vertical_${idxS}.jpg`)
      const r1 = await t?.liveclip?.writeImageFile?.({ path: coverPath, base64: horizontal })
      if (r1?.error) throw new Error(r1.error)
      const r2 = await t?.liveclip?.writeImageFile?.({ path: coverVerticalPath, base64: vertical })
      if (r2?.error) throw new Error(r2.error)
      c.coverPath = coverPath
      c.coverVerticalPath = coverVerticalPath
      c.coverUrl = 'file:///' + coverPath.replace(/\\/g, '/').replace(/^\//, '')
    } catch (e) {
      c.err = '封面生成失败：' + (e instanceof Error ? e.message : String(e))
    }
  }
  coverStage.value = ''
  const ok = list.filter((c) => c.coverPath).length
  clipMsg.value = `封面生成完成：${ok}/${list.length} 个`
}

/** 单独切片（原版 ClipListItemWidget.start_individual_slice L387-447） */
async function sliceSingle(c: Clip) {
  if (clipBusy.value || c.state === 'running') return
  c.state = 'running'; c.err = ''
  clipBusy.value = true; clipMsg.value = `正在单独切片: ${c.title}...`
  try {
    const outDir = outputBaseDir()
    const idx = clips.value.indexOf(c)
    const out = joinPath(outDir, clipFileName(idx, c.title))
    let srtPath: string | undefined
    if (c.burnSubtitles && transcriptSegs.value.length) {
      const segContent = buildSrtFromSegments(clipSegmentsForRange(transcriptSegs.value, c.start, c.end))
      if (segContent) {
        const tr = await tintin()?.liveclip?.writeTempText?.({ basename: `liveclip_sub_${Date.now()}_${idx}.srt`, content: segContent })
        if (tr?.path) srtPath = tr.path
      }
    }
    const res = await tintin()?.ffmpeg?.cut?.(videoPath.value, out, c.start, c.end, { reencode: true, srtPath })
    if (res === undefined) throw new Error('ffmpeg:cut 不可用（预览环境）')
    c.path = out
    c.state = 'done'
    await generateCovers([c])
    clipMsg.value = '单独切片完成'
  } catch (e) {
    c.state = 'failed'
    c.err = e instanceof Error ? e.message : String(e)
  } finally {
    clipBusy.value = false
  }
}

/** 改标题后重画单张封面（对应原版 CoverEditDialog 的重新生成能力，简化形态） */
async function regenCover(c: Clip) {
  if (c.state !== 'done') return
  coverStage.value = '正在重新生成封面...'
  try { await generateCovers([c]) } finally { coverStage.value = '' }
}

/** 编辑切片标题（结果回填，UI 层事件） */
function editClipTitle(c: Clip, v: string) { c.title = v }

/**
 * 最终导出（原版 _start_final_export L969 + FinalExportWorker L427-452）：
 * 对已生成封面的切片逐个 embedCover（封面 2s 片头 concat），竖片选竖版封面
 * （原版 utils.py L148-152），输出 final/done_NNN_title.mp4。
 */
const canExport = computed(() => clips.value.some((c) => c.state === 'done' && c.coverPath))
async function startFinalExport() {
  const targets = clips.value.filter((c) => c.state === 'done' && c.coverPath)
  if (!targets.length || exporting.value) return
  exporting.value = true
  exportMsg.value = ''
  const t = tintin()
  const finalDir = joinPath(outputBaseDir(), 'final')
  try {
    const outs: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i]
      exportMsg.value = `正在合并并导出第 ${i + 1}/${targets.length} 个视频: ${c.title.slice(0, 20)}...`
      // 竖片选竖版封面（原版 embed_cover_to_video L148-152）
      let cover = c.coverPath
      try {
        const info = await t?.ffmpeg?.probe?.(c.path)
        if (info && Number(info.width) > 0 && Number(info.height) > 0 && info.width < info.height && c.coverVerticalPath) {
          cover = c.coverVerticalPath
        }
      } catch (_) { /* probe 失败用横版封面 */ }
      const safe = String(c.title || 'clip').replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 30)
      const out = joinPath(finalDir, `done_${String(i + 1).padStart(3, '0')}_${safe}.mp4`)
      const r = await t?.ffmpeg?.embedCover?.(c.path, cover, out, 2)
      if (r === undefined) throw new Error('ffmpeg:embedCover 不可用（预览环境）')
      outs.push(out)
    }
    exportMsg.value = `导出完成！${outs.length} 个视频已保存到: ${finalDir}`
    exportDone.value = true
    t?.shell?.revealInFolder?.(finalDir)
  } catch (e) {
    exportMsg.value = '导出失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    exporting.value = false
  }
}

/** 导出是否成功过（openOutput 决定开 final 还是切片目录） */
const exportDone = ref(false)

/** 打开输出目录（原版 _open_output L1029-1047：final 优先，退回切片目录） */
function openOutput() {
  const finalDir = joinPath(outputBaseDir(), 'final')
  tintin()?.shell?.revealInFolder?.(exportDone.value ? finalDir : outputBaseDir())
}

const canNext = computed(() => hotspots.value.length > 0)
const doneCount = computed(() => clips.value.filter((c) => c.state === 'done').length)
const scoreOptions: Array<{ label: string; value: number }> = SCORE_FILTER_OPTIONS

/** 秒 → mm:ss（模板用；与 liveClipLogic.fmtMinSec 同口径） */
function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
</script>

<template>
  <div class="liveclip" style="display: flex; flex-direction: column; gap: var(--space-5);">

    <!-- 顶部步骤条 -->
    <div class="step-bar">
      <div class="step-pill" :class="{ active: step === 0, done: step > 0 }" @click="step = 0">1. 视频分析与热点发现</div>
      <span class="step-arrow">›</span>
      <div class="step-pill" :class="{ active: step === 1, done: step > 1 }" @click="step = 1">2. 切片与封面生成</div>
    </div>

    <!-- Step 0: 分析与热点 -->
    <template v-if="step === 0">
      <section class="card">
        <div class="dropzone" @click="pickVideo" @drop.prevent="onDrop" @dragover.prevent="acceptFileDragOver($event); isDragging = true" @dragleave.prevent="isDragging = false">
          <span class="dz-main">{{ videoName || '拖入直播录像 或 点击选择（支持 40GB+，流式处理）' }}</span>
          <span class="dz-hint">支持 mp4 / mov / avi / mkv / flv / ts / webm / m4v</span>
        </div>

        <!-- 音频预览（原版 AudioPlayerWidget） -->
        <div v-if="audioPath" class="row">
          <label class="label">音频预览:</label>
          <audio v-if="audioAvailable" class="audio" controls :src="audioUrl" @error="onAudioError"></audio>
          <span v-else class="muted">音频预览不可用（文件已提取：{{ audioPath }}）</span>
        </div>

        <div class="row wrap">
          <label class="label">分析方法:</label>
          <TSelect class="w160" v-model="analysisMode" :options="MODE_OPTIONS" />
          <label class="label">转写语言:</label>
          <TSelect class="w130" v-model="transcribeLang" :options="[{label:'中文 (简体)',value:'zh'},{label:'自动识别',value:'auto'},{label:'英语',value:'en'}]" />
          <label class="chk"><input type="checkbox" v-model="forceReextract" /> 强制重新提取音频</label>
          <TButton label="开始提取并分析" icon="search" :loading="analyzing" @click="startAnalysis" />
          <TButton v-if="analyzing" label="停止" icon="close" variant="danger" @click="stopAnalysis" />
        </div>
        <div v-if="analysisMsg" class="hint">{{ analysisMsg }}</div>
        <p class="hint hintline">
          链路：本地 ffmpeg 提取音频（16kHz 单声道 wav，缓存校验：mtime+size+路径 meta 匹配即复用，
          勾选「强制重新提取」跳过缓存）→ 服务端 ASR 转写（/whisper/transcribe）→ 内置热点算法
          （60s 窗口/30s 步长评分，阈值=均值×1.3，片段 15~300s）或 LLM 分析
          （/llm/chat/completions，4000 字符分块 + 5 行重叠）。LLM 单块失败自动跳过（对齐原版兜底口径）。
        </p>
      </section>

      <section class="card">
        <div class="row between">
          <span class="card-title">热点片段 <span class="muted">(勾选后进入下一步切片)</span></span>
          <div class="row">
            <label class="label">评分过滤:</label>
            <TSelect class="w110" v-model="scoreFilter" :options="scoreOptions" />
            <TButton label="全选" variant="secondary" @click="selectAllVisible" />
            <TButton label="取消" variant="secondary" @click="deselectAllVisible" />
            <span class="clip-count">已选 {{ selectedCount }} 个</span>
            <TButton label="导出字幕" variant="secondary" :disabled="!canExportSub" @click="exportSubtitles" />
          </div>
        </div>
        <div v-if="transcript" class="transcript">
          <div class="transcript-title">转写预览</div>
          <div class="transcript-body">{{ transcript }}</div>
        </div>
        <table class="tbl">
          <thead><tr><th style="width:30px"></th><th>#</th><th>起止</th><th>时长</th><th>热点标题</th><th>评分</th></tr></thead>
          <tbody>
            <tr v-for="(h, i) in visiblePlan" :key="i">
              <td><input type="checkbox" v-model="h.checked" /></td>
              <td>{{ i + 1 }}</td>
              <td>{{ h.startStr }} – {{ h.endStr }}</td>
              <td>{{ h.duration }}s</td>
              <td :title="h.title">{{ h.title }}</td>
              <td :class="scoreClass(h.score)">{{ h.score }}</td>
            </tr>
            <tr v-if="!visiblePlan.length"><td colspan="6" class="muted">当前过滤下无热点（可调低评分过滤或重新分析）</td></tr>
          </tbody>
        </table>
      </section>

      <div class="row right">
        <TButton label="下一步：切片与封面生成" icon="arrowRight" :disabled="!canNext" @click="step = 1" />
      </div>
    </template>

    <!-- Step 1: 切片与封面生成 -->
    <template v-else>
      <section class="card">
        <div class="row between">
          <span class="card-title">✂ 自动切片与封面编辑</span>
          <div class="row">
            <span class="clip-count">已选 {{ selectedCount }} 个片段待切片</span>
            <TButton label="打开输出目录" variant="secondary" @click="openOutput" />
          </div>
        </div>
        <div class="row">
          <label class="label">切片输出目录:</label>
          <input :value="clipDir" placeholder="默认为视频所在目录，点击选择..." readonly class="input grow" @click="pickClipDir" />
        </div>
        <div class="row">
          <TButton label="开始切片" icon="play" :loading="clipBusy" @click="startClipping" />
          <TButton v-if="clipBusy" label="停止" icon="close" variant="danger" @click="stopAnalysis" />
        </div>
        <div v-if="clipMsg" class="hint" :class="{ ok: !clipBusy && doneCount > 0 && coverStage === '' }">{{ clipMsg }}</div>

        <!-- 分段处理状态：待处理/处理中/成功/失败 + 封面预览 + 标题编辑回填 -->
        <ul class="file-list">
          <li v-for="c in clips" :key="c.id" class="clip-item">
            <img v-if="c.coverUrl" class="cover-thumb" :src="c.coverUrl" alt="" />
            <div class="clip-main">
              <div class="row">
                <span class="clip-state" :class="c.state">
                  {{ c.state === 'pending' ? '待处理' : c.state === 'running' ? '处理中…' : c.state === 'done' ? '成功' : '失败' }}
                </span>
                <input class="clip-title" :value="c.title" @input="editClipTitle(c, ($event.target as HTMLInputElement).value)" />
                <span class="muted">{{ fmt(c.start) }} – {{ fmt(c.end) }}</span>
                <label class="chk"><input type="checkbox" v-model="c.burnSubtitles" /> 加字幕</label>
              </div>
              <div class="row">
                <span class="muted clip-path">{{ c.state === 'done' ? c.path : (c.err || '') }}</span>
                <TButton v-if="c.state === 'done'" label="打开" variant="secondary" @click="tintin()?.shell?.revealInFolder?.(c.path)" />
                <TButton v-if="c.state !== 'done' && c.state !== 'running'" label="单独切片" variant="secondary" @click="sliceSingle(c)" />
                <TButton v-if="c.state === 'done' && c.coverPath" label="重新生成封面" variant="secondary" :disabled="!!coverStage" @click="regenCover(c)" />
              </div>
            </div>
          </li>
          <li v-if="!clips.length" class="muted">点击「开始切片」从所选热点片段生成剪辑</li>
        </ul>
      </section>

      <section class="card">
        <span class="card-title">📤 最终导出</span>
        <div class="row">
          <TButton label="确认封面并导出最终视频" icon="upload" :loading="exporting" :disabled="!canExport" @click="startFinalExport" />
          <span v-if="!canExport" class="muted">需先切片并生成封面</span>
        </div>
        <div v-if="exportMsg" class="hint" :class="{ ok: exportMsg.startsWith('导出完成') }">{{ exportMsg }}</div>
        <p class="muted hintline">
          导出 = 封面作为 2s 片头与正片拼接（音频延迟对齐，对齐原版 embed_cover_to_video），
          输出 final/done_NNN_标题.mp4；竖片自动选用竖版封面。
        </p>
      </section>

      <div class="row left">
        <TButton label="上一步：视频分析与热点发现" icon="arrowLeft" variant="secondary" @click="step = 0" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.step-bar { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.step-pill { padding: 4px 10px; border-radius: 999px; font-size: 13px; color: var(--muted-foreground); cursor: pointer; }
.step-pill.active { background: rgba(46,204,113,0.18); color: var(--primary); font-weight: 600; }
.step-pill.done { color: var(--success); }
.step-arrow { color: var(--muted-foreground); opacity: .4; }

.card { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
/* 2026-09-07 用户裁决：全程序拖拽上传区高度统一 min-height 120px（以智能混剪选择素材原高 ≈80px 基准 +1/2），内容垂直居中 */
.dropzone { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; min-height: 120px; padding: var(--space-5); background: color-mix(in srgb, var(--primary) 6%, var(--surface-container)); border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border)); border-radius: var(--radius-lg); cursor: pointer; color: var(--foreground); transition: border-color var(--duration-fast), background var(--duration-fast); }
.dropzone:hover { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, var(--surface-container)); }
.dz-main { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); }
.dz-hint { font-size: var(--font-size-caption); color: var(--muted-foreground); }

.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.row.between { justify-content: space-between; }
.row.right { justify-content: flex-end; }
.row.left { justify-content: flex-start; }
.label, .card-title { font-size: 13px; font-weight: 600; color: var(--foreground); }
.muted { color: var(--muted-foreground); font-size: 12px; }
.hint { color: var(--muted-foreground); font-size: 12px; }
.hint.ok { color: var(--success); font-weight: 600; }
.hintline { max-width: 720px; }
.clip-count { font-weight: 700; }
.chk { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.audio { height: 32px; }

.input { height: 32px; padding: 0 10px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--foreground); outline: none; font-size: 13px; }
.input:focus { border-color: var(--primary); }
.input.grow { flex: 1; min-width: 120px; }
.w110 { width: 110px; } .w130 { width: 130px; } .w160 { width: 160px; }

.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th, .tbl td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
.tbl th { color: var(--muted-foreground); font-weight: 500; font-size: 12px; }
/* 评分着色（原版 _on_analysis L682-685：≥7 绿 / ≥5 黄） */
:deep(.score-high) { color: var(--success); font-weight: 600; }
:deep(.score-mid) { color: #eab308; font-weight: 600; }

/* 2026-09-05 列表行间统一规范：页面内嵌密集列表 = 分隔线式 */
.file-list { display: flex; flex-direction: column; list-style: none; margin: 0; padding: 0; font-size: 13px; }
.clip-item { display: flex; align-items: flex-start; gap: var(--space-3); padding: 8px 10px; border-bottom: 1px solid var(--border); }
.clip-item:last-child { border-bottom: none; }
.clip-main { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; min-width: 0; }
.cover-thumb { flex: 0 0 auto; width: 96px; height: 54px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); }
.clip-state { flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--muted-foreground); background: var(--surface-container-high); }
.clip-state.running { color: var(--primary); background: rgba(46,204,113,0.12); }
.clip-state.done { color: var(--success); background: rgba(16,185,129,0.12); }
.clip-state.failed { color: var(--error); background: rgba(239,68,68,0.12); }
.clip-title { flex: 0 1 260px; min-width: 120px; height: 26px; padding: 0 8px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--foreground); font-size: 12px; outline: none; }
.clip-title:focus { border-color: var(--primary); }
.clip-path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.transcript { display: flex; flex-direction: column; gap: 6px; padding: var(--space-3); background: var(--surface-container); border: 1px solid var(--border); border-radius: var(--radius-md); }
.transcript-title { font-size: 12px; font-weight: 600; color: var(--muted-foreground); }
.transcript-body { max-height: 120px; overflow: auto; font-size: 13px; color: var(--foreground-muted); }
</style>
