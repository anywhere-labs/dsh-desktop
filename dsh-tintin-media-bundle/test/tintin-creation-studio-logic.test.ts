// test/tintin-creation-studio-logic.test.ts — 创作模式纯函数回归（2026-10-16）
// 覆盖：默认技能种子、sanitize 容错（坏 JSON/缺字段/空数组回退）、组合展开
//（{{输入}}/{{主体}}、无占位拼接、自动模式）、过滤/按名定位、/令牌提取。
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_CREATION_SKILLS,
  CREATION_CATALOG,
  CREATION_CATALOG_CATEGORIES,
  CREATION_TYPES,
  type CreationSkill,
  buildLlmMessages,
  buildVoiceoverRequest,
  catalogToSkill,
  composeCreationPrompt,
  effectiveBackend,
  extractSkillToken,
  filterSkills,
  findSkillByName,
  llmTextFromResponse,
  newSkillId,
  sanitizeSkills,
  subjectsBlock,
} from '../src/composables/creationStudioLogic'

describe('默认技能种子（即梦首页芯片行，2026-10-16 运行态提取）', () => {
  it('内置 7 个技能，名字/徽标对齐即梦芯片行，全部 llm 后端可编辑', () => {
    expect(BUILTIN_CREATION_SKILLS.map((s) => s.name)).toEqual([
      '电影级长镜头运镜', '创作分镜', '风格大师', '叙事短片导演分镜', '微表情导演', '电影广告全能导演', '系列套图生成',
    ])
    expect(BUILTIN_CREATION_SKILLS.map((s) => s.badge)).toEqual(['New', 'New', 'New', 'Hot', 'Hot', undefined, undefined])
    expect(BUILTIN_CREATION_SKILLS.every((s) => s.builtin === true)).toBe(true)
    expect(BUILTIN_CREATION_SKILLS.every((s) => s.template.includes('{{输入}}'))).toBe(true)
  })
})

describe('技能市场字典（即梦技能市场真实条目）', () => {
  it('目录 14 条，名称与分类域对齐提取数据', () => {
    expect(CREATION_CATALOG).toHaveLength(14)
    expect(CREATION_CATALOG.map((e) => e.name)).toContain('短视频爆款带货')
    expect(CREATION_CATALOG.map((e) => e.name)).toContain('系列套图生成')
    expect(CREATION_CATALOG.every((e) => e.author && e.usage && e.description.length > 30)).toBe(true)
    expect(CREATION_CATALOG_CATEGORIES).toEqual(['广告营销', '影视作品', '平面设计', '电商', '动画动漫', '其他'])
  })
  it('catalogToSkill：加入为 llm 技能，模板含描述原文与占位符', () => {
    const entry = CREATION_CATALOG[0]!
    const skill = catalogToSkill(entry)
    expect(skill.id).toBe(`skill-${entry.id}`)
    expect(skill.backend).toBe('llm')
    expect(skill.template).toContain(entry.description.slice(0, 20))
    expect(skill.template).toContain('{{输入}}')
    expect(skill.template).toContain('{{主体}}')
  })
  it('创作类型字典=即梦 Agent 模式下拉原文（7 项）', () => {
    expect(CREATION_TYPES.map((t) => t.label)).toEqual([
      'Agent 模式', '图片生成', '视频生成', '音乐生成', '音频生成', '数字人', '动作模仿',
    ])
  })
})

describe('sanitizeSkills 容错', () => {
  it('坏 JSON/非数组/空数组 → 回退内置种子', () => {
    expect(sanitizeSkills(null)).toHaveLength(7)
    expect(sanitizeSkills('x')).toHaveLength(7)
    expect(sanitizeSkills([])).toHaveLength(7)
  })
  it('缺 id/名的条目丢弃；合法条目保留并规范字段', () => {
    const out = sanitizeSkills([
      { id: 'a', name: '  口播带货  ', emoji: '', template: 't {{输入}}', tool: 'voice-clone' },
      { id: '', name: '没id' },
      { name: '没id2' },
      'junk',
      null,
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'a', name: '口播带货', emoji: '🧩', tool: 'voice-clone' })
  })
})

describe('composeCreationPrompt 组合展开', () => {
  const skill: CreationSkill = {
    id: 'x', name: 'X', emoji: '✨',
    template: '前缀：{{输入}}\n尾注{{主体}}',
  }
  it('替换 {{输入}} 与 {{主体}}（主体顿号连接）', () => {
    const out = composeCreationPrompt({
      skill,
      input: '  做一支咖啡广告  ',
      subjects: [{ id: '1', name: '拿铁' }, { id: '2', name: '冷萃' }],
    })
    expect(out).toContain('前缀：做一支咖啡广告')
    expect(out).toContain('主体：拿铁、冷萃')
  })
  it('无主体 → 不追加主体块，且 {{主体}} 清空', () => {
    const out = composeCreationPrompt({ skill, input: 'abc' })
    expect(out).toBe('前缀：abc\n尾注')
  })
  it('模板无占位 → 模板+输入拼接', () => {
    const out = composeCreationPrompt({ skill: { id: 'y', name: 'Y', emoji: '✨', template: '固定开场' }, input: '正文' })
    expect(out).toBe('固定开场\n正文')
  })
  it('自动模式（无技能）= 裸输入 + 主体块', () => {
    expect(composeCreationPrompt({ input: 'hi', subjects: [{ id: '1', name: 'A' }] })).toBe('hi\n主体：A')
    expect(composeCreationPrompt({ input: 'hi' })).toBe('hi')
  })
  it('空输入守卫：无输入无主体 → 空串', () => {
    expect(composeCreationPrompt({ skill: null, input: '   ' })).toBe('')
  })
})

describe('过滤与按名定位', () => {
  const skills = sanitizeSkills(undefined)
  it('filterSkills：空串=全部；子串命中（大小写不敏感）', () => {
    expect(filterSkills(skills, '')).toHaveLength(skills.length)
    expect(filterSkills(skills, '分镜').map((s) => s.name)).toEqual(['创作分镜', '叙事短片导演分镜'])
    expect(filterSkills(skills, 'ABCDEF')).toHaveLength(0)
  })
  it('findSkillByName：精确优先，其次前缀，未命中 null', () => {
    expect(findSkillByName(skills, '创作分镜')?.id).toBe('sk-storyboard')
    expect(findSkillByName(skills, '创作')?.name).toBe('创作分镜')
    expect(findSkillByName(skills, '不存在')).toBeNull()
    expect(findSkillByName(skills, '')).toBeNull()
  })
})

describe('/ 令牌提取（即梦口径：/ 出现在文本中即唤起）', () => {
  it('取首个 /词，并给出移除该词后的正文', () => {
    expect(extractSkillToken('/创作分镜 一支咖啡广告')).toEqual({ name: '创作分镜', rest: ' 一支咖啡广告' })
    expect(extractSkillToken('帮我 /风格大师 处理')).toEqual({ name: '风格大师', rest: '帮我  处理' })
  })
  it('无 / → null；/ 后空白/越界 → 空名', () => {
    expect(extractSkillToken('没有技能')).toBeNull()
    expect(extractSkillToken('/ 前缀')).toEqual({ name: '', rest: ' 前缀' })
  })
})

describe('newSkillId 唯一性', () => {
  it('两次生成不重复且带前缀', () => {
    const a = newSkillId()
    const b = newSkillId()
    expect(a).not.toBe(b)
    expect(a.startsWith('sk-')).toBe(true)
  })
})

describe('发送后端路由（P1/P2 对接，2026-10-16）', () => {
  it('effectiveBackend：缺省/非法=llm；显式 voiceover/copy 生效', () => {
    expect(effectiveBackend(null)).toBe('llm')
    expect(effectiveBackend({ id: 'a', name: 'a', emoji: '✨', template: '' })).toBe('llm')
    expect(effectiveBackend({ id: 'a', name: 'a', emoji: '✨', template: '', backend: 'voiceover' })).toBe('voiceover')
    expect(effectiveBackend({ id: 'a', name: 'a', emoji: '✨', template: '', backend: 'copy' })).toBe('copy')
    // 非法值兜底 llm（后端仅三值，枚举外不猜）
    expect(effectiveBackend({ id: 'a', name: 'a', emoji: '✨', template: '', backend: 'wat' as never })).toBe('llm')
  })
  it('sanitize 保留合法 backend、丢弃非法值', () => {
    const out = sanitizeSkills([
      { id: 'a', name: 'A', template: 't', backend: 'voiceover' },
      { id: 'b', name: 'B', template: 't', backend: 'nonsense' },
    ])
    expect(out[0]?.backend).toBe('voiceover')
    expect(out[1]?.backend).toBeUndefined()
  })

  it('buildLlmMessages：固定 system + user=组合提示词；不带 model（缺省走服务端默认）', () => {
    const msgs = buildLlmMessages('写一支咖啡广告')
    expect(msgs).toHaveLength(2)
    expect(msgs[0]?.role).toBe('system')
    expect(msgs[0]?.content).toContain('创作助手')
    expect(msgs[1]).toEqual({ role: 'user', content: '写一支咖啡广告' })
    expect(JSON.stringify(msgs).includes('model')).toBe(false)
  })

  it('llmTextFromResponse：choices[0].message.content 防御解析', () => {
    expect(llmTextFromResponse({ choices: [{ message: { content: ' 成品 ' } }] })).toBe('成品')
    expect(llmTextFromResponse(null)).toBe('')
    expect(llmTextFromResponse({})).toBe('')
    expect(llmTextFromResponse({ choices: [] })).toBe('')
  })

  it('buildVoiceoverRequest：product_desc=主体+输入；hint 仅在有主体时携带；platform 仅显式时携带；不猜 skill_id', () => {
    const skill: CreationSkill = { id: 's', name: '口播', emoji: '🎙️', template: 't' }
    expect(buildVoiceoverRequest({ skill, input: '降噪耳机' })).toEqual({ product_desc: '降噪耳机' })
    expect(buildVoiceoverRequest({
      skill,
      input: '新品上市',
      subjects: [{ id: '1', name: '燕麦奶' }, { id: '2', name: '手冲壶' }],
      platform: '抖音',
    })).toEqual({
      product_desc: '燕麦奶，手冲壶，新品上市',
      hint: '需围绕主体：燕麦奶、手冲壶',
      platform: '抖音',
    })
    // 空输入+无主体 → product_desc 空串（调用方校验报错，不造默认值）
    expect(buildVoiceoverRequest({ skill, input: '' }).product_desc).toBe('')
    expect(JSON.stringify(buildVoiceoverRequest({ skill, input: 'x' })).includes('skill_id')).toBe(false)
  })
})
