import { expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: 'button' }))
import { desktopTranslate } from '../src/client/settings.tsx'

it('titles the settings page with the channel name instead of the shared Desktop copy', () => {
  expect(desktopTranslate('zh-CN')('title')).toBe('DSH NEXT 设置')
  expect(desktopTranslate('en')('title')).toBe('DSH NEXT settings')
})
