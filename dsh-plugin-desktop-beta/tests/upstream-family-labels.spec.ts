import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { OFFICIAL_PLUGIN_INDEX } from '../src/upstream-family-labels.ts'

const require = createRequire(import.meta.url)
const meta = (locale: 'zh' | 'en'): { title?: unknown; description?: unknown } => JSON.parse(readFileSync(
  require.resolve(`@deepseek-ai/dsh-experimental-plugin-market-bundle/locale/${locale}.json`), 'utf8')).meta
// Releases before 0.2.2 still call the bundle a plugin market; Desktop shows the 0.2.2 name ahead of them.
const BEFORE_0_2_2 = { zh: '自定义插件市场', en: 'Custom plugin markets' }

it('names the official plugin index bundle exactly as the installed release does from 0.2.2 on', () => {
  for (const locale of ['zh', 'en'] as const) {
    if (meta(locale).title === BEFORE_0_2_2[locale]) continue
    expect(meta(locale).title, locale).toBe(OFFICIAL_PLUGIN_INDEX.title[locale])
    expect(meta(locale).description, locale).toBe(OFFICIAL_PLUGIN_INDEX.description[locale])
  }
})
