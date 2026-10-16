// test/tintin-tool-card-class.test.ts — 工具卡拉链卡回归（2026-10-16 用户报障）
//
// 报障：媒体/运营工具卡的 accent 渐变只在焦点/悬停时出现，基础态是白底 +
// 灰边，卡内白字因此不可见（"每个卡片默认都要有颜色背景"）。
//
// 根因是 CSS 级联而不是数值：卡片的 scoped 规则 `.card[data-v-x]`（特异性
// 0,2,0）与移植兼容层 `.tintin-media-scope .card`（见 styles/tintin-global.css，
// 把旧 `.card` 类映射到 luo-card 白底外观）特异性相同，而兼容层在合并后的
// 样式表里更靠后，因此基础态被它覆盖；只有 `:hover`/`:focus-visible` 多一个
// 伪类（0,3,0）才盖得回渐变——于是"只有点到的卡有颜色"。
//
// 修法是让工具卡不再使用被兼容层接管的 `.card` 类名。这条静态断言锁住该
// 契约：一旦有人把类名改回 `.card`（或给兼容层再加同类映射），这里立刻变红，
// 而不是等到用户看到白底白字。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appVue = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const opsAppVue = readFileSync(new URL('../src/OpsApp.vue', import.meta.url), 'utf8')
const globalCss = readFileSync(new URL('../src/styles/tintin-global.css', import.meta.url), 'utf8')

describe('工具卡拉链卡外观（accent 渐变常驻）', () => {
  it('兼容层确实还接管着旧 .card（本回归的前提）', () => {
    expect(globalCss).toContain('.tintin-media-scope .card {')
  })

  for (const [name, source] of [['App.vue（媒体工具）', appVue], ['OpsApp.vue（运营工具）', opsAppVue]] as const) {
    it(`${name}：工具卡用 tool-card 类名，不用被兼容层接管的 card`, () => {
      expect(source).toContain('class="tool-card"')
      expect(source).not.toContain('class="card"')
    })

    it(`${name}：基础态就带 accent 渐变、无边框（不是只有焦点才有颜色）`, () => {
      const block = /\.tool-card\s*\{([\s\S]*?)\}/u.exec(source)?.[1] ?? ''
      expect(block).toContain('background-image: var(--card-accent, none)')
      expect(block).toContain('border: none')
      // 渐变必须挂在类规则上，不能只在 hover 规则里出现
      expect(/\.tool-card:hover\s*\{/u.test(source)).toBe(true)
    })
  }
})
