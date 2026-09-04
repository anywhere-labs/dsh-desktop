import { app } from 'electron'
import type { BrowserWindow } from 'electron'

/**
 * Return whether an activation event needs to bring the application forward.
 *
 * The app-level `activate` event is an explicit macOS Dock/relaunch path.
 * Broader lifecycle notifications such as `did-become-active` are deliberately
 * not reveal signals: treating them as one would restore a window while the
 * user is working in another application.  Other callers should reserve
 * revealApplication for explicit UI actions such as a tray click or menu item.
 */
export function applicationNeedsReveal(
  window: Pick<BrowserWindow, 'isMinimized' | 'isVisible'>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return window.isMinimized()
    || !window.isVisible()
    || platform === 'darwin' && app.isHidden()
}

/** Reveal a native window, restoring the macOS application before the window. */
export function revealApplication(
  window: Pick<BrowserWindow, 'isMinimized' | 'show' | 'restore' | 'focus'>,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'darwin' && app.isHidden()) app.show()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
