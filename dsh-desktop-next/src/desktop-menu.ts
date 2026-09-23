/** Preserve the original Desktop tray ordering for the capabilities Next provides. */
import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopCommand, DesktopState } from './desktop-contract.ts'
import { updateAction, updateLabel } from './update-state.ts'

export function desktopMenu(state: DesktopState, language: string, show: () => void, run: (command: DesktopCommand) => void): MenuItemConstructorOptions[] {
  const t = (zh: string, en: string): string => language.toLowerCase().startsWith('zh') ? zh : en
  const action = (label: string, type: DesktopCommand['type'], enabled = true): MenuItemConstructorOptions => ({
    label, enabled: enabled && (!state.busy || type === 'controls'), click: () => run({ type } as DesktopCommand),
    ...(type === 'controls' ? { accelerator: 'CmdOrCtrl+,' } : {}),
  })
  return [
    { label: t('打开 DSH NEXT', 'Open DSH NEXT'), click: show },
    action(t('重新加载界面', 'Reload Interface'), 'reload', state.phase === 'ready'),
    { type: 'separator' },
    ...(['darwin', 'win32'].includes(state.platform) ? [action(t('打开 DSH 终端', 'Open DSH Terminal'), 'terminal')] : []),
    action(t('导出诊断信息…', 'Export Diagnostics…'), 'diagnostics'),
    action(state.safeMode ? t('退出安全模式并重启…', 'Exit Safe Mode and Restart…') : t('进入安全模式…', 'Enter Safe Mode…'), state.safeMode ? 'normal-mode' : 'safe-mode'),
    { type: 'separator' },
    { label: `${t('Profile：', 'Profile: ')}${state.selected}`, submenu: [
      ...state.profiles.map(name => ({ label: state.unavailableProfiles.includes(name) ? `${name}${t('（不可用于桌面端）', ' (Unavailable for Desktop)')}` : name, type: 'radio' as const, checked: name === state.selected,
        enabled: !state.busy && !state.unavailableProfiles.includes(name), click: () => { if (name !== state.selected || state.safeMode || state.phase !== 'ready') run({ type: 'switch', name }) } })),
      { type: 'separator' },
      { label: t('新建 Profile…', 'New Profile…'), enabled: !state.busy, click: () => run({ type: 'controls', page: 'create-profile' }) },
      { label: t('管理 Profile…', 'Manage Profiles…'), click: () => run({ type: 'controls', page: 'profiles' }) },
    ] },
    { type: 'separator' },
    action(t('设置…', 'Settings…'), 'controls'),
    ...(state.updates ? [action(updateLabel(state.updates, language), updateAction(state.updates) ?? 'check-updates', !!updateAction(state.updates))] : []),
    ...(state.browserUrl ? [action(t('在浏览器中打开', 'Open in Browser'), 'open-browser')] : []),
    { label: t('恢复助手…', 'Recovery Assistant…'), click: () => run({ type: 'controls', page: 'recovery' }) },
    { type: 'separator' },
    { label: t('退出', 'Quit'), accelerator: 'CmdOrCtrl+Q', click: () => run({ type: 'quit' }) },
  ]
}
