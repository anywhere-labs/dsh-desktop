// ═══════════════════════════════════════════════════════════════
// skillManagerLogic — 技能管理·纯函数层（2026-10-16 用户裁决：侧栏新增
// 「技能管理」页，列服务端技能库，逐技能安装/删除；安装后进入创作模式
// 技能表，可用 / 调用）
//
// 服务端契约（2026-10-16 实测 GET /skills）：
//   { ok: true, skills: [{ id, name, description, instruction, executor,
//       tags, machine_id, version, registered_by, created_at, ... }] }
// 安装语义=把服务端条目转成创作模式技能（CreationSkill）追加进
// tintin.creationStudio.skills.v1（同 id 幂等=更新）；删除=按服务端 id
// 从创作技能表移除。不做服务端 DELETE（注册表共享，客户端只读服务端）。
// ═══════════════════════════════════════════════════════════════
import {
  type CreationSkill,
  sanitizeSkills,
} from './creationStudioLogic'

/** 服务端技能注册表条目（GET /skills 实测字段；extras 容错忽略） */
export interface ServerSkill {
  id: string
  name: string
  description: string
  /** 技能指令正文（安装后成为创作模板主体） */
  instruction: string
  executor: string
  version: string
}

/** 创作技能 id 前缀——安装来源标记（卸载/判已装按它定位） */
export const SERVER_SKILL_ID_PREFIX = 'skill-srv-'

/** 由服务端技能 id 派生创作技能 id（稳定：重装=更新不重复） */
export function serverSkillId(serverId: string): string {
  return `${SERVER_SKILL_ID_PREFIX}${String(serverId ?? '').trim()}`
}

/** GET /skills 响应 → 合法技能列表（容错：{ok,skills} 裸数组皆可；坏条目丢弃） */
export function parseSkillsResponse(res: unknown): ServerSkill[] {
  const list = Array.isArray(res)
    ? res
    : Array.isArray((res as { skills?: unknown } | null)?.skills)
      ? ((res as { skills: unknown[] }).skills)
      : []
  const out: ServerSkill[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const it = item as Record<string, unknown>
    const id = String(it.id ?? '').trim()
    const name = String(it.name ?? '').trim()
    if (!id || !name) continue
    out.push({
      id,
      name,
      description: String(it.description ?? '').trim(),
      instruction: String(it.instruction ?? '').trim(),
      executor: String(it.executor ?? '').trim(),
      version: String(it.version ?? '').trim(),
    })
  }
  return out
}

/** 服务端技能 → 创作模式技能（模板组包同 catalogToSkill 口径：说明原文 + 输入/主体槽）。
 *  fullInstruction=落盘 SKILL.md 正文（2026-10-16 用户裁决「调用时真实调用」）：
 *  有正文=完整指令模板（LLM 按技能包真说明书执行）；缺省回退注册表简介模板。 */
export function serverSkillToCreationSkill(skill: ServerSkill, fullInstruction?: string): CreationSkill {
  const version = skill.version ? ` v${skill.version}` : ''
  const full = String(fullInstruction ?? '').trim()
  const template = full
    ? `你是「${skill.name}」技能（TinTin 服务端技能库${version}）。下面是该技能的完整说明书（SKILL.md），严格按说明书执行：\n\n${full}\n\n请对下面的创作需求执行该技能：\n{{输入}}{{主体}}`
    : (() => {
        const body = skill.instruction || skill.description
        return body
          ? `你是「${skill.name}」技能（TinTin 服务端技能库${version}）。技能说明：\n${body}\n\n请对下面的创作需求执行该技能：\n{{输入}}{{主体}}`
          : `请以「${skill.name}」技能处理下面的创作需求：\n{{输入}}{{主体}}`
      })()
  return {
    id: serverSkillId(skill.id),
    name: skill.name,
    emoji: '🧩',
    template,
    backend: 'llm',
  }
}

/** 已安装判定（按派生 id 在创作技能表中存在） */
export function isServerSkillInstalled(serverId: string, skills: readonly CreationSkill[]): boolean {
  const id = serverSkillId(serverId)
  return skills.some((s) => s.id === id)
}

/** 安装：同 id 幂等（重装=更新模板），插到最前——创作模式芯片行只展示前 7 个，
 *  追加会被内置芯片压住（2026-10-16 实测），装完必须即刻可见可调用。
 *  fullInstruction=安装时宿主带回的 SKILL.md 正文（调用时真实调用裁决） */
export function installServerSkill(skill: ServerSkill, skills: readonly CreationSkill[], fullInstruction?: string): CreationSkill[] {
  const next = serverSkillToCreationSkill(skill, fullInstruction)
  const id = next.id
  const rest = skills.filter((s) => s.id !== id)
  return [next, ...rest]
}

/** 删除：只移除该服务端 id 派生的技能（用户自建/内置芯片不动） */
export function removeServerSkill(serverId: string, skills: readonly CreationSkill[]): CreationSkill[] {
  const id = serverSkillId(serverId)
  return skills.filter((s) => s.id !== id)
}

/** 当前安装列表（从创作技能表过滤来源前缀；经 sanitize 容错回读） */
export function installedServerSkills(skills: readonly CreationSkill[]): CreationSkill[] {
  return sanitizeSkills(skills).filter((s) => s.id.startsWith(SERVER_SKILL_ID_PREFIX))
}

/** 卡片搜索（2026-10-18 界面改版）：任一字段含关键词即命中（大小写不敏感；
 *  空白查询=全部命中） */
export function skillMatchesQuery(query: string, fields: readonly string[]): boolean {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q))
}
