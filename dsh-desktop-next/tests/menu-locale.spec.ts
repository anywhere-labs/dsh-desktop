import { expect, it, vi } from 'vitest'
import { preferredDesktopLocale, resolveDesktopLocale, roleApplicationMenuTemplate } from '../src/menu-locale.ts'

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
    { label: 'DSH NEXT', submenu: [{ label: 'App' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ])
  vi.restoreAllMocks()
})

it('expands bilingual role menus on Linux', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  const template = roleApplicationMenuTemplate([{ label: '应用' }], 'zh-CN')
  expect(template[0]).toEqual({ label: 'DSH NEXT', submenu: [{ label: '应用' }] })
  const [, edit, view, window] = template as Array<{ label?: string; submenu?: Array<{ role?: string; label?: string }> }>
  expect(edit.label).toBe('编辑')
  expect(edit.submenu).toContainEqual({ role: 'undo', label: '撤销' })
  expect(edit.submenu).toContainEqual({ role: 'selectAll', label: '全选' })
  expect(view.label).toBe('查看')
  expect(view.submenu).toContainEqual({ role: 'reload', label: '重新加载' })
  expect(view.submenu).toContainEqual({ role: 'togglefullscreen', label: '切换全屏' })
  expect(window.label).toBe('窗口')
  expect(window.submenu).toContainEqual({ role: 'minimize', label: '最小化' })
  expect(window.submenu).toContainEqual({ role: 'close', label: '关闭' })
  vi.restoreAllMocks()
})

it('keeps English role menus on Linux when the language is English', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  const [, edit] = roleApplicationMenuTemplate([], 'en-US') as Array<{ label?: string; submenu?: Array<{ role?: string; label?: string }> }>
  expect(edit.label).toBe('Edit')
  expect(edit.submenu).toContainEqual({ role: 'undo', label: 'Undo' })
  vi.restoreAllMocks()
})

it('exposes view and window strings alongside the edit copy', () => {
  expect(resolveDesktopLocale('zh-CN').messages).toMatchObject({ edit: '编辑', view: '查看', window: '窗口', reload: '重新加载' })
  expect(resolveDesktopLocale('en-US').messages).toMatchObject({ edit: 'Edit', view: 'View', window: 'Window', reload: 'Reload' })
})
