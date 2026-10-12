import { expect, it } from 'vitest'
import { recoverySupport } from '../src/recovery-support.ts'

it('links to the project issue page without automatically attaching diagnostic data', () => {
  for (const locale of ['zh', 'en'] as const) {
    const support = recoverySupport(locale)
    expect(support.href).toBe('https://github.com/anywhere-labs/dsh-desktop/issues')
    expect(support.hint).toMatch(locale === 'zh' ? /完整报错.*日志.*敏感信息/u : /full error.*logs.*sensitive information/u)
  }
  expect(recoverySupport('zh').label).toBe('联系我们')
})
