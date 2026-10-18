// ═══════════════════════════════════════════════════════════════
// opsCopywritingLogic — 产品文案创作·纯函数层（无 vue / IPC 依赖）
// 对照原客户端 gui/product_script_page.py + utils/extreme_words.py：
//   · 生成设置映射（L443-464）：平台/语气/结构 → 提示词文本
//   · 产品资料段（L412-425）：basic 行 + 【性能参数】【核心卖点】
//   · prompt 构造（L428-486）：system + user_parts（资料/风格/要求）
//   · 极限词检测（extreme_words.py 全表移植 + check_extreme_words 口径）
// 风格化条目（知识库）暂缺（2026-08-31 知识库批次暂停），styleText 参数
//   保留可选位；本版不提供风格化选择 UI。
// ═══════════════════════════════════════════════════════════════

/* ── 生成设置选项（对齐原 combo 可选项） ─────────────────────── */

export const PLATFORM_OPTIONS = ['通用', '抖音', '快手', '小红书'] as const
export const TONE_OPTIONS = ['热情种草', '专业测评', '幽默搞笑', '悬念钩子', '温情故事', '酷飒高级'] as const
export const STRUCTURE_OPTIONS = ['黄金3秒开场', '痛点切入', '故事化', '清单式', '对比式', '倒叙悬念'] as const
export const TAG_OPTIONS = ['不生成', '5 个', '10 个'] as const

export type CopyPlatform = typeof PLATFORM_OPTIONS[number]
export type CopyTone = typeof TONE_OPTIONS[number]
export type CopyStructure = typeof STRUCTURE_OPTIONS[number]

/** 平台 → 平台要求文本（对齐原 L443-448） */
export const PLATFORM_TEXT: Record<string, string> = {
  '通用': '通用（不指定平台）',
  '抖音': '抖音：口语化、节奏快、黄金3秒抓人、适合口播，可带轻量互动引导',
  '快手': '快手：接地气、老铁口吻、真实感强、简单直接',
  '小红书': '小红书：种草笔记体、真诚分享、分段清晰、可带适量 emoji',
}

/** 语气 → 语气要求文本（对齐原 L449-456） */
export const TONE_TEXT: Record<string, string> = {
  '热情种草': '热情种草：兴奋、真诚、强烈推荐感',
  '专业测评': '专业测评：客观、数据化、权威感',
  '幽默搞笑': '幽默搞笑：轻松、有梗、口语化',
  '悬念钩子': '悬念钩子：先抛疑问/反差，再揭晓卖点',
  '温情故事': '温情故事：从生活场景切入，强调情感共鸣',
  '酷飒高级': '酷飒高级：简洁、利落、高级感',
}

/** 结构 → 结构要求文本（对齐原 L457-464） */
export const STRUCTURE_TEXT: Record<string, string> = {
  '黄金3秒开场': '黄金3秒开场：开头抓人，中间卖点支撑，结尾引导下单/互动',
  '痛点切入': '痛点切入：先讲用户痛点，再给产品方案，最后行动引导',
  '故事化': '故事化：用场景/故事带入，自然引出产品卖点',
  '清单式': '清单式：分点列出卖点/优势，清晰易读',
  '对比式': '对比式：与同类产品或旧方案对比，突出优势',
  '倒叙悬念': '倒叙悬念：先给结果/反差，再回溯原因',
}

/** 话题标签选项 → 数量（对齐原 L465） */
export function tagCountOf(label: string): number {
  return { '不生成': 0, '5 个': 5, '10 个': 10 }[label] ?? 0
}

/* ── 产品资料段（对齐原 _generate_copywriting L412-425） ─────── */

export interface ProductBasicRecord {
  category?: unknown
  brand?: unknown
  model?: unknown
  goods_no?: unknown
  spec_name?: unknown
}

const BASIC_LABELS: Array<[keyof ProductBasicRecord, string]> = [
  ['category', '品类'],
  ['brand', '品牌'],
  ['model', '型号'],
  ['goods_no', '商家编码'],
  ['spec_name', '规格'],
]

/** 产品基础信息行（空值跳过，两空格连接） */
export function buildProductBasicLine(record: ProductBasicRecord | null | undefined): string {
  const parts: string[] = []
  for (const [k, lbl] of BASIC_LABELS) {
    const v = String(record?.[k] ?? '').trim()
    if (v) parts.push(`${lbl}：${v}`)
  }
  return parts.join('  ')
}

/** 产品资料段：基础行 + 【性能参数】【核心卖点】（未录入占位对齐原版） */
export function buildProductSection(
  record: ProductBasicRecord | null | undefined,
  features: string,
  sellingPoints: string,
): string {
  const basic = buildProductBasicLine(record)
  return [
    basic,
    '',
    `【性能参数】\n${features ? features : '（未录入）'}`,
    '',
    `【核心卖点】\n${sellingPoints ? sellingPoints : '（未录入）'}`,
  ].join('\n').replace(/^\n+/, '')
}

/* ── prompt 构造（对齐原 L428-486） ──────────────────────────── */

export interface CopywritingPromptInput {
  productText: string
  platform: string
  tone: string
  structure: string
  tagCount: number
  avoidBanned: boolean
  extraPrompt?: string
  /** 风格指引（知识库风格化条目正文；本版知识库未实装，预留） */
  styleText?: string
}

export interface CopywritingPrompt {
  systemPrompt: string
  userPrompt: string
}

export function buildCopywritingPrompt(input: CopywritingPromptInput): CopywritingPrompt {
  const styleText = (input.styleText || '').trim()

  let systemPrompt =
    '你是资深的爆款短视频带货文案主创，擅长把产品卖点写成口语化、吸睛、适合念白的短视频文案。'
  if (styleText) {
    systemPrompt += (
      '\n\n同时，你须严格按照「风格指引」决定文案的**写作风格（HOW）**，'
      + '但产品名称、核心卖点与数据（WHAT）不可改变。'
    )
  }

  const userParts: string[] = [`【产品资料】\n${input.productText}`]
  if (styleText) userParts.push(`【风格指引】\n${styleText.slice(0, 1000)}`)

  const reqs = [
    '请根据以上信息，创作一篇 200-400 字的带货短视频文案。要求：',
    '① 开头黄金 3 秒抓人；中间用卖点支撑；结尾引导下单/互动。',
    '② 极口语化，适合直接口播。',
  ]
  if (styleText) reqs.push('③ 严格遵守「风格指引」中定义的钩子/口吻/节奏/句式/收尾风格。')
  reqs.push(`平台要求：${PLATFORM_TEXT[input.platform] || PLATFORM_TEXT['通用']}。`)
  reqs.push(`语气要求：${TONE_TEXT[input.tone] || TONE_TEXT['热情种草']}。`)
  reqs.push(`结构要求：${STRUCTURE_TEXT[input.structure] || STRUCTURE_TEXT['黄金3秒开场']}。`)
  if (input.tagCount > 0) {
    reqs.push(`文末另起一行生成 ${input.tagCount} 个话题标签（# 开头，贴合所选平台与产品）。`)
  }
  if (input.avoidBanned) {
    reqs.push('违禁词要求：全程规避平台广告极限词/违禁词（绝对化用语、虚假宣传、夸大功效、无法验证的承诺等），必要时用中性表达替代。')
  }
  reqs.push('只输出文案正文，不要任何前言或总结说明。')
  if (input.extraPrompt && input.extraPrompt.trim()) {
    reqs.push(`\n【附加要求】\n${input.extraPrompt.trim()}`)
  }
  userParts.push(reqs.join('\n'))

  return { systemPrompt, userPrompt: userParts.join('\n\n') }
}

/* ── 极限词检测（extreme_words.py 全表移植，口径一致） ───────── */

export const EXTREME_WORDS: readonly string[] = [
  // 1. 绝对性词汇
  '第一', '最', '最高', '最低', '最好', '最大', '最小', '最强', '最差', '最先', '最后', '最新',
  '顶级', '顶尖', '极致', '极品', '终极', '巅峰', '至尊', '绝对', '极致', '冠', '首', '之首',
  '最前沿', '最先进', '最符合', '最热', '最划算', '最高级', '最顶级', '终极', '空前绝后',
  // 2. 国家级/行业权威性词汇
  '国家级', '国级', '世界级', '宇宙级', '全球级', '特级', '金牌', '名牌', '优秀', '权威', '免检',
  // 3. 独家/排他性词汇
  '唯一', '独家', '独一无二', '首发', '全网首发', '全网第一', '独创', '首创', '仅此一次',
  '仅此一家', '首选', '第一品牌', '独占', '垄断', '绝对性', '绝无仅有',
  // 4. 虚假/欺诈性保障词汇
  '100%', '百分之百', '保证', '保证通过', '包过', '神效', '特效', '神级', '立刻见效',
  '万能', '绝对安全', '无毒', '无副作用', '纯天然', '百分之百天然', '纯绿色', '绿色天然',
  // 5. 电商促销敏感词汇
  '全网最低', '全网最低价', '低价', '破产价', '秒杀', '点击领奖', '无效退款', '省钱', '赚大钱',
  '发财', '致富', '暴富',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface ExtremeMatch {
  word: string
  start: number
  end: number
}

/** 文本极限词检测（不区分大小写；按出现位置排序，对齐 check_extreme_words） */
export function checkExtremeWords(text: string): ExtremeMatch[] {
  const results: ExtremeMatch[] = []
  if (!text) return results
  for (const word of EXTREME_WORDS) {
    const re = new RegExp(escapeRegExp(word), 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      results.push({ word, start: m.index, end: m.index + m[0].length })
      if (m[0].length === 0) break // 防御：零长匹配死循环
    }
  }
  return results.sort((a, b) => a.start - b.start)
}

/** 命中词去重汇总（对齐原 word_list_str：sorted unique join '、'） */
export function summarizeExtremeWords(matches: ExtremeMatch[]): string {
  return [...new Set(matches.map((m) => m.word))].sort().join('、')
}

/* ── 产品下拉标签（对齐原 _populate_products L330-334） ──────── */

/** 「[品类] 品牌 - 型号」或编码兜底 */
export function productComboLabel(it: ProductBasicRecord & { goods_no?: unknown; id?: unknown }): string {
  const brand = String(it.brand ?? '').trim()
  const model = String(it.model ?? '').trim()
  let label = `${brand} - ${model}`.replace(/^[\s-]+|[\s-]+$/g, '')
  if (!label) label = String(it.goods_no ?? '').trim()
  const cat = String(it.category ?? '').trim()
  if (cat) label = `[${cat}] ${label}`
  return label
}
