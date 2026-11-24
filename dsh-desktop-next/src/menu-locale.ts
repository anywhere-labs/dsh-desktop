import type { MenuItemConstructorOptions } from 'electron'

/**
 * Built-in Desktop languages: the native-menu copy, and the quit confirmation in upstream Desktop's words with
 * this product's name, plus the question and button of the confirmations before a restart and an update.
 */
const en = { application: 'Application', edit: 'Edit', menuBar: 'Application menu',
  undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', delete: 'Delete', selectAll: 'Select All',
  view: 'View', reload: 'Reload', forceReload: 'Force Reload', toggleDevTools: 'Toggle Developer Tools',
  actualSize: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', toggleFullScreen: 'Toggle Full Screen',
  window: 'Window', minimize: 'Minimize', close: 'Close',
  aboutProduct: 'DSH NEXT', quit: 'Quit', cancel: 'Cancel', quitTitle: 'Quit DSH NEXT?',
  quitActiveTasks: 'Running tasks will be interrupted.',
  quitScheduledTasks: 'Scheduled tasks will not run while the app is closed.',
  quitActiveAndScheduledTasks: 'Running tasks will be interrupted, and scheduled tasks will not run while the app is closed.',
  quitAndRestart: 'Quit and Restart', quitAndRestartTitle: 'Quit and restart DSH NEXT?',
  installAndRestart: 'Install and Restart', installAndRestartTitle: 'Install the update and restart DSH NEXT?' }
const zh: typeof en = { application: '应用', edit: '编辑', menuBar: '应用菜单',
  undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', delete: '删除', selectAll: '全选',
  view: '查看', reload: '重新加载', forceReload: '强制重新加载', toggleDevTools: '切换开发者工具',
  actualSize: '实际大小', zoomIn: '放大', zoomOut: '缩小', toggleFullScreen: '切换全屏',
  window: '窗口', minimize: '最小化', close: '关闭',
  aboutProduct: 'DSH NEXT', quit: '退出', cancel: '取消', quitTitle: '退出 DSH NEXT？',
  quitActiveTasks: '当前正在运行的任务将会中断',
  quitScheduledTasks: '应用关闭期间，定时任务不会运行',
  quitActiveAndScheduledTasks: '当前正在运行的任务将会中断，且应用关闭期间，定时任务不会运行',
  quitAndRestart: '退出并重启', quitAndRestartTitle: '退出并重启 DSH NEXT？',
  installAndRestart: '安装并重启', installAndRestartTitle: '安装更新并重启 DSH NEXT？' }

/** The copy of one built-in language. */
export type DesktopMessages = typeof en
/** One resolved built-in language. */
export interface DesktopLocale { readonly messages: DesktopMessages }

/** Follow the OS preference order, using the same primary-language match as the official frontend. */
export function preferredDesktopLocale(languages: readonly string[]): 'zh' | 'en' {
  for (const language of languages) {
    const primary = language.toLowerCase().replaceAll('_', '-').split('-')[0]
    if (primary === 'zh' || primary === 'en') return primary
  }
  return 'en'
}

export function resolveDesktopLocale(language: string): DesktopLocale {
  return { messages: language.toLowerCase().startsWith('zh') ? zh : en }
}

/**
 * Application-menu bars that Electron only localizes on macOS. On Linux the bare
 * `role` menus stay English, so expand them with the same bilingual copy Windows
 * already uses; macOS keeps the roles and the system-owned translations.
 */
export function roleApplicationMenuTemplate(appItems: MenuItemConstructorOptions[], language: string): MenuItemConstructorOptions[] {
  const application: MenuItemConstructorOptions = { label: 'DSH NEXT', submenu: appItems }
  if (process.platform !== 'linux') return [application, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]
  const { messages: m } = resolveDesktopLocale(language)
  return [
    application,
    { label: m.edit, submenu: [
      { role: 'undo', label: m.undo }, { role: 'redo', label: m.redo },
      { type: 'separator' },
      { role: 'cut', label: m.cut }, { role: 'copy', label: m.copy }, { role: 'paste', label: m.paste },
      { role: 'delete', label: m.delete },
      { type: 'separator' }, { role: 'selectAll', label: m.selectAll },
    ] },
    { label: m.view, submenu: [
      { role: 'reload', label: m.reload }, { role: 'forceReload', label: m.forceReload },
      { role: 'toggleDevTools', label: m.toggleDevTools },
      { type: 'separator' },
      { role: 'resetZoom', label: m.actualSize }, { role: 'zoomIn', label: m.zoomIn }, { role: 'zoomOut', label: m.zoomOut },
      { type: 'separator' }, { role: 'togglefullscreen', label: m.toggleFullScreen },
    ] },
    { label: m.window, submenu: [
      { role: 'minimize', label: m.minimize }, { role: 'close', label: m.close },
    ] },
  ]
}
