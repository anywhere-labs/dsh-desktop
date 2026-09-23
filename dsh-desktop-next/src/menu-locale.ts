/** Built-in Desktop languages and the native-menu copy. */
const en = { application: 'Application', edit: 'Edit', menuBar: 'Application menu',
  undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', delete: 'Delete', selectAll: 'Select All' }
const zh: typeof en = { application: '应用', edit: '编辑', menuBar: '应用菜单',
  undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', delete: '删除', selectAll: '全选' }

/** Follow the OS preference order, using the same primary-language match as the official frontend. */
export function preferredDesktopLocale(languages: readonly string[]): 'zh' | 'en' {
  for (const language of languages) {
    const primary = language.toLowerCase().replaceAll('_', '-').split('-')[0]
    if (primary === 'zh' || primary === 'en') return primary
  }
  return 'en'
}

export function resolveDesktopLocale(language: string) {
  return { messages: language.toLowerCase().startsWith('zh') ? zh : en }
}
