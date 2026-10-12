/** Platform tray icon selection from generated assets. */

import {
  nativeImage,
  type NativeImage,
} from 'electron'
import type { DesktopPlatform, DesktopTrayIcons } from './runtime.ts'

function loadTrayIcon(path: string): NativeImage {
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) {
    throw new Error(`dsh-plugin-desktop: failed to load tray icon ${path}`)
  }
  return image
}

/**
 * Load the tray images required by one native platform.
 * @param assets - generated template and brand-color asset paths.
 * @param platform - current Electron platform.
 * @returns the image passed to the Tray constructor.
 */
export function prepareTrayIcon(
  assets: DesktopTrayIcons,
  platform: DesktopPlatform,
): NativeImage {
  if (platform === 'darwin') {
    const template = loadTrayIcon(assets.templatePath)
    template.setTemplateImage(true)
    return template
  }
  return loadTrayIcon(assets.bluePath)
}
