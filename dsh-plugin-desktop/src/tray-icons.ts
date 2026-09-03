/** Platform tray icon selection from generated assets. */

import {
  nativeImage,
  type NativeImage,
} from 'electron'
import type { DesktopPlatform, DesktopTrayIcons } from './runtime.ts'
import { readWindowsTaskbarUsesLightTheme } from './windows-taskbar-theme.ts'

function loadTrayIcon(path: string): NativeImage {
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) {
    throw new Error(`dsh-plugin-desktop: failed to load tray icon ${path}`)
  }
  return image
}

/**
 * Resolve the tray asset path for one platform.
 * @param assets - generated template and brand-color asset paths.
 * @param platform - current Electron platform.
 * @param taskbarLight - Windows-only override; defaults to the live registry read.
 */
export function resolveTrayIconPath(
  assets: DesktopTrayIcons,
  platform: DesktopPlatform,
  taskbarLight?: boolean,
): string {
  if (platform === 'darwin') return assets.templatePath
  if (platform === 'win32') {
    const light = taskbarLight ?? readWindowsTaskbarUsesLightTheme()
    return light ? assets.bluePath : assets.winDarkTaskbarPath
  }
  return assets.bluePath
}

/**
 * Load the tray images required by one native platform.
 * @param assets - generated template and brand-color asset paths.
 * @param platform - current Electron platform.
 * @param taskbarLight - Windows-only override; defaults to the live registry read.
 * @returns the image passed to the Tray constructor.
 */
export function prepareTrayIcon(
  assets: DesktopTrayIcons,
  platform: DesktopPlatform,
  taskbarLight?: boolean,
): NativeImage {
  if (platform === 'darwin') {
    const template = loadTrayIcon(assets.templatePath)
    template.setTemplateImage(true)
    return template
  }
  return loadTrayIcon(resolveTrayIconPath(assets, platform, taskbarLight))
}
