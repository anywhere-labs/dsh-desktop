// ═══════════════════════════════════════════════════════════════
// useVoiceCloneStudio — 声音克隆（条目④ 业务层）
// 对照原客户端 studio/gui/voice_clone_page.py：
//   · _transcribe_ref_audio L690-743（ASR → segments_to_plain →
//     PunctuationLLMWorker 标点优化，失败降级原文 L723-726）
// 纯逻辑在 voiceCloneLogic.ts（parser/builder 层），本文件仅编排（runner 层）
// 2026-09-29 用户裁决：删除「一键拆分填充」按钮与逐行文案表——整体克隆
// （服务端拆句拼接）已覆盖主路径，逐行模式无消费。行表编排与语速推算
// （_split_and_populate_text_only/_run_synthesize/_estimate_max_chars 对照层）
// 一并移除；voiceCloneLogic.ts 纯逻辑模块保留（转写标点等多消费者共用）。
// 2026-09-29 用户裁决（客户端职责边界）：客户端不做任何音频归一化/预处理，
// 只负责上传四样——声音样本文件、样本文案（ref_text/text）、要克隆的文案
// （text）、调整参数（engine/ duration_factor/emo 等）；响度治理归服务端。
// ═══════════════════════════════════════════════════════════════

import { ref, computed, watch, onBeforeUnmount } from 'vue'
import {
  PUNCTUATION_SYSTEM_PROMPT,
  extractLlmContent,
} from './voiceCloneLogic'
import { parseTranscriptionResponse, segmentsToPlainText } from './srtUtils'
import { useServerTask } from './useServerTask'
import { readCacheDir } from './useSettingsConfig'
import { clientError, clientInfo } from '../utils/clientLog'
import { errText } from './copywritingMontage/context'

/**
 * 声音克隆文件命名规范（对齐原客户端 voice_clone_page.py _get_named_filename）
 * 格式：{样本前缀}_{文案前10字}_{YYYYMMDD}[后缀].wav
 *  - 样本前缀：样本名按 -/_/空格 拆分取第一段
 *  - 文案前缀：文案前 10 字，去除 Windows 非法字符
 *  - 后缀：整体=无，合并=_merged，分句=_row{idx}
 */
const VOICE_CLONE_SUBDIR = 'voice_clone'

/** 取样本名前缀（按 -/_/空格 拆分取第一段） */
function getSamplePrefix(sampleName: string): string {
  if (!sampleName) return ''
  for (const sep of ['-', '_', ' ']) {
    if (sampleName.includes(sep)) {
      return sampleName.split(sep)[0].trim()
    }
  }
  return sampleName.trim()
}

/** 取文案前 n 字（去除 Windows 非法字符） */
function getTextPrefix(text: string, n = 10): string {
  if (!text) return ''
  let compact = text.replace(/\s+/g, '')
  for (const c of ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
    compact = compact.replace(new RegExp(`\\${c}`, 'g'), '')
  }
  compact = compact.replace(/^[ .]+|[ .]+$/g, '')
  return compact.slice(0, n) || '未命名'
}

/** 生成声音克隆文件名（对齐原客户端 _get_named_filename；引擎段后缀：同目录不同模型的产物可区分） */
function buildVoiceCloneFileName(
  text: string,
  sampleName: string,
  kind: 'whole' | 'merged' | 'row' = 'whole',
  rowIdx?: number,
  engine?: string,
): string {
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const sample = getSamplePrefix(sampleName)
  const text10 = getTextPrefix(text)
  const parts = [sample, text10, dateStr, engine || ''].filter(Boolean)
  const base = parts.join('_')
  if (kind === 'merged') return `${base}_merged.wav`
  if (kind === 'row' && rowIdx !== undefined) return `${base}_row${rowIdx}.wav`
  return `${base}.wav`
}

/** 获取声音克隆保存目录（cacheDir/voice_clone/） */
async function getVoiceCloneSaveDir(): Promise<string> {
  const cacheDir = await readCacheDir()
  const base = cacheDir || ''
  return base ? `${base.replace(/[/\\]+$/, '')}/${VOICE_CLONE_SUBDIR}` : VOICE_CLONE_SUBDIR
}

/** 音色/样本目录项（来自 /voices/list、/voices/samples） */
export interface CatalogItem {
  id: string
  name: string
  path?: string
  url?: string
  text?: string       // 样本对应文字（API-GUIDE: /voice/samples 返回 text 字段）
}

function notify(title: string, body: string): void {
  try { window.tintin?.shell?.showNotification?.(title, body) } catch (_) {}
}

export function useVoiceCloneStudio() {
  // ── 参考音频 ──
  const refAudioPath = ref('')        // 上传的本地路径
  const selectedSampleId = ref('')    // 或选中的样本 id
  const refText = ref('')             // 参考文本（转写取词结果，可编辑）
  const transcribing = ref(false)

  // ── 目录数据 ──
  const voiceOptions = ref<CatalogItem[]>([])
  const samples = ref<CatalogItem[]>([])
  const voice = ref('')
  const uploadingSample = ref(false)
  // 2026-09-05 用户裁决：声音克隆固定使用 IndexTTS，不再使用 voxcpm（无引擎选择器）
  // 2026-09-20（服务端 TTS 统一入口）：引擎可选——qwen3=Qwen3-TTS（克隆必填 ref_text）
  // 2026-09-20 用户裁决：所有声音克隆默认 QwenTTS（engine=qwen3，tab 选择默认高亮 QwenTTS）
  // 2026-09-28 用户裁决：默认引擎 VoxCPM2（engine=voxcpm；服务端 0928 已恢复）
  const ttsEngine = ref<'indextts' | 'qwen3' | 'voxcpm'>('voxcpm')
  const wholeEngine = ref<'indextts' | 'qwen3' | 'voxcpm'>(ttsEngine.value)
  // ── Qwen3-TTS 专属设置（契约 IndexTTSRequest：speaker 预置音色 / instruct 指令文本；
  //    duration_factor/emo_text/emo_alpha 为 IndexTTS 专属，qwen3 不支持）──
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
    } catch (e) {
      clientError('voice-clone', '加载 QwenTTS 音色列表失败', errText(e))
    } finally {
      qwen3VoicesLoading.value = false
    }
  }
  watch(ttsEngine, (v) => {
    if (v === 'qwen3' && !qwen3Voices.value.length) void loadQwen3Voices()
  })
  if (ttsEngine.value === 'qwen3') void loadQwen3Voices()
  // IndexTTS 专属参数（API-GUIDE：/indextts/tts）
  const ttsDurationFactor = ref(1.0)   // 语速 0.5~2.0，默认 1.0
  const ttsEmoText = ref('')           // 情感文字（如：开心、悲伤、激动）
  const ttsEmoAlpha = ref(0.5)         // 情感强度 0~1，默认 0.5

  // ── 文案 ──
  const wholeText = ref('')
  const stageText = ref('')

  // ── 整体合成（原「整体克隆人声」入口保留；task_id 异步经 /tasks/{id} 轮询）──
  const wholeTask = useServerTask({
    successTitle: '声音克隆完成',
    failTitle: '声音克隆失败',
    getSuccessBody: () => '合成音频已就绪',
  })
  const wholeProgress = wholeTask.uploadPercent

  // ── 整体克隆合成进度 ──
  // 服务端 HTTP 同步等待（IndexTTS 内部队列对外也是等完返回），无真实进度可拉：
  // 用缓动假进度逼近 92%（前快后慢），完成置 100、失败归零。此前只有上传进度
  // （wholeProgress=uploadPercent，ttsGenerate 未接 onProgress 恒 0），合成等待期无任何指示。
  const wholeSynthProgress = ref(0)
  let synthTimer: ReturnType<typeof setInterval> | null = null
  function startSynthProgress(): void {
    stopSynthProgress(false)
    synthTimer = setInterval(() => {
      const p = wholeSynthProgress.value
      wholeSynthProgress.value = Math.min(92, p + Math.max(0.6, (92 - p) * 0.045))
    }, 150)
  }
  function stopSynthProgress(done: boolean): void {
    if (synthTimer) { clearInterval(synthTimer); synthTimer = null }
    wholeSynthProgress.value = done ? 100 : 0
  }

  // ── wholeTask 解包视图（嵌套 ref 在模板中不自动解包，直接 wholeTask.status===... 恒 false，
  // 这是此前「克隆成功后无播放/下载」的根因；组件统一改用以下 computed）──
  const wholeStatus = computed(() => wholeTask.status.value)
  const wholeIsProcessing = computed(() => wholeTask.isProcessing.value)
  const wholeErrorMsg = computed(() => wholeTask.errorMsg.value)
  const wholeResultUrl = computed(() => wholeTask.resultUrl.value)
  const wholeResultPath = computed(() => wholeTask.resultPath.value)

  const refReady = computed(() => !!refAudioPath.value || !!selectedSampleId.value)
  const hasRefText = computed(() => !!refText.value.trim())

  /** 从服务端响应中提取数组（兼容裸数组 / {items} / {data} / {samples} / {voices} 等包裹格式） */
  function extractArray(res: unknown): unknown[] {
    if (Array.isArray(res)) return res
    if (res && typeof res === 'object') {
      const obj = res as Record<string, unknown>
      for (const key of ['items', 'data', 'samples', 'voices', 'list', 'results']) {
        if (Array.isArray(obj[key])) return obj[key] as unknown[]
      }
    }
    return []
  }

  /** 拉取样本目录（GET /voice/samples，一次请求同时填充 voiceOptions + samples） */
  async function loadCatalog(): Promise<void> {
    try {
      const raw = await window.tintin.server.ttsVoicesSamples()
      const list = extractArray(raw)
      // 诊断：打印服务端样本字段（JSON 序列化，避免 [object Object]；2026-09-06）
      clientInfo('voice-clone', `samples raw: ${JSON.stringify(list.map((s: any) => ({ id: s.id, name: s.name, text: s.text, filename: s.filename, size: s.size, audio_url: s.audio_url })))}`)
      if (!list.length) throw new Error((raw as any)?.error || '样本列表为空')
      // 同时填充音色选项 + 样本列表（两者来自同一端点）；audio_url 为服务端相对路径
      voiceOptions.value = list.map((v: any) => ({ id: String(v.id), name: v.name }))
      samples.value = list.map((s: any) => ({
        id: String(s.id),
        name: s.name,
        // 严格对齐服务端 /voice/samples 契约：音频地址字段为 audio_url（相对路径）；无该字段=服务端问题，客户端不兜底猜测（2026-09-06）
        url: s.audio_url || '',
        text: s.text || '',
      }))
      if (voiceOptions.value.length && !voice.value) voice.value = voiceOptions.value[0].id
    } catch (err) {
      console.warn('[voice-clone] 拉取样本目录失败:', err)
      voiceOptions.value = []
      samples.value = []
    }
  }

  /** 参考音频就绪路径（仅用户本地上传文件；服务端样本无本地路径，契约 /voice/samples 列表项不含 path 字段） */
  function getRefAudioPath(): string {
    return refAudioPath.value
  }

  /** 参考音频就绪 URL（样本无本地路径时用服务端 url 直传 ASR） */
  function getRefAudioUrl(): string {
    if (refAudioPath.value) return ''
    const s = samples.value.find((x) => x.id === selectedSampleId.value)
    return s?.url || ''
  }

  function setRefAudio(path: string): void {
    stopSamplePreview()
    refAudioPath.value = path
    selectedSampleId.value = ''
  }

  // ── 样本试听（2026-09-07 用户裁决·对齐原客户端：给播放器一个直接可播的地址）──
  //    原客户端 QMediaPlayer 直播本地文件路径（voice_clone_page.py _play_audio），零中间环节；
  //    服务端化等价 = 播放条 src 直填服务端音频 URL（/voice/samples/{id}/audio 免鉴权，
  //    CSP media-src 放行 http:，Chromium 媒体栈自行流式加载）。
  //    整条 IPC→base64→fetch(data:)→blob 链路删除（useVideoMontage.playRefAudio 同款模式）；
  //    不做缓存；不做程序化 play。──
  const samplePreviewUrl = ref('')
  const samplePreviewLoading = ref(false)
  const serverUrl = ref('')

  /** 服务端地址（单一地址源 getServerUrl，经 env:serverPing 取回；useVideoMontage 同款） */
  async function ensureServerUrl(): Promise<string> {
    if (serverUrl.value) return serverUrl.value
    try {
      const ping = await (window as any).tintin?.env?.serverPing?.()
      serverUrl.value = String(ping?.url || '')
    } catch (_) { /* 预览环境无 env 桥 → 空串 */ }
    return serverUrl.value
  }

  async function loadSamplePreview(id: string): Promise<void> {
    const s = samples.value.find((x) => x.id === id)
    // 选择必留痕：任何一次选择都不允许在日志里隐形（2026-09-06 铁律）
    clientInfo('voice-clone', `选择样本：id=${id}，拼接服务端音频直连地址`)
    // C-6 失败上报：样本缺失/缺音频地址不再静默 return，给出明确提示（2026-09-06）
    if (!s) {
      clientError('voice-clone', `试听样本失败: 未找到样本 ${id}`, new Error('sample not found'))
      notify('提示', '试听失败：未找到该样本，请刷新样本列表后重试')
      return
    }
    if (!s.url) {
      // 接口对齐：/voice/samples 契约音频地址字段为 audio_url；缺失即服务端未提供，客户端明确报出而非兑底（2026-09-06）
      clientError('voice-clone', `试听样本失败: 样本「${s.name}」服务端未返回 audio_url`, new Error('sample audio_url empty'))
      notify('提示', `试听失败：样本「${s.name}」没有音频地址——服务端 /voice/samples 未返回 audio_url，需服务端补全样本音频`)
      return
    }
    samplePreviewLoading.value = true
    try {
      const base = await ensureServerUrl()
      const abs = /^https?:\/\//i.test(s.url)
        ? s.url
        : base.replace(/\/$/, '') + (s.url.startsWith('/') ? s.url : '/' + s.url)
      samplePreviewUrl.value = abs
      clientInfo('voice-clone', `样本音频 ${s.name}(${id})：播放地址=${abs}（直连服务端 URL，媒体栈自行加载，无 base64/blob 中间环节）`)
    } catch (err) {
      clientError('voice-clone', `试听样本失败: ${err instanceof Error ? err.message : String(err)}`, err)
      notify('提示', `试听失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      samplePreviewLoading.value = false
    }
  }

  function stopSamplePreview(): void {
    samplePreviewUrl.value = ''
    samplePreviewLoading.value = false
  }

  onBeforeUnmount(() => { stopSamplePreview() })

  function selectSample(id: string): void {
    selectedSampleId.value = id
    refAudioPath.value = ''
    // 自动填充样本的参考文字
    const s = samples.value.find((x) => x.id === id)
    if (s?.text) refText.value = s.text
    // 选中样本即加载播放条（2026-09-07 用户要求：选择样本时就显示播放条，不再单独点试听按钮）
    if (id) void loadSamplePreview(id)
  }

  /** 上传音频为样本（API-GUIDE：POST /voice/samples，multipart: file + name + text） */
  async function uploadSample(name: string, text?: string): Promise<{ ok: boolean; error?: string }> {
    const path = refAudioPath.value
    if (!path) return { ok: false, error: '没有可上传的音频文件' }
    if (!name.trim()) return { ok: false, error: '样本名称不能为空' }
    uploadingSample.value = true
    try {
      const res = await window.tintin.server.ttsUploadSample({
        file: { path } as unknown as Blob,
        name: name.trim(),
        text: text?.trim() || '',
      } as any)
      if (!res || (res as any).error) {
        return { ok: false, error: (res as any)?.error || '上传失败' }
      }
      await loadCatalog()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      uploadingSample.value = false
    }
  }

  /** 底部独立上传新样本（指定文件路径 + 名称 + 文字，上传后自动刷新列表） */
  async function uploadNewSample(filePath: string, name: string, text?: string): Promise<{ ok: boolean; error?: string; sampleId?: string }> {
    if (!filePath) return { ok: false, error: '没有可上传的音频文件' }
    if (!name.trim()) return { ok: false, error: '样本名称不能为空' }
    uploadingSample.value = true
    try {
      const res = await window.tintin.server.ttsUploadSample({
        file: { path: filePath } as unknown as Blob,
        name: name.trim(),
        text: text?.trim() || '',
      } as any)
      if (!res || (res as any).error) {
        return { ok: false, error: (res as any)?.error || '上传失败' }
      }
      await loadCatalog()
      // 自动选中新上传的样本
      const newId = String((res as any)?.id || '')
      if (newId) selectSample(newId)
      return { ok: true, sampleId: newId }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      uploadingSample.value = false
    }
  }

  /** 参考音频转写取词（对照 _transcribe_ref_audio：ASR → LLM 标点 → 失败降级原文） */
  async function transcribeRefAudio(): Promise<void> {
    if (!refReady.value) {
      notify('未选择声音样本', '请先选择参考声音样本 (wav/mp3)！')
      return
    }
    transcribing.value = true
    stageText.value = '正在识别参考音频文本...'
    try {
      // 仅用户上传的本地参考音频（refAudioPath）走 file 分支；服务端样本走 url 分支。
      // 不能用 getRefAudioPath()：它 fallback 到样本 s.path，而 s.path 是服务端路径，
      // 客户端本地无此文件，会被误当 multipart 文件上传导致转写失败（2026-09-06 修复）
      // 主进程契约：/whisper/transcribe 仅收 multipart file（url 分支由主进程先 GET 取回样本
      // 音频字节再上传，2026-09-06 修复 422）；fmt=json 返回 {segments,...} 供按段解析
      const localPath = refAudioPath.value
      const url = getRefAudioUrl()
      const payload: Record<string, unknown> = localPath
        ? { audio: { path: localPath } as unknown as Blob }
        : { url }
      payload.fmt = 'json'
      const res = await window.tintin.server.asrTranscribe(payload as any)
      if (!res) throw new Error('服务端离线或未返回结果')
      if ((res as any).error) throw new Error((res as any).error)
      const segments = parseTranscriptionResponse(res)
      const plain = segmentsToPlainText(segments)
      if (!plain) throw new Error('无法从参考音频中提取文本')
      stageText.value = '正在使用 AI 模型自动优化断句与标点...'
      try {
        const llmRes = await window.tintin.server.llmChat({
          messages: [
            { role: 'system', content: PUNCTUATION_SYSTEM_PROMPT },
            { role: 'user', content: plain },
          ],
        })
        if (!llmRes || (llmRes as any).error) throw new Error((llmRes as any)?.error || 'LLM 离线')
        const punctuated = extractLlmContent(llmRes).trim()
        refText.value = punctuated || plain // LLM 空输出 → 原文兜底
        stageText.value = '完成： 识别与标点优化完成'
      } catch (_) {
        // 标点优化失败 → 原始识别文本（对照 on_punc_err L723-726）
        refText.value = plain
        stageText.value = '完成： 识别完成（标点优化失败）'
      }
    } catch (err) {
      stageText.value = '失败： 识别文本失败'
      clientError('voice-clone', '识别文本失败', err)
      notify('识别文本失败', `无法从参考音频中提取文本：\n${err instanceof Error ? err.message : String(err)}`)
    } finally {
      transcribing.value = false
    }
  }

  /** base64 → Blob URL（TTS 返回 WAV 二进制经主进程 base64 透传） */
  function base64ToAudioUrl(base64: string, contentType = 'audio/wav'): string {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: contentType })
    return URL.createObjectURL(blob)
  }

  /** 从 TTS 响应中提取音频 URL（兼容 audio_base64 / audio_url） */
  function extractAudioUrl(res: any): string {
    if (res?.audio_base64) return base64ToAudioUrl(res.audio_base64, res.content_type)
    // 契约 /indextts/tts resp=json 音频字段为 audio_url（/output/tts/...）；url 属猜测兜底，删除
    return res?.audio_url || ''
  }

  /** 整体克隆（API-GUIDE：sample_id + engine 双引擎；WAV base64 / audio_url 双响应） */
  async function generateWhole(): Promise<void> {
    const text = wholeText.value.trim()
    if (!text) {
      notify('提示', '请先输入待克隆整体文案！')
      return
    }
    if (!getRefAudioUrl() && !selectedSampleId.value) {
      notify('未选择声音样本', '请先从样本库选择参考声音样本！')
      return
    }
    stageText.value = '正在进行整体克隆...'
    wholeTask.begin()
    startSynthProgress()
    try {
      const payload: Record<string, unknown> = {
        text,
        ...(selectedSampleId.value ? { sample_id: Number(selectedSampleId.value) } : {}),
        // 2026-09-20（服务端 TTS 统一入口）：engine=qwen3 → Qwen3-TTS；
        // ref_text=参考音频文稿（Qwen3 克隆必填，缺失服务端 400）
        ...(wholeEngine.value !== 'indextts' ? { engine: wholeEngine.value } : {}),
        ...(wholeEngine.value !== 'indextts' && refText.value.trim() ? { ref_text: refText.value.trim() } : {}),
        // 2026-09-20 用户裁决：Qwen3 专属设置（预置音色/指令文本）——qwen3 不支持
        // IndexTTS 的 duration_factor/emo_text/emo_alpha（此前误发致「变速不起作用」）
        ...(wholeEngine.value === 'qwen3'
          ? {
              ...(qwen3Speaker.value ? { speaker: qwen3Speaker.value } : {}),
              ...(qwen3Instruct.value.trim() ? { instruct: qwen3Instruct.value.trim() } : {}),
            }
          : {
              duration_factor: ttsDurationFactor.value,
              ...(ttsEmoText.value.trim() ? { emo_text: ttsEmoText.value.trim() } : {}),
              emo_alpha: ttsEmoAlpha.value,
            }),
        resp: 'json',
      }
      const res = await window.tintin.server.ttsGenerate(payload as any)
      if (!res) throw new Error('服务端离线或未返回结果')
      if ((res as any).error) throw new Error((res as any).error)
      const rawUrl = extractAudioUrl(res)
      // audio_url 契约=服务端相对路径（/output/tts/...）：必须先补全服务端基址——
      // 否则播放器 src 经 toFileUrl 变成宿主媒体代理地址（白名单外 404，播放死）、
      // 自动落盘/下载的 http 分支也不命中报「无可用的音频数据源」（2026-10-12 实障）
      const base = rawUrl && !rawUrl.startsWith('blob:') ? await ensureServerUrl() : ''
      const url = rawUrl && !/^https?:\/\/|^blob:/i.test(rawUrl)
        ? base.replace(/\/$/, '') + (rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl)
        : rawUrl
      if (url) {
        // 按命名规范生成文件名（含引擎段）+ 保存到 voice_clone 子目录
        const saveDir = await getVoiceCloneSaveDir()
        const sampleName = samples.value.find((s) => s.id === selectedSampleId.value)?.name || ''
        const fileName = buildVoiceCloneFileName(text, sampleName, 'whole', undefined, wholeEngine.value)
        const savePath = `${saveDir}/${fileName}`
        let localPath = ''
        try {
          if ((res as any).audio_base64) {
            // base64 响应：直接写入本地文件
            const saved = await window.tintin.server.ttsSaveAudio({
              base64: (res as any).audio_base64,
              savePath,
            })
            localPath = typeof saved === 'string' ? saved : ''
          } else if (url.startsWith('http')) {
            // audio_url 响应：从服务端下载
            const saved = await window.tintin.server.downloadResult(url, savePath)
            localPath = String(saved || '')
          }
        } catch (_) {
          localPath = ''
        }
        wholeTask.completeSync(url)
        if (localPath) {
          // 注意必须写 .value：直接 wholeTask.resultPath = localPath 会把 ref 覆盖成字符串、破坏响应性
          wholeTask.resultPath.value = localPath
        }
        stopSynthProgress(true)
        stageText.value = `完成： 整体克隆人声生成成功！文件：${fileName}`
        notify('生成成功', `文件：${fileName}${localPath ? '，已保存到缓存目录' : ''}`)
      } else if ((res as any).task_id) {
        stopSynthProgress(false) // 切换到 /tasks/{id} 真实轮询进度
        wholeTask.startPolling((res as any).task_id)
      } else {
        throw new Error('未返回音频数据')
      }
    } catch (err) {
      stopSynthProgress(false)
      wholeTask.failWith(err)
      stageText.value = '失败： 整体生成失败'
    }
  }

  /** 整体克隆结果下载（2026-10-12 用户裁决终版：点下载=弹原生保存对话框、默认
   *  Windows 下载目录，由用户选位置保存）。对话框由桌面壳桥
   *  dshDesktopSaveFilePicker（preload+showSaveDialog，随 16:19 包生效）承担；
   *  选中后优先 fromPath 复制已落盘文件，未落盘兜底 downloadResult 直下。
   *  反馈一律走 stageText 界面状态行（系统通知会被 Windows 拦截，不可依赖）。 */
  async function saveWholeAudioAs(): Promise<void> {
    const localPath = wholeResultPath.value
    const url = wholeResultUrl.value
    if (!localPath && !url) {
      stageText.value = '提示： 还没有可下载的克隆音频'
      notify('提示', '还没有可下载的克隆音频')
      return
    }
    const sampleName = samples.value.find((s) => s.id === selectedSampleId.value)?.name || ''
    const fileName = buildVoiceCloneFileName(wholeText.value.trim(), sampleName, 'whole', undefined, wholeEngine.value)
    stageText.value = '正在打开保存对话框…'
    try {
      const target = await window.tintin.dialog.saveFile({
        title: '保存克隆音频',
        defaultPath: fileName,
        filters: [{ name: 'WAV 音频', extensions: ['wav'] }],
      })
      if (!target) { stageText.value = ''; return } // 用户取消
      if (localPath) {
        const saved = await window.tintin.server.ttsSaveAudio({ fromPath: localPath, savePath: target })
        if (saved && typeof saved === 'object' && (saved as any).error) throw new Error((saved as any).error)
      } else {
        const saved = await window.tintin.server.downloadResult(url, target)
        if (!saved) throw new Error('下载失败')
      }
      stageText.value = `完成： 已保存到 ${target}`
      notify('下载完成', target)
    } catch (err) {
      clientError('voice-clone', '下载失败', err)
      const reason = err instanceof Error ? err.message : String(err)
      stageText.value = `失败： 下载失败——${reason}（重试仍失败请看宿主日志）`
      notify('下载失败', reason)
    }
  }

  /** 整体克隆结果上传到素材库（音频库 audio_library，与 AudioGen 保存 BGM/音效同通道；
   *  category='配音'，tags 带引擎标识；依赖 ttsSaveAudio 返回的绝对路径） */
  const uploadingToLib = ref(false)
  async function uploadWholeToLibrary(): Promise<void> {
    if (uploadingToLib.value) return
    let filePath = wholeResultPath.value
    if (!filePath) {
      // 兕底：尚未落盘时先从 blob 写盘再传
      const url = wholeResultUrl.value
      if (!url?.startsWith('blob:')) {
        notify('提示', '没有可上传的克隆音频')
        return
      }
      try {
        const saveDir = await getVoiceCloneSaveDir()
        const sampleName = samples.value.find((s) => s.id === selectedSampleId.value)?.name || ''
        const fileName = buildVoiceCloneFileName(wholeText.value.trim(), sampleName, 'whole', undefined, wholeEngine.value)
        const blob = await fetch(url).then((r) => r.blob())
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result || ''))
          fr.onerror = () => reject(new Error('读取音频数据失败'))
          fr.readAsDataURL(blob)
        })
        const base64 = dataUrl.split(',')[1] || ''
        if (!base64) throw new Error('音频数据为空')
        const saved = await window.tintin.server.ttsSaveAudio({ base64, savePath: `${saveDir}/${fileName}` })
        if (typeof saved !== 'string') throw new Error((saved as any).error || '落盘失败')
        filePath = saved
        wholeTask.resultPath.value = saved
      } catch (err) {
        clientError('voice-clone', '上传失败-落盘', err)
        notify('上传失败', err instanceof Error ? err.message : String(err))
        return
      }
    }
    uploadingToLib.value = true
    try {
      const data = await window.tintin.server.audioLibraryUpload({
        filePath,
        category: '配音',
        tags: `声音克隆,${wholeEngine}`,
      })
      if (data && typeof data === 'object' && (data as any).error) throw new Error((data as any).error)
      const newId = Number((data as any)?.id)
      notify('成功', `配音已上传到素材库（音频库）${Number.isInteger(newId) && newId > 0 ? `，编号 #${newId}` : ''}`)
    } catch (err) {
      clientError('voice-clone', '上传失败-素材库', err)
      notify('上传失败', err instanceof Error ? err.message : String(err))
    } finally {
      uploadingToLib.value = false
    }
  }

  return {
    // state
    refAudioPath, selectedSampleId, refText, transcribing,
    voiceOptions, samples, voice, ttsEngine, wholeEngine, ttsDurationFactor, ttsEmoText, ttsEmoAlpha,
    // Qwen3-TTS 专属（2026-09-20 用户裁决）
    qwen3Speaker, qwen3Instruct, qwen3Voices, qwen3VoicesLoading, loadQwen3Voices,
    wholeText, stageText,
    wholeTask, wholeProgress,
    // 整体克隆：解包视图 + 合成进度 + 另存为（模板直接用，禁 wholeTask.xxx 裸访问）
    wholeStatus, wholeIsProcessing, wholeErrorMsg, wholeResultUrl, wholeResultPath,
    wholeSynthProgress, saveWholeAudioAs, uploadingToLib, uploadWholeToLibrary,
    refReady, hasRefText, uploadingSample,
    samplePreviewUrl, samplePreviewLoading,
    // methods
    loadCatalog, setRefAudio, selectSample, uploadSample, uploadNewSample, transcribeRefAudio,
    loadSamplePreview, stopSamplePreview,
    generateWhole,
  }
}
