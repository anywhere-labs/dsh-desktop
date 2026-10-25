// 欠装补片/检测纯函数回归（2026-09-30 用户裁决 A+B：「先智能匹配、后克隆声音」时序下
// 镜标按旁白等比放大，旧绑定组全长不足新目标——生成剪辑方案前自动补片 +
// 克隆完成后欠装提示）。场景取自当日实测：9 段 4s 素材、镜标 [4,5,3]、旁白放大 1.265。
import { describe, expect, it } from 'vitest'
import { planShotGroup, topUpClipGroups, underfillAfterVoice, voiceScaleOf } from '../src/composables/copywritingMontageAssignLogic'
import type { SplitSceneRow } from '../src/composables/copywritingMontageStep1SplitLogic'
import type { AssignPoolItem } from '../src/composables/copywritingMontageStep2ConcatLogic'

const row = (idx: number, duration: number): SplitSceneRow =>
  ({ idx, name: `s${idx}`, sourceName: `s${idx}`, startSec: 0, endSec: duration, duration }) as unknown as SplitSceneRow
const pool = (...rows: SplitSceneRow[]): AssignPoolItem[] => rows.map((r, i) => ({ key: `k${i}`, scene: r }))

describe('voiceScaleOf / underfillAfterVoice / topUpClipGroups', () => {
  it('voiceScaleOf：旁白/镜标和的比例，clamp 与缺省', () => {
    expect(voiceScaleOf(67.04, 53)).toBeCloseTo(1.265, 2)
    expect(voiceScaleOf(0, 53)).toBe(1)
    expect(voiceScaleOf(53 * 5, 53)).toBe(4)
    expect(voiceScaleOf(10, 53)).toBeCloseTo(0.2, 5)
  })

  it('underfillAfterVoice：放大后全长不足的镜数与差值（实测场景 4s 池）', () => {
    const p = pool(row(1, 4), row(2, 4), row(3, 4))
    const shots = [{ duration: 4 }, { duration: 5 }, { duration: 3 }]
    // 旁白 = 12×1.265 = 15.18 → 目标 [5.06, 6.33, 3.79]；绑定各 1 段 4s
    const u = underfillAfterVoice(shots, [[1], [2], [3]], p, 15.18)
    expect(u.shotsShort).toBe(2) // 5.06 与 6.33 的镜欠装；3.79×全 4s 够
    expect(u.deficitSec).toBeCloseTo(1.06 + 2.33, 1)
    // 无旁白（scale=1）：4/3 目标均被 4s 覆盖，仅 5s 镜欠 1s
    const u2 = underfillAfterVoice(shots, [[1], [2], [3]], p, 0)
    expect(u2.shotsShort).toBe(1)
    expect(u2.deficitSec).toBeCloseTo(1, 5)
  })

  it('topUpClipGroups：欠装组按预筛追加、组内去重、满装不动、池耗尽即止', () => {
    const p = pool(row(1, 4), row(2, 4), row(3, 4))
    const shots = [{ duration: 4 }, { duration: 5 }]
    // 目标 [5.06, 6.33]；绑定 [[1],[2]] → 两组都需各补 1 段（非本组内行）
    const r = topUpClipGroups(shots, [[1], [2]], p, 11.385)
    expect(r.appendedTotal).toBe(2)
    expect(r.appendedByShot).toEqual([1, 1])
    expect(r.groups[0]!.length).toBe(2)
    expect(r.groups[0]![0]).toBe(1)
    expect(new Set(r.groups[0]).size).toBe(2) // 组内不重复
    expect(new Set(r.groups[1]).size).toBe(2)
    // 满装组（全长 ≥ 目标）不追加
    const r2 = topUpClipGroups([{ duration: 3 }], [[1, 2]], p, 0)
    expect(r2.appendedTotal).toBe(0)
    expect(r2.groups).toEqual([[1, 2]])
    // 池耗尽：单行池、绑定即该行 → 无可补，保持欠装（欠装明示口径不变）
    const p1 = pool(row(9, 4))
    const r3 = topUpClipGroups([{ duration: 4 }], [[9]], p1, 5.06 * 0 + 11.385)
    expect(r3.appendedTotal).toBe(0)
    expect(r3.groups).toEqual([[9]])
  })
})

// ── 2026-09-30 用户裁决（防重复）：装填/补片按跨镜使用计数优先未用片段 ──
describe('planShotGroup / topUpClipGroups 使用计数防重复', () => {
  const p = pool(
    row(1, 4), row(2, 4), row(3, 4), row(4, 4), row(5, 4),
  )
  const shot = { duration: 8 } as never

  it('planShotGroup：补片按 usage 升序取用（同数保持预筛排名序）', () => {
    const noUsage = planShotGroup(shot, 1, p)
    expect(noUsage.idxs).toEqual([1, 2]) // 无计数：预筛排名 idx 升序
    const withUsage = planShotGroup(shot, 1, p, { usage: new Map([[2, 1]]) })
    expect(withUsage.idxs).toEqual([1, 3]) // 2 已被其它镜用过 → 取未用的 3
    // 池内未用耗尽 → 允许复用已用片段（欠装兜底语义不变）
    const m = new Map([[2, 1], [3, 1], [4, 1], [5, 1]])
    const reused = planShotGroup(shot, 1, p, { usage: m })
    expect(reused.idxs.length).toBe(2)
    expect(reused.sealed).toBe(true)
  })

  it('topUpClipGroups：追加按既有跨镜成员计数降级已用片段', () => {
    // 既有组：1/2 各出现 2 次、3 出现 1 次、4 未用；每镜 target 10s（8s 不足）各补 1 段
    const shots = [{ duration: 10 }, { duration: 10 }, { duration: 10 }]
    const r = topUpClipGroups(shots, [[1, 2], [1, 3], [1, 2]], pool(row(1, 4), row(2, 4), row(3, 4), row(4, 4)), 30)
    expect(r.appendedByShot).toEqual([1, 1, 1])
    // 追加不再撞已高频使用的 1/2：镜1/镜2 取未用的 4，镜3 取使用最少的 3
    expect(r.groups[0]).toContain(4)
    expect(r.groups[1]).toContain(4)
    expect(r.groups[2]).toContain(3)
    expect(r.groups[0]).not.toContain(3)
    expect(r.groups[1]).not.toContain(2)
    expect(r.groups[2]).not.toContain(4)
  })
})

// ── 2026-10-21 实机：5.166667 秒片段被四舍五入成 5.17，导出 film.html 的
//    #t=0,5.17 越过文件长度，OpenFilm Studio 拒绝绘制整条预览 ──
describe('planShotGroup 时长不越过片段全长', () => {
  it('小数时长向下取整（5.166667 → 5.16），不产生 5.17', () => {
    const p = pool(row(1, 5.166667), row(2, 4))
    const r = planShotGroup({ duration: 30 } as never, 1, p)
    expect(r.useDurs[0]).toBeCloseTo(5.16, 2)
    expect(r.useDurs.every((d) => d <= 5.166667 + 1e-9)).toBe(true)
  })

  it('整百分位时长原样保留（5.16 不被浮点误差误减成 5.15）', () => {
    const p = pool(row(1, 5.16), row(2, 4))
    const r = planShotGroup({ duration: 30 } as never, 1, p)
    expect(r.useDurs[0]).toBe(5.16)
  })
})
