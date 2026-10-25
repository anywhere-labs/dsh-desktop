// ═══════════════════════════════════════════════════════════════
// copywritingMontageAssignLogic.ts — 分镜×素材智能匹配纯逻辑（2026-09-21 用户裁决方案 C：
// 「自动分配到分镜脚本」直接升级为智能匹配——本地硬约束预筛 + LLM 候选内语义精选 +
// 循环轮转兜底；原 assignClipsCyclically 全量轮转降级为兜底算法）
// 分层：本文件纯函数零 IPC/DOM（IRON-06/07）；LLM 调用编排在 CopywritingStep2Panel。
// 数据流：buildAssignPool 去重池 → buildAssignCandidateSet 逐镜预筛并集（景别桶+
// 时长窗+评分序）→ buildAssignMatchPrompt 单脚本一次 llm:chat → parseAssignMatchResponse
// 校验解析 → mergeTabAssignment 命中写回+缺口循环兜底 → planShotGroup 装填写 tab.clipGroups。
// ═══════════════════════════════════════════════════════════════
import { SHOT_TYPE_LABELS } from './copywritingMontageStep1SplitLogic'
import type { StoryboardShot } from './opsStoryboardLogic'
import type { AssignPoolItem } from './copywritingMontageStep2ConcatLogic'

/** 单脚本进 prompt 的候选素材总量帽（控制 token；超出按逐镜轮转保序截断） */
export const ASSIGN_MATCH_CANDIDATE_CAP = 40
/** 逐镜预筛每镜候选上限（轮转并集前各镜独立排名截断） */
export const ASSIGN_MATCH_PER_SHOT_TOPK = 8
/** 时长窗（相对镜标注时长，2026-09-22 用户裁决方案C收紧为紧窗）：素材时长落在
 *  [0.8×, 1.5×] 内视为接近（从源头减少超长/欠装）；镜时长未知（0）视为全通过 */
export const ASSIGN_DUR_WIN_MIN = 0.8
export const ASSIGN_DUR_WIN_MAX = 1.5
/** 封镜阈值（2026-09-22 用户裁决）：装填累计 ≥ 镜标×0.9 即封镜（略欠优于超） */
export const ASSIGN_SEAL_RATIO = 0.9

/** 景别是否同桶：素材侧存服务端键（closeup/medium/…），分镜侧多为中文
 *  （特写/中景/…）——键相等或键的中文名相等均算命中；任一方空=不命中
 *  （未标注镜头不设景别偏好，走时长/评分排序） */
export function shotTypeMatches(sceneType: string | undefined, shotType: string | undefined): boolean {
  const s = String(sceneType || '').trim()
  const t = String(shotType || '').trim()
  if (!s || !t) return false
  if (s === t) return true
  return (SHOT_TYPE_LABELS[s] || '') === t
}

/** 逐镜预筛排名：景别同桶 > 时长窗内 > |Δ时长| > 评分降序 > idx 升序（稳定可测）。
 *  截前 topK；池空返回空 */
export function prefilterShotCandidates(
  shot: StoryboardShot,
  pool: ReadonlyArray<AssignPoolItem>,
  topK = ASSIGN_MATCH_PER_SHOT_TOPK,
): AssignPoolItem[] {
  if (!pool.length) return []
  const dur = Number(shot.duration) || 0
  const inWin = (d: number) => (dur > 0 ? d >= dur * ASSIGN_DUR_WIN_MIN && d <= dur * ASSIGN_DUR_WIN_MAX : true)
  const ranked = [...pool].sort((a, b) => {
    const ta = shotTypeMatches(a.scene.shotType, shot.shot_type) ? 0 : 1
    const tb = shotTypeMatches(b.scene.shotType, shot.shot_type) ? 0 : 1
    if (ta !== tb) return ta - tb
    const da = Number(a.scene.duration) || 0
    const db = Number(b.scene.duration) || 0
    const wa = inWin(da) ? 0 : 1
    const wb = inWin(db) ? 0 : 1
    if (wa !== wb) return wa - wb
    if (Math.abs(da - dur) !== Math.abs(db - dur)) return Math.abs(da - dur) - Math.abs(db - dur)
    const sa = Number(a.scene.score) || 0
    const sb = Number(b.scene.score) || 0
    if (sa !== sb) return sb - sa
    return a.scene.idx - b.scene.idx
  })
  return ranked.slice(0, Math.max(1, topK))
}

/** 单脚本候选集：逐镜预筛结果按名次轮转并集去重（保证每镜的前几名都进候选），
 *  超 cap 截断。返回保持轮转插入序（prompt 内按此序编 C 号） */
export function buildAssignCandidateSet(
  shots: StoryboardShot[],
  pool: AssignPoolItem[],
  cap = ASSIGN_MATCH_CANDIDATE_CAP,
): AssignPoolItem[] {
  const lists = (shots || []).map((sh) => prefilterShotCandidates(sh, pool))
  const maxLen = lists.reduce((m, l) => Math.max(m, l.length), 0)
  const seen = new Set<string>()
  const out: AssignPoolItem[] = []
  for (let rank = 0; rank < maxLen && out.length < cap; rank++) {
    for (const l of lists) {
      if (out.length >= cap) break
      const item = l[rank]
      if (item && !seen.has(item.key)) {
        seen.add(item.key)
        out.push(item)
      }
    }
  }
  return out
}

/** 组智能匹配 prompt（单脚本一次 llm:chat）：候选按本地序编 C 号（LLM 只见 C 号，
 *  客户端本地映射回 scene.idx，防模型编造越界 idx） */
export function buildAssignMatchPrompt(
  shots: StoryboardShot[],
  candidates: AssignPoolItem[],
): { systemPrompt: string; userPrompt: string } {
  const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || '无描述'
  const shotLines = (shots || []).map((s, i) => {
    const t = String(s.shot_type || '').trim() || '未标注'
    return `${i + 1}|${t}|${(Number(s.duration) || 0).toFixed(1)}s|${clean(s.visual)}`
  })
  const candLines = (candidates || []).map((c, i) => {
    const st = c.scene.shotType ? (SHOT_TYPE_LABELS[c.scene.shotType] || c.scene.shotType) : '未标注'
    return `C${i + 1}|${st}|${(Number(c.scene.duration) || 0).toFixed(1)}s|${Number(c.scene.score) || 0}分|${clean(c.scene.description || c.scene.analysis)}`
  })
  const systemPrompt = [
    '你是短视频分镜配材助手：为分镜脚本的每个镜头，从候选素材中选出画面内容最合适的一段。',
    '规则：',
    '1. 只能使用候选表中出现的素材号（C1、C2…）；',
    '2. 每个镜号恰好输出一个素材号；素材数少于镜头数时允许复用，但尽量分散、避免相邻镜头重复；',
    '3. 匹配依据优先级：画面内容语义一致 > 景别一致 > 时长接近；',
    '4. 只输出 JSON 对象（格式 {"matches":{"1":"C1","2":"C3"}}），不要解释、不要代码块标记。',
  ].join('\n')
  const userPrompt = [
    '## 分镜镜头（镜号|景别|时长秒|画面描述）',
    ...shotLines,
    '',
    '## 候选素材（素材号|景别|时长秒|评分|画面描述）',
    ...candLines,
    '',
    '## 输出格式',
    '{"matches":{"1":"C1","2":"C3"}}',
  ].join('\n')
  return { systemPrompt, userPrompt }
}

/** 解析 LLM 匹配响应：剥代码围栏 → 截取最外层 JSON → 读 matches →
 *  镜号/候选号（"C12"/12/"12" 均收）范围校验。不可解析/全非法返回 null；
 *  局部非法条目丢弃（对应镜走循环兜底） */
export function parseAssignMatchResponse(
  content: string,
  shotCount: number,
  candidateCount: number,
): Map<number, number> | null {
  if (shotCount <= 0 || candidateCount <= 0) return null
  const text = String(content || '').replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const m = (obj as Record<string, unknown> | null)?.matches
  if (!m || typeof m !== 'object') return null
  const out = new Map<number, number>()
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    const shotNo = Number(k)
    const candNo = Number(String(v ?? '').trim().replace(/^[Cc]/, ''))
    if (!Number.isInteger(shotNo) || shotNo < 1 || shotNo > shotCount) continue
    if (!Number.isInteger(candNo) || candNo < 1 || candNo > candidateCount) continue
    out.set(shotNo, candNo)
  }
  return out.size ? out : null
}

/** 单脚本结果：idxs=每镜绑定的 scene.idx（-1=无池可分）；matched=LLM 命中数；
 *  nextK=循环兜底游标（与原 assignClipsCyclically 同口径：全局镜头序跨脚本连续，
 *  各素材使用次数均衡） */
export interface TabAssignmentResult {
  idxs: number[]
  matched: number
  nextK: number
}

/** LLM 命中写回 + 缺口循环兜底：parsed 命中的镜取候选 scene.idx；未命中/解析失败
 *  的镜按 pool[cyclicK % pool.length] 轮转补齐并推进游标 */
export function mergeTabAssignment(
  shotCount: number,
  parsed: Map<number, number> | null,
  candidates: AssignPoolItem[],
  pool: AssignPoolItem[],
  cyclicK: number,
): TabAssignmentResult {
  const idxs: number[] = []
  let k = cyclicK
  let matched = 0
  for (let s = 1; s <= shotCount; s++) {
    const candNo = parsed?.get(s)
    const cand = candNo != null && candNo >= 1 && candNo <= candidates.length ? candidates[candNo - 1] : undefined
    if (cand) {
      idxs.push(cand.scene.idx)
      matched++
    } else if (pool.length) {
      const cyc = pool[k % pool.length]
      if (cyc) {
        idxs.push(cyc.scene.idx)
        k++
      }
    } else {
      idxs.push(-1)
    }
  }
  return { idxs, matched, nextK: k }
}

// ── 一镜多片·按时长装填（2026-09-22 用户裁决开工：方案C裁决项落地——
//    超长处置=换片优先+裁剪兜底；封镜阈值 0.9；镜内片间硬切）──

/** 单镜装填结果：idxs=按序片段 scene.idx；useDurs=每片使用的时长（< 片段全长
 *  即需本地裁剪，末端裁到镜标）；coveredSec=装填后镜长（ΣuseDurs）；
 *  sealed=是否装到封镜阈值（false=素材耗尽欠装） */
export interface ShotFillPlan {
  idxs: number[]
  useDurs: number[]
  coveredSec: number
  sealed: boolean
}

/** 按镜标时长装填单镜（2026-09-22 用户裁决方案C开工）：主片（LLM 语义选定）置首，
 *  其后按预筛排名继续取片，累计达 镜标×封镜阈值(0.9) 即封镜；末端片段超出镜标时
 *  裁剪到剩余量（超长裁剪兜底）；主片自身超长 → 单片裁到镜标；镜标未知 → 主片全长单片。
 *  组内按片段 idx 去重（不复用同一段）。
 *  2026-09-30 用户裁决：补片按 usage 使用计数升序取用（同数保持预筛排名序）——
 *  跨镜优先未用过的片段，消除「每镜补片都是同一段」的重复；池耗尽仍允许复用（欠装兜底） */
export function planShotGroup(
  shot: StoryboardShot,
  primaryIdx: number,
  pool: AssignPoolItem[],
  opts?: { sealRatio?: number; usage?: ReadonlyMap<number, number> },
): ShotFillPlan {
  const sealRatio = opts?.sealRatio ?? ASSIGN_SEAL_RATIO
  const usage = opts?.usage
  const target = Math.max(0, Number(shot.duration) || 0)
  const primary = pool.find((c) => c.scene.idx === primaryIdx) || null
  if (!primary) return { idxs: [], useDurs: [], coveredSec: 0, sealed: false }
  const primaryFull = Math.max(0, Number(primary.scene.duration) || 0)
  if (target <= 0) {
    return { idxs: [primary.scene.idx], useDurs: [primaryFull], coveredSec: primaryFull, sealed: true }
  }
  const ranked = prefilterShotCandidates(shot, pool).filter((c) => c.scene.idx !== primary.scene.idx)
  // 稳定排序：使用数相同的片段保持预筛排名序（主片语义优先，不在重排名之列）
  const fillers = usage
    ? [...ranked].sort((a, b) => (usage.get(a.scene.idx) ?? 0) - (usage.get(b.scene.idx) ?? 0))
    : ranked
  const seen = new Set<number>([primary.scene.idx])
  const idxs: number[] = []
  const useDurs: number[] = []
  let covered = 0
  let sealed = false
  for (const cand of [primary, ...fillers]) {
    if (seen.has(cand.scene.idx) && idxs.length) continue
    const full = Math.max(0, Number(cand.scene.duration) || 0)
    if (full <= 0) continue
    if (covered >= target * sealRatio - 1e-6) { sealed = true; break }
    let use = full
    if (covered + full > target) use = Math.max(0.05, target - covered) // 末端超长 → 裁到剩余量
    idxs.push(cand.scene.idx)
    // 向下取整到 0.01s（2026-10-21 实机：5.166667 秒片段四舍五入成 5.17，
    // 导出 film.html 的 #t=0,5.17 越过文件长度，Studio 拒绝绘制整条预览）
    useDurs.push(Math.floor(use * 100 + 1e-6) / 100)
    covered += use
    if (covered >= target * sealRatio - 1e-6) sealed = true
  }
  return { idxs, useDurs, coveredSec: Math.round(covered * 100) / 100, sealed }
}

/** 镜标按旁白时长等比放大的系数（2026-09-24 用户裁决口径；clamp 0.2~4）。
 *  旁白缺失（=0）或镜标 Σ=0 时系数 1（维持原值）。 */
export function voiceScaleOf(voiceDurSec: number, shotsSumSec: number): number {
  const vd = Number(voiceDurSec) || 0
  const sum = Number(shotsSumSec) || 0
  return vd > 0 && sum > 0 ? Math.max(0.2, Math.min(4, vd / sum)) : 1
}

/** 2026-09-30 用户裁决 B：生成剪辑方案前的欠装补片——「先智能匹配、后克隆声音」
 *  时序下，匹配按原镜标封箱的绑定组（如 4s 镜绑 1 段 4s），在旁白把镜标等比放大后
 *  全长不足新目标（单片段组最长只能用全长，groupUseDurs 只裁不补）。此处按同镜
 *  预筛排名从池内追加片段：组内去重同 planShotGroup、跨镜复用同匹配口径，追加到
 *  覆盖目标或池耗尽（末端裁剪由方案生成的 groupUseDurs 落地）。
 *  2026-09-30 用户裁决（防重复）：追加按跨镜使用计数升序取用——计数初值=既有各组
 *  成员（已在多镜出现的片段降级），追加中实时累加；消除「每镜补的都是同一段」。
 *  返回 { groups: 追加后的组, appendedTotal, appendedByShot }（无欠装时原样返回）。 */
export function topUpClipGroups(
  shots: ReadonlyArray<Pick<StoryboardShot, 'duration'> & Partial<Pick<StoryboardShot, 'shot_type'>>>,
  groups: ReadonlyArray<ReadonlyArray<number>>,
  pool: ReadonlyArray<AssignPoolItem>,
  voiceDurSec: number,
): { groups: number[][]; appendedTotal: number; appendedByShot: number[] } {
  const scale = voiceScaleOf(voiceDurSec, shots.reduce((a, s) => a + (Number(s?.duration) || 0), 0))
  const byIdx = new Map(pool.map((c) => [c.scene.idx, c]))
  // 跨镜使用计数：初值=既有各组全部成员（出现即计 1，不叠次数——降级已用片段即可）
  const usage = new Map<number, number>()
  for (const g of groups) for (const idx of new Set(g || [])) usage.set(idx, (usage.get(idx) ?? 0) + 1)
  const out: number[][] = []
  const appendedByShot: number[] = []
  let appendedTotal = 0
  groups.forEach((g, i) => {
    const idxs = [...(g || [])]
    const inGroup = new Set<number>()
    let fullSum = 0
    for (const idx of idxs) {
      if (inGroup.has(idx)) continue
      inGroup.add(idx)
      fullSum += Math.max(0, Number(byIdx.get(idx)?.scene.duration) || 0)
    }
    const shot = shots[i]
    const target = (Number(shot?.duration) || 0) * scale
    let appended = 0
    if (target > 0 && fullSum < target - 0.05) {
      // 预筛以放大后目标计（与 planShotGroup 的 shim 同口径），景别/时长窗排名一致；
      // 排名按使用计数升序稳定重排（同数保持预筛序）
      const shim = { ...shot, duration: target } as StoryboardShot
      const ranked = prefilterShotCandidates(shim, pool).filter((c) => !inGroup.has(c.scene.idx))
        .sort((a, b) => (usage.get(a.scene.idx) ?? 0) - (usage.get(b.scene.idx) ?? 0))
      for (const cand of ranked) {
        if (fullSum >= target - 0.05) break
        const full = Math.max(0, Number(cand.scene.duration) || 0)
        if (full <= 0) continue
        idxs.push(cand.scene.idx)
        inGroup.add(cand.scene.idx)
        usage.set(cand.scene.idx, (usage.get(cand.scene.idx) ?? 0) + 1)
        fullSum += full
        appended++
      }
    }
    appendedByShot.push(appended)
    appendedTotal += appended
    out.push(idxs)
  })
  return { groups: out, appendedTotal, appendedByShot }
}

/** 2026-09-30 用户裁决 A：克隆声音后的欠装检测（提示用）——镜标按旁白放大后仍有
 *  绑定组全长不足目标的镜数与总差值（秒）。供克隆完成提示"将自动补片/可重新匹配"。 */
export function underfillAfterVoice(
  shots: ReadonlyArray<Pick<StoryboardShot, 'duration'>>,
  groups: ReadonlyArray<ReadonlyArray<number>>,
  pool: ReadonlyArray<AssignPoolItem>,
  voiceDurSec: number,
): { shotsShort: number; deficitSec: number } {
  const scale = voiceScaleOf(voiceDurSec, shots.reduce((a, s) => a + (Number(s?.duration) || 0), 0))
  const byIdx = new Map(pool.map((c) => [c.scene.idx, c]))
  let shotsShort = 0
  let deficitSec = 0
  groups.forEach((g, i) => {
    const target = (Number(shots[i]?.duration) || 0) * scale
    if (target <= 0) return
    const inGroup = new Set<number>()
    let fullSum = 0
    for (const idx of g || []) {
      if (inGroup.has(idx)) continue
      inGroup.add(idx)
      fullSum += Math.max(0, Number(byIdx.get(idx)?.scene.duration) || 0)
    }
    if (fullSum < target - 0.05) {
      shotsShort++
      deficitSec += target - fullSum
    }
  })
  return { shotsShort, deficitSec: Math.round(deficitSec * 100) / 100 }
}
