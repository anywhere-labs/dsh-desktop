// test/tintin-skill-manager-logic.test.ts — 技能管理纯函数回归（2026-10-16
// 用户裁决：侧栏「技能管理」页——列服务端技能库，逐技能安装/删除；安装后
// 进入创作模式技能表，/技能名 调用）。
//
// 契约锚点：
// - GET /skills 实测响应形如 { ok:true, skills:[{id,name,description,
//   instruction,executor,version,...}] }——解析须容错（裸数组/缺字段丢弃）。
// - 安装=转 CreationSkill 追加创作技能表（同 id 幂等=更新，其余原样保留，
//   内置芯片不丢）；删除=只移除 skill-srv-* 派生 id，用户自建/内置不动。
// - 创作技能表为空时 loadSkills 回退内置芯片（sanitizeSkills 契约）——删除
//   最后一个安装项后回内置是既定行为。
import { describe, expect, it } from 'vitest'
import {
  SERVER_SKILL_ID_PREFIX,
  installServerSkill,
  isServerSkillInstalled,
  parseSkillsResponse,
  removeServerSkill,
  serverSkillId,
  serverSkillToCreationSkill,
} from '../src/composables/skillManagerLogic'
import { BUILTIN_CREATION_SKILLS, loadSkills, saveSkills, sanitizeSkills } from '../src/composables/creationStudioLogic'

const ENTRY = {
  id: 'tintin-video-gen',
  name: 'TinTin 视频生成',
  description: '分镜/关键帧/视频成片/视频换物完整生成管线',
  instruction: '视频生成统一入口：POST /scheduledtasks。{{无关}}',
  executor: 'client_tool',
  version: '1.1.0',
  machine_id: 'x',
  created_at: 1792137613.1,
}

describe('parseSkillsResponse（GET /skills 容错解析）', () => {
  it('{ok,skills} 包装与裸数组皆可；坏条目（缺 id/name）丢弃', () => {
    const wrapped = parseSkillsResponse({ ok: true, skills: [ENTRY, { id: '', name: '坏' }, { name: '缺id' }, 42] })
    expect(wrapped).toHaveLength(1)
    expect(wrapped[0]).toMatchObject({ id: 'tintin-video-gen', name: 'TinTin 视频生成', executor: 'client_tool', version: '1.1.0' })
    expect(parseSkillsResponse([ENTRY])).toHaveLength(1)
  })

  it('null/对象缺 skills/字符串 一律空表', () => {
    expect(parseSkillsResponse(null)).toEqual([])
    expect(parseSkillsResponse({ ok: false })).toEqual([])
    expect(parseSkillsResponse('nope')).toEqual([])
  })
})

describe('serverSkillToCreationSkill（安装转换）', () => {
  it('id 派生稳定；模板含说明原文与输入/主体槽', () => {
    const s = serverSkillToCreationSkill(ENTRY)
    expect(s.id).toBe('skill-srv-tintin-video-gen')
    expect(s.name).toBe('TinTin 视频生成')
    expect(s.emoji).toBe('🧩')
    expect(s.backend).toBe('llm')
    expect(s.template).toContain('TinTin 服务端技能库 v1.1.0')
    expect(s.template).toContain(ENTRY.instruction)
    expect(s.template).toContain('{{输入}}')
    expect(s.template).toContain('{{主体}}')
  })

  it('instruction 缺失回退 description；两者皆空给裸模板', () => {
    expect(serverSkillToCreationSkill({ ...ENTRY, instruction: '' }).template).toContain(ENTRY.description)
    const bare = serverSkillToCreationSkill({ ...ENTRY, instruction: '', description: '' })
    expect(bare.template).toContain('请以「TinTin 视频生成」技能处理')
  })
})

describe('安装/删除（创作技能表操作）', () => {
  it('安装=插到最前（芯片行只展示前 7，装完即刻可见）；重装同 id=更新不重复；其余技能与内置芯片保留', () => {
    const base = [...BUILTIN_CREATION_SKILLS]
    const once = installServerSkill(ENTRY, base)
    expect(once[0]?.id).toBe(serverSkillId(ENTRY.id))
    expect(once.filter((s) => s.id === serverSkillId(ENTRY.id))).toHaveLength(1)
    const edited = { ...ENTRY, instruction: '新版说明' }
    const twice = installServerSkill(edited, once)
    expect(twice[0]?.id).toBe(serverSkillId(ENTRY.id))
    expect(twice.filter((s) => s.id === serverSkillId(ENTRY.id))).toHaveLength(1)
    expect(twice.find((s) => s.id === serverSkillId(ENTRY.id))?.template).toContain('新版说明')
    expect(twice.filter((s) => s.builtin)).toHaveLength(BUILTIN_CREATION_SKILLS.length)
  })

  it('删除=只移除该派生 id；用户自建技能不动', () => {
    const custom = { id: 'sk-mine', name: '自建', emoji: '✏️', template: 'x' }
    const withAll = [...installServerSkill(ENTRY, [...BUILTIN_CREATION_SKILLS, custom])]
    const after = removeServerSkill(ENTRY.id, withAll)
    expect(after.some((s) => s.id === serverSkillId(ENTRY.id))).toBe(false)
    expect(after.some((s) => s.id === 'sk-mine')).toBe(true)
    expect(after.filter((s) => s.builtin)).toHaveLength(BUILTIN_CREATION_SKILLS.length)
  })

  it('已装判定按派生 id', () => {
    const installed = installServerSkill(ENTRY, [...BUILTIN_CREATION_SKILLS])
    expect(isServerSkillInstalled(ENTRY.id, installed)).toBe(true)
    expect(isServerSkillInstalled('other', installed)).toBe(false)
  })

  it('端到端（localStorage 注入）：空存储先回内置再安装，删除最后一项回内置', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    // 空存储：loadSkills 回内置；安装后持久化含内置+安装项
    const installed = installServerSkill(ENTRY, loadSkills(storage))
    saveSkills(installed, storage)
    expect(sanitizeSkills(JSON.parse(store.get('tintin.creationStudio.skills.v1')!)).some((s) => s.id === serverSkillId(ENTRY.id))).toBe(true)
    // 删除安装项：写回后按 sanitize 契约回内置芯片
    saveSkills(removeServerSkill(ENTRY.id, loadSkills(storage)), storage)
    expect(loadSkills(storage).some((s) => s.id.startsWith(SERVER_SKILL_ID_PREFIX))).toBe(false)
    expect(loadSkills(storage)).toHaveLength(BUILTIN_CREATION_SKILLS.length)
  })
})
