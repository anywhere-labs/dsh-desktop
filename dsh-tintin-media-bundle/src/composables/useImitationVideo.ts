// ═══════════════════════════════════════════════════════════════
// useImitationVideo — 仿视频（V3.5 / PRD-M-5）编排层（runner：只做编排+响应式 state）
// 纯逻辑全在 imitationVideoLogic.ts（可单测）；本文件不做 DOM，失败分支全部
// clientError 打点（铁律 7），契约缺失显式报错不兜底（铁律 6）。
// 依据：《仿视频流程规范》v1.0（2026-10-02 合并版）§4/§5.1/§5.3/§11-19；
// 端点与响应形态以 2026-10-02 服务端实测为准（/api/storyboard/scripts/imitate、
// /tasks/unified/{id} result={script_id,version,shot_count}、frames multipart）。
// 本地视频预上传已闭（2026-10-02 服务端开通 `POST /api/storyboard/scripts/
// imitate/upload`）：multipart file → 入素材库（source=imitate_upload、file_hash
// 去重）→ 返 {material_id, material} → 以 material://{id} 提交 imitate。
// File/Blob 属 DOM 概念留在本层（UI 文件选择器供给）；纯逻辑层只处理字符串形态。
// ═══════════════════════════════════════════════════════════════

import { computed, onBeforeUnmount, ref } from 'vue'
import { API_PATHS } from '../types/server-api'
import { clientError, clientInfo } from '../utils/clientLog'
import { extractTaskObj, mapTaskStatus } from './copywritingMontageCommonLogic'
import {
  arollTimelineWarning,
  buildFramesConfirmBody,
  buildImitateBody,
  buildStoryboardGenerateBody,
  isStageDReady,
  normalizeServerEnums,
  validateGenShots,
  type GenerateStage,
  type ImitationShot,
  type ServerEnums,
} from './imitationVideoLogic'
import { normalizeProductSixViews, type ProductSixViewEntry } from './opsProductLibraryLogic'

const POLL_INTERVAL_MS = 2000
const TAG = 'imitation-video'

function serverBridge() {
  const s = (globalThis as unknown as { tintin?: { server?: Record<string, (...a: unknown[]) => Promise<unknown>> } }).tintin?.server
  if (!s) throw new Error('window.tintin.server 桥不可用（宿主未注入）')
  return s
}

export interface ImitateSubmitInput {
  /** material://{id} | http url | 服务端路径 | File（本地视频，经 imitate/upload 预上传） */
  video: unknown
  products?: Array<unknown>
  options?: { ratio?: string; fidelity?: string; max_shots?: number }
  /** 本地 File 预上传进度（0..1） */
  onUploadProgress?: (ratio: number) => void
}

export interface GenerateSubmitInput {
  arollMaterialId?: number
  arollImage?: string
  scriptId: string
  stage: GenerateStage
  onlyShots?: string[]
  fidelityOverride?: 'fast' | 'balanced' | 'high'
  autoMontage?: boolean
  /** 产品图 url/路径数组（2026-10-03 用户裁决：第 2 步选产品图后随任务直传，服务端 ≥1 校验） */
  productImages?: string[]
}

export function useImitationVideo() {
  // ── 枚举唯一源（§11-19）──────────────────────────────────────
  const enums = ref<ServerEnums | null>(null)
  const enumsError = ref('')
  async function loadEnums(): Promise<boolean> {
    enumsError.value = ''
    try {
      const raw = await serverBridge().get(API_PATHS.comfygen.enums)
      const normalized = normalizeServerEnums(raw)
      if (!normalized) {
        enumsError.value = '/comfygen/enums 响应不合法（ok!==true 或 cameras/fidelity 缺失）'
        clientError(TAG, enumsError.value, { raw })
        return false
      }
      enums.value = normalized
      clientInfo(TAG, `枚举已加载 source=${normalized.source} cameras=${normalized.cameras.length}`)
      return true
    } catch (e) {
      enumsError.value = `枚举拉取失败：${(e as Error).message}`
      clientError(TAG, enumsError.value, e)
      return false
    }
  }

  // ── 平台字典（2026-10-03 用户裁决：仿写文案对齐文案混剪——GET /copywriting/platforms，
  //    platform 直传服务端，平台指引由服务端织入；拉取失败保留当前值）──
  const ivPlatformOptions = ref<Array<{ name: string; guide: string }>>([])
  const ivPlatform = ref('抖音')
  async function loadIvPlatforms(): Promise<void> {
    try {
      const res = await serverBridge().get(API_PATHS.copywriting.platforms)
      const data = (res && typeof res === 'object' ? res : null) as { default?: string; platforms?: Array<{ name?: string; guide?: string }> } | null
      const list = Array.isArray(data?.platforms) ? data!.platforms! : []
      if (list.length) {
        ivPlatformOptions.value = list
          .filter((x) => x && typeof x.name === 'string' && x.name)
          .map((x) => ({ name: String(x.name), guide: String(x.guide || '') }))
        if (typeof data?.default === 'string' && data.default) ivPlatform.value = data.default
        clientInfo(TAG, `平台字典已加载 n=${ivPlatformOptions.value.length} default=${ivPlatform.value}`)
      }
    } catch (e) { /* 拉取失败保留当前值；打点可追溯（铁律 7） */
      clientError(TAG, '平台字典拉取失败（保留默认抖音）', e)
    }
  }

  // ── Seedance 交付包（v4.9 收口：九宫格图一张+逐镜 prompt_zh/camera_zh/seed_base；
  //    未生成/旧脚本 → null，UI 落占位不兜底造数据）──
  const storyboardPack = ref<Record<string, unknown> | null>(null)
  async function loadStoryboardPack(id: string): Promise<void> {
    if (!id) return
    try {
      storyboardPack.value = (await serverBridge().get(API_PATHS.storyboard.storyboardPack(id))) as Record<string, unknown> | null
    } catch (e) {
      storyboardPack.value = null
      clientInfo(TAG, `storyboard-pack 未取到（未生成或旧脚本）：${(e as Error).message}`)
    }
  }

  // ── Part 1：imitate 提交 + unified 轮询（§4/§5.3）────────────
  const part1TaskId = ref('')
  const part1Phase = ref<'' | 'running' | 'done' | 'failed'>('')
  const part1Error = ref('')
  const part1Note = ref('')
  /** 拆解进度反馈（2026-10-03 用户裁决：拆解中必须有进度条）：progress=服务端 0-100
   *  （实测 completed=100），缺省/未知=-1 → UI 走不定态动画；已用时秒表+last_message */
  const part1Progress = ref(-1)
  const part1ElapsedSec = ref(0)
  const part1Message = ref('')
  let part1StartedAt = 0
  /** Part 1 源素材 id（预上传回填 / material:// 输入解析；供后续产品图等引用） */
  const part1MaterialId = ref('')
  /** Part 1 完整结果（shots[] + 提示词字段——拆解接口=脚本+反推提示词唯一来源） */
  const part1Result = ref<Record<string, unknown>>({})
  const scriptId = ref('')
  const scriptVersion = ref(0)
  const shotCount = ref(0)

  let part1Timer: ReturnType<typeof setInterval> | null = null
  function stopPart1Polling(): void {
    if (part1Timer) { clearInterval(part1Timer); part1Timer = null }
  }
  onBeforeUnmount(stopPart1Polling)

  async function submitImitate(input: ImitateSubmitInput): Promise<boolean> {
    let video: unknown = input.video
    part1Note.value = ''
    // File/Blob → 先经 imitate/upload 入素材库，拿 material_id 转成 material:// URI
    if (typeof File !== 'undefined' && (input.video instanceof File || input.video instanceof Blob)) {
      try {
        const form = new FormData()
        form.append('file', input.video, input.video instanceof File ? input.video.name : 'source.mp4')
        const resp = (await serverBridge().upload(
          API_PATHS.storyboard.imitateUpload,
          form,
          input.onUploadProgress,
        )) as Record<string, unknown> | null
        const mid = resp?.material_id ?? (resp?.material as Record<string, unknown> | undefined)?.id
        if (mid === undefined || mid === null || mid === '') {
          const keys = resp ? Object.keys(resp).join(',') : 'null'
          part1Error.value = `预上传响应缺 material_id（实得字段：${keys}）`
          clientError(TAG, part1Error.value, { resp })
          return false
        }
        video = `material://${mid}`
        part1MaterialId.value = String(mid)
        part1Note.value = `本地视频已入素材库 id=${mid}`
        clientInfo(TAG, `预上传完成 material_id=${mid}`)
      } catch (e) {
        part1Error.value = `本地视频预上传失败：${(e as Error).message}`
        clientError(TAG, part1Error.value, e)
        return false
      }
    }
    // 素材引用输入也解析出 id（反推提示词 /prompt/video 需 material 引用）
    const materialRef = /^material:\/\/(\d+)/.exec(String(video))
    if (materialRef) part1MaterialId.value = materialRef[1]
    const built = buildImitateBody({ video, products: input.products, options: input.options })
    part1Note.value = part1Note.value || built.note
    if (!built.ok) {
      const msg = built.needsUpload
        ? '本地路径字符串无法直传（渲染层不读盘）：请传入文件选择器的 File 对象，或素材库 material://{id} / 服务端路径'
        : built.note
      part1Error.value = msg
      clientError(TAG, `imitate 提交被拒：${msg}`)
      return false
    }
    try {
      // 参考模式随拆解落脚本（服务端 1012：imitate_import 收 reference_mode 存
      // meta.imitate——文案生成挂 skill 与生成档路由都以它为权威）
      built.body.reference_mode = referenceMode.value
      const resp = (await serverBridge().post(API_PATHS.storyboard.imitate, built.body)) as Record<string, unknown> | null
      const taskId = resp && (resp.task_id ?? resp.id)
      if (!taskId || typeof taskId !== 'string' && typeof taskId !== 'number') {
        const keys = resp ? Object.keys(resp).join(',') : 'null'
        part1Error.value = `imitate 响应缺 task_id（实得字段：${keys}）`
        clientError(TAG, part1Error.value, { resp })
        return false
      }
      part1TaskId.value = String(taskId)
      part1Phase.value = 'running'
      part1Error.value = ''
      part1StartedAt = Date.now()
      part1ElapsedSec.value = 0
      part1Progress.value = -1
      part1Message.value = ''
      clientInfo(TAG, `Part1 已提交 task=${taskId}`)
      startPart1Polling()
      return true
    } catch (e) {
      part1Error.value = `imitate 提交失败：${(e as Error).message}`
      clientError(TAG, part1Error.value, e)
      return false
    }
  }

  function startPart1Polling(): void {
    stopPart1Polling()
    const tick = async (): Promise<void> => {
      try {
        const resp = await serverBridge().get(API_PATHS.tasks.unifiedItem(part1TaskId.value))
        const task = extractTaskObj(resp)
        const info = mapTaskStatus(task.status ?? task.state, task)
        // 进度/用时/阶段文案同步刷新（running 态 UI 每个轮询周期更新一次）
        part1ElapsedSec.value = Math.round((Date.now() - part1StartedAt) / 1000)
        const rawProg = Number((task as Record<string, unknown>).progress)
        part1Progress.value = Number.isFinite(rawProg) && rawProg >= 0 ? Math.min(100, Math.round(rawProg)) : -1
        part1Message.value = String((task as Record<string, unknown>).last_message ?? '')
        if (info.phase === 'running') return
        stopPart1Polling()
        if (info.phase === 'failed') {
          part1Phase.value = 'failed'
          part1Error.value = info.error
          clientError(TAG, `Part1 失败 task=${part1TaskId.value}`, { error: info.error })
          return
        }
        const result = (task.result ?? {}) as Record<string, unknown>
        const sid = result.script_id
        if (!sid) {
          part1Phase.value = 'failed'
          part1Error.value = `Part1 完成但 result 缺 script_id（实得字段：${Object.keys(result).join(',') || '空'}）`
          clientError(TAG, part1Error.value, { task })
          return
        }
        scriptId.value = String(sid)
        scriptVersion.value = Number(result.version) || 0
        shotCount.value = Number(result.shot_count) || 0
        // 完整结果保留（含 shots[] 与提示词字段——2026-10-02 用户裁决：拆解接口即
        // 脚本+反推提示词的唯一来源，客户端不再单独调 /prompt/video）
        part1Result.value = result
        part1Phase.value = 'done'
        clientInfo(TAG, `Part1 完成 script=${sid} shots=${shotCount.value}`)
      } catch (e) {
        clientError(TAG, `Part1 轮询异常 task=${part1TaskId.value}`, e)
      }
    }
    // 首拍立即执行（不等首个周期）——提交后 UI 即刻进 running 并出进度条
    void tick()
    part1Timer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  }

  // ── 脚本读写（HumanGate① 数据面，§5.3）────────────────────────
  async function loadScript(id: string): Promise<Record<string, unknown> | null> {
    try {
      const resp = await serverBridge().get(API_PATHS.storyboard.scriptsItem(id))
      const data = (resp && ((resp as Record<string, unknown>).data ?? resp)) as Record<string, unknown> | null
      if (!data) {
        clientError(TAG, `脚本读取为空 id=${id}`, { resp })
        return null
      }
      return data
    } catch (e) {
      clientError(TAG, `脚本读取失败 id=${id}`, e)
      return null
    }
  }

  async function saveScript(id: string, payload: Record<string, unknown>): Promise<boolean> {
    // 2026-10-11：服务端 flap 容忍——失败重试共 3 次（间隔 2s；PUT 幂等）。
    // 采纳链曾因单次保存失败静默中断且 distribute/rewrite 无补发入口，重试降低断链概率。
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await serverBridge().put(API_PATHS.storyboard.scriptsItem(id), payload)
        if (resp === null || (resp as Record<string, unknown>)?.error) {
          clientError(TAG, `脚本保存失败（第 ${attempt}/3 次） id=${id}`, { resp })
        } else {
          return true
        }
      } catch (e) {
        clientError(TAG, `脚本保存异常（第 ${attempt}/3 次） id=${id}`, e)
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    return false
  }

  // ── HumanGate②：帧确认 / 手动换帧（multipart，实测口径）──────
  /** 闸门① 九宫分镜整体确认（v4.3：PUT draft/confirm → draft_status=confirmed，解锁 frames 精稿） */
  async function confirmDraft(id: string): Promise<boolean> {
    try {
      const resp = (await serverBridge().put(API_PATHS.storyboard.draftConfirm(id), {})) as Record<string, unknown> | null
      if (resp === null || (resp as Record<string, unknown>)?.error) {
        clientError(TAG, `九宫粗稿确认失败 id=${id}`, { resp })
        return false
      }
      clientInfo(TAG, `九宫粗稿已确认（draft_status=confirmed）id=${id}`)
      return true
    } catch (e) {
      clientError(TAG, `九宫粗稿确认异常 id=${id}`, e)
      return false
    }
  }

  async function confirmShotFrames(id: string, name: string): Promise<boolean> {
    const form = new FormData()
    Object.entries(buildFramesConfirmBody()).forEach(([k, v]) => form.append(k, String(v)))
    return uploadShotFrames(id, name, form, `确认帧 ${name}`)
  }

  async function replaceShotFrames(
    id: string,
    name: string,
    files: { first?: File | Blob; last?: File | Blob },
  ): Promise<boolean> {
    if (!files.first && !files.last) {
      clientError(TAG, `换帧缺少文件：${name}（first/last 至少一项）`)
      return false
    }
    const form = new FormData()
    if (files.first) form.append('first', files.first, files.first instanceof File ? files.first.name : 'first.png')
    if (files.last) form.append('last', files.last, files.last instanceof File ? files.last.name : 'last.png')
    return uploadShotFrames(id, name, form, `换帧 ${name}`)
  }

  async function uploadShotFrames(id: string, name: string, form: FormData, action: string): Promise<boolean> {
    try {
      // frames 端点=PUT multipart（POST 会被 405 拒——2026-10-06 实测修复）
      const resp = await serverBridge().upload(API_PATHS.storyboard.shotFrames(id, name), form, undefined, 'PUT')
      if (resp === null || (resp as Record<string, unknown>)?.error) {
        clientError(TAG, `${action} 失败`, { resp, id, name })
        return false
      }
      clientInfo(TAG, `${action} 成功`)
      return true
    } catch (e) {
      clientError(TAG, `${action} 异常`, e)
      return false
    }
  }

  // ── Part 2：storyboard_generate 提交 + scheduled 轮询（§5.1）──
  const genTaskId = ref('')
  /** 最近一次 videos 提交的任务 id（E-1.2「生成任务转草稿」入口用——from-task 只认成片任务；
   *  A-roll 等后续任务不覆盖它，保证转草稿指向逐镜视频任务） */
  const videosTaskId = ref('')
  const genPhase = ref<'' | 'running' | 'done' | 'failed'>('')
  const genError = ref('')
  const genResult = ref<Record<string, unknown>>({})
  /** comfygen job_ids（服务端任务运行中即写 result.job_ids——/comfygen/jobs 精确关联锚点，2026-10-06） */
  const genJobIds = ref<string[]>([])

  let genTimer: ReturnType<typeof setInterval> | null = null
  function stopGenPolling(): void {
    if (genTimer) { clearInterval(genTimer); genTimer = null }
  }
  onBeforeUnmount(stopGenPolling)

  /** 提交前本地把关（gen_spec 镜像 + 阶段 D 闸门 + A-roll 对轨提示）；返回错误列表（空=通过） */
  function preflightGenerate(shots: ImitationShot[], stage: GenerateStage): string[] {
    const issues = validateGenShots(shots, enums.value).map((i) => `第${i.index + 1}镜 ${i.field}：${i.message}`)
    // 视频换物档免阶段 D（2026-10-12 用户裁决：输入=原片段+六视图，不生成九宫格/精稿，
    // 无确认帧可言；服务端 videos worker 按拆解源窗裁原片段逐镜 video_edit）
    if (stage === 'videos' && referenceMode.value !== 'video_replace' && !isStageDReady(shots)) {
      issues.push('阶段 D 闸门未开：存在 frames_status 未 confirmed 的 AI 镜头（HumanGate②）')
    }
    return issues
  }

  async function submitGenerate(input: GenerateSubmitInput, shots: ImitationShot[] = []): Promise<boolean> {
    const issues = shots.length ? preflightGenerate(shots, input.stage) : []
    if (issues.length) {
      genError.value = issues.join('；')
      clientError(TAG, `生成提交被本地校验拒绝：${genError.value}`)
      return false
    }
    try {
      const body = buildStoryboardGenerateBody({ ...input, referenceMode: referenceMode.value })
      const resp = (await serverBridge().post(API_PATHS.scheduled.tasksList, body)) as Record<string, unknown> | null
      const taskId = resp && (resp.task_id ?? resp.id)
      if (taskId === undefined || taskId === null || taskId === '') {
        const keys = resp ? Object.keys(resp).join(',') : 'null'
        genError.value = `生成任务响应缺 id/task_id（实得字段：${keys}）`
        clientError(TAG, genError.value, { resp })
        return false
      }
      genTaskId.value = String(taskId)
      if (input.stage === 'videos') videosTaskId.value = String(taskId)
      genPhase.value = 'running'
      genError.value = ''
      genResult.value = {}
      genStage.value = input.stage
      genStartedAt = Date.now()
      genElapsedSec.value = 0
      genProgress.value = -1
      genMessage.value = ''
      clientInfo(TAG, `storyboard_generate 已提交 task=${genTaskId.value} stage=${input.stage}`)
      startGenPolling()
      return true
    } catch (e) {
      genError.value = `生成任务提交失败：${(e as Error).message}`
      clientError(TAG, genError.value, e)
      return false
    }
  }

  // ── 生成进度反馈（2026-10-04 用户裁决：分镜头确认步与第 1 步同款进度条）──
  const genProgress = ref(-1)      // 服务端 0-100；缺省/未知=-1 → UI 不定态
  const genElapsedSec = ref(0)
  const genMessage = ref('')
  /** 最近提交的生成阶段（storyboard/frames/videos/aroll）——UI 按阶段归位进度显示 */
  const genStage = ref<GenerateStage | ''>('')
  let genStartedAt = 0

  function startGenPolling(): void {
    stopGenPolling()
    const tick = async (): Promise<void> => {
      try {
        const resp = await serverBridge().get(API_PATHS.scheduled.tasksItem(genTaskId.value))
        const task = extractTaskObj(resp)
        const info = mapTaskStatus(task.status ?? task.state, task)
        genElapsedSec.value = Math.round((Date.now() - genStartedAt) / 1000)
        const rawProg = Number((task as Record<string, unknown>).progress)
        genProgress.value = Number.isFinite(rawProg) && rawProg >= 0 ? Math.min(100, Math.round(rawProg)) : -1
        genMessage.value = String((task as Record<string, unknown>).last_message ?? '')
        const resObj = (task.result ?? {}) as Record<string, unknown>
        const jids = Array.isArray(resObj.job_ids) ? resObj.job_ids.map((x) => String(x)) : []
        if (jids.length) genJobIds.value = jids
        if (info.phase === 'running') return
        stopGenPolling()
        genPhase.value = info.phase === 'done' ? 'done' : 'failed'
        genError.value = info.error
        genResult.value = (task.result ?? {}) as Record<string, unknown>
        if (info.phase === 'failed') clientError(TAG, `storyboard_generate 失败 task=${genTaskId.value}`, { error: info.error })
        else clientInfo(TAG, `storyboard_generate 完成 task=${genTaskId.value}`)
      } catch (e) {
        clientError(TAG, `生成轮询异常 task=${genTaskId.value}`, e)
      }
    }
    void tick()
    genTimer = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
  }

  /** A-roll 对轨 warning（§3：±15% 仅提示；voice 时长由脚本记录提供） */
  function timelineWarning(shots: ImitationShot[], voiceDurSec: unknown): string {
    return arollTimelineWarning(shots, voiceDurSec)
  }

  // ── 参考模式（方向档位字典 /comfygen/enums.reference_mode 下发，三档下拉在
  //    第 1 步 ImitationSourceStep 提交拆解旁）：
  //    scene_refs=画面级还原（原片帧参考）/ style_anchor=风格级相似（文字+产品图）/
  //    video_replace=视频换物（原片段换物，§11-62 集成档——videos 阶段服务端按拆解
  //    源窗裁原片段逐镜 type=video_edit，替换物六视图，脚本侧逐镜换物品=批 A UI）。
  //    默认 video_replace（2026-10-10 用户裁决：第一步默认视频换物模式）；
  //    submitGenerate 对每次 storyboard_generate 注入 params.reference_mode，
  //    父组件调用点零改动 ──
  const referenceMode = ref('video_replace')
  // ── 产品六视图槽位（2026-10-10 用户裁决：第 2 步六视图槽位化=产品资料同款；
  //    六视图是产品资料域资产——上传替换/单删走全局作用域 views 端点（纯替换语义，
  //    客户端不传 auto_assemble），正面+背面齐才放行下一步）──
  const productSixViews = ref<ProductSixViewEntry[]>([])
  const productSixBusy = ref(false)
  const currentProductId = ref('')
  /** 下一步闸门（2026-10-10 用户裁决：顶部视图必须有——正面+背面规则作废） */
  const productViewsReady = computed(() => productSixViews.value.some((e) => e.view === 'top'))

  /** 拉取并驻留产品六视图（GET /api/product-library/items/{id} 内嵌 item.six_views）。
   *  2026-10-12 用户裁决：接口失败只提示、不冲界面——拉取失败时保留已显示槽位，
   *  仅显式清空（无 id）或成功取到新视图时才替换。 */
  async function refreshProductSixViews(itemId: string): Promise<ProductSixViewEntry[]> {
    currentProductId.value = itemId
    if (!itemId) { productSixViews.value = []; return [] }
    const data = (await serverBridge().get(`/api/product-library/items/${encodeURIComponent(itemId)}`, {})) as Record<string, unknown> | null
    if (!data) throw new Error('无法连接服务端')
    const item = (((data as Record<string, unknown>).item as Record<string, unknown> | undefined) ?? (data as Record<string, unknown>))
    const views = normalizeProductSixViews(item?.six_views)
    productSixViews.value = views
    return views
  }

  /** 上传替换单视图（POST views/{view}/upload multipart；纯替换=其余五张不动） */
  async function uploadProductSixView(itemId: string, view: string, file: File): Promise<boolean> {
    if (productSixBusy.value) return false
    productSixBusy.value = true
    try {
      const form = new FormData()
      form.append('file', file, file.name || `${view}.png`)
      await serverBridge().upload(`/api/product-library/items/${encodeURIComponent(itemId)}/views/${encodeURIComponent(view)}/upload`, form)
      return true
    } catch (e) {
      clientError(TAG, `上传六视图失败（${view}）：${(e as Error).message}`, e)
      return false
    } finally {
      productSixBusy.value = false
    }
  }

  /** 删除单视图（DELETE views/{view}；错图清理后可重新上传） */
  async function deleteProductSixView(itemId: string, view: string): Promise<boolean> {
    if (productSixBusy.value) return false
    productSixBusy.value = true
    try {
      await serverBridge().delete(`/api/product-library/items/${encodeURIComponent(itemId)}/views/${encodeURIComponent(view)}`, {})
      return true
    } catch (e) {
      clientError(TAG, `删除六视图失败（${view}）：${(e as Error).message}`, e)
      return false
    } finally {
      productSixBusy.value = false
    }
  }

  return {
    // 枚举
    enums, enumsError, loadEnums,
    // 平台字典（仿写文案）
    ivPlatformOptions, ivPlatform, loadIvPlatforms,
    // Seedance 交付包（九宫格图+提示词）
    storyboardPack, loadStoryboardPack,
    // Part 1
    part1TaskId, part1Phase, part1Error, part1Note, part1MaterialId, part1Result, scriptId, scriptVersion, shotCount,
    part1Progress, part1ElapsedSec, part1Message,
    submitImitate,
    // 脚本（HumanGate①）
    loadScript, saveScript,
    // HumanGate②
    confirmShotFrames, replaceShotFrames, confirmDraft,
    // Part 2
    genTaskId, genPhase, genError, genResult, genProgress, genElapsedSec, genMessage, genStage, genJobIds, videosTaskId,
    // 产品六视图槽位（2026-10-10 槽位化裁决）
    productSixViews, productSixBusy, currentProductId, productViewsReady,
    refreshProductSixViews, uploadProductSixView, deleteProductSixView, referenceMode,
    submitGenerate, preflightGenerate, timelineWarning,
  }
}
