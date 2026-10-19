// composeEmbedBounds 回归（2026-10-19 方案 4 内嵌模式）：外层=chrome 容器矩形
// （主窗内容坐标），内层=页面 #view-host 矩形（页面视图内坐标）；两层合成=平台
// 分区视图在主窗 contentView 的 setBounds 入参，宽高按外层余量截断防溢出。
import { describe, expect, it } from 'vitest'
import { composeEmbedBounds } from '../src/browser/browser-service.ts'

describe('composeEmbedBounds 两层矩形合成', () => {
  it('外层原点 + 内层偏移；宽高原样通过', () => {
    expect(composeEmbedBounds(
      { x: 280, y: 40, width: 1200, height: 800 },
      { x: 16, y: 56, width: 1168, height: 736 },
    )).toEqual({ x: 296, y: 96, width: 1168, height: 736 })
  })
  it('内层宽高超外层余量时截断（页面侧栏占位导致的溢出防御）', () => {
    expect(composeEmbedBounds(
      { x: 0, y: 0, width: 800, height: 600 },
      { x: 100, y: 50, width: 900, height: 700 },
    )).toEqual({ x: 100, y: 50, width: 700, height: 550 })
  })
  it('负值/非有限数钳为 0（畸形上报防御）', () => {
    expect(composeEmbedBounds(
      { x: -5, y: Number.NaN, width: 800, height: 600 },
      { x: -3, y: 10, width: -20, height: 300 },
    )).toEqual({ x: 0, y: 10, width: 0, height: 300 })
  })
  it('整数舍入（getBoundingClientRect 可返回小数）', () => {
    expect(composeEmbedBounds(
      { x: 280.6, y: 40.2, width: 1200.4, height: 800.6 },
      { x: 16.3, y: 56.7, width: 1168.9, height: 736.1 },
    )).toEqual({ x: 297, y: 97, width: 1169, height: 736 })
  })
})
