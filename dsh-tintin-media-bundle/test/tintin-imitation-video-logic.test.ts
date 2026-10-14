// test/tintin-imitation-video-logic.test.ts — 仿视频 V3.5 客户端纯函数回归（2026-10-02）
// 契约锚点：《仿视频流程规范》PRD-M-5·V3.5（2026-10-02 v1.0 + 同日评审复核）
// §3 数据模型与两条状态机 / §4 Part1 输入 / §5.1 storyboard_generate 输入 /
// §5.3 徽标与解锁 / §6 gen_spec 镜像 / §11-9 stage 显式必填。
import { describe, expect, it } from 'vitest'
import {
  arollTimelineWarning,
  buildFramesConfirmBody,
  buildFramesReplaceFiles,
  buildImitateBody,
  buildScriptPutPayload,
  buildStoryboardGenerateBody,
  canConfirmFrames,
  classifySixViewPollStatus,
  clampDuration,
  composedDuration,
  enumLabel,
  framesBadgeText,
  genBadgeText,
  disableShotReplaceItem,
  enableShotReplaceItem,
  isReplaceShot,
  isStageDReady,
  shotInReplace,
  shotModeBadgeClass,
  shotModeBadgeText,
  nextGenName,
  normalizeImitateVideo,
  parseSixViewEntries,
  preserveProductSelectionOnReload,
  shotHealNeeded,
  shotProgressPercent,
  productChipLabel,
  sixViewFileUrl,
  normalizeServerEnums,
  ratioSize,
  sceneElementOptions,
  shotsTotalDuration,
  switchShotSource,
  validateGenShots,
  type ImitationShot,
  type ServerEnums,
} from '../src/composables/imitationVideoLogic'

/** /comfygen/enums 实测形状的测试夹具（裁剪子集，结构 1:1） */
const ENUMS: ServerEnums = normalizeServerEnums({
  ok: true,
  source: 'gen_spec',
  surfaces: { gray_studio: '浅灰摄影棚', dark_wood_desk: '深色木纹桌面' },
  environments: { none: '无（纯台面）', gaming_room: '夜晚电竞房' },
  lightings: { soft_studio: '柔和顶光', purple_blue: '紫蓝氛围灯' },
  styles: { ecommerce: '电商大片' },
  compositions: { centered: '居中构图', closeup: '特写构图' },
  cameras: { push_in: '镜头缓慢推近', static: '固定机位', dolly_in: '镜头平滑前移' },
  fidelity: { fast: '快速（约3分/镜头）', balanced: '均衡（约4.5分/镜头）', high: '高保真（约7分/镜头）' },
  ratios: { '9:16': [704, 1248], '16:9': [1280, 704] },
})!

function genShot(name: string, over: Partial<ImitationShot> = {}): ImitationShot {
  return {
    index: 1,
    visual: '深色木桌上的鼠标特写',
    audio: '口播文案',
    duration: 5,
    source: 'generate',
    gen: {
      backend: 'comfygen',
      name,
      scene: { surface: 'dark_wood_desk', environment: 'gaming_room', lighting: 'purple_blue', style: 'ecommerce', composition: 'centered' },
      scene_en: 'dark wood desk closeup with RGB accents',
      end_scene_en: 'the same scene, camera closer to the product',
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
    ...over,
  }
}

describe('frames_status 状态机（§3 定稿：pending→generated→confirmed）', () => {
  it('仅 generated 态可确认（HumanGate②）', () => {
    expect(canConfirmFrames(genShot('shot_01'))).toBe(false)
    expect(canConfirmFrames(genShot('shot_01', { gen: { ...genShot('x').gen!, frames_status: 'generated' } }))).toBe(true)
    expect(canConfirmFrames(genShot('shot_01', { gen: { ...genShot('x').gen!, frames_status: 'confirmed' } }))).toBe(false)
  })

  it('阶段 D 放行 = 全部生成镜 confirmed；无生成镜放行；混入 pending 拒绝', () => {
    const matShot: ImitationShot = { duration: 4, source: 'material', material_id: 12 }
    const confirmed = genShot('a', { gen: { ...genShot('x').gen!, frames_status: 'confirmed' } })
    expect(isStageDReady([matShot])).toBe(true)
    expect(isStageDReady([matShot, confirmed])).toBe(true)
    expect(isStageDReady([confirmed, genShot('b')])).toBe(false)
  })

  it('废拼法 frames_generated 不在合法值内（评审复核统一为 generated）', () => {
    const legacy = genShot('a', { gen: { ...genShot('x').gen!, frames_status: 'frames_generated' as unknown as 'generated' } })
    expect(validateGenShots([legacy]).some((i) => i.field === 'gen.frames_status')).toBe(true)
  })
})

describe('徽标文案（§5.3-4/5）', () => {
  it('生成徽标四态 + 失败带原因', () => {
    expect(genBadgeText({ duration: 4, source: 'material' })).toBe('实拍')
    expect(genBadgeText(genShot('a'))).toBe('待生成')
    expect(genBadgeText(genShot('a', { gen: { ...genShot('x').gen!, status: 'submitted' } }))).toBe('生成中')
    expect(genBadgeText(genShot('a', { gen: { ...genShot('x').gen!, status: 'done' } }))).toBe('已完成')
    expect(genBadgeText(genShot('a', { gen: { ...genShot('x').gen!, status: 'failed', error: 'timeout' } }))).toBe('失败：timeout')
  })

  it('帧徽标三态，实拍镜为空', () => {
    expect(framesBadgeText(genShot('a'))).toBe('帧待生成')
    expect(framesBadgeText(genShot('a', { gen: { ...genShot('x').gen!, frames_status: 'generated' } }))).toBe('帧待确认')
    expect(framesBadgeText(genShot('a', { gen: { ...genShot('x').gen!, frames_status: 'confirmed' } }))).toBe('帧已确认')
    expect(framesBadgeText({ duration: 4, source: 'material' })).toBe('')
  })
})

describe('整镜来源切换（§5.3-2）', () => {
  it('material→generate：清空绑片字段并初始化 gen（唯一名、双状态机归 pending）', () => {
    const mat: ImitationShot = { duration: 6, source: 'material', material_id: 33, visual: 'v', audio: 'a' }
    const shot = switchShotSource(mat, 'generate', [genShot('shot_01'), genShot('shot_02')])
    expect(shot.source).toBe('generate')
    expect(shot.material_id).toBe(0) // 实测 Shot.material_id 为 integer default 0 非 nullable
    expect(shot.material_path).toBe('')
    expect(shot.gen?.name).toBe('shot_03') // 已占 01/02 → 冲突递增
    expect(shot.gen?.frames_status).toBe('pending')
    expect(shot.gen?.status).toBe('pending')
    expect(shot.visual).toBe('v')
  })

  it('generate→material：保留 gen 块（A2 裁决：切回不重建）与既有绑片', () => {
    const g = genShot('shot_01', { material_id: 77 })
    const shot = switchShotSource(g, 'material')
    expect(shot.source).toBe('material')
    expect(shot.gen).toEqual(g.gen) // gen 原样保留，不删
    expect(shot.duration).toBe(5)
    expect(shot.audio).toBe('口播文案')
    expect(shot.material_id).toBe(77)
  })

  it('AI→实拍→AI 往返：保留的 gen 原样恢复（编辑过的提示词/帧状态不丢），绑片按 A1 清零', () => {
    const edited = genShot('shot_02', {
      gen: {
        ...genShot('x').gen!,
        name: 'shot_02',
        camera: 'crane_up',
        scene_en: 'marble desk with cool rim light',
        frames_status: 'confirmed',
        first_frame: { path: 'script_x/shot_02_first.png', source: 'generated' },
      },
    })
    const roundTrip = switchShotSource(switchShotSource(edited, 'material'), 'generate')
    expect(roundTrip.source).toBe('generate')
    expect(roundTrip.gen).toEqual(edited.gen) // 原样恢复，非重建默认值
    expect(roundTrip.gen?.camera).toBe('crane_up')
    expect(roundTrip.gen?.frames_status).toBe('confirmed')
    expect(roundTrip.material_id).toBe(0)
    expect(roundTrip.material_path).toBe('')
  })
})

describe('gen_spec 客户端镜像（§6）', () => {
  it('name 重复 / 非 ASCII / duration 越界 / 未知运镜逐一报错（带 enums 全集校验）', () => {
    const dupA = genShot('shot_01')
    const dupB = genShot('shot_01')
    const chinese = genShot('shot_02', { gen: { ...genShot('x').gen!, scene_en: '深色木桌' } })
    const badDur = genShot('shot_03', { duration: 20 })
    const badCam = genShot('shot_04', { gen: { ...genShot('x').gen!, camera: 'zoom' as never } })
    const issues = validateGenShots([dupA, dupB, chinese, badDur, badCam], ENUMS)
    expect(issues.some((i) => i.message.includes('name 重复'))).toBe(true)
    expect(issues.some((i) => i.field === 'gen.scene_en')).toBe(true)
    expect(issues.some((i) => i.field === 'duration')).toBe(true)
    expect(issues.some((i) => i.field === 'gen.camera')).toBe(true)
  })

  it('无 enums 跳过枚举全集检查（服务端 gen_spec 兜底）；有 enums 时以服务端表为准', () => {
    const follow = genShot('shot_01', { gen: { ...genShot('x').gen!, camera: 'follow' } })
    const dolly = genShot('shot_02', { gen: { ...genShot('x').gen!, camera: 'dolly_in' } })
    expect(validateGenShots([follow])).toEqual([]) // 无 enums 不查全集
    expect(validateGenShots([dolly], ENUMS)).toEqual([]) // dolly_in 服务端有值，本地旧表没有——以服务端为准
    expect(validateGenShots([follow], ENUMS).some((i) => i.field === 'gen.camera')).toBe(true) // follow 待 comfygen #11，服务端表无此值
    expect(validateGenShots([genShot('shot_01'), { duration: 4, source: 'material' }], ENUMS)).toEqual([])
  })

  it('场景四要素：有 enums 时查全集，空值跳过', () => {
    const badSurface = genShot('shot_01', { gen: { ...genShot('x').gen!, scene: { ...genShot('x').gen!.scene!, surface: 'wood' } } })
    expect(validateGenShots([badSurface], ENUMS).some((i) => i.field === 'gen.scene.surface')).toBe(true)
    const noScene = genShot('shot_01', { gen: { ...genShot('x').gen!, scene: {} } })
    expect(validateGenShots([noScene], ENUMS)).toEqual([])
  })

  it('clampDuration 归一 3~15，非法回退 5', () => {
    expect(clampDuration(1)).toBe(3)
    expect(clampDuration(99)).toBe(15)
    expect(clampDuration(5.4)).toBe(5)
    expect(clampDuration('x')).toBe(5)
  })

  it('nextGenName 唯一递增', () => {
    expect(nextGenName(['shot_01', 'shot_02'])).toBe('shot_03')
    expect(nextGenName([])).toBe('shot_01')
    expect(nextGenName(['shot_02'])).toBe('shot_01')
  })
})

describe('服务端枚举唯一源（§11-19：GET /comfygen/enums）', () => {
  it('normalizeServerEnums 归一实测形状；ok 非 true 或 cameras/fidelity 缺失 → null', () => {
    expect(ENUMS.source).toBe('gen_spec')
    expect(ENUMS.cameras).toHaveLength(3)
    expect(ENUMS.fidelity.map((f) => f.value)).toEqual(['fast', 'balanced', 'high'])
    expect(ENUMS.ratios).toEqual([
      { ratio: '9:16', width: 704, height: 1248 },
      { ratio: '16:9', width: 1280, height: 704 },
    ])
    expect(normalizeServerEnums({ ok: false })).toBeNull()
    expect(normalizeServerEnums({ ok: true, cameras: {}, fidelity: {} })).toBeNull()
    expect(normalizeServerEnums(null)).toBeNull()
  })
  it('场景要素取项 / 标签回退 / ratio 换算', () => {
    expect(sceneElementOptions(ENUMS, 'surface').map((o) => o.value)).toEqual(['gray_studio', 'dark_wood_desk'])
    expect(enumLabel(ENUMS.cameras, 'dolly_in')).toBe('镜头平滑前移')
    expect(enumLabel(ENUMS.cameras, 'unknown_x')).toBe('unknown_x') // 展示回退原值
    expect(ratioSize(ENUMS, '9:16')).toEqual({ width: 704, height: 1248 })
    expect(ratioSize(ENUMS, '21:9')).toBeNull()
  })
})

describe('A-roll 对轨（§3：±15% 仅提示；成片总长=两轨较长者）', () => {
  const shots = [genShot('a', { duration: 10 }), genShot('b', { duration: 10 })]
  it('Σduration 与偏差计算', () => {
    expect(shotsTotalDuration(shots)).toBe(20)
  })
  it('偏差 ≤15% 不提示；>15% 提示；口播缺失不提示', () => {
    expect(arollTimelineWarning(shots, 18)).toBe('') // |20-18|/18 ≈ 11%
    expect(arollTimelineWarning(shots, 16)).toContain('偏差') // 25%
    expect(arollTimelineWarning(shots, undefined)).toBe('')
    expect(arollTimelineWarning(shots, 0)).toBe('')
  })
  it('成片总长取较长轨', () => {
    expect(composedDuration(20, 30)).toBe(30)
    expect(composedDuration(25, 20)).toBe(25)
    expect(composedDuration(undefined, 20)).toBe(20)
    expect(composedDuration(20, undefined)).toBe(20)
  })
})

describe('Part 1 输入归一化与请求体（§4）', () => {
  it('三形态 + 本地文件需预上传 + material://URI 往返', () => {
    expect(normalizeImitateVideo(123).kind).toBe('material')
    expect(normalizeImitateVideo('https://v.douyin.com/xyz').kind).toBe('url')
    expect(normalizeImitateVideo('D:/work/output/src.mp4').kind).toBe('video_path')
    expect(normalizeImitateVideo('C:/Users/me/Desktop/demo.mp4').kind).toBe('local_file')
    expect(normalizeImitateVideo('').kind).toBe('invalid')
    // 预上传成功后的往返：编排层把 material://{id} 回填再提交，必须原样通过
    // （2026-10-02 实机事故回归锚：缺 URI 分支时被误判 local_file 致上传白做）
    const rt = buildImitateBody({ video: 'material://812729' })
    expect(rt.ok).toBe(true)
    expect(rt.body.video).toBe('material://812729')
    expect(normalizeImitateVideo('material://812729').kind).toBe('material')
  })
  it('body.video 按 kind 取值（材质=material:// URI，实测 2026-10-02）；products/options 透传；本地文件返回 needsUpload', () => {
    expect(buildImitateBody({ video: 123 })).toEqual({ ok: true, body: { video: 'material://123' }, note: expect.any(String) })
    expect(buildImitateBody({ video: 'https://a/b.mp4' }).body).toEqual({ video: 'https://a/b.mp4' })
    const withOpts = buildImitateBody({ video: 1, products: [{ id: 9 }], options: { ratio: '9:16', fidelity: 'balanced', max_shots: 9 } })
    expect(withOpts.body.video).toBe('material://1')
    expect(withOpts.body.products).toEqual([{ id: 9 }])
    expect(withOpts.body.options).toEqual({ ratio: '9:16', fidelity: 'balanced', max_shots: 9 })
    const local = buildImitateBody({ video: 'C:/local.mp4' })
    expect(local.ok).toBe(false)
    expect(local.needsUpload).toBe('C:/local.mp4')
  })
})

describe('Part 2 请求体（§5.1 / §11-9 stage 显式）', () => {
  it('storyboard_generate body 形状与默认值', () => {
    expect(buildStoryboardGenerateBody({ scriptId: 's1', stage: 'frames' })).toEqual({
      task_type: 'storyboard_generate',
      params: { script_id: 's1', stage: 'frames', auto_montage: false },
    })
    expect(buildStoryboardGenerateBody({ scriptId: 's1', stage: 'videos', onlyShots: ['shot_02'], fidelityOverride: 'fast', autoMontage: true }).params).toEqual({
      script_id: 's1', stage: 'videos', only_shots: ['shot_02'], fidelity_override: 'fast', auto_montage: true,
    })
  })
  it('非法 stage 抛错（与 comfygen stage 同名异值防线）', () => {
    expect(() => buildStoryboardGenerateBody({ scriptId: 's1', stage: 'video' as never })).toThrow()
  })
  it('quality 档透传（批3 D4：draft 缺省/final 定稿；不传不出键=服务端缺省）', () => {
    const fin = buildStoryboardGenerateBody({ scriptId: 's1', stage: 'frames', quality: 'final' })
    expect((fin.params as Record<string, unknown>).quality).toBe('final')
    const draft = buildStoryboardGenerateBody({ scriptId: 's1', stage: 'frames', quality: 'draft' })
    expect((draft.params as Record<string, unknown>).quality).toBe('draft')
    const none = buildStoryboardGenerateBody({ scriptId: 's1', stage: 'frames' })
    expect((none.params as Record<string, unknown>).quality).toBeUndefined()
  })
  it('product_images 随任务直传且截断 ≤6（2026-10-06 服务端放宽 2→6；worker 只认 url/路径）', () => {
    const one = buildStoryboardGenerateBody({ scriptId: 's1', stage: 'frames', productImages: ['http://x/1.png'] })
    expect((one.params as Record<string, unknown>).product_images).toEqual(['http://x/1.png'])
    const six = buildStoryboardGenerateBody({
      scriptId: 's1', stage: 'videos',
      productImages: ['http://x/1.png', 'http://x/2.png', 'http://x/3.png', 'http://x/4.png', 'http://x/5.png', 'http://x/6.png', 'http://x/7.png'],
    })
    expect((six.params as Record<string, unknown>).product_images).toEqual([
      'http://x/1.png', 'http://x/2.png', 'http://x/3.png', 'http://x/4.png', 'http://x/5.png', 'http://x/6.png',
    ])
    expect(buildStoryboardGenerateBody({ scriptId: 's1', stage: 'frames' }).params).not.toHaveProperty('product_images')
  })
  it('seed_base 不进提交面（规范 §5.1 定稿：服务端自回填自消费 gen.seed_base，客户端提交形=发明契约）', () => {
    const shots = [{ gen: { name: 'shot_01', seed_base: 42 } }]
    for (const stage of ['storyboard', 'frames', 'videos', 'all'] as const) {
      const body = buildStoryboardGenerateBody({ scriptId: 's1', stage }, shots as never)
      expect(body.params).not.toHaveProperty('seed_base')
    }
  })
  it('HumanGate② 帧确认/换帧 body（§9；实测 PUT 为 multipart：confirmed 布尔 + first/last 文件）', () => {
    expect(buildFramesConfirmBody()).toEqual({ confirmed: true })
    expect(buildFramesReplaceFiles('C:/f.png')).toEqual({ first: { path: 'C:/f.png' } })
    expect(buildFramesReplaceFiles('C:/f.png', 'C:/l.png')).toEqual({ first: { path: 'C:/f.png' }, last: { path: 'C:/l.png' } })
    expect(buildFramesReplaceFiles()).toEqual({})
  })
})

describe('保真枚举 off 档（§11-52③：FlashVSR LoRA 默认不启用）', () => {
  it('normalizeServerEnums 为空 label 的 off 档补可读文案', () => {
    const e = normalizeServerEnums({
      ok: true, source: 'gen_spec',
      surfaces: { dark_wood_desk: '深色木纹桌面' }, environments: { none: '无（纯台面）' },
      lightings: { soft_studio: '柔和顶光' }, styles: { ecommerce: '电商大片' },
      compositions: { centered: '居中构图' }, cameras: { push_in: '推近' },
      fidelity: { off: '', balanced: '均衡（约4.5分/镜头）' },
      reference_mode: { scene_refs: '画面级还原（原片帧参考）', style_anchor: '风格级相似（文字+产品图）' },
      ratios: { '9:16': [704, 1248] },
    })!
    expect(e.referenceModes).toEqual([
      { value: 'scene_refs', label: '画面级还原（原片帧参考）' },
      { value: 'style_anchor', label: '风格级相似（文字+产品图）' },
    ])
    const off = e.fidelity.find((f) => f.value === 'off')
    expect(off?.label).toBe('关（默认，不启用 FlashVSR）')
    expect(e.fidelity.find((f) => f.value === 'balanced')?.label).toBe('均衡（约4.5分/镜头）')
  })
})

describe('六视图提取（§11-51，2026-10-08 实测定稿两形态）', () => {
  it('键控对象形态（实测 result/meta）：views 按视角名键控，规范序输出，view 名入条目', () => {
    const real = {
      status: 'generated',
      views: { top: { path: 's/six_view/top.png' }, back: { path: 's/six_view/back.png' },
        left: { path: 's/six_view/left.png' }, front: { path: 's/six_view/front.png' },
        right: { path: 's/six_view/right.png' }, bottom: { path: 's/six_view/bottom.png' } },
      job_id: '6a3e940fb434', source: 'comfygen_view_jobs',
    }
    expect(parseSixViewEntries(real)).toEqual([
      { view: 'front', path: 's/six_view/front.png' },
      { view: 'right', path: 's/six_view/right.png' },
      { view: 'back', path: 's/six_view/back.png' },
      { view: 'left', path: 's/six_view/left.png' },
      { view: 'top', path: 's/six_view/top.png' },
      { view: 'bottom', path: 's/six_view/bottom.png' },
    ])
    // 自包含 url 字段随条目透传（新任务回填带 url；无 url 时调用方按 sixViewFileUrl 拼）
    const withUrl = parseSixViewEntries({ views: { front: { path: 's/six_view/front.png', url: '/api/storyboard/scripts/s1/six-view/file/front' } } })
    expect(withUrl[0]?.url).toBe('/api/storyboard/scripts/s1/six-view/file/front')
    expect(sixViewFileUrl('script_x', 'top')).toBe('/api/storyboard/scripts/script_x/six-view/file/top')
    // 轮询响应形态：views 嵌在 result 下
    expect(parseSixViewEntries({ status: 'completed', result: real }).map((e) => e.view)).toEqual([
      'front', 'right', 'back', 'left', 'top', 'bottom',
    ])
  })
  it('数组形态兼容：直数组/多键数组取路径字符串，非串过滤，序号补 view 名', () => {
    expect(parseSixViewEntries({ paths: ['/x/y.png'] })).toEqual([{ view: '1', path: '/x/y.png' }])
    expect(parseSixViewUrlsCompat())
  })
  function parseSixViewUrlsCompat(): boolean {
    expect(parseSixViewEntries(['only-array-form'])).toEqual([{ view: '1', path: 'only-array-form' }])
    expect(parseSixViewEntries({ views: [123, 'keep'] })).toEqual([{ view: '1', path: 'keep' }])
    return true
  }
  it('无视图键/空源返回空数组（显示层走占位）', () => {
    expect(parseSixViewEntries({ status: 'running' })).toEqual([])
    expect(parseSixViewEntries(null)).toEqual([])
    expect(parseSixViewEntries({ views: 'not-array' })).toEqual([])
  })
})

describe('classifySixViewPollStatus（2026-10-09 服务端联动取消：取消族是终态不是失败）', () => {
  it('pending 族（空/进行中）→ 继续轮询', () => {
    for (const st of ['', 'running', 'pending', null, undefined]) {
      expect(classifySixViewPollStatus(st)).toBe('pending')
    }
  })
  it('失败族 → failed（走既有失败分支）', () => {
    expect(classifySixViewPollStatus('failed')).toBe('failed')
    expect(classifySixViewPollStatus('error')).toBe('failed')
  })
  it('取消族（双拼写+服务端重启对账 interrupted，大小写不敏感）→ cancelled', () => {
    for (const st of ['cancelled', 'canceled', 'interrupted', 'CANCELLED', 'Interrupted']) {
      expect(classifySixViewPollStatus(st)).toBe('cancelled')
    }
  })
  it('其余一律按完成处理（done/completed/succeeded）', () => {
    for (const st of ['done', 'completed', 'succeeded', 'generated']) {
      expect(classifySixViewPollStatus(st)).toBe('complete')
    }
  })
})

describe('换物品镜（2026-10-10 用户裁决：切换为实拍→切换为换物品）', () => {
  const genShot: ImitationShot = {
    duration: 4,
    source: 'generate',
    gen: { backend: 'comfygen', name: 'gen_1', scene: {}, camera: 'push_in', fidelity: 'balanced', first_frame: null, last_frame: null, frames_status: 'confirmed', status: 'done', job_id: 'j1', check: null, error: null },
  }

  it('enableShotReplaceItem：source→material+挂块，refs 带六视图缺省（滤非法截 9 张），绑定清零，gen 块保留', () => {
    const out = enableShotReplaceItem(genShot, ['11', '22', 33, -1, Number.NaN])
    expect(out.source).toBe('material')
    expect(out.material_id).toBe(0)
    expect(out.material_path).toBe('')
    expect(out.replace_item).toEqual({ operation: 'replace', ref_ids: [11, 22, 33], object_desc: '' })
    expect(out.gen?.name).toBe('gen_1') // gen 块原样保留（切回可恢复）
    expect(out.gen?.frames_status).toBe('confirmed')
  })

  it('disableShotReplaceItem：剥块+恢复 AI（既有 gen 原样恢复不重建，绑定清零）', () => {
    const enabled = enableShotReplaceItem(genShot, [11])
    const back = disableShotReplaceItem(enabled, [enabled])
    expect(back.replace_item).toBeUndefined()
    expect(back.source).toBe('generate')
    expect(back.gen?.name).toBe('gen_1')
    expect(back.gen?.status).toBe('done')
    expect(back.material_id).toBe(0)
  })

  it('isReplaceShot：material+块=真；纯手动实拍绑定（无块）=假', () => {
    expect(isReplaceShot(enableShotReplaceItem(genShot, [11]))).toBe(true)
    expect(isReplaceShot({ duration: 3, source: 'material', material_id: 42 })).toBe(false)
    expect(isReplaceShot(genShot)).toBe(false)
  })

  it('genBadgeText：换物品镜显示「物品替换」，优先于实拍/AI 态', () => {
    expect(genBadgeText(enableShotReplaceItem(genShot, [11]))).toBe('物品替换')
    expect(genBadgeText({ duration: 3, source: 'material', material_id: 42 })).toBe('实拍')
    expect(genBadgeText(genShot)).toBe('已完成')
  })
})

describe('video_replace 档模式感知（§11-62：第一步缺省档，服务端 worker 按模式路由）', () => {
  const genShot: ImitationShot = {
    duration: 4,
    source: 'generate',
    gen: { backend: 'comfygen', name: 'gen_1', scene: {}, camera: 'push_in', fidelity: 'balanced', first_frame: null, last_frame: null, frames_status: 'pending', status: 'pending', job_id: null, check: null, error: null },
  }
  const doneShot: ImitationShot = { ...genShot, gen: { ...genShot.gen!, status: 'done' } }

  it('shotInReplace：video_replace 档 generate 镜=换物镜（无论有无块）；其余档仅显式块', () => {
    expect(shotInReplace(genShot, 'video_replace')).toBe(true)
    expect(shotInReplace(genShot, 'scene_refs')).toBe(false)
    expect(shotInReplace(enableShotReplaceItem(genShot, [11]), 'scene_refs')).toBe(true)
    expect(shotInReplace({ duration: 3, source: 'material', material_id: 1 }, 'video_replace')).toBe(false)
  })

  it('shotModeBadgeText：档位驱动镜显示「物品替换」，显式块/其余档走 genBadgeText', () => {
    expect(shotModeBadgeText(genShot, 'video_replace')).toBe('物品替换')
    expect(shotModeBadgeText(genShot, 'scene_refs')).toBe('待生成')
    expect(shotModeBadgeText(doneShot, 'video_replace')).toBe('已完成') // done 落回终态显示不被档位覆盖
    expect(shotModeBadgeText(enableShotReplaceItem(genShot, [11]), 'video_replace')).toBe('物品替换')
  })

  it('shotModeBadgeClass：档位驱动镜 mat 灰不冒充 AI 绿；其余档保留 gen 态配色', () => {
    expect(shotModeBadgeClass(genShot, 'video_replace')).toBe('iv-badge--mat')
    expect(shotModeBadgeClass(doneShot, 'video_replace')).toBe('iv-badge--ai') // done 保留完成绿
    expect(shotModeBadgeClass(doneShot, 'scene_refs')).toBe('iv-badge--ai')
    expect(shotModeBadgeClass({ ...doneShot, gen: { ...doneShot.gen!, status: 'failed' } }, 'scene_refs')).toBe('iv-badge--fail')
    expect(shotModeBadgeClass(genShot, 'scene_refs')).toBe('iv-badge--mat')
  })
})

// ── 产品选择回读保留（2026-10-12 用户裁决：接口失败只影响对应结果展示——
//    选择/清除未落库期间，脚本回读不得用服务端旧态覆盖内存产品绑定）──
describe('preserveProductSelectionOnReload', () => {
  const picked = {
    products: [{ brand: '罗技(Logitech)', model: 'G304 黑【910-005286】' }],
    meta: { imitate: { product_selected: true, product_id: '129abc6b981f9315', product_images: ['u1', 'u2'], product_image_ids: [1, 2], product_image_names: ['正面', '顶部'], orig_seeded: true } },
  }

  it('非脏（已落库）→ 原样返回，不做任何合并', () => {
    const data = { meta: { imitate: { product_selected: false } }, products: [] }
    expect(preserveProductSelectionOnReload(picked, data, false)).toBe(data)
    expect(data.meta.imitate.product_selected).toBe(false)
  })

  it('内存为空（首载）→ 不合并', () => {
    const data = { meta: { imitate: {} }, products: [] }
    expect(preserveProductSelectionOnReload(null, data, true)).toBe(data)
  })

  it('脏+已选品+服务端丢绑定（adopt-copy 丢 meta.imitate）→ 整族字段与 products 取内存，他字段仍服务端权威', () => {
    const data = { topic: 't', meta: { imitate: { orig_seeded: true, copy_adopted: true } }, products: [{ brand: '自动提取' }] }
    preserveProductSelectionOnReload(picked, data, true)
    const im = (data.meta as Record<string, any>).imitate
    expect(im.product_selected).toBe(true)
    expect(im.product_id).toBe('129abc6b981f9315')
    expect(im.product_images).toEqual(['u1', 'u2'])
    expect(im.product_image_ids).toEqual([1, 2])
    expect(im.product_image_names).toEqual(['正面', '顶部'])
    expect(im.copy_adopted).toBe(true) // 服务端自有字段不丢
    expect(data.products).toEqual(picked.products)
    expect(data.topic).toBe('t')
  })

  it('脏+已清品+服务端残留旧绑定 → 剥成未选，回读不带出旧产品', () => {
    const prev = { products: [], meta: { imitate: { product_selected: false, product_id: '', product_images: [], product_image_ids: [], product_image_names: [] } } }
    const data = { meta: { imitate: { product_selected: true, product_id: 'old', product_images: ['x'] } }, products: [{ brand: '旧产品' }] }
    preserveProductSelectionOnReload(prev, data, true)
    const im = (data.meta as Record<string, any>).imitate
    expect(im.product_selected).toBe(false)
    expect(im.product_id).toBe('')
    expect(im.product_images).toEqual([])
    expect(data.products).toEqual([])
  })

  it('脏+已选品但内存缺数组字段 → 归位空数组不抛（防御形态）', () => {
    const prev = { products: 'bad', meta: { imitate: { product_selected: true } } }
    const data = { meta: { imitate: {} }, products: [] }
    preserveProductSelectionOnReload(prev, data, true)
    const im = (data.meta as Record<string, any>).imitate
    expect(im.product_selected).toBe(true)
    expect(im.product_images).toEqual([])
    expect(data.products).toEqual([])
  })
})

describe('productChipLabel', () => {
  const products = [{ brand: '罗技(Logitech)', model: 'G304 黑【910-005286】', name: 'G304' }]
  it('未选品=空串（自动提取的 products 不得冒充 chip）', () => {
    expect(productChipLabel(products, false)).toBe('')
  })
  it('品牌/型号去重拼接；缺型号回退 name', () => {
    expect(productChipLabel(products, true)).toBe('罗技(Logitech) / G304 黑【910-005286】')
    expect(productChipLabel([{ brand: '', model: '', name: 'G304' }], true)).toBe('G304')
    expect(productChipLabel([], true)).toBe('')
  })
})

describe('buildScriptPutPayload', () => {
  it('ScriptIn 字段组透传：缺省回填 + shots 逐镜时长钳制 + total_duration 兜底求和', () => {
    const shots = [
      { name: 'shot_01', duration: 99, gen: { name: 'shot_01', status: 'done' } },
      { name: 'shot_02', duration: 0, gen: { name: 'shot_02', status: 'pending' } },
    ] as unknown as ImitationShot[]
    const payload = buildScriptPutPayload({ topic: 't', meta: { imitate: { product_selected: true } } }, shots)
    expect(payload.topic).toBe('t')
    expect((payload.meta as Record<string, unknown>).imitate).toEqual({ product_selected: true })
    expect(payload.products).toEqual([])
    expect(payload.shot_count).toBe(2)
    expect(payload.total_duration).toBe(shotsTotalDuration(shots))
    const put = payload.shots as Array<Record<string, unknown>>
    expect(put[0].duration).toBe(clampDuration(99))
    expect(put[1].duration).toBe(clampDuration(0))
    expect(put[0].gen).toEqual({ name: 'shot_01', status: 'done' }) // gen 原样透传
  })
  it('total_duration 已有值不覆盖', () => {
    expect(buildScriptPutPayload({ total_duration: 12.5 }, []).total_duration).toBe(12.5)
  })
})

describe('shotProgressPercent', () => {
  it('有逐镜计数：完成比优先（3/6→50%，封顶 100）', () => {
    expect(shotProgressPercent(3, 6, 0)).toBe(50)
    expect(shotProgressPercent(6, 6, 0)).toBe(100)
    expect(shotProgressPercent(7, 6, 0)).toBe(100)
  })
  it('无计数（done=0）：回落服务端 %（-1=不定态透传）', () => {
    expect(shotProgressPercent(0, 6, -1)).toBe(-1)
    expect(shotProgressPercent(0, 6, 0)).toBe(0)
    expect(shotProgressPercent(0, 0, 40)).toBe(40)
  })
})

describe('shotHealNeeded', () => {
  const gen = (name: string, patch: Record<string, unknown>) => ({ source: 'generate', name, gen: { name, ...patch } } as unknown as ImitationShot)
  it('done 阶段：粗稿/回填缺失镜存在才自愈（storyboard/videos 分支）', () => {
    const shots = [gen('shot_01', { status: 'done' }), gen('shot_02', {})]
    expect(shotHealNeeded('done', 'storyboard', shots)).toBe(true)
    expect(shotHealNeeded('done', 'videos', shots)).toBe(true)
  })
  it('齐全/失败镜/非 done：不自愈（真失败镜有 failed 不触发）', () => {
    const ok = [gen('shot_01', { status: 'done', draft_status: 'generated', draft_first: 'x' })]
    expect(shotHealNeeded('done', 'storyboard', ok)).toBe(false)
    expect(shotHealNeeded('running', 'storyboard', ok)).toBe(false)
    const failed = [gen('shot_01', { status: 'failed' })]
    expect(shotHealNeeded('done', 'videos', failed)).toBe(false)
  })
})
