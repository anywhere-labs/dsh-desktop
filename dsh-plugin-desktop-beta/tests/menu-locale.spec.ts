import { afterEach, expect, it, vi } from 'vitest'
import { preferredDesktopLocale, resolveDesktopLocale, roleApplicationMenuTemplate } from '../src/menu-locale.ts'

// Restore the mocked `process.platform` even when an assertion fails, so later specs see the real one.
afterEach(() => { vi.restoreAllMocks() })

it.each([
  [['zh-Hans-CN', 'en-US'], 'zh'], [['zh-Hant-TW'], 'zh'], [['zh_CN'], 'zh'],
  [['en-GB', 'zh-CN'], 'en'], [['ja-JP', 'zh-CN', 'en-US'], 'zh'], [['fr-FR'], 'en'], [[], 'en'],
] as const)('chooses a supported language from %j in preference order', (languages, expected) => {
  expect(preferredDesktopLocale(languages)).toBe(expected)
})

it('keeps bare role menus when the platform is not Linux', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  const template = roleApplicationMenuTemplate([{ label: 'App' }], 'zh-CN')
  expect(template).toEqual([
    { label: 'DSH Desktop Beta', submenu: [{ label: 'App' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ])
})

it('expands bilingual role menus on Linux', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  expect(roleApplicationMenuTemplate([{ label: '应用' }], 'zh-CN')).toMatchObject([
    { label: 'DSH Desktop Beta', submenu: [{ label: '应用' }] },
    { label: '编辑', submenu: expect.arrayContaining([{ role: 'undo', label: '撤销' }, { role: 'selectAll', label: '全选' }]) },
    { label: '查看', submenu: expect.arrayContaining([{ role: 'reload', label: '重新加载' }, { role: 'togglefullscreen', label: '切换全屏' }]) },
    { label: '窗口', submenu: expect.arrayContaining([{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭' }]) },
  ])
})

it('keeps English role menus on Linux when the language is English', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  expect(roleApplicationMenuTemplate([], 'en-US')[1]).toMatchObject({
    label: 'Edit', submenu: expect.arrayContaining([{ role: 'undo', label: 'Undo' }]),
  })
})

it('exposes view and window strings alongside the edit copy', () => {
  expect(resolveDesktopLocale('zh-CN').messages).toMatchObject({ edit: '编辑', view: '查看', window: '窗口', reload: '重新加载' })
  expect(resolveDesktopLocale('en-US').messages).toMatchObject({ edit: 'Edit', view: 'View', window: 'Window', reload: 'Reload' })
})
