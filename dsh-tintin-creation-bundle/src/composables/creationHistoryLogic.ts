// ═══════════════════════════════════════════════════════════════
// creationHistoryLogic — 创作会话历史纯函数层（2026-10-18）
//
// 用户裁决（2026-10-18）：创作结果本地保存——发送/结果成对入历史，
// composer 下出历史列表（回看/重开/清空），重载自动恢复最近一轮到结果
// 浮层。此前结果只进剪贴板+一次性浮层（App.vue send），下一轮覆盖、
// 重载全丢，用户报障「历史消息丢失」。
//
// 存储：localStorage，同 skills.v1 口径（坏 JSON/非法条目逐条丢弃、注入
// storage 便于测试、写失败静默不阻塞创作）。
//
// 存储缝（服务端升级预留，2026-10-18 裁决）：本模块是历史读写的唯一入口，
// 当前为本地实现；服务端 /api/creation/sessions 端点就绪后在此加 server
// 实现、失败自动退回本地——调用方（App.vue）不改。
// ═══════════════════════════════════════════════════════════════

/** 结果来源（copy 后端的结果=组包后的提示词本身） */
export type CreationHistorySource = 'llm' | 'voiceover' | 'copy'

/** 一轮创作 = 发送上下文 + 结果文本 */
export interface CreationHistoryEntry {
  id: string
  ts: number
  source: CreationHistorySource
  /** 用户原始输入 */
  input: string
  resultText: string
  skillName?: string
  typeLabel?: string
  /** 发送时的主体（@产品）名 */
  subjects?: string[]
  /** 发送时的上传引用名 */
  references?: string[]
  /** 口播多稿选中时的写法名 */
  formula?: string
}

export const CREATION_HISTORY_KEY = 'tintin.creationStudio.history.v1'
/** 历史条数上限（新进旧出；结果文本不截断——创作结果是核心资产） */
export const CREATION_HISTORY_CAP = 50

export function newHistoryId(): string {
  return `his-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 记录入参 → 完整条目（id/ts 在此补齐；可选字段空值不出键——调用方不必做
 *  exactOptional 体操；subjects/references 空数组视同未提供） */
export function buildHistoryEntry(p: {
  source: CreationHistorySource
  input: string
  resultText: string
  skillName?: string
  typeLabel?: string
  subjects?: string[]
  references?: string[]
  formula?: string
}): CreationHistoryEntry {
  return {
    id: newHistoryId(),
    ts: Date.now(),
    source: p.source,
    input: p.input.trim(),
    resultText: p.resultText,
    ...(p.skillName ? { skillName: p.skillName } : {}),
    ...(p.typeLabel ? { typeLabel: p.typeLabel } : {}),
    ...(p.subjects?.length ? { subjects: p.subjects } : {}),
    ...(p.references?.length ? { references: p.references } : {}),
    ...(p.formula ? { formula: p.formula } : {}),
  }
}

/** 任意值 → 合法历史条目（缺 id/ts 补算；source 非法回 llm；input/resultText
 *  去首尾空白、全空丢弃；可选字段空值不出键——exactOptionalPropertyTypes 口径） */
export function sanitizeHistoryEntry(raw: unknown): CreationHistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const it = raw as Record<string, unknown>
  const input = String(it.input ?? '').trim()
  const resultText = String(it.resultText ?? '').trim()
  if (!input && !resultText) return null
  const ts = Number(it.ts)
  const strList = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const out = v.map((x) => String(x ?? '').trim()).filter(Boolean)
    return out.length > 0 ? out : undefined
  }
  const subjects = strList(it.subjects)
  const references = strList(it.references)
  const skillName = String(it.skillName ?? '').trim()
  const typeLabel = String(it.typeLabel ?? '').trim()
  const formula = String(it.formula ?? '').trim()
  return {
    id: String(it.id ?? '').trim() || newHistoryId(),
    ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    source: it.source === 'voiceover' || it.source === 'copy' ? it.source : 'llm',
    input,
    resultText,
    ...(skillName ? { skillName } : {}),
    ...(typeLabel ? { typeLabel } : {}),
    ...(subjects ? { subjects } : {}),
    ...(references ? { references } : {}),
    ...(formula ? { formula } : {}),
  }
}

/** 读历史（新→旧；缺存储/坏 JSON/非数组=空表） */
export function loadCreationHistory(storage?: Pick<Storage, 'getItem'>): CreationHistoryEntry[] {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return []
  try {
    const raw = store.getItem(CREATION_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => sanitizeHistoryEntry(item))
      .filter((e): e is CreationHistoryEntry => e !== null)
      .slice(0, CREATION_HISTORY_CAP)
  } catch (_) {
    return []
  }
}

/** 写历史（写入失败静默——配额/隐私模式下本次会话内仍可用） */
export function saveCreationHistory(entries: readonly CreationHistoryEntry[], storage?: Pick<Storage, 'setItem'>): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  if (!store) return
  try {
    store.setItem(CREATION_HISTORY_KEY, JSON.stringify(entries.slice(0, CREATION_HISTORY_CAP)))
  } catch (_) { /* 同上 */ }
}

/** 新一轮入史：新条目置顶，超限从尾部丢弃（返回新数组不改入参） */
export function appendCreationHistory(
  entries: readonly CreationHistoryEntry[],
  entry: CreationHistoryEntry,
  cap = CREATION_HISTORY_CAP,
): CreationHistoryEntry[] {
  return [entry, ...entries].slice(0, cap)
}

/** 清空（本地实现=清存储；服务端实现将来在此换成 DELETE 端点） */
export function clearCreationHistory(storage?: Pick<Storage, 'removeItem'>): void {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  try { store?.removeItem(CREATION_HISTORY_KEY) } catch (_) { /* 同上 */ }
}

/** 列表时间标签：同年「MM-DD HH:mm」，跨年带年份 */
export function historyTimeLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.getFullYear() === new Date(now).getFullYear() ? hm : `${d.getFullYear()}-${hm}`
}

/** 列表行摘要：有输入显示输入（截 60 字），否则显示结果开头 */
export function historySnippet(entry: Pick<CreationHistoryEntry, 'input' | 'resultText'>, max = 60): string {
  const text = entry.input.trim() || entry.resultText.trim()
  const clean = text.replace(/\s+/gu, ' ')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/** 列表行来源标签：口播带写法名；llm 回落创作类型/技能名 */
export function historySourceLabel(entry: CreationHistoryEntry): string {
  if (entry.formula) return `口播 · ${entry.formula}`
  if (entry.source === 'copy') return '提示词'
  if (entry.source === 'voiceover') return '口播'
  return entry.typeLabel || entry.skillName || 'Agent'
}
