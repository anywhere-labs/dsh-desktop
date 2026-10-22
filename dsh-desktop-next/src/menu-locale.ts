/** Built-in Desktop languages and the native-menu copy. */
const en = { application: 'Application', edit: 'Edit', menuBar: 'Application menu',
  undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', delete: 'Delete', selectAll: 'Select All',
  view: 'View', reload: 'Reload', forceReload: 'Force Reload', toggleDevTools: 'Toggle Developer Tools',
  actualSize: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', toggleFullScreen: 'Toggle Full Screen',
  window: 'Window', minimize: 'Minimize', close: 'Close' }
const zh: typeof en = { application: '应用', edit: '编辑', menuBar: '应用菜单',
  undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', delete: '删除', selectAll: '全选',
  view: '查看', reload: '重新加载', forceReload: '强制重新加载', toggleDevTools: '切换开发者工具',
  actualSize: '实际大小', zoomIn: '放大', zoomOut: '缩小', toggleFullScreen: '切换全屏',
  window: '窗口', minimize: '最小化', close: '关闭' }

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

/**
 * Application-menu bars that Electron only localizes on macOS. On Linux the bare
 * `role` menus stay English, so expand them with the same bilingual copy Windows
 * already uses; macOS keeps the roles and the system-owned translations.
 */
export function roleApplicationMenuTemplate(appItems: import('electron').MenuItemConstructorOptions[], language: string): import('electron').MenuItemConstructorOptions[] {
  const { messages: m } = resolveDesktopLocale(language)
  return [
    { label: 'DSH NEXT', submenu: appItems },
    ...(process.platform === 'linux' ? [
      { label: m.edit, submenu: [
        { role: 'undo', label: m.undo }, { role: 'redo', label: m.redo },
        { type: 'separator' as const },
        { role: 'cut', label: m.cut }, { role: 'copy', label: m.copy }, { role: 'paste', label: m.paste },
        { role: 'delete', label: m.delete },
        { type: 'separator' as const }, { role: 'selectAll', label: m.selectAll },
      ] },
      { label: m.view, submenu: [
        { role: 'reload', label: m.reload }, { role: 'forceReload', label: m.forceReload },
        { role: 'toggleDevTools', label: m.toggleDevTools },
        { type: 'separator' as const },
        { role: 'resetZoom', label: m.actualSize }, { role: 'zoomIn', label: m.zoomIn }, { role: 'zoomOut', label: m.zoomOut },
        { type: 'separator' as const }, { role: 'togglefullscreen', label: m.toggleFullScreen },
      ] },
      { label: m.window, submenu: [
        { role: 'minimize', label: m.minimize }, { role: 'close', label: m.close },
      ] },
    ] : [
      { role: 'editMenu' as const }, { role: 'viewMenu' as const }, { role: 'windowMenu' as const },
    ]),
  ]
}
