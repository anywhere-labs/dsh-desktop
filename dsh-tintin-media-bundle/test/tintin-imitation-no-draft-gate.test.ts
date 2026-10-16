// test/tintin-imitation-no-draft-gate.test.ts — 仿视频九宫格人工确认退役回归
// （2026-10-16 用户裁决：删除生成九宫格图功能；原阶段①九宫格确认删除、原阶段②
// 高清首尾帧升为阶段①；第 2→3 步不再经过九宫格确认——粗稿任务由父组件自动
// 确认并自动续跑高清首尾帧）。
//
// 静态源码断言锁住该契约：九宫格 UI 入口不得回潜（人工按钮/下载/重新生成/
// 提示词列表），阶段编号不得回退，父组件必须保留 autoConfirmDraft 自动链。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const genSteps = readFileSync(new URL('../src/components/media-tools/ImitationGenSteps.vue', import.meta.url), 'utf8')
const parent = readFileSync(new URL('../src/components/media-tools/ImitationVideo.vue', import.meta.url), 'utf8')

describe('仿视频九宫格人工确认退役', () => {
  it('第 3 步面板不再有九宫格卡/人工确认/下载/重新生成/提示词列表入口', () => {
    for (const banned of [
      '确认九宫粗稿',
      '重新生成九宫格图',
      '下载九宫格图',
      '九宫格提示词',
      'draftGateText',
      'draftGateVisible',
      'confirm-draft',
      'regen-storyboard',
    ]) {
      expect(genSteps).not.toContain(banned)
    }
  })

  it('首尾帧阶段标为阶段①（原阶段②升位，模板不残留阶段②）', () => {
    expect(genSteps).toContain('阶段① 已确认')
    // 只查模板段（script 头注里允许出现「阶段②」的历史说明）
    const template = genSteps.slice(genSteps.indexOf('<template>'))
    expect(template).not.toContain('阶段②')
  })

  it('父组件保留粗稿自动确认→自动续跑高清首尾帧的链路', () => {
    expect(parent).toContain('async function autoConfirmDraft')
    expect(parent).toContain('iv.confirmDraft(scriptId.value)')
    expect(parent).toContain('startFramesSubmission')
    expect(parent).not.toContain('@regen-storyboard')
    expect(parent).not.toContain('@confirm-draft')
    expect(parent).not.toContain('confirmDraftAndSubmitVideos')
  })
})
