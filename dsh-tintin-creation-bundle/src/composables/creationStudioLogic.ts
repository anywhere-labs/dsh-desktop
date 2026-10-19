// ═══════════════════════════════════════════════════════════════
// creationStudioLogic — 创作模式·纯函数层（2026-10-16，仿即梦输入会话）
//
// 逆向依据（铁律 9）：入口结构/字典来自即梦桌面端 1.0.53 运行态提取
// （2026-10-16 CDP 动态分析：composer DOM + 技能市场字典 + 创作类型下拉），
// 截图基准 D:/tmp/jimeng-entry-reference.png；技能条目=即梦技能市场真实
// 数据（名称/作者/赞/使用量/描述原文）。
//
// 功能后端=本服务端（用户裁决 2026-10-16）：不消费即梦私有协议。
// ═══════════════════════════════════════════════════════════════

/** 媒体工具卡 id（App.vue GROUPS 的 id 域）——技能可绑定直达 */
export type CreationToolId =
  | 'storyboard'
  | 'jianying-templates'
  | 'video-transcribe'
  | 'cover-design'
  | 'image-matting'
  | 'material-library'
  | 'voice-clone'
  | 'copywriting-montage'
  | 'imitation-video'
  | 'live-slice'
  | 'subtitle-removal'
  | 'video-download'

export interface CreationSkill {
  id: string
  /** 芯片/菜单显示名（如「电影级长镜头运镜」） */
  name: string
  emoji: string
  /** 提示词模板：{{输入}}=用户主输入；{{主体}}=@主体名列表（顿号连接） */
  template: string
  /** 可选绑定：发送后直达的媒体工具卡 */
  tool?: CreationToolId
  /** 发送后端：llm（默认）/ voiceover / copy（语义见 buildVoiceoverRequest 注） */
  backend?: 'llm' | 'voiceover' | 'copy'
  /** 芯片徽标（即梦口径：New=蓝 / Hot=橙；提取自 2026-10-16 运行态） */
  badge?: 'New' | 'Hot'
  builtin?: boolean
}

export interface CreationSubject {
  id: string
  name: string
  /** 产品档案（2026-10-16 用户裁决：@ 选中即拉详情——型号/卖点/参数/六视图，LLM 资料块+口播+P4 媒体生成共用） */
  product?: CreationSubjectProduct
}

/** @主体的产品档案（产品库条目 → 客户端形状；来源=GET /api/product-library/items/{id}） */
export interface CreationSubjectProduct {
  id: string
  brand?: string
  model?: string
  /** 核心卖点（服务端 selling_points 多行 markdown → 行数组） */
  sellingPoints?: string[]
  /** 性能参数（服务端 features 多行 markdown → 行数组） */
  features?: string[]
  /** 六视图（view+可直连 URL——P4 媒体生成时即参考图入参） */
  sixViews?: Array<{ view: string; url: string }>
}

export const CREATION_SKILLS_KEY = 'tintin.creationStudio.skills.v1'

// ── 技能市场字典（即梦运行态提取的 2026-10-16 真实条目）────────────────
// 分类=即梦技能市场一级页签；badge=首页芯片行实拍。条目按使用量降序。
export interface CreationCatalogEntry {
  id: string
  name: string
  author: string
  likes: string
  usage: string
  description: string
  category: '广告营销' | '影视作品' | '平面设计' | '电商' | '动画动漫' | '其他'
  badge?: 'New' | 'Hot'
}

export const CREATION_CATALOG: readonly CreationCatalogEntry[] = Object.freeze([
  {
    id: 'cat-douyin-daihuo', name: '短视频爆款带货', author: '即梦AI', likes: '161', usage: '6730 次使用', category: '电商', badge: 'New',
    description: '一站式创作达人带货视频，让商品卖点变成看得见的种草理由。上传商品图或描述需求，即可提炼卖点、编写自然口播、设计逐镜分镜并生成视频。支持卖点多选组合，按需设置视频时长、画面比例、达人形象与出镜方式；通过商品演示、使用场景和明确的行动引导，增强内容吸引力与购买意愿。',
  },
  {
    id: 'cat-narrative-storyboard', name: '叙事短片导演分镜', author: '森海荧光', likes: '1257', usage: '3.6万 次使用', category: '影视作品', badge: 'Hot',
    description: '以森海荧光导演分镜方法论产出叙事短片：导演意图书、九列分镜表、4~15s Clip 表与逐 Clip 提示词，直至成片。当用户要做剧情/影视向 AI 短片，需要按森海风格（哥特怪诞卡通+暗黑童话+高审美电影感，可覆盖）做分镜、镜头设计与运镜提示词时调用；不处理电商带货、产品展示、纯图片风格化及单镜头快速生图。',
  },
  {
    id: 'cat-one-image-ad', name: '一图成片-电影广告全能导演', author: '渊静-中意', likes: '763', usage: '2万 次使用', category: '广告营销',
    description: '本技能基于用户上传的一张或多张图片，生成电影短片、电影预告、TVC广告、品牌广告、产品广告、社媒短片、IP角色预告、潮玩宣发、时尚大片、音乐视觉片、纪录片感短片、电商视频、发布会大屏片等多类型视频。流程包含视觉基因解构、视频类别选择、视频结构规划、对话/旁白/字幕配置、视觉扩展边界、短片方案、高密度分镜表、multi_modal2video 全能参考分段生成，以及 video_editor 最终拼接。',
  },
  {
    id: 'cat-script-asset', name: '剧本资产视频一条龙创作', author: '娜乌斯嘉', likes: '545', usage: '1.1万 次使用', category: '影视作品',
    description: '本技能从创意/原始文本出发，一站式完成标准剧本转换、视觉资产提取、设定图生成、分镜运镜设计、资产匹配到最终视频成片，支持每个环节用户确认调整，完成从创意到短片的全流程创作。',
  },
  {
    id: 'cat-series-sets', name: '系列套图生成', author: '渊静-中意', likes: '502', usage: '1.3万 次使用', category: '平面设计',
    description: '本技能用于将用户提供的母版提示词、参考图、产品图、角色设定、品牌资料、Logo、IP形象或视觉方向，抽象为稳定的系列视觉母体，并通过母版分析、风格锁定、动态配置卡、系列变量矩阵、提示词预览、图片生成、质检重试与高清处理，最终生成一组风格统一但变量清晰的系列图片。',
  },
  {
    id: 'cat-micro-expression', name: 'AI演员微表情导演', author: '即梦AI', likes: '502', usage: '7104 次使用', category: '影视作品', badge: 'Hot',
    description: '本技能通过表单交互生成符合影视要求的时间轴微表情提示词，支持批量生成微表情视频，当用户需要为AI视频创作设计精准微表情时调用，不处理完整长片创作。',
  },
  {
    id: 'cat-ecom-creative', name: '爆款电商短视频题材创意', author: 'Carson', likes: '494', usage: '1.1万 次使用', category: '电商',
    description: '电商短视频创作助手，支持多题材选择、时长配置，每个题材生成5组差异化方案，已集成爆款短视频高完播创作规则',
  },
  {
    id: 'cat-character-design', name: '角色设计', author: '慕影-中意', likes: '355', usage: '1.1万 次使用', category: '动画动漫',
    description: '通用角色设计skill：从人设到完整角色设定（内核配置→行为设计→视觉概念设计→角色概念设定图 prompt：探索变体/定妆立绘/三视图/表情表/姿态表），以及对现成角色的诊断修复。产出为白底设定图（无环境无场景）。',
  },
  {
    id: 'cat-pop-ad', name: '顶级波普视觉广告导演', author: '即梦AI', likes: '314', usage: '2582 次使用', category: '广告营销',
    description: '本技能输出12秒高频闪切快消品短视频分镜表，专注Z世代/Y2K波普风格创作。当用户提供快消产品信息、视觉元素和氛围关键词时调用，不处理非快消品类或长视频广告创作。',
  },
  {
    id: 'cat-tryon', name: '穿搭上身试穿视频生成', author: '即梦AI', likes: '277', usage: '2801 次使用', category: '电商',
    description: '本技能输出15秒竖版UGC风格穿搭上身试穿视频，当用户上传衣服和模特参考图，希望生成穿搭试穿展示视频时调用，不处理非穿搭类视频创作。',
  },
  {
    id: 'cat-future-electronics', name: '高能未来电子产品广告视频', author: '即梦AI', likes: '253', usage: '2684 次使用', category: '广告营销',
    description: '本技能输出高能电影感未来风格高级电子产品广告视频；当用户上传电子产品参考图，希望生成专业产品商业广告视频时调用；不处理非电子产品、要求添加场景人物的广告视频创作。',
  },
  {
    id: 'cat-story-dev', name: '故事开发', author: '慕影-中意', likes: '204', usage: '3264 次使用', category: '影视作品',
    description: '通用故事开发skill：从零开发（想法→定位声明→logline→人物配置→节拍表→treatment）与诊断修复。内核是好故事评价体系（三门槛/四轴）+ 生成七步工序 + 结构锚点库（三幕/Save the Cat/英雄之旅/起承转合/微短剧节拍等）。做到 treatment/节拍表为止。',
  },
  {
    id: 'cat-fashion-runway', name: '时尚走秀短视频导演', author: '即梦AI', likes: '196', usage: '2254 次使用', category: '广告营销',
    description: '本技能将简单输入升维拆解为15秒充满高级感的工业级奢侈品时尚走秀短视频分镜表。当用户提供模特特征、服装特征和场景，需要创作高奢街拍广告视频分镜时调用，不处理非奢侈品时尚走秀类视频创作。',
  },
  {
    id: 'cat-jewelry-ecom', name: '珠宝电商图文视频一站式', author: '地质大学博士说AI', likes: '177', usage: '1879 次使用', category: '电商',
    description: '仅限珠宝品类的电商素材一站式生成：按平台预设产出商品主图、角度图、细节图、佩戴图、场景图、包装图、卖点图 + 商品文案 + 短视频。非珠宝品类不适用。',
  },
])

/** 技能市场分类页签（即梦运行态提取顺序） */
export const CREATION_CATALOG_CATEGORIES: ReadonlyArray<CreationCatalogEntry['category']> =
  ['广告营销', '影视作品', '平面设计', '电商', '动画动漫', '其他']

/** 创作类型字典（即梦 composer 的 Agent 模式下拉原文，2026-10-16 提取） */
export const CREATION_TYPES: ReadonlyArray<{ id: string; label: string }> = Object.freeze([
  { id: 'agent', label: 'Agent 模式' },
  { id: 'image', label: '图片生成' },
  { id: 'video', label: '视频生成' },
  { id: 'music', label: '音乐生成' },
  { id: 'audio', label: '音频生成' },
  { id: 'digital-human', label: '数字人' },
  { id: 'motion', label: '动作模仿' },
])

/** 创作类型提示词前缀（各类型产出物口径；creationSystemPrompt 消费） */
const TYPE_PROMPT_PREFIX: Record<string, string> = {
  image: '请为「图片生成」输出可直接使用的绘画提示词方案（主体/构图/风格/光线/负向词）',
  video: '请为「视频生成」输出可直接使用的视频生成提示词与分镜方案',
  music: '请为「音乐生成」输出可直接使用的音乐生成提示词方案（风格/情绪/结构/BPM）',
  audio: '请为「音频生成」输出可直接使用的音频/音效生成提示词方案',
  'digital-human': '请为「数字人」输出可直接使用的数字人生成方案（形象/口播文案/动作）',
  motion: '请为「动作模仿」输出可直接使用的动作模仿提示词方案（参考主体/动作描述/节奏）',
}

/** llm 后端的 system 段：Agent 模式不注入（=undefined），具体类型按字典包一层 */
export function creationSystemPrompt(typeId: string, typeLabel: string): string | undefined {
  if (typeId === 'agent') return undefined
  return `用户在创作会话中选择了创作类型「${typeLabel}」。${TYPE_PROMPT_PREFIX[typeId] ?? ''}。`
}

/** 技能可绑定的工具卡选项（编辑器下拉；value=媒体包工具卡 id） */
export const TOOL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '不绑定（仅创作）' },
  { value: 'storyboard', label: '分镜脚本创作' },
  { value: 'copywriting-montage', label: '文案混剪' },
  { value: 'imitation-video', label: '仿爆款视频' },
  { value: 'cover-design', label: '封面制作' },
  { value: 'voice-clone', label: '声音克隆' },
  { value: 'material-library', label: '素材库' },
  { value: 'video-transcribe', label: '视频转文字' },
  { value: 'live-slice', label: '直播切片' },
]

export function toolLabel(id: string): string {
  return TOOL_OPTIONS.find((o) => o.value === id)?.label ?? id
}

/** 由市场条目生成用户技能（「添加」语义：加入芯片行，模板=技能描述原文组包） */
export function catalogToSkill(entry: CreationCatalogEntry): CreationSkill {
  return {
    id: `skill-${entry.id}`,
    name: entry.name,
    emoji: '🧩',
    template: `你是「${entry.name}」技能（作者：${entry.author}）。技能说明：\n${entry.description}\n\n请对下面的创作需求执行该技能：\n{{输入}}{{主体}}`,
    backend: 'llm',
  }
}

/** 首页芯片行（即梦运行态：7 个技能名 + New/Hot 徽标） */
export const BUILTIN_CREATION_SKILLS: readonly CreationSkill[] = Object.freeze([
  { id: 'sk-cinematic-camera', name: '电影级长镜头运镜', emoji: '🎬', badge: 'New', builtin: true, backend: 'llm', template: '以电影级长镜头运镜的方式呈现：{{输入}}。\n要求：一镜到底的运镜设计（推/拉/摇/移/跟随），交代主体与环境的空间关系，节奏由缓到急再收束；标注每个段落的镜头运动与时长建议。{{主体}}' },
  { id: 'sk-storyboard', name: '创作分镜', emoji: '🎞️', badge: 'New', builtin: true, tool: 'storyboard', backend: 'llm', template: '请把下面的想法拆成可拍摄的分镜脚本：{{输入}}\n每镜包含：画面描述、景别、运镜、时长（秒）、台词/旁白。{{主体}}' },
  { id: 'sk-style-master', name: '风格大师', emoji: '🎨', badge: 'New', builtin: true, backend: 'llm', template: '作为风格大师，为下面的内容定调整体视觉与叙事风格：{{输入}}\n输出：风格关键词（3-5 个）、参考影调/色调、材质与光线建议、统一到全片的风格守则。{{主体}}' },
  { id: 'sk-narrative-storyboard', name: '叙事短片导演分镜', emoji: '🎥', badge: 'Hot', builtin: true, tool: 'storyboard', backend: 'llm', template: `你是「叙事短片导演分镜」技能（作者：森海荧光）。技能说明：\n以森海荧光导演分镜方法论产出叙事短片：导演意图书、九列分镜表、4~15s Clip 表与逐 Clip 提示词，直至成片。\n\n请对下面的创作需求执行该技能：\n{{输入}}{{主体}}` },
  { id: 'sk-micro-expression', name: '微表情导演', emoji: '😌', badge: 'Hot', builtin: true, backend: 'llm', template: '你是「AI演员微表情导演」技能。以微表情导演的方式细化下面场景中人物的表演：{{输入}}\n逐拍给出：微表情变化（眼/眉/嘴）、头部与肢体微动作、与台词/节奏的配合点。{{主体}}' },
  { id: 'sk-ad-director', name: '电影广告全能导演', emoji: '📺', builtin: true, tool: 'copywriting-montage', backend: 'llm', template: '以电影广告片导演身份把下面的brief发展为15-30s广告：{{输入}}\n输出：核心卖点一句话、创意概念、逐镜脚本（画面/运镜/字幕/音乐点）、结尾落版与行动号召。{{主体}}' },
  { id: 'sk-series-sets', name: '系列套图生成', emoji: '🖼️', builtin: true, tool: 'cover-design', backend: 'llm', template: '围绕下面的主题设计一组风格统一的系列图（4-6 张）：{{输入}}\n每张给出：画面主体与构图、统一风格的色调/字体/版式规则、图与图之间的叙事递进关系。{{主体}}' },
])

function cloneSkills(skills: readonly CreationSkill[]): CreationSkill[] {
  return skills.map((s) => ({ ...s }))
}

/** 发送后端归一（缺省 llm；枚举外一律 llm） */
export function effectiveBackend(skill: CreationSkill | null | undefined): 'llm' | 'voiceover' | 'copy' {
  return skill?.backend === 'voiceover' || skill?.backend === 'copy' ? skill.backend : 'llm'
}

/** localStorage 原始值 → 合法技能表（容错：坏 JSON/缺字段/空名丢弃；全空=回内置芯片） */
export function sanitizeSkills(raw: unknown): CreationSkill[] {
  if (!Array.isArray(raw)) return cloneSkills(BUILTIN_CREATION_SKILLS)
  const out: CreationSkill[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const id = String(it.id ?? '').trim()
    const name = String(it.name ?? '').trim()
    if (!id || !name) continue
    const tool = typeof it.tool === 'string' && it.tool.trim() ? (it.tool.trim() as CreationToolId) : undefined
    const backend = it.backend === 'voiceover' || it.backend === 'copy' || it.backend === 'llm' ? it.backend : undefined
    const badge = it.badge === 'New' || it.badge === 'Hot' ? it.badge : undefined
    out.push({
      id,
      name,
      emoji: String(it.emoji ?? '🧩').trim() || '🧩',
      template: String(it.template ?? ''),
      ...(tool ? { tool } : {}),
      ...(backend ? { backend } : {}),
      ...(badge ? { badge } : {}),
      ...(it.builtin === true ? { builtin: true } : {}),
    })
  }
  return out.length > 0 ? out : cloneSkills(BUILTIN_CREATION_SKILLS)
}

/** 读自定义技能表（注入 storage 便于测试；缺省=内置芯片） */
export function loadSkills(storage?: Pick<Storage, 'getItem'>): CreationSkill[] {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return cloneSkills(BUILTIN_CREATION_SKILLS)
  try {
    const raw = store.getItem(CREATION_SKILLS_KEY)
    if (!raw) return cloneSkills(BUILTIN_CREATION_SKILLS)
    return sanitizeSkills(JSON.parse(raw))
  } catch (_) {
    return cloneSkills(BUILTIN_CREATION_SKILLS)
  }
}

/** 写自定义技能表（写入失败静默——预设丢失不阻塞创作） */
export function saveSkills(skills: readonly CreationSkill[], storage?: Pick<Storage, 'setItem'>): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return
  try {
    store.setItem(CREATION_SKILLS_KEY, JSON.stringify(skills))
  } catch (_) { /* 配额/隐私模式：本次会话内仍可用 */ }
}

/** 恢复默认=清存储回内置芯片行 */
export function resetSkills(storage?: Pick<Storage, 'removeItem'>): CreationSkill[] {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  try { store?.removeItem(CREATION_SKILLS_KEY) } catch (_) { /* 同上 */ }
  return cloneSkills(BUILTIN_CREATION_SKILLS)
}

export function newSkillId(): string {
  return `sk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 技能过滤：名字/模板包含即命中（大小写不敏感；空串=全部） */
export function filterSkills(skills: readonly CreationSkill[], query: string): CreationSkill[] {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return cloneSkills(skills)
  return skills.filter((s) => s.name.toLowerCase().includes(q) || s.template.toLowerCase().includes(q))
}

/** 从输入解析「/技能名」令牌（/ 后空白也命中——空名=打开未过滤的技能菜单） */
export function extractSkillToken(text: string): { name: string; rest: string } | null {
  const m = /\/([^\s@/]{0,24})/u.exec(String(text ?? ''))
  if (!m) return null
  return { name: m[1] ?? '', rest: String(text ?? '').slice(0, m.index) + String(text ?? '').slice((m.index ?? 0) + m[0].length) }
}

/** 光标处活跃触发令牌（2026-10-17 方案 1+4 落地）：取光标前到最近空白的词，
 *  再截取词内最后一个 / 或 @ 起的尾部——`使用/技` 的活跃令牌是 `/技`（技能
 *  菜单），已完成提及（其后有空格/正文）不再唤起菜单，修掉全文 lastIndexOf
 *  每键重开的旧行为；无触发符=空串。 */
export function activeTokenAt(text: string, caret: number): string {
  const before = String(text ?? '').slice(0, Math.max(0, Math.floor(caret)))
  const word = /[^\s]*$/u.exec(before)?.[0] ?? ''
  const idx = Math.max(word.lastIndexOf('/'), word.lastIndexOf('@'))
  return idx < 0 ? '' : word.slice(idx)
}

/** / 技能引用内联补全（2026-10-17 用户裁决方案 1）：尾部活跃 `/令牌` 原位
 *  替换为完整提及；无活跃令牌（工具栏/芯片行路径）则在文末追加。模板组包
 *  机制不变——提及只是文本里的可见指针。 */
export function completeSlashMention(text: string, name: string): string {
  const s = String(text ?? '')
  const m = /\/[^\s@/]*$/u.exec(s)
  if (m && m.index !== undefined) return s.slice(0, m.index) + `/${name} `
  return s.length > 0 && !/\s$/u.test(s) ? `${s} /${name} ` : `${s}/${name} `
}

/** @ 引用内联补全（原 insertAtReference 语义下沉）：尾部活跃 `@令牌` 原位
 *  替换为 `@完整名 `；文件与产品（方案 4）同用此形态。 */
export function completeAtMention(text: string, name: string): string {
  return String(text ?? '').replace(/@[^\s@/]*$/u, '') + `@${name} `
}

/** 按名定位技能（精确优先，其次前缀） */
export function findSkillByName(skills: readonly CreationSkill[], name: string): CreationSkill | null {
  const key = String(name ?? '').trim().toLowerCase()
  if (!key) return null
  return (
    skills.find((s) => s.name.toLowerCase() === key)
    ?? skills.find((s) => s.name.toLowerCase().startsWith(key))
    ?? null
  )
}

/** @主体名列表（顿号连接成「主体：a、b」片段；空=空串） */
export function subjectsBlock(subjects: readonly CreationSubject[]): string {
  const lines: string[] = []
  const plain: string[] = []
  for (const s of subjects) {
    const name = String(s.name ?? '').trim()
    if (!name) continue
    const p = s.product
    const hasDetail = !!(p && (p.model || p.sellingPoints?.length || p.features?.length || p.sixViews?.length))
    if (!hasDetail) { plain.push(name); continue }
    // 产品档案主体（2026-10-16 用户裁决）：型号+卖点+参数+六视图清单（LLM 文本接口——六视图以 URL 列表作内容参考）
    lines.push(`主体：${p?.model ? `${name}（型号 ${p.model}）` : name}`)
    if (p?.sellingPoints?.length) lines.push(`卖点：${p.sellingPoints.join('；')}`)
    if (p?.features?.length) lines.push(`参数：${p.features.join('；')}`)
    if (p?.sixViews?.length) lines.push(`六视图参考：${p.sixViews.map((v) => `${v.view} ${v.url}`).join('、')}`)
  }
  if (plain.length) lines.unshift(`主体：${plain.join('、')}`)
  return lines.length ? `\n${lines.join('\n')}` : ''
}

/** 组合最终提示词（{{输入}}/{{主体}} 替换；skill 缺省=裸输入+主体块） */
export function composeCreationPrompt(p: {
  skill?: CreationSkill | null
  input: string
  subjects?: readonly CreationSubject[]
}): string {
  const input = String(p.input ?? '').trim()
  const subjectTail = subjectsBlock(p.subjects ?? [])
  if (!p.skill) return `${input}${subjectTail}`.trim()
  const template = String(p.skill.template ?? '')
  const body = template.includes('{{输入}}')
    ? template.replaceAll('{{输入}}', input).replaceAll('{{主体}}', subjectTail)
    : `${template.trim()}${template.trim() ? '\n' : ''}${input}${subjectTail}`
  return body.trim()
}

// ── 服务端对接（P1/P2 已实施；契约=需求文档 §5 + 客户端既有先例）──────────

/** LLM 系统提示（工程细节：与运营文案/直播切片「中文可直用创作内容」同口径） */
export const CREATION_LLM_SYSTEM_PROMPT =
  '你是短视频创作助手。按用户给出的技能指令创作，输出中文、可直接使用的创作内容正文，不要复述指令、不要加解释性前言或结尾。'

/** LLM messages 组包（window.tintin.llmChat 契约；model 缺省=服务端默认） */
export function buildLlmMessages(prompt: string, system?: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: system ?? CREATION_LLM_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ]
}

/** /llm/chat/completions 响应 → 文本（choices[0].message.content，防御解析） */
export function llmTextFromResponse(res: unknown): string {
  const r = res as { choices?: Array<{ message?: { content?: unknown } }> } | null
  return String(r?.choices?.[0]?.message?.content ?? '').trim()
}

/** voiceover 请求组包（铁律 6：可选字段仅非空携带，不猜 skill_id） */
export function buildVoiceoverRequest(p: {
  skill: CreationSkill
  input: string
  subjects?: readonly CreationSubject[]
  platform?: string
}): { product_desc: string; hint?: string; platform?: string } {
  const input = String(p.input ?? '').trim()
  // 产品档案主体（2026-10-16 用户裁决）：product_desc 带型号+卖点；无档案主体维持裸名字
  const descs: string[] = []
  const plainNames: string[] = []
  for (const s of p.subjects ?? []) {
    const name = String(s.name ?? '').trim()
    if (!name) continue
    const pt = s.product
    if (pt && (pt.model || pt.sellingPoints?.length)) {
      descs.push(`${name}${pt.model ? `（型号 ${pt.model}）` : ''}${pt.sellingPoints?.length ? `：${pt.sellingPoints.join('；')}` : ''}`)
    } else {
      plainNames.push(name)
    }
  }
  const productDesc = [...descs, ...plainNames, input].filter(Boolean).join('，')
  const out: { product_desc: string; hint?: string; platform?: string } = { product_desc: productDesc || input }
  const allNames = [...descs, ...plainNames]
  if (allNames.length > 0) out.hint = `需围绕主体：${allNames.join('、')}`
  const platform = String(p.platform ?? '').trim()
  if (platform) out.platform = platform
  return out
}

// ── 生成偏好（2026-10-16 用户裁决：「自动」可点选——即梦生成偏好面板同款：
//    自动开关 + 图片/视频页签 + 选择比例；P4 媒体生成对接后作为生成参数消费）──
export const CREATION_PREFS_KEY = 'tintin.creationStudio.prefs.v1'

export interface CreationPrefs {
  /** 跟随默认自动偏好（即梦面板右上开关） */
  auto: boolean
  modality: 'image' | 'video'
  ratio: string
}

export const CREATION_RATIOS = ['智能', '1:1', '3:4', '16:9', '4:3', '9:16', '2:3', '3:2', '21:9'] as const

export const CREATION_PREFS_DEFAULT: CreationPrefs = { auto: true, modality: 'image', ratio: '智能' }

/** 原始值 → 合法偏好（容错：缺字段/非法枚举回默认档） */
export function sanitizeCreationPrefs(raw: unknown): CreationPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    auto: typeof o.auto === 'boolean' ? o.auto : CREATION_PREFS_DEFAULT.auto,
    modality: o.modality === 'video' ? 'video' : 'image',
    ratio: (CREATION_RATIOS as readonly string[]).includes(String(o.ratio)) ? String(o.ratio) : CREATION_PREFS_DEFAULT.ratio,
  }
}

/** 读生成偏好（注入 storage 便于测试；缺省=默认档） */
export function loadCreationPrefs(storage?: Pick<Storage, 'getItem'>): CreationPrefs {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return { ...CREATION_PREFS_DEFAULT }
  try {
    const raw = store.getItem(CREATION_PREFS_KEY)
    if (!raw) return { ...CREATION_PREFS_DEFAULT }
    return sanitizeCreationPrefs(JSON.parse(raw))
  } catch (_) {
    return { ...CREATION_PREFS_DEFAULT }
  }
}

/** 写生成偏好（写入失败静默——偏好丢失不阻塞创作） */
export function saveCreationPrefs(prefs: CreationPrefs, storage?: Pick<Storage, 'setItem'>): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return
  try {
    store.setItem(CREATION_PREFS_KEY, JSON.stringify(sanitizeCreationPrefs(prefs)))
  } catch (_) { /* 配额/隐私模式：本次会话内仍可用 */ }
}

/** 偏好芯片文字随状态（2026-10-17 用户裁决）：跟随自动=「自动」，关掉自选=「自定义」。 */
export function autoChipLabel(prefs: CreationPrefs): '自动' | '自定义' {
  return prefs.auto ? '自动' : '自定义'
}

// ── @主体产品档案（2026-10-16 用户裁决：选中即拉详情）────────────────────
/** markdown 多行文本 → 行数组（去空行；服务端存的是展示文本，列表标记原样保留） */
export function markdownLines(raw: unknown): string[] {
  return String(raw ?? '').split(/\r?\n/u).map((l) => l.trim()).filter(Boolean)
}

/** 产品库条目（GET items/{id} 详情）→ 主体产品档案（六视图 URL 缺省按 material_id 回退拼装） */
export function subjectProductFromItem(item: Record<string, unknown>): CreationSubjectProduct {
  const sixRaw = (item.six_views && typeof item.six_views === 'object' ? item.six_views : {}) as Record<string, unknown>
  const sixViews = Object.entries(sixRaw)
    .map(([view, e]) => ({ view, e: (e && typeof e === 'object' ? e : {}) as Record<string, unknown> }))
    .filter((x) => String(x.e.material_id ?? ''))
    .map((x) => ({
      view: x.view,
      url: String(x.e.url || `/material/serve?material_id=${x.e.material_id}`),
    }))
  const out: CreationSubjectProduct = {
    id: String(item.id ?? ''),
    brand: String(item.brand ?? '') || undefined,
    model: String(item.model ?? '') || undefined,
  }
  const sp = markdownLines(item.selling_points)
  if (sp.length) out.sellingPoints = sp
  const ft = markdownLines(item.features)
  if (ft.length) out.features = ft
  if (sixViews.length) out.sixViews = sixViews
  return out
}
