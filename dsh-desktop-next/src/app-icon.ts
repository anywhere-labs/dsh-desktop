/** Which artwork the running Desktop shows; renderer-safe, so settings and setup share the copy. */

/**
 * `default` is the whale tail every package installs. `classic` is the DeepSeek whale the app showed before it,
 * which `icons:export` keeps below `build/classic` and `assets/classic`.
 */
export type DesktopAppIcon = 'default' | 'classic'

export const DESKTOP_APP_ICONS: readonly DesktopAppIcon[] = Object.freeze(['default', 'classic'])

export function isDesktopAppIcon(value: unknown): value is DesktopAppIcon {
  return value === 'default' || value === 'classic'
}

/**
 * @param icon - A choice.
 * @param zh - Chinese copy.
 * @returns The choice's short name.
 */
export function appIconLabel(icon: DesktopAppIcon, zh: boolean): string {
  return icon === 'classic' ? zh ? '经典' : 'Classic' : zh ? '默认' : 'Default'
}

/**
 * Where a choice shows. On macOS the running app replaces its Dock and menu bar images, while the signed bundle keeps
 * its own icon. Windows and Linux packages are not signed, so the app also points the shortcuts and the desktop entry
 * they installed at the choice; only the program file itself keeps the default.
 * @param platform - `process.platform` of the app.
 * @param zh - Chinese copy.
 */
export function appIconDescription(platform: string | undefined, zh: boolean): string {
  if (platform === 'darwin') {
    return zh ? '更改程序坞和菜单栏中的图标，立即生效。访达、通知以及应用未运行时的程序坞仍显示默认图标。'
      : 'Changes the icon in the Dock and menu bar right away. Finder, notifications and the Dock while the app is not running keep the default icon.'
  }
  if (platform === 'win32') {
    return zh ? '更改开始菜单、桌面和任务栏快捷方式，以及窗口和托盘中的图标，立即生效。程序文件本身仍显示默认图标；为所有用户安装时，开始菜单和桌面快捷方式需要管理员权限，也保持默认。'
      : 'Changes the icon of Start menu, desktop and taskbar shortcuts, windows and the tray right away. The program file itself keeps the default icon; when installed for all users, so do the Start menu and desktop shortcuts, which need administrator rights.'
  }
  return zh ? '更改应用菜单、程序坞、窗口和托盘中的图标，立即生效。AppImage 只更改窗口和托盘中的图标。'
    : 'Changes the icon in the application menu, dock, windows and tray right away. An AppImage changes only the window and tray icons.'
}
