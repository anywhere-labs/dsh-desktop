// ═════════════════════════════════════════════════════════════
// useImitationTts.ts — 仿视频第 2 步口播配音的 TTS 状态与调用（对齐文案混剪
// Step3 同名功能点，2026-10-03 用户裁决"参考=功能点一样实现"）：
//   参考声音样本下拉（GET /voice/samples 同源）/ 常驻试听 / 设置声音克隆弹窗
//   （按引擎参数：语速+情感+情感强度 / 预置音色+指令文本，随每次 TTS 请求发送）。
//   （2026-10-04 用户裁决：上传新样本组件与功能自仿视频移除——该能力归声音克隆/文案混剪。）
// TTS 调用=POST /indextts/tts（resp:'json' + 600s 超时，克隆渲染实测 ≈0.25s/字）。
// 与文案混剪的差异（有意）：montage 批量走主进程 voiceCloneBatch（落盘供配音混流）；
// 仿视频单条+URL 试听走桥面 json 形态。句间停顿（((pause=ms)) 拆段合成）为主进程
// 展开能力，直连接口无此参数——仿视频暂缺该功能点（如实标注，待裁决/移植）。
// ═════════════════════════════════════════════════════════════
import { computed, ref } from 'vue'
import { API_PATHS } from '@/types/server-api'
import { clientError } from '@/utils/clientLog'
import { errText } from './copywritingMontage/context'

export interface ImitationTtsDeps {
  /** 目标时长（秒）取值器：target_duration 随请求发送 */
  getTargetDuration: () => number
  /** 脚本 id 取值器（distribute-voiceover 路径参数） */
  getScriptId: () => string
  /** 主稿保存（分配前先持久化 meta.imitate.voiceover） */
  saveScript: () => Promise<boolean>
  /** 分配后回读脚本（逐镜旁白预填） */
  reloadScript: () => Promise<void>
  /** 打点标签（默认 imitation-video） */
  tag?: string
}

export function useImitationTts(deps: ImitationTtsDeps) {
  const tag = deps.tag ?? 'imitation-video'
  const TTS_ENGINE_OPTIONS = [
    { label: 'VoxCPM2', value: 'voxcpm' },
    { label: 'QwenTTS（Qwen3-TTS）', value: 'qwen3' },
    { label: 'IndexTTS（快速/情感）', value: 'indextts' },
  ]
  /** 情感预设选项（IndexTTS emo_text 常用值，同声音克隆页/文案混剪 Step3） */
  const TTS_EMO_OPTIONS = [
    { label: '开心', value: '开心' },
    { label: '悲伤', value: '悲伤' },
    { label: '激动', value: '激动' },
    { label: '温柔', value: '温柔' },
    { label: '愤怒', value: '愤怒' },
    { label: '恐惧', value: '恐惧' },
    { label: '惊讶', value: '惊讶' },
    { label: '厌恶', value: '厌恶' },
    { label: '平静', value: '平静' },
  ]

  const ttsEngineSel = ref<'voxcpm' | 'qwen3' | 'indextts'>('voxcpm') // 客户端默认 voxcpm
  interface VoiceSample { id: number; name: string; url: string }
  const voiceSamples = ref<VoiceSample[]>([])
  const voiceSamplesError = ref('')
  const selectedSampleKey = ref('') // 空=未选样本（2026-10-06 用户裁决：Base 选项退役——未选样本不发请求，入口直接提示）
  const sampleOptions = computed(() =>
    voiceSamples.value.map((s) => ({ label: s.name, value: String(s.id) })),
  )
  const samplePreviewUrl = computed(() => voiceSamples.value.find((s) => String(s.id) === selectedSampleKey.value)?.url || '')

  async function loadVoiceSamples(): Promise<void> {
    voiceSamplesError.value = ''
    try {
      const res = (await window.tintin.server.get(API_PATHS.voice.samples)) as unknown
      const arr = (Array.isArray(res) ? res : (res as Record<string, unknown> | null)?.items) as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(arr)) {
        voiceSamplesError.value = '声音样本响应缺 items 数组'
        clientError(tag, voiceSamplesError.value, { res })
        return
      }
      voiceSamples.value = arr
        .filter((s) => s.id !== undefined)
        .map((s) => ({ id: Number(s.id), name: String(s.name || s.desc || `样本 ${s.id}`), url: String(s.audio_url || '') }))
      // 默认选中第一个样本（Base 选项退役后无样本=空选，由生成入口前置拦截）
      if (!voiceSamples.value.some((s) => String(s.id) === selectedSampleKey.value)) {
        selectedSampleKey.value = String(voiceSamples.value[0]?.id || '')
      }
    } catch (e) {
      voiceSamplesError.value = `样本清单加载失败：${errText(e)}`
      clientError(tag, voiceSamplesError.value, e)
    }
  }

  // ── 设置声音克隆（同 Step3 同名功能：参数随每次 TTS 请求发送，按引擎各表）──
  const ttsFactor = ref(1.0)        // IndexTTS 语速 duration_factor（0.5~2）
  const ttsEmoText = ref('')        // IndexTTS 情感 emo_text
  const ttsEmoAlpha = ref(0.5)      // IndexTTS 情感强度 emo_alpha（0~1）
  const qwen3Speaker = ref('')      // QwenTTS 预置音色
  const qwen3Instruct = ref('')     // QwenTTS 指令文本
  const qwen3Voices = ref<Array<{ value: string; label: string }>>([])
  const qwen3VoicesLoading = ref(false)
  const cloneParamsDlg = ref({ show: false, factor: 1.0, emo: '', alpha: 0.5, engine: 'voxcpm' as string })

  async function loadQwen3Voices(): Promise<void> {
    if (qwen3VoicesLoading.value) return
    qwen3VoicesLoading.value = true
    try {
      const res = await window.tintin.server.ttsQwen3Voices()
      const speakers = res && 'speakers' in res && Array.isArray(res.speakers) ? res.speakers : []
      qwen3Voices.value = speakers.map((v) => ({ value: String(v), label: String(v) }))
    } finally {
      qwen3VoicesLoading.value = false
    }
  }
  function openCloneParams(): void {
    cloneParamsDlg.value = { show: true, factor: ttsFactor.value, emo: ttsEmoText.value, alpha: ttsEmoAlpha.value, engine: ttsEngineSel.value }
    if (ttsEngineSel.value === 'qwen3' && !qwen3Voices.value.length) void loadQwen3Voices()
  }
  function closeCloneParams(): void { cloneParamsDlg.value.show = false }
  function saveCloneParams(p: { factor: number; emo: string; alpha: number; speaker: string; instruct: string }): void {
    ttsFactor.value = p.factor
    ttsEmoText.value = p.emo
    ttsEmoAlpha.value = p.alpha
    qwen3Speaker.value = p.speaker
    qwen3Instruct.value = p.instruct
    cloneParamsDlg.value.show = false
  }

  // ── 采纳文案编排（2026-10-11 服务端 ed8ae5c7 adopt-copy 上线：单请求完成
  //    主稿落库→按镜铺旁白→LLM 画面跟随，服务端内编排、步骤状态可重试——
  //    客户端确认文案只调此一个接口；四步原语保留给高级/手动用法）──
  /** POST {id}/adopt-copy body {text, rewrite_visuals:true} → {ok, steps{save,distribute,rewrite}}；
   *  步骤失败不整单失败（旁白已铺时 rewrite 可单独重试），红字明示失败步骤 */
  async function adoptCopy(text: string): Promise<boolean> {
    if (!deps.getScriptId()) {
      distributeError.value = '尚无脚本（先完成第 1 步拆解）——文案采纳挂脚本提交'
      clientError(tag, distributeError.value)
      return false
    }
    distributeBusy.value = true
    distributeError.value = ''
    distributeNote.value = ''
    try {
      const resp = await window.tintin.server.post(
        `/api/storyboard/scripts/${deps.getScriptId()}/adopt-copy`,
        { text, rewrite_visuals: true },
        undefined,
        300000, // LLM 画面跟随较慢，超时对齐 rewrite-visuals
      )
      await deps.reloadScript()
      const steps = ((resp && typeof resp === 'object' ? (resp as Record<string, unknown>).steps : null) ?? {}) as Record<string, string>
      const failed = Object.entries(steps).filter(([, v]) => v !== 'done')
      if (failed.length) {
        distributeError.value = `文案采纳部分完成：${failed.map(([k, v]) => `${k}=${v}`).join('、')}——旁白已铺可手动修正，失败步骤可重新采纳重试`
        clientError(tag, distributeError.value, { resp })
      } else {
        distributeNote.value = '文案已采纳：主稿落库 + 按镜铺旁白 + 画面跟随 全部完成'
      }
      return !failed.length
    } catch (e) {
      distributeError.value = `文案采纳失败：${errText(e)}——主稿与旁白均未变更，请检查服务端连接后重试`
      clientError(tag, distributeError.value, e)
      return false
    } finally {
      distributeBusy.value = false
    }
  }

  // ── 仿写文案分配到逐镜旁白（2026-10-04 服务端实装：POST distribute-voiceover，
  //    text 缺省=脚本主稿；服务端按镜切分写 shot.audio → 回读后旁白=预填可编辑）──
  const distributeNote = ref('')
  const distributeBusy = ref(false)
  /** 分配/重写失败红字（2026-10-10 用户裁决：服务端宕断时链路断点要醒目，不再灰字混过） */
  const distributeError = ref('')
  /** 主稿先保存 → POST distribute-voiceover（服务端整句配额分配写 shot.audio）→ 回读 */
  async function distributeFromMaster(): Promise<void> {
    distributeBusy.value = true
    try {
      await window.tintin.server.post(
        API_PATHS.storyboard.distributeVoiceover(deps.getScriptId()),
        {},
      )
      await deps.reloadScript()
      distributeError.value = ''
      distributeNote.value = '已按新文案分配逐镜旁白（下方各镜可再编辑）'
    } catch (e) {
      distributeError.value = `旁白分配失败：${errText(e)}——新文案未写入各镜旁白，请检查服务端连接后重试`
      clientError(tag, distributeError.value, e)
    } finally {
      distributeBusy.value = false
    }
  }
  /** 仿写文案重写（2026-10-04 上线 rewrite-visuals：LLM 按主稿重出 visual/scene/audio，
   *  一次全换；LLM 多镜重写较慢，超时放宽 300s） */
  const rewriteBusy = ref(false)
  async function rewriteFromMaster(): Promise<void> {
    rewriteBusy.value = true
    distributeBusy.value = true
    try {
      await window.tintin.server.post(
        API_PATHS.storyboard.rewriteVisuals(deps.getScriptId()),
        {},
        undefined,
        300000,
      )
      await deps.reloadScript()
      distributeError.value = ''
      distributeNote.value = '已按新文案重写画面/旁白/场景（下方各镜可再编辑）'
    } catch (e) {
      distributeError.value = `画面重写失败：${errText(e)}——旁白分配不受影响，画面可手动编辑`
      clientError(tag, distributeError.value, e)
    } finally {
      distributeBusy.value = false
      rewriteBusy.value = false
    }
  }

  return {
    TTS_ENGINE_OPTIONS, TTS_EMO_OPTIONS,
    ttsEngineSel, voiceSamples, voiceSamplesError, selectedSampleKey, sampleOptions, samplePreviewUrl,
    loadVoiceSamples,
    ttsFactor, ttsEmoText, ttsEmoAlpha, qwen3Speaker, qwen3Instruct, qwen3Voices, qwen3VoicesLoading,
    cloneParamsDlg, openCloneParams, closeCloneParams, saveCloneParams, loadQwen3Voices,
    distributeNote, distributeBusy, distributeError, adoptCopy, distributeFromMaster, rewriteFromMaster, rewriteBusy,
  }
}
