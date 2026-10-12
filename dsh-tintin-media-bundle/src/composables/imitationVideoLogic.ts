// ═══════════════════════════════════════════════════════════════
// imitationVideoLogic — 仿视频（V3.5 / PRD-M-5）客户端纯函数层（无 vue/IPC 依赖，可单测）
// 契约依据：《仿视频流程规范》PRD-M-5·V3.5（2026-10-02 v1.0 + 同日评审复核：
//   §3 数据模型 / §5.1 storyboard_generate 输入与阶段 / §5.3 客户端调用面 /
//   §6 gen_spec 双向校验 / §11 评审遗留 9-13）
//   +《ComfyUI 工作流调用规范》v4.1 §3（camera/fidelity/duration 枚举与比例换算）。
// 实施注记：
//   · 本文件是客户端侧 gen_spec 镜像（提交前把关，铁律 6 显式报错不兜底）；
//     **枚举全集唯一源 = 服务端 `GET /comfygen/enums`**（2026-10-02 用户裁决 A4 +
//     流程规范 §11-19 闭账：gen_spec 快照、非代理、comfygen 离线可用；含 ratio→尺寸
//     换算表与中文标签）。本地过渡枚举表已删除——实测服务端 cameras 含 `dolly_in`
//     （本地表没有，会误杀合法值）、无 `follow`（待 comfygen #11），证明必须以服务端
//     为准。调用方（composable）负责拉取后经 normalizeServerEnums 归一传入；
//     无 enums 时 validateGenShots 跳过枚举合法性检查（服务端 gen_spec 兜底）。
//   · 任务级 stage 服务端缺省=all（§11-9 闭账），客户端仍按裁决 A3 永远显式传。
//   · Part 1 输入允许 http url（流程规范 §4），与旧版仿爆款（已退役 2026-10-02，
//     用户裁决 A5：旧款未投产，V3.5 新链取代；服务端 /viral/clone/* 契约与类型保留）
//     不同源，勿互抄。
// ═══════════════════════════════════════════════════════════════

// ── 枚举与常量（§3 / v4.1 §3）──────────────────────────────────

/** 生成后端（§3 gen.backend；v1 只实现 comfygen，其余留适配位） */
export type GenBackend = 'comfygen' | 'jimeng' | 'runninghub' | 'manual'

/** 镜头素材来源（§3。2026-10-07 批4 D5 起三值：material=实拍素材绑定 / generate=AI 生成 /
 *  original=原片直切——videos 阶段服务端前置裁 source_start/source_end 源窗（净切+剥轨）
 *  →入库 source=original_window→回填 material_path。客户端切换 UI 现仅二值
 *  generate↔material，original 三态接线=C3 预选批待办） */
export type ShotSource = 'material' | 'generate' | 'original'

/** 分镜帧确认闸门（§3 状态机定稿：pending →(阶段C) generated →(人工确认) confirmed；
 *  中间态拼法唯一权威 = generated，原 frames_generated 拼法已废） */
export type FramesStatus = 'pending' | 'generated' | 'confirmed'

/** 生成状态（§3：pending/submitted/done/failed，独立于 frames_status 勿混叙） */
export type GenStatus = 'pending' | 'submitted' | 'done' | 'failed'

/** A-roll 来源（§3 aroll.source） */
export type ArollSource = 'digital_human' | 'material' | 'none'

/** A-roll 状态（§3 aroll.status） */
export type ArollStatus = 'pending' | 'running' | 'done' | 'failed'

/** 素材准备任务阶段（§5.1 输入；注意与 comfygen stage=frames|video|all 同名异值：
 *  任务级 videos ↔ comfygen video，联调传参勿混——流程规范 §11-9） */
export type GenerateStage = 'aroll' | 'storyboard' | 'frames' | 'videos' | 'all'

/** 保真档位（v4.1 §3：fast 约3分 / balanced 约4.5分 / high 约7分） */
export type Fidelity = 'fast' | 'balanced' | 'high'

/** 运镜枚举（全集以服务端 /comfygen/enums 下发为准；dolly_in 为服务端实测有值，
 *  follow 待 comfygen #11——本地联合仅作编写提示，校验以 enums 传入值为准） */
export type CameraKey =
  | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'orbit'
  | 'handheld' | 'follow' | 'crane_up' | 'crane_down' | 'static' | 'dolly_in'

// ── 服务端枚举（唯一源 GET /comfygen/enums，流程规范 §11-19）────

export interface EnumOption {
  value: string
  label: string
}

/** 服务端 /comfygen/enums 归一结果（各枚举 {value,label} 列表 + ratio→尺寸表） */
export interface ServerEnums {
  source: string
  surfaces: EnumOption[]
  environments: EnumOption[]
  lightings: EnumOption[]
  styles: EnumOption[]
  compositions: EnumOption[]
  cameras: EnumOption[]
  fidelity: EnumOption[]
  /** 参考模式（方向档位字典，2026-10-09 /comfygen/enums 下发）：
   *  scene_refs=画面级还原（原片帧参考）/ style_anchor=风格级相似（文字+产品图） */
  referenceModes: EnumOption[]
  ratios: Array<{ ratio: string; width: number; height: number }>
}

function toOptions(map: unknown): EnumOption[] {
  if (!map || typeof map !== 'object') return []
  return Object.entries(map as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string')
    .map(([value, label]) => ({ value, label: String(label) }))
}

/**
 * 归一化服务端枚举响应（实测 2026-10-02：{ok,source,contract,surfaces,
 * environments,lightings,styles,compositions,cameras,fidelity,ratios}，
 * 各枚举为 {值:中文标签} 映射、ratios 为 {ratio:[w,h]}）。
 * ok!==true 或 cameras/fidelity 缺失 → null（调用方显式报错，不兜底猜测）。
 */
export function normalizeServerEnums(raw: unknown): ServerEnums | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.ok !== true) return null
  const ratios: ServerEnums['ratios'] = []
  if (o.ratios && typeof o.ratios === 'object') {
    for (const [ratio, wh] of Object.entries(o.ratios as Record<string, unknown>)) {
      if (Array.isArray(wh) && wh.length >= 2 && Number.isFinite(Number(wh[0])) && Number.isFinite(Number(wh[1]))) {
        ratios.push({ ratio, width: Number(wh[0]), height: Number(wh[1]) })
      }
    }
  }
  const enums: ServerEnums = {
    source: String(o.source || ''),
    surfaces: toOptions(o.surfaces),
    environments: toOptions(o.environments),
    lightings: toOptions(o.lightings),
    styles: toOptions(o.styles),
    compositions: toOptions(o.compositions),
    cameras: toOptions(o.cameras),
    fidelity: toOptions(o.fidelity),
    referenceModes: toOptions(o.reference_mode),
    ratios,
  }
  if (!enums.cameras.length || !enums.fidelity.length) return null
  // off 档（2026-10-09 用户裁决：FlashVSR LoRA 默认不启用）服务端下发空 label——补可读文案
  for (const f of enums.fidelity) {
    if (f.value === 'off' && !f.label) f.label = '关（默认，不启用 FlashVSR）'
  }
  return enums
}

/** 场景四要素键序（§3 gen.scene） */
export type SceneElementKey = 'surface' | 'environment' | 'lighting' | 'style' | 'composition'
export const SCENE_ELEMENT_KEYS: SceneElementKey[] = ['surface', 'environment', 'lighting', 'style', 'composition']

const SCENE_ELEMENT_ENUM_MAP: Record<SceneElementKey, 'surfaces' | 'environments' | 'lightings' | 'styles' | 'compositions'> = {
  surface: 'surfaces',
  environment: 'environments',
  lighting: 'lightings',
  style: 'styles',
  composition: 'compositions',
}

/** 取场景某要素的下拉选项（中文下拉值=comfygen 枚举，§5.3-2） */
export function sceneElementOptions(enums: ServerEnums | null, key: SceneElementKey): EnumOption[] {
  if (!enums) return []
  return enums[SCENE_ELEMENT_ENUM_MAP[key]]
}

/** 枚举值 → 中文标签（未命中回退原值，用于展示而非校验） */
export function enumLabel(options: EnumOption[], value: unknown): string {
  const v = String(value ?? '')
  return options.find((o) => o.value === v)?.label || v
}

/** ratio → 尺寸换算（未命中返回 null；§6 gen_spec 同源表） */
export function ratioSize(enums: ServerEnums, ratio: unknown): { width: number; height: number } | null {
  const r = String(ratio ?? '')
  const hit = enums.ratios.find((x) => x.ratio === r)
  return hit ? { width: hit.width, height: hit.height } : null
}

export const GEN_BACKENDS: GenBackend[] = ['comfygen', 'jimeng', 'runninghub', 'manual']
export const FRAMES_STATUS_VALUES: FramesStatus[] = ['pending', 'generated', 'confirmed']
export const GEN_STATUS_VALUES: GenStatus[] = ['pending', 'submitted', 'done', 'failed']
export const GENERATE_STAGE_VALUES: GenerateStage[] = ['aroll', 'storyboard', 'frames', 'videos', 'all']

/** duration 合法区间（§4：归一到 3~15s；v4.1 §3 下限 5→3 已放宽） */
export const DURATION_MIN = 3
export const DURATION_MAX = 15

/** A-roll 对轨 warning 阈值（§3：Σduration vs voice_dur_sec 偏差超 ±15% 提示节奏审视） */
export const AROLL_TIMELINE_TOLERANCE = 0.15

// ── 数据模型（§3 shot 增量字段 / 根级 aroll）────────────────────

/** 分镜帧引用（§3 定形：{path|url, source}；帧不入素材库，worker 实现={"path","source"}） */
export interface FrameRef {
  path?: string
  url?: string
  source: 'generated' | 'manual'
}

/** 场景四要素（§3；枚举全集归服务端 gen_spec/comfygen /api/enums，客户端不臆造） */
export interface GenScene {
  surface?: string
  environment?: string
  lighting?: string
  style?: string
  composition?: 'centered' | 'closeup'
}

/** shot.gen 块（§3；material_id 副本已废——回填唯一权威 = shot 根级） */
export interface ShotGenBlock {
  backend?: GenBackend
  name: string
  scene?: GenScene
  scene_en?: string
  end_scene_en?: string
  camera?: CameraKey
  fidelity?: Fidelity
  first_frame?: FrameRef | null
  last_frame?: FrameRef | null
  frames_status?: FramesStatus
  /** v4.3 九宫分镜粗稿（低清，仅供九宫格整体确认；确认后解锁 frames 精稿） */
  draft_status?: 'pending' | 'generated' | 'confirmed'
  draft_first?: FrameRef | null
  draft_last?: FrameRef | null
  status?: GenStatus
  job_id?: string | null
  check?: unknown
  error?: string | null
  /** 该镜基础种子（v4.3 comfygen shots_done 回传；规范 §4 定稿：2026-10-05 起
   *  服务端回填消费——storyboard/frames 两阶段均回填，frames 复用保构图。
   *  客户端只随 PUT 原样透传不丢字段，不提交不消费语义） */
  seed_base?: number | null
  /** 选路建议（2026-10-07 批4 A4：拆解后置按规则标注——大运镜/环境镜/人物镜→original；
   *  客户端预选可改。缺省/None=无建议，维持现有 source 逻辑） */
  suggested_source?: ShotSource | null
}

/** meta.quality_report（批1 M0/D7：stage=frames 后置质量报告回填——评分挂只 warning
 *  不阻塞交付（S6）；缺源记 null=N/A 不算 0；issues=哨兵 S1/S2/S3 采集模式） */
export interface QualityReportIssue {
  rule: string
  shot?: string
  level?: string
  detail?: string
}
export interface QualityReportShotScore {
  aesthetic?: number | null
  product_sim?: number | null
  env_coverage?: number | null
  parallax_sim?: number | null
}
export interface QualityReport {
  stage?: string
  engine?: string
  cost?: Record<string, unknown>
  issues?: QualityReportIssue[]
  per_shot?: Record<string, QualityReportShotScore>
  cross_shot?: Record<string, unknown>
}

/** 六视图条目（§11-51：视角名 + 相对路径；相对路径由调用方 toAbsolute） */
export interface SixViewEntry {
  view: string
  path: string
  /** 服务端自包含 URL（新任务回填带 url 字段）；缺省由调用方按 sixViewFileUrl 拼 */
  url?: string
}
/** 六视图取图路由（2026-10-08 commit 1a428020 上线；view ∈ 六视角白名单） */
export function sixViewFileUrl(sid: string, view: string): string {
  return `/api/storyboard/scripts/${sid}/six-view/file/${view}`
}
const SIX_VIEW_ORDER = ['front', 'right', 'back', 'left', 'top', 'bottom']

/** 六视图轮询状态分类（2026-10-09 服务端联动取消：任务终态族 cancelled/canceled +
 *  重启对账 interrupted 是「已取消/已中断」终态，不是失败——服务端 meta.six_view
 *  留痕 job_id+remote_cancelled；大小写不敏感，未知状态按完成处理（沿用旧兜底）。 */
export type SixViewPollOutcome = 'pending' | 'failed' | 'cancelled' | 'complete'

export function classifySixViewPollStatus(status: unknown): SixViewPollOutcome {
  const st = String(status ?? '').toLowerCase()
  if (st === '' || st === 'pending' || st === 'running') return 'pending'
  if (st === 'failed' || st === 'error') return 'failed'
  if (st === 'cancelled' || st === 'canceled' || st === 'interrupted') return 'cancelled'
  return 'complete'
}


/** 六视图提取（§11-51，2026-10-08 实测定稿两种形态）：
 *  ① 键控对象（实测 result/meta 形态）：{status, views:{front:{path},…}} 或顶层即键控对象；
 *     输出按 front/right/back/left/top/bottom 规范序，非标准视角名按插入序追加；
 *  ② 数组形态（直数组或 views/paths/images/files 数组，元素=字符串或 {path}），view 留空由调用方标序号。 */
export function parseSixViewEntries(src: unknown): SixViewEntry[] {
  const asEntry = (e: unknown): SixViewEntry | null => {
    if (typeof e === 'string') return e.trim() ? { view: '', path: e } : null
    if (e && typeof e === 'object') {
      const rec = e as Record<string, unknown>
      const path = String(rec.path ?? '')
      if (!path.trim()) return null
      const url = typeof rec.url === 'string' && rec.url.trim() ? rec.url : undefined
      const view = typeof rec.view === 'string' && rec.view.trim() ? rec.view : undefined
      return { view: view || '', path, url }
    }
    return null
  }
  let cur = src
  // 轮询响应把载荷嵌在 result 下（task_queue 通用面）——剥一层再解析
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
    const r = (cur as Record<string, unknown>).result
    if (r && typeof r === 'object' && !Array.isArray(r)) cur = r
  }
  // ② 数组形态
  let arr: unknown[] | null = null
  if (Array.isArray(cur)) arr = cur
  else {
    const o = cur as Record<string, unknown> | null | undefined
    if (o) for (const k of ['views', 'paths', 'images', 'files']) {
      if (Array.isArray(o[k])) { arr = o[k] as unknown[]; break }
    }
  }
  if (arr) {
    return arr
      .map(asEntry)
      .filter((e): e is SixViewEntry => !!e)
      .map((e, i) => ({ ...e, view: e.view || String(i + 1) }))
  }
  // ① 键控对象形态（views 键优先，其次顶层即键控对象）
  const o = cur as Record<string, unknown> | null | undefined
  if (!o) return []
  const viewsObj = o.views && typeof o.views === 'object' && !Array.isArray(o.views)
    ? (o.views as Record<string, unknown>)
    : null
  const entries: SixViewEntry[] = []
  const collect = (obj: Record<string, unknown>): void => {
    for (const k of SIX_VIEW_ORDER) {
      const e = asEntry(obj[k])
      if (e) entries.push({ ...e, view: k })
    }
    for (const [k, e0] of Object.entries(obj)) {
      if (SIX_VIEW_ORDER.includes(k)) continue
      const e = asEntry(e0)
      if (e) entries.push({ ...e, view: e.view || k })
    }
  }
  if (viewsObj) collect(viewsObj)
  else {
    // 数组形态键名（views/paths/images/files）不是视角条目——非数组值时必须排除
    const skip = ['status', 'job_id', 'source', 'progress', 'task_id', 'views', 'paths', 'images', 'files']
    const keys = Object.keys(o).filter((k) => !skip.includes(k))
    if (keys.length && keys.every((k) => asEntry(o[k]))) collect(o)
  }
  return entries
}

/** 换物品配置块（2026-10-10 用户裁决：第 3 步「切换为实拍」升级为「切换为换物品」；
 *  refs=替换物产品图 material ids，默认带出第 2 步产品六视图，可经选择产品图弹窗改选；
 *  提交链=服务端换物引擎 media_jobs video_edit（refs 槽位序 1~9 张），本批只做状态与
 *  选择 UI，第四步提交编排另行批次）。随 shots JSONB 透传往返，服务端零改动。 */
export interface ShotReplaceItem {
  operation: 'replace'
  /** 替换物产品图 material id（H3 ref2va refs 槽位序=此数组序，≤9 张） */
  ref_ids: number[]
  /** 替换目标物品描述（可空=纯参考图；video_edit object_desc 载荷，出口须 ASCII） */
  object_desc: string
}

/** 仿视频 shot（文案线既有字段 shot_type/visual/audio/sfx 等经 extra 透传） */
export interface ImitationShot {
  index?: number
  visual?: string
  audio?: string
  /** 原片旁白切片（拆解稿参考，第 2 步替换文字前的原稿；extra=allow 随脚本保存） */
  orig_audio?: string
  duration: number
  /** 混剪标准绑定字段（实拍绑定 / AI 生成回填 唯一权威，§3） */
  material_id?: number | string | null
  material_path?: string | null
  source?: ShotSource
  gen?: ShotGenBlock
  replace_item?: ShotReplaceItem
  [extra: string]: unknown
}

/** 根级 aroll 块（§3） */
export interface ArollBlock {
  source: ArollSource
  image_material_id?: number | string | null
  audio_id?: number | string | null
  material_id?: number | string | null
  status?: ArollStatus
  error?: string | null
}

// ── 工具 ────────────────────────────────────────────────────────

/** 纯 ASCII 判定（v4.1 铁律：scene_en/end_scene_en/name 出口校验） */
export function isAscii(s: unknown): boolean {
  return typeof s === 'string' && /^[\x00-\x7F]*$/.test(s)
}

function isDigits(s: string): boolean {
  return /^\d+$/.test(s)
}

/** duration 归一（clamp 3~15，非法输入回退 5；§4「归一到 3~15s」客户端镜像） */
export function clampDuration(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 5
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(v)))
}

/** 生成 ASCII 唯一名 shot_NN（§3 gen.name：重试合并键；与既有名冲突时递增） */
export function nextGenName(existingNames: Array<string | undefined | null>, start = 1): string {
  const used = new Set(existingNames.filter((n): n is string => typeof n === 'string'))
  let i = start
  while (used.has(`shot_${String(i).padStart(2, '0')}`)) i += 1
  return `shot_${String(i).padStart(2, '0')}`
}

// ── 状态机（§3 两条独立状态机 + §5.1-1 阶段 D 闸门）─────────────

/** 帧是否可确认（HumanGate②：仅 generated 态允许确认） */
export function canConfirmFrames(shot: ImitationShot): boolean {
  return shot.source === 'generate' && shot.gen?.frames_status === 'generated'
}

/** 阶段 D 是否放行（§5.1-1：全部 source=generate 镜头 frames_status=confirmed；无生成镜=true） */
export function isStageDReady(shots: ImitationShot[]): boolean {
  return shots.every((s) => s.source !== 'generate' || s.gen?.frames_status === 'confirmed')
}

/** 换物品镜判定（source=material 且带 replace_item 块——纯手动实拍绑定不带块） */
export function isReplaceShot(shot: ImitationShot): boolean {
  return shot.source === 'material' && !!shot.replace_item
}

/** 模式驱动换物镜判定（§11-62 video_replace 档：服务端 worker 按模式把全部
 *  generate 镜路由 video_edit——该档下 generate 镜即换物镜，无论有无显式块） */
export function shotInReplace(shot: ImitationShot, referenceMode: string): boolean {
  return isReplaceShot(shot) || (referenceMode === 'video_replace' && shot.source === 'generate')
}

/** 模式感知徽标文案（video_replace 档 generate 镜在待生成/生成中=物品替换；
 *  done/failed 落回 genBadgeText 保住终态显示；显式块/其余档走 genBadgeText） */
export function shotModeBadgeText(shot: ImitationShot, referenceMode: string): string {
  const st = shot.gen?.status ?? 'pending'
  if (referenceMode === 'video_replace' && shot.source === 'generate' && !shot.replace_item
    && (st === 'pending' || st === 'submitted')) return '物品替换'
  return genBadgeText(shot)
}

/** 模式感知徽标配色类（与 shotModeBadgeText 同口径：仅待生成/生成中档位驱动镜
 *  走 mat 灰不冒充 AI 绿；done/failed 落回 gen 态配色 ai 绿/fail 红） */
export function shotModeBadgeClass(shot: ImitationShot, referenceMode: string): string {
  const st = shot.gen?.status ?? 'pending'
  if (referenceMode === 'video_replace' && shot.source === 'generate' && !shot.replace_item
    && (st === 'pending' || st === 'submitted')) return 'iv-badge--mat'
  if (shot.source !== 'generate') return 'iv-badge--mat'
  if (shot.gen?.status === 'done') return 'iv-badge--ai'
  if (shot.gen?.status === 'failed') return 'iv-badge--fail'
  return 'iv-badge--mat'
}

/** 逐镜生成徽标文案（§5.3-5：待生成/生成中/完成/失败+原因；换物品镜优先显示） */
export function genBadgeText(shot: ImitationShot): string {
  if (shot.source !== 'generate') return isReplaceShot(shot) ? '物品替换' : '实拍'
  const st = shot.gen?.status ?? 'pending'
  if (st === 'pending') return '待生成'
  if (st === 'submitted') return '生成中'
  if (st === 'done') return '已完成'
  return `失败：${shot.gen?.error || '未知原因'}`
}

/** 分镜帧徽标文案（§5.3-4 HumanGate②：帧待生成/帧待确认/帧已确认） */
export function framesBadgeText(shot: ImitationShot): string {
  if (shot.source !== 'generate') return ''
  const st = shot.gen?.frames_status ?? 'pending'
  if (st === 'pending') return '帧待生成'
  if (st === 'generated') return '帧待确认'
  return '帧已确认'
}

// ── 来源切换（§5.3-2：整镜切换 AI↔实拍，混合比例人工定稿）────────

/**
 * 整镜切换来源（2026-10-02 用户裁决 A1/A2）：
 * · 切实拍（→material）：**保留 gen 块**——gen 是小体积配置数据且携带已确认帧引用
 *   （first/last_frame、frames_status），删除后切回需重跑映射层并重烧 GPU 重生成帧；
 *   "僵尸块"顾虑因体积小不成立。实拍镜上的 gen 为惰性保留（阶段 C/D 只筛
 *   source=generate）；material_id 保留由用户重绑。
 * · 切 AI（→generate）：绑定字段清零（A1：material_id=0/material_path=''，实测
 *   integer default 0 非 nullable，null 会被 422；防旧实拍绑片在生成完成前混入混剪）；
 *   若镜头已有保留的 gen 块则**原样恢复不重建**（保住编辑过的提示词/运镜/帧状态），
 *   无 gen 才初始化全新块（backend=comfygen、唯一名、双状态机归 pending）。
 */
export function switchShotSource(shot: ImitationShot, to: ShotSource, allShots: ImitationShot[] = []): ImitationShot {
  if (to === 'material') {
    return { ...shot, source: 'material' }
  }
  if (shot.gen) {
    return { ...shot, source: 'generate', material_id: 0, material_path: '' }
  }
  return {
    ...shot,
    source: 'generate',
    material_id: 0,
    material_path: '',
    gen: {
      backend: 'comfygen',
      name: nextGenName(allShots.map((s) => s.gen?.name)),
      scene: {},
      camera: 'push_in',
      fidelity: 'balanced',
      first_frame: null,
      last_frame: null,
      frames_status: 'pending',
      status: 'pending',
      job_id: null,
      check: null,
      error: null,
    },
  }
}

/**
 * 切换为换物品（2026-10-10 用户裁决，替代原「切换为实拍」按钮语义）：
 * · source→material + 挂 replace_item 块（refs 缺省=第 2 步产品六视图 material ids，
 *   空则由选择产品图弹窗补选）；binding 字段清零（material_id=0/material_path=''，
 *   同切 AI 口径——换物镜的绑定视频来自换物管线产物，不消费手动绑定旧值）。
 * · gen 块保留（同切实拍语义：小体积配置+已确认帧引用，切回 AI 原样恢复不重建）。
 */
export function enableShotReplaceItem(shot: ImitationShot, defaultRefIds: number[] = []): ImitationShot {
  return {
    ...shot,
    source: 'material',
    material_id: 0,
    material_path: '',
    replace_item: {
      operation: 'replace',
      ref_ids: defaultRefIds.slice(0, 9).map(Number).filter((n) => Number.isFinite(n) && n > 0),
      object_desc: '',
    },
  }
}

/** 切回 AI 生成：剥 replace_item 块 + 走既有切 AI 路径（gen 块原样恢复不重建） */
export function disableShotReplaceItem(shot: ImitationShot, allShots: ImitationShot[] = []): ImitationShot {
  const { replace_item: _drop, ...rest } = shot
  return switchShotSource(rest, 'generate', allShots)
}

// ── gen_spec 客户端镜像（§6：Part 1 出口自检 / PUT 前把关）────────

export interface GenSpecIssue {
  index: number
  field: string
  message: string
}

/**
 * 提交前校验（§4 契约测试口径的客户端镜像）：枚举合法 / scene_en 纯 ASCII /
 * duration 3~15 / name 唯一且 ASCII。传入 enums（/comfygen/enums 归一结果）时
 * 连带校验 camera/fidelity/场景四要素全集；未传则跳过枚举全集检查（服务端
 * gen_spec 兜底）——本地不再维护枚举表（裁决 A4/§11-19）。
 */
export function validateGenShots(shots: ImitationShot[], enums?: ServerEnums | null): GenSpecIssue[] {
  const issues: GenSpecIssue[] = []
  const seenNames = new Map<string, number>()
  shots.forEach((shot, i) => {
    if (shot.source !== 'generate') return
    const gen = shot.gen
    if (!gen) {
      issues.push({ index: i, field: 'gen', message: 'AI 镜头缺 gen 块' })
      return
    }
    if (!gen.name) issues.push({ index: i, field: 'gen.name', message: 'gen.name 必填' })
    else {
      if (!isAscii(gen.name)) issues.push({ index: i, field: 'gen.name', message: `name 含非 ASCII：${gen.name}` })
      if (seenNames.has(gen.name)) {
        issues.push({ index: i, field: 'gen.name', message: `name 重复：${gen.name}（首次出现在第 ${seenNames.get(gen.name)! + 1} 镜）` })
      } else seenNames.set(gen.name, i)
    }
    if (gen.scene_en !== undefined && gen.scene_en !== '' && !isAscii(gen.scene_en)) {
      issues.push({ index: i, field: 'gen.scene_en', message: 'scene_en 含非 ASCII 字符（中文提示词会编码灾难，v4.1 铁律）' })
    }
    if (gen.end_scene_en !== undefined && gen.end_scene_en !== '' && !isAscii(gen.end_scene_en)) {
      issues.push({ index: i, field: 'gen.end_scene_en', message: 'end_scene_en 含非 ASCII 字符' })
    }
    if (gen.camera && enums && !enums.cameras.some((c) => c.value === gen.camera)) {
      issues.push({ index: i, field: 'gen.camera', message: `未知运镜：${gen.camera}（合法值以 /comfygen/enums 为准）` })
    }
    if (gen.fidelity && enums && !enums.fidelity.some((f) => f.value === gen.fidelity)) {
      issues.push({ index: i, field: 'gen.fidelity', message: `未知保真档位：${gen.fidelity}` })
    }
    if (gen.scene && enums) {
      const scene = gen.scene as Record<string, unknown>
      for (const key of SCENE_ELEMENT_KEYS) {
        const v = scene[key]
        if (v === undefined || v === null || v === '') continue
        if (!sceneElementOptions(enums, key).some((o) => o.value === String(v))) {
          issues.push({ index: i, field: `gen.scene.${key}`, message: `未知场景枚举 ${key}=${v}（合法值以 /comfygen/enums 为准）` })
        }
      }
    }
    if (gen.backend && !GEN_BACKENDS.includes(gen.backend)) {
      issues.push({ index: i, field: 'gen.backend', message: `未知生成后端：${gen.backend}` })
    }
    if (gen.frames_status && !FRAMES_STATUS_VALUES.includes(gen.frames_status)) {
      issues.push({ index: i, field: 'gen.frames_status', message: `非法帧状态：${gen.frames_status}` })
    }
    if (gen.status && !GEN_STATUS_VALUES.includes(gen.status)) {
      issues.push({ index: i, field: 'gen.status', message: `非法生成状态：${gen.status}` })
    }
    const dur = Number(shot.duration)
    if (!Number.isFinite(dur) || dur < DURATION_MIN || dur > DURATION_MAX) {
      issues.push({ index: i, field: 'duration', message: `时长 ${shot.duration} 越界（${DURATION_MIN}~${DURATION_MAX}s）` })
    }
  })
  return issues
}

// ── A-roll 对轨（§3：A-roll 轨主权=口播音频；镜头轨主权=脚本 duration）──

/** 镜头轨总时长（Σduration） */
export function shotsTotalDuration(shots: ImitationShot[]): number {
  return shots.reduce((acc, s) => acc + (Number(s.duration) || 0), 0)
}

/**
 * 保存脚本时的节奏 warning（§3：|Σduration − voice_dur_sec| / voice_dur_sec > 15%
 * 仅提示不改数据；voice 时长缺失 → 空串不提示）。voice_dur_sec 字段存在性待服务端
 * 实证（流程规范 §11-12）。
 */
export function arollTimelineWarning(shots: ImitationShot[], voiceDurSec: unknown): string {
  const v = Number(voiceDurSec)
  if (!Number.isFinite(v) || v <= 0) return ''
  const total = shotsTotalDuration(shots)
  const dev = Math.abs(total - v) / v
  if (dev <= AROLL_TIMELINE_TOLERANCE) return ''
  const pct = Math.round(dev * 100)
  return `口播 ${v.toFixed(1)}s 与镜头总时长 ${total.toFixed(1)}s 偏差 ${pct}%（阈值 ±${Math.round(AROLL_TIMELINE_TOLERANCE * 100)}%），建议审视节奏`
}

/** 成片总长 = 两轨较长者（§3 措辞澄清；任一缺失取另一轨） */
export function composedDuration(arollDurSec: unknown, timelineDurSec: unknown): number {
  const a = Number(arollDurSec)
  const t = Number(timelineDurSec)
  const hasA = Number.isFinite(a) && a > 0
  const hasT = Number.isFinite(t) && t > 0
  if (hasA && hasT) return Math.max(a, t)
  if (hasA) return a
  if (hasT) return t
  return 0
}

// ── Part 1 请求体（§4 输入：video = material_id | http url | 上传文件）──

export interface ImitateVideoInput {
  kind: 'material' | 'url' | 'video_path' | 'local_file'
  materialId?: number | string
  url?: string
  videoPath?: string
  localPath?: string
  note: string
}

/**
 * 归一化原视频来源（§4 三形态）。与旧版仿爆款 normalizeSource 不同源：
 * V3.5 明确允许 http url；本地文件 → local_file（调用方经通用上传通道预上传后
 * 以路径重建 body，§4「上传文件」形态）。
 */
export function normalizeImitateVideo(videoRef: unknown): ImitateVideoInput | { kind: 'invalid'; note: string } {
  if (videoRef === null || videoRef === undefined || String(videoRef).trim() === '') {
    return { kind: 'invalid', note: '未提供原视频' }
  }
  if (typeof videoRef === 'number' || isDigits(String(videoRef).trim())) {
    const n = Number(videoRef)
    return { kind: 'material', materialId: Number.isInteger(n) ? n : String(videoRef).trim(), note: `素材库 id=${videoRef}` }
  }
  const s = String(videoRef).trim()
  // material://{id} URI（服务端实测入参形态；预上传成功后的回填往返也走这里——
  // 2026-10-02 实机事故：缺此分支时 URI 被误判为本地路径，上传成功却拒绝提交）
  const materialUri = /^material:\/\/(.+)$/.exec(s)
  if (materialUri) {
    return { kind: 'material', materialId: materialUri[1], note: `素材库 URI id=${materialUri[1]}` }
  }
  if (/^https?:\/\//i.test(s)) return { kind: 'url', url: s, note: 'http(s) 链接（服务端下载）' }
  if (/[/\\]output[/\\]/i.test(s) || /(^|[/\\])output[/\\]?$/i.test(s)) {
    return { kind: 'video_path', videoPath: s, note: '服务端已上传路径' }
  }
  if (s.includes('/') || s.includes('\\') || /\.[a-z0-9]{2,5}$/i.test(s)) {
    return { kind: 'local_file', localPath: s, note: '本地视频，需预上传后以路径提交' }
  }
  return { kind: 'material', materialId: s, note: `素材 id=${s}` }
}

export interface ImitateBodyInput {
  video: unknown
  products?: Array<unknown>
  options?: { ratio?: string; fidelity?: string; max_shots?: number }
}

/** POST /storyboard/scripts/imitate body（§4/§9；实测 2026-10-02：video 素材形态
 *  为 `material://{id}` URI 而非裸 id——文档 §4 的 material_id 字面按此 URI 落地） */
export function buildImitateBody(input: ImitateBodyInput): { ok: boolean; body: Record<string, unknown>; needsUpload?: string; note: string } {
  const src = normalizeImitateVideo(input.video)
  if (src.kind === 'invalid') return { ok: false, body: {}, note: src.note }
  if (src.kind === 'local_file') {
    return { ok: false, body: {}, needsUpload: src.localPath, note: src.note }
  }
  const body: Record<string, unknown> = {
    video: src.kind === 'material' ? `material://${src.materialId}` : src.kind === 'url' ? src.url : src.videoPath,
  }
  if (input.products?.length) body.products = input.products
  if (input.options) body.options = input.options
  return { ok: true, body, note: src.note }
}

// ── Part 2 请求体（§5.1 输入 / §9）──────────────────────────────

export interface StoryboardGenerateParams {
  scriptId: string
  /** 显式必填：任务级 stage 缺省值未裁决（§11-9），客户端不依赖服务端缺省 */
  stage: GenerateStage
  onlyShots?: string[]
  fidelityOverride?: Fidelity
  autoMontage?: boolean
  /** 产品图（2026-10-03 用户裁决：第 2 步必须先选产品图）——http url 或服务端本地
   *  路径字符串数组（worker _collect_product_files 只认这两形，material:// 不认），
   *  服务端 ≤6 张、≥1 张校验（产品锚定必需；2026-10-06 服务端放宽 2→6） */
  productImages?: string[]
  /** A-roll 实拍素材 id（stage=aroll 且 aroll.source=material 时必需，worker 直绑） */
  arollMaterialId?: number
  /** A-roll 数字人人物图引用（stage=aroll 且 source=digital_human，material:// 形态） */
  arollImage?: string
  /** 质量档（2026-10-07 批3 D4：draft 缺省（turbo）/ final 定稿非 turbo——非法值服务端
   *  出口即拒；定稿重跑按钮用 final） */
  quality?: 'draft' | 'final'
  /** 参考模式（方向档位字典：scene_refs=画面级还原 / style_anchor=风格级相似；
   *  字典 /comfygen/enums.reference_mode 下发，缺省 scene_refs） */
  referenceMode?: string
}

/** POST /scheduled/tasks body：task_type=storyboard_generate（§5.1；auto_montage 默认 false，§11-2 两段式）。
 *  契约参数面={script_id, stage?, only_shots?, fidelity_override?, auto_montage?}（规范 §5.1 定稿）——
 *  seed_base 不在提交面：服务端自回填自消费（gen.seed_base，2026-10-05 起），客户端发明提交形会被拒/忽略 */
export function buildStoryboardGenerateBody(p: StoryboardGenerateParams): Record<string, unknown> {
  if (!GENERATE_STAGE_VALUES.includes(p.stage)) {
    throw new Error(`非法 stage：${p.stage}（合法值 ${GENERATE_STAGE_VALUES.join('|')}；与 comfygen stage 同名异值勿混）`)
  }
  const params: Record<string, unknown> = { script_id: p.scriptId, stage: p.stage }
  if (p.onlyShots?.length) params.only_shots = p.onlyShots
  if (p.fidelityOverride) params.fidelity_override = p.fidelityOverride
  params.auto_montage = p.autoMontage ?? false
  // 产品图（2026-10-03 用户裁决：第 2 步选产品图后随生成任务直传；服务端 ≤6 张截断（2026-10-06 服务端放宽 2→6））
  if (p.productImages?.length) params.product_images = p.productImages.slice(0, 6)
  // A-roll 阶段③参数（2026-10-04 用户裁决：口播音频+图片→A-roll；worker 按 aroll.source 消费）
  if (p.arollMaterialId) params.aroll_material_id = p.arollMaterialId
  if (p.arollImage) params.aroll_image = p.arollImage
  // 质量档（批3 D4：draft 缺省/final 定稿非 turbo；不传=服务端缺省 draft）
  if (p.quality) params.quality = p.quality
  // 参考模式（方向档位字典；不传=服务端缺省）
  if (p.referenceMode) params.reference_mode = p.referenceMode
  return { task_type: 'storyboard_generate', params }
}

/** HumanGate② 帧确认表单值（实测 2026-10-02：PUT frames 为 multipart/form-data，
 * 字段 first/last 文件可选 + confirmed 布尔；本函数返回确认形态的表单值，
 * 由调用方以 multipart 编码发送，无文件）。
 */
export function buildFramesConfirmBody(): Record<string, unknown> {
  return { confirmed: true }
}

/** A-roll 产物预览相对 URL（2026-10-05：aroll.material_id 回填后 /material/serve 流式；
 *  0/空/非数字=未回填 → 空串。绝对化由调用方 toAbsolute 承担） */
export function arollPreviewUrlFrom(materialId: unknown): string {
  const mid = Number(materialId)
  return Number.isInteger(mid) && mid > 0 ? `/material/serve?material_id=${mid}` : ''
}

/** 九宫图总览相对 URL（v4.7 契约 2026-10-05：meta.storyboard_grid 回填后 GET
 *  storyboard-grid 直取；旧脚本无引用 → 空串，客户端落回逐镜粗稿网格） */
export function storyboardGridUrlFrom(meta: unknown, scriptId: string): string {
  const hasGrid = !!((meta as Record<string, unknown> | undefined)?.storyboard_grid)
  return hasGrid && scriptId ? `/api/storyboard/scripts/${scriptId}/storyboard-grid` : ''
}

/** HumanGate② 手动换帧 multipart 文件组（§9：multipart 上传首/尾帧；
 *  渲染层文件约定 {path}，主进程 multipartUpload 读盘上传，同 SplitRequest 口径） */
export function buildFramesReplaceFiles(firstLocalPath?: string, lastLocalPath?: string): { first?: { path: string }; last?: { path: string } } {
  const files: { first?: { path: string }; last?: { path: string } } = {}
  if (firstLocalPath) files.first = { path: firstLocalPath }
  if (lastLocalPath) files.last = { path: lastLocalPath }
  return files
}

/** 产品选择回读保留（2026-10-12 用户裁决：接口失败只影响对应结果的展示，
 *    不得波及无关组件——选择/清除产品尚未落库时，任何脚本回读（采纳文案/轮询/
 *    重进页面）不得用服务端旧态覆盖内存新态；任何一次保存成功后服务端恢复权威） */
export function preserveProductSelectionOnReload(
  prev: Record<string, unknown> | null | undefined,
  data: Record<string, unknown>,
  dirty: boolean,
): Record<string, unknown> {
  if (!prev || !dirty) return data
  const pm = (((prev.meta as Record<string, unknown> | undefined)?.imitate as Record<string, unknown> | undefined) ?? {})
  const meta = { ...((data.meta as Record<string, unknown> | undefined) ?? {}) }
  const imitate = { ...((meta.imitate as Record<string, unknown> | undefined) ?? {}) }
  if (pm.product_selected === true) {
    imitate.product_selected = true
    imitate.product_id = typeof pm.product_id === 'string' ? pm.product_id : ''
    imitate.product_images = Array.isArray(pm.product_images) ? pm.product_images : []
    imitate.product_image_ids = Array.isArray(pm.product_image_ids) ? pm.product_image_ids : []
    imitate.product_image_names = Array.isArray(pm.product_image_names) ? pm.product_image_names : []
    data.products = Array.isArray(prev.products) ? prev.products : []
  } else {
    imitate.product_selected = false
    imitate.product_id = ''
    imitate.product_images = []
    imitate.product_image_ids = []
    imitate.product_image_names = []
    data.products = []
  }
  meta.imitate = imitate
  data.meta = meta
  return data
}

/** 产品 chip 标签（选品时 products[0] 的 品牌/型号 去重拼接；未选品或无产品=空串，
 *  自动提取的 products 不得冒充——picked 由调用方传入 product_selected 状态） */
export function productChipLabel(products: unknown, picked: boolean): string {
  if (!picked) return ''
  const p = (Array.isArray(products) ? (products as Array<Record<string, unknown>>)[0] : undefined) ?? {}
  const parts = [p.brand, p.model || p.name].filter(Boolean).map(String).filter((v, i, a) => a.indexOf(v) === i)
  return parts.join(' / ') || String(p.name || p.brand || '')
}

/** PUT /scripts/{id} 整体替换组包（§8 ScriptIn 字段组；gen 随 shots JSONB 原样透传）。
 *  2026-10-12 自渲染层下沉还行数账——组件只供 record 快照与 shots。 */
export function buildScriptPutPayload(r: Record<string, unknown>, shots: ImitationShot[]): Record<string, unknown> {
  return {
    topic: r.topic ?? '',
    meta: r.meta ?? {},
    style: r.style ?? '',
    atmosphere: r.atmosphere ?? '',
    rhythm: r.rhythm ?? '',
    bgm_type: r.bgm_type ?? '',
    guidance: r.guidance ?? '',
    products: r.products ?? [],
    ratio: r.ratio ?? '',
    total_duration: r.total_duration ?? shotsTotalDuration(shots),
    shot_count: shots.length,
    shots: shots.map((s) => ({ ...s, duration: clampDuration(s.duration) })),
    saved_at: r.saved_at ?? '',
    voice_audio_id: r.voice_audio_id ?? 0,
    voice_dur_sec: r.voice_dur_sec ?? 0,
    aroll: r.aroll ?? {},
  }
}
