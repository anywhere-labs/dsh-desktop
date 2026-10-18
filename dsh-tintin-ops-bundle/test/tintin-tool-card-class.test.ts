// test/tintin-tool-card-class.test.ts — 工具卡拉链卡回归（2026-10-16 用户报障）
//
// 报障一（白底白字）：媒体/运营工具卡的 accent 渐变只在焦点/悬停时出现，基础态是
// 白底 + 灰边，卡内白字因此不可见。根因是 CSS 级联而不是数值：卡片的 scoped 规则
// `.card[data-v-x]`（特异性 0,2,0）与移植兼容层 `.tintin-media-scope .card`
// （见 styles/tintin-global.css，把旧 `.card` 类映射到 luo-card 白底外观）特异性
// 相同，而兼容层在合并后的样式表里更靠后，因此基础态被它覆盖；只有 `:hover`/
// `:focus-visible` 多一个伪类（0,3,0）才盖得回渐变——于是「只有点到的卡有颜色」。
// 修法：工具卡不再使用被兼容层接管的 `.card` 类名。
//
// 报障二（图片带残留色块 / 底色太艳）：图标自身带 accent 色块，卡片看起来有第三层
// 颜色；用户要求「卡片只有底色 + 图片两层」「底色再浅、饱和度不要这么高」，于是图标
// 去掉内联色块，底色改为「罩层 + 渐变」两层叠加，标题与图片底部对齐。
//
// 这条静态断言锁住以上契约：一旦有人把类名改回 `.card`、把色块加回图标，或去掉
// 罩层/底部对齐，这里立刻变红，而不是等到用户看到白底白字或色块才发现。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appVue = readFileSync(new URL('../../dsh-tintin-media-bundle/src/App.vue', import.meta.url), 'utf8')
const opsAppVue = readFileSync(new URL('../src/OpsApp.vue', import.meta.url), 'utf8')
const globalCss = readFileSync(new URL('../src/styles/tintin-global.css', import.meta.url), 'utf8')

describe('工具卡外观契约（浅底常驻 + 两层 + 底部对齐）', () => {
  it('兼容层确实还接管着旧 .card（本回归的前提）', () => {
    expect(globalCss).toContain('.tintin-media-scope .card {')
  })

  for (const [name, source] of [['App.vue（媒体工具）', appVue], ['OpsApp.vue（运营工具）', opsAppVue]] as const) {
    it(`${name}：工具卡用 tool-card 类名，不用被兼容层接管的 card`, () => {
      expect(source).toContain('class="tool-card"')
      expect(source).not.toContain('class="card"')
    })

    it(`${name}：基础态=罩层 + accent 渐变、无边框（不是只有焦点才有颜色）`, () => {
      const block = /\.tool-card\s*\{([\s\S]*?)\}/u.exec(source)?.[1] ?? ''
      expect(block).toContain('background-image: linear-gradient(var(--tool-card-wash), var(--tool-card-wash)), var(--card-accent')
      expect(block).toContain('border: none')
      // 暗色主题必须有对应罩层，否则暗底会被白罩漂白
      expect(source).toContain('.dark .tool-card { --tool-card-wash:')
      // 渐变必须挂在类规则上，不能只在 hover 规则里出现
      expect(/\.tool-card:hover\s*\{/u.test(source)).toBe(true)
    })

    it(`${name}：图片自身透明——卡片只有底色 + 图片两层`, () => {
      expect(source).toContain('<div class="icon"><span>{{ t.emoji }}</span></div>')
      expect(source).not.toContain(':style="{ background: t.accent }"')
    })

    it(`${name}：标题与图片底部对齐`, () => {
      const block = /\.card-top\s*\{([\s\S]*?)\}/u.exec(source)?.[1] ?? ''
      expect(block).toContain('align-items: flex-end')
    })
  }
})
