import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecoveryFailureDetails, RecoveryTerminalAction } from '../src/native-ui/recovery/App.tsx'
import { desktopRecoveryCopy } from '../src/recovery-copy.ts'

describe('Recovery native terminal action', () => {
  it('places the optional contact action before Terminal without attaching logs', () => {
    const markup = renderToStaticMarkup(createElement(RecoveryTerminalAction, {
      copy: desktopRecoveryCopy('zh'), search: '?frame=true&platform=darwin',
      support: { href: 'https://github.com/anywhere-labs/dsh-desktop/issues', label: '联系我们', hint: '提供完整报错' },
    }))
    expect(markup).toContain('href="https://github.com/anywhere-labs/dsh-desktop/issues"')
    expect(markup.indexOf('联系我们')).toBeLessThan(markup.indexOf('打开 DSH 终端'))
  })

  it('does not invent a title-row action without Desktop frame controls', () => {
    const copy = desktopRecoveryCopy('en')
    expect(renderToStaticMarkup(createElement(RecoveryTerminalAction, {
      copy,
      search: '?frame=false&platform=darwin',
    }))).toBe('')
    expect(renderToStaticMarkup(createElement(RecoveryTerminalAction, {
      copy,
      search: '?frame=true&platform=linux',
    }))).toBe('')
  })
})

it('keeps complete failure evidence in an initially collapsed, selectable disclosure', () => {
  const detail = 'Original error\nCaused by: missing provider\nRetry 1\n<unsafe-plugin>'
  const markup = renderToStaticMarkup(createElement(RecoveryFailureDetails, { locale: 'zh', detail }))
  expect(markup).toContain('完整错误与日志')
  expect(markup).toContain('复制详情')
  expect(markup).toContain('<details ')
  expect(markup).not.toMatch(/<details\b[^>]*\bopen(?:[=\s>])/u)
  expect(markup).toContain('Caused by: missing provider')
  expect(markup).toContain('Retry 1')
  expect(markup).toContain('&lt;unsafe-plugin&gt;')
})
