import { expect, it } from 'vitest'
import { DesktopHostStartupTimeoutError, hostStartupLimitTitle, hostStartupTimeoutFromId, hostStartupTimeoutLabel, isDesktopStartupEntry,
  isHostStartupTimeout, startupEntriesSection, startupEntriesSummary, startupNoticeCopy, type DesktopStartupEntry } from '../src/host-startup-limit.ts'

const mcp: DesktopStartupEntry = { id: 'magpie-mcp-deepwiki', name: '@deepseek-ai/dsh-mcp-client', phase: 'starting', waitedMs: 46_700 }

it('accepts whole seconds from 60 through 600 or no limit, and reads the recovery link ids', () => {
  for (const value of [60, 120, 200, 600, 'none']) expect(isHostStartupTimeout(value)).toBe(true)
  for (const value of [59, 601, 90.5, 0, -60, '120', null, undefined, Infinity, 'unlimited']) expect(isHostStartupTimeout(value)).toBe(false)
  expect(hostStartupTimeoutFromId('180')).toBe(180)
  expect(hostStartupTimeoutFromId('none')).toBe('none')
  for (const id of ['30', '1e3', ' 120', '601', '', undefined, 180]) expect(() => hostStartupTimeoutFromId(id)).toThrow('Invalid Host startup limit')
  expect([60, 180, 'none'].map(value => hostStartupTimeoutLabel(value as 60 | 180 | 'none', true))).toEqual(['60 秒（默认）', '180 秒', '不限时'])
  expect([600, 'none'].map(value => hostStartupTimeoutLabel(value as 600 | 'none', false))).toEqual(['600 seconds', 'No limit'])
  expect([hostStartupLimitTitle(true), hostStartupLimitTitle(false)]).toEqual(['插件服务（Host）启动时限', 'Plugin service (Host) startup limit'])
})

it('names what a slow start still loads in the failure text and the report', () => {
  expect(new DesktopHostStartupTimeoutError(60, [mcp]).message)
    .toBe('Host startup exceeded 60 seconds\nStill loading: magpie-mcp-deepwiki (@deepseek-ai/dsh-mcp-client, starting, 47 s).')
  const many = ['a', 'b', 'c', 'd', 'e'].map(id => ({ ...mcp, id, phase: 'importing' as const }))
  expect(startupEntriesSummary(many)).toBe('Still loading: a (@deepseek-ai/dsh-mcp-client, importing, 47 s), b (@deepseek-ai/dsh-mcp-client, importing, 47 s), '
    + 'c (@deepseek-ai/dsh-mcp-client, importing, 47 s) and 2 more.')
  expect(startupEntriesSummary([])).toBe('Every plugin had finished loading; the Host was completing its own startup.')
  expect(new DesktopHostStartupTimeoutError(120, undefined).message).toBe('Host startup exceeded 120 seconds\nThe Host did not say which plugins were still loading.')
  // Why the Host did not say tells a busy Host from one that has not reached its plugins yet.
  expect(new DesktopHostStartupTimeoutError(60, undefined, 'Startup entry query timed out').message)
    .toBe('Host startup exceeded 60 seconds\nThe Host did not say which plugins were still loading (Startup entry query timed out).')
  expect(startupEntriesSection({ seconds: 120, pending: [mcp] })).toEqual([
    '--- plugins still loading at the 120-second startup limit ---',
    'magpie-mcp-deepwiki (@deepseek-ai/dsh-mcp-client): starting, 47 s since the Host created it',
  ])
  expect(startupEntriesSection({ seconds: 60 })).toEqual(['--- plugins still loading at the 60-second startup limit ---', '(the Host did not answer)'])
  expect(startupEntriesSection({ seconds: 60, unanswered: 'The Host has not started loading plugins yet' }))
    .toEqual(['--- plugins still loading at the 60-second startup limit ---', '(the Host did not answer: The Host has not started loading plugins yet)'])
})

it('validates every entry field a Host answer carries', () => {
  expect(isDesktopStartupEntry(mcp)).toBe(true)
  for (const entry of [{ ...mcp, phase: 'active' }, { ...mcp, waitedMs: -1 }, { ...mcp, waitedMs: Number.NaN }, { ...mcp, id: 7 },
    { ...mcp, name: 'x'.repeat(257) }, null, 'magpie']) expect(isDesktopStartupEntry(entry)).toBe(false)
})

it('tells where the recovery assistant is on each platform', () => {
  const notice = { limit: 180, pending: [mcp, { ...mcp, id: 'figma' }, { ...mcp, id: 'linear' }] } as const
  expect(startupNoticeCopy(notice, 'zh-CN', 'win32', true)).toEqual({ title: 'DSH Desktop Beta 仍在启动',
    body: '插件服务启动已超过 1 分钟，时限为 180 秒。仍在加载 magpie-mcp-deepwiki、figma 等 3 个插件。如需排查，可从托盘图标（可能收在任务栏的隐藏图标中）打开恢复助手。' })
  expect(startupNoticeCopy({ limit: 'none', pending: undefined }, 'en', 'darwin', true)).toEqual({ title: 'DSH Desktop Beta is still starting',
    body: 'The plugin service has been starting for over a minute. To investigate, open the recovery assistant from the menu bar icon or the DSH Desktop Beta menu.' })
  expect(startupNoticeCopy({ limit: 300, pending: [mcp] }, 'en', 'linux', false).body)
    .toBe('The plugin service has been starting for over a minute (limit: 300 seconds). Still loading magpie-mcp-deepwiki.')
})
