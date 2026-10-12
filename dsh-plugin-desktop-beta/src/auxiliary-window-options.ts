/** Shared custom frame options for Desktop-owned auxiliary windows. */

import type { BrowserWindowConstructorOptions } from 'electron'
import { DESKTOP_FRAME_HEIGHT, DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP } from './window-chrome.ts'

/** Whether a renderer-owned frame is needed below visible native controls. */
export function auxiliaryWindowHasCustomFrame(
  platform: NodeJS.Platform = process.platform,
  windowControls = true,
): boolean {
  return windowControls && (platform === 'darwin' || platform === 'win32')
}

/** Hide the ordinary OS title row while retaining native window controls. */
export function auxiliaryWindowChromeOptions(
  platform: NodeJS.Platform = process.platform,
  windowControls = true,
): BrowserWindowConstructorOptions {
  if (!windowControls) {
    return {
      frame: false,
      closable: false,
      minimizable: false,
      maximizable: false,
    }
  }
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP },
    }
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#7f858f',
        height: DESKTOP_FRAME_HEIGHT,
      },
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    }
  }
  return {}
}
