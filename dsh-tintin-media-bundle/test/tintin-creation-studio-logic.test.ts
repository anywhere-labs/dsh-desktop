// test/tintin-creation-studio-logic.test.ts — 创作模式纯函数回归（2026-10-16）
// 覆盖：默认技能种子、sanitize 容错（坏 JSON/缺字段/空数组回退）、组合展开
//（{{输入}}/{{主体}}、无占位拼接、自动模式）、过滤/按名定位、/令牌提取。
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_CREATION_SKILLS,
  CREATION_CATALOG,
  CREATION_CATALOG_CATEGORIES,
  CREATION_RATIOS,
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
  loadCreationPrefs,
  newSkillId,
  subjectProductFromItem,
  sanitizeCreationPrefs,
  sanitizeSkills,
  saveCreationPrefs,
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

// ── 生成偏好（2026-10-16 用户裁决：「自动」可点选——即梦生成偏好面板同款）──
describe('生成偏好 sanitize 容错', () => {
  it('缺字段/非法枚举回默认档（auto 开、图片、智能）', () => {
    expect(sanitizeCreationPrefs(undefined)).toEqual({ auto: true, modality: 'image', ratio: '智能' })
    expect(sanitizeCreationPrefs({ auto: 'yes', modality: 'audio', ratio: '5:4' })).toEqual({ auto: true, modality: 'image', ratio: '智能' })
  })
  it('合法值原样保留（video + 9:16 + auto 关）', () => {
    expect(sanitizeCreationPrefs({ auto: false, modality: 'video', ratio: '9:16' })).toEqual({ auto: false, modality: 'video', ratio: '9:16' })
  })
  it('九档比例字典齐全且智能在首', () => {
    expect(CREATION_RATIOS).toEqual(['智能', '1:1', '3:4', '16:9', '4:3', '9:16', '2:3', '3:2', '21:9'])
  })
})

describe('生成偏好 save/load（注入 storage）', () => {
  it('round-trip：保存后读回一致；无存储=默认档', () => {
    const mem = new Map<string, string>()
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    saveCreationPrefs({ auto: false, modality: 'video', ratio: '16:9' }, store)
    expect(loadCreationPrefs(store)).toEqual({ auto: false, modality: 'video', ratio: '16:9' })
    expect(loadCreationPrefs({ getItem: () => null })).toEqual({ auto: true, modality: 'image', ratio: '智能' })
  })
  it('坏 JSON 回默认档不抛', () => {
    const store = { getItem: () => '{oops', setItem: () => {} }
    expect(loadCreationPrefs(store)).toEqual({ auto: true, modality: 'image', ratio: '智能' })
  })
})

// ── @主体产品档案（2026-10-16 用户裁决：选中即拉详情，LLM 资料块+口播契约）──
describe('subjectProductFromItem 产品条目映射', () => {
  it('model/selling_points/features/six_views → 客户端形状；六视图 URL 缺省按 material_id 回退', () => {
    const p = subjectProductFromItem({
      id: 'P1', brand: '罗技', model: 'G304黑',
      selling_points: '低延迟竞技\nHero 传感器',
      features: '≥400 IPS\n5 号电池',
      six_views: { front: { material_id: 'M1' }, back: { material_id: 'M2', url: '/material/serve?material_id=M2' } },
    })
    expect(p).toEqual({
      id: 'P1', brand: '罗技', model: 'G304黑',
      sellingPoints: ['低延迟竞技', 'Hero 传感器'],
      features: ['≥400 IPS', '5 号电池'],
      sixViews: [
        { view: 'front', url: '/material/serve?material_id=M1' },
        { view: 'back', url: '/material/serve?material_id=M2' },
      ],
    })
  })
  it('空条目只有 id（可选字段不落 undefined 键）', () => {
    expect(subjectProductFromItem({ id: 'P2' })).toEqual({ id: 'P2' })
  })
})

describe('subjectsBlock 产品档案资料块', () => {
  it('带档案主体=型号行+卖点+参数+六视图清单；无档案主体维持裸名字行', () => {
    const block = subjectsBlock([
      { id: 'a', name: 'G304黑', product: { id: 'P1', model: '910-002586', sellingPoints: ['低延迟', '长续航'], features: ['400 IPS'], sixViews: [{ view: 'front', url: 'http://x/1.png' }] } },
      { id: 'b', name: '普通主体' },
    ])
    expect(block).toContain('主体：G304黑（型号 910-002586）')
    expect(block).toContain('卖点：低延迟；长续航')
    expect(block).toContain('参数：400 IPS')
    expect(block).toContain('六视图参考：front http://x/1.png')
    expect(block).toContain('主体：普通主体')
  })
  it('纯名字主体=旧行为逐字节一致', () => {
    expect(subjectsBlock([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])).toBe('\n主体：A、B')
  })
})

describe('buildVoiceoverRequest 产品档案契约', () => {
  it('product_desc 带型号+卖点；无档案主体维持裸名字', () => {
    const r = buildVoiceoverRequest({
      skill: BUILTIN_CREATION_SKILLS[0]!,
      input: '来一段开场',
      subjects: [
        { id: 'a', name: 'G304黑', product: { id: 'P1', model: '910-002586', sellingPoints: ['低延迟', '长续航'] } },
        { id: 'b', name: '普通主体' },
      ],
    })
    expect(r.product_desc).toBe('G304黑（型号 910-002586）：低延迟；长续航，普通主体，来一段开场')
    expect(r.hint).toContain('G304黑（型号 910-002586）')
    expect(r.hint).toContain('普通主体')
  })
  it('无产品档案时与旧行为逐字节一致', () => {
    const r = buildVoiceoverRequest({ skill: BUILTIN_CREATION_SKILLS[0]!, input: 'x', subjects: [{ id: 'a', name: 'A' }] })
    expect(r.product_desc).toBe('A，x')
    expect(r.hint).toBe('需围绕主体：A')
  })
})
