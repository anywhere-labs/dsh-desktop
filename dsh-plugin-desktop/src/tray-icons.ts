/** Platform tray icon selection from generated assets. */

import {
  nativeImage,
  type NativeImage,
} from 'electron'
import type { DesktopPlatform, DesktopTrayIcons } from './runtime.ts'

/** Theme flags that select platform tray glyph variants. */
export interface TrayIconTheme {
  /** The Windows taskbar currently uses the light theme. */
  taskbarUsesLightTheme: boolean
}

function loadTrayIcon(path: string): NativeImage {
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) {
    throw new Error(`dsh-plugin-desktop: failed to load tray icon ${path}`)
  }
  return image
}

/**
 * Load the tray images required by one native platform.
 * @param assets - generated template, brand-color, and taskbar-variant asset paths.
 * @param platform - current Electron platform.
 * @param theme - Windows taskbar theme flags selecting the glyph variant.
 * @returns the image passed to the Tray constructor.
 */
export function prepareTrayIcon(
  assets: DesktopTrayIcons,
  platform: DesktopPlatform,
  theme?: TrayIconTheme,
): NativeImage {
  if (platform === 'darwin') {
    const template = loadTrayIcon(assets.templatePath)
    template.setTemplateImage(true)
    return template
  }
  if (platform === 'win32') {
    return loadTrayIcon(theme?.taskbarUsesLightTheme === true
      ? assets.lightTaskbarPath
      : assets.darkTaskbarPath)
  }
  return loadTrayIcon(assets.bluePath)
}
